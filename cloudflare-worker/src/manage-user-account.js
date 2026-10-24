import { json, readJson } from "./http.js";
import {
  assertUserDocumentSessionState,
  verifyFirebaseIdToken,
} from "./firebase-auth.js";
import {
  firestoreClient,
  firestoreErrorRetryDelayMs,
  isTransientFirestoreError,
} from "./firestore.js";
import { googleAccessToken, parseServiceAccount } from "./google-auth.js";

class ApiError extends Error {
  constructor(code, status = 400) {
    super(code);
    this.code = code;
    this.status = status;
  }
}

const clean = (value) => String(value ?? "").trim();
const validKey = (value) => /^[A-Za-z0-9_-]{12,180}$/.test(clean(value));
const liftRestrictionFields = Object.freeze({
  liftPrivateMessagesRestriction: {
    until: "privateMessagesRestrictedUntil",
    minutes: "privateMessageRestrictionMinutes",
    liftedAt: "privateMessagesRestrictionLiftedAt",
    liftedBy: "privateMessagesRestrictionLiftedBy",
    label: "الرسائل الخاصة",
  },
  liftRoomChatRestriction: {
    until: "roomChatRestrictedUntil",
    minutes: "roomChatRestrictionMinutes",
    liftedAt: "roomChatRestrictionLiftedAt",
    liftedBy: "roomChatRestrictionLiftedBy",
    label: "الكتابة في الغرف",
  },
  liftRoomMicRestriction: {
    until: "roomMicRestrictedUntil",
    minutes: "roomMicRestrictionMinutes",
    liftedAt: "roomMicRestrictionLiftedAt",
    liftedBy: "roomMicRestrictionLiftedBy",
    label: "المايكروفون في الغرف",
  },
  liftRoomEntryRestriction: {
    until: "roomEntryRestrictedUntil",
    minutes: "roomEntryRestrictionMinutes",
    liftedAt: "roomEntryRestrictionLiftedAt",
    liftedBy: "roomEntryRestrictionLiftedBy",
    label: "دخول الغرف",
  },
});
// Provenance is stored on the existing user and original operation documents.
// Never guess which historical operation a legacy sanction belongs to.
const restrictionProvenance = Object.freeze({
  restrictPrivateMessages: ["privateMessagesRestrictionOperationId", "privateMessagesRestrictedUntil"],
  liftPrivateMessagesRestriction: ["privateMessagesRestrictionOperationId", "privateMessagesRestrictedUntil"],
  restrictRoomChat: ["roomChatRestrictionOperationId", "roomChatRestrictedUntil"],
  liftRoomChatRestriction: ["roomChatRestrictionOperationId", "roomChatRestrictedUntil"],
  restrictRoomEntry: ["roomEntryRestrictionOperationId", "roomEntryRestrictedUntil"],
  liftRoomEntryRestriction: ["roomEntryRestrictionOperationId", "roomEntryRestrictedUntil"],
  restrictRoomMic: ["roomMicRestrictionOperationId", "roomMicRestrictedUntil"],
  liftRoomMicRestriction: ["roomMicRestrictionOperationId", "roomMicRestrictedUntil"],
});
const activeRestrictionActions = new Set([
  "restrictPrivateMessages", "restrictRoomChat", "restrictRoomEntry", "restrictRoomMic",
]);
const accountStatusSourceActions = new Set(["suspend", "ban", "disable"]);
const accountStatusReleaseActions = new Set(["unban", "enable"]);

function restrictionTimestamp(value) {
  if (value instanceof Date) return value.getTime();
  if (typeof value?.toDate === "function") return value.toDate().getTime();
  if (typeof value?.toMillis === "function") return value.toMillis();
  const seconds = Number(value?.seconds ?? value?._seconds);
  if (value && typeof value === "object" && Number.isFinite(seconds)) {
    return seconds * 1000;
  }
  if (typeof value === "number") return value;
  const ms = Date.parse(String(value || ""));
  return Number.isFinite(ms) ? ms : 0;
}
const allowedActions = new Set([
  "suspend",
  "warn",
  "restrictPrivateMessages",
  "restrictRoomChat",
  "restrictRoomEntry",
  "restrictRoomMic",
  "liftPrivateMessagesRestriction",
  "liftRoomChatRestriction",
  "liftRoomEntryRestriction",
  "liftRoomMicRestriction",
  "ban",
  "unban",
  "disable",
  "enable",
  "revokeSessions",
  "deleteAccount",
]);

async function identityRequest(env, path, body) {
  const { projectId } = parseServiceAccount(env.FIREBASE_SERVICE_ACCOUNT);
  const token = await googleAccessToken(
    env,
    "https://www.googleapis.com/auth/identitytoolkit",
  );
  const response = await fetch(
    `https://identitytoolkit.googleapis.com/v1/projects/${encodeURIComponent(projectId)}/accounts:${path}`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    },
  );
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const code = clean(data?.error?.status || data?.error?.message || "identity_request_failed");
    throw new ApiError(code || "identity_request_failed", response.status || 500);
  }
  return data;
}

async function updateAuthUser(env, targetUid, { disabled, revoke = true } = {}) {
  const payload = { localId: targetUid };
  if (typeof disabled === "boolean") payload.disableUser = disabled;
  if (revoke) payload.validSince = String(Math.floor(Date.now() / 1000));
  return identityRequest(env, "update", payload);
}

function statusPatch(action, body, actorUid, now) {
  const base = {
    moderatedBy: actorUid,
    moderatedAt: now,
    moderationReason: clean(body.reason),
  };

  if (action === "warn") {
    return {
      ...base,
      lastWarnedAt: now,
      lastWarnedBy: actorUid,
      lastWarningReason: clean(body.reason),
    };
  }
  if (action === "restrictPrivateMessages") {
    const minutes = Number(body.durationMinutes);
    if (!Number.isInteger(minutes) || minutes < 10 || minutes > 43200) {
      throw new ApiError("invalid_restriction_duration", 400);
    }
    return {
      ...base,
      privateMessagesRestrictedUntil: new Date(Date.now() + minutes * 60000),
      privateMessageRestrictionMinutes: minutes,
      privateMessagesRestrictedBy: actorUid,
      privateMessageRestrictionReason: clean(body.reason),
    };
  }
  if (action === "restrictRoomChat") {
    const minutes = Number(body.durationMinutes);
    if (!Number.isInteger(minutes) || minutes < 10 || minutes > 43200) {
      throw new ApiError("invalid_restriction_duration", 400);
    }
    return {
      ...base,
      roomChatRestrictedUntil: new Date(now.getTime() + minutes * 60_000),
      roomChatRestrictionMinutes: minutes,
      roomChatRestrictedBy: actorUid,
      roomChatRestrictionReason: clean(body.reason),
    };
  }
  if (action === "restrictRoomEntry") {
    const minutes = Number(body.durationMinutes);
    if (!Number.isInteger(minutes) || minutes < 10 || minutes > 43200) {
      throw new ApiError("invalid_restriction_duration", 400);
    }
    return {
      ...base,
      roomEntryRestrictedUntil: new Date(now.getTime() + minutes * 60_000),
      roomEntryRestrictionMinutes: minutes,
      roomEntryRestrictedBy: actorUid,
      roomEntryRestrictionReason: clean(body.reason),
    };
  }
  if (action === "restrictRoomMic") {
    const minutes = Number(body.durationMinutes);
    if (!Number.isInteger(minutes) || minutes < 10 || minutes > 43200) {
      throw new ApiError("invalid_restriction_duration", 400);
    }
    return {
      ...base,
      roomMicRestrictedUntil: new Date(now.getTime() + minutes * 60_000),
      roomMicRestrictionMinutes: minutes,
      roomMicRestrictedBy: actorUid,
      roomMicRestrictionReason: clean(body.reason),
    };
  }
  if (liftRestrictionFields[action]) {
    const fields = liftRestrictionFields[action];
    return {
      ...base,
      [fields.until]: null,
      [fields.minutes]: null,
      [fields.liftedAt]: now,
      [fields.liftedBy]: actorUid,
    };
  }
  if (action === "suspend") {
    const minutes = Number(body.durationMinutes);
    if (!Number.isInteger(minutes) || minutes < 10 || minutes > 43200) {
      throw new ApiError("invalid_suspend_duration", 400);
    }
    return {
      ...base,
      accountStatus: "suspended",
      suspendedUntil: new Date(Date.now() + minutes * 60 * 1000),
      suspensionMinutes: minutes,
      bannedAt: null,
      disabledAt: null,
      authDeleted: false,
      sessionsRevokedAt: now,
    };
  }
  if (action === "ban") {
    return {
      ...base,
      accountStatus: "banned",
      suspendedUntil: null,
      suspensionMinutes: null,
      bannedAt: now,
      disabledAt: null,
      authDeleted: false,
      sessionsRevokedAt: now,
    };
  }
  if (action === "disable") {
    return {
      ...base,
      accountStatus: "disabled",
      suspendedUntil: null,
      suspensionMinutes: null,
      disabledAt: now,
      authDeleted: false,
      sessionsRevokedAt: now,
    };
  }
  if (action === "unban" || action === "enable") {
    return {
      ...base,
      accountStatus: "active",
      suspendedUntil: null,
      suspensionMinutes: null,
      bannedAt: null,
      disabledAt: null,
      authDeleted: false,
      sessionsRevokedAt: now,
    };
  }
  if (action === "revokeSessions") {
    return {
      ...base,
      sessionsRevokedAt: now,
    };
  }
  throw new ApiError("invalid_action", 400);
}

async function mutateAccount(db, env, actorPayload, body) {
  const actorUid = clean(actorPayload?.sub);
  const targetUid = clean(body.targetUid);
  const action = clean(body.accountAction);
  const reason = clean(body.reason);
  const key = clean(body.idempotencyKey);
  const linkedReportId = clean(body.linkedReportId);
  // Only the internal reports endpoint may supply a case-bound receipt.
  // Diary-comment report IDs can exceed the short general-report ID format.
  if (linkedReportId &&
      (linkedReportId.length > 512 ||
       linkedReportId.includes("/") || linkedReportId.includes("\\"))) {
    throw new ApiError("invalid_linked_report_id", 400);
  }
  const assertMatchingOperation = (snap) => {
    if (!snap.exists) return;
    const saved = snap.data || {};
    // Keep the established diary-moderation error contract for a receipt
    // belonging to another report, before any account mutation is retried.
    if (clean(saved.result?.linkedReportId) !== linkedReportId) {
      throw new ApiError("unverified_account_action", 409);
    }
    if (clean(saved.actorUid) !== actorUid ||
        clean(saved.targetId) !== targetUid ||
        clean(saved.action) !== action ||
        clean(saved.result?.targetUid) !== targetUid ||
        clean(saved.result?.action) !== action) {
      throw new ApiError("idempotency_key_conflict", 409);
    }
  };

  if (
    !targetUid ||
    targetUid === actorUid ||
    !allowedActions.has(action) ||
    reason.length < 3 ||
    reason.length > 160 ||
    !validKey(key)
  ) {
    throw new ApiError("invalid_request", 400);
  }

  const actorSnap = await db.get(`users/${actorUid}`);
  const actor = actorSnap.data || {};
  if (actorSnap.exists) {
    assertUserDocumentSessionState(actorPayload, actor);
  }
  const actorRole = clean(actor.role);
  const actorCapabilities = Array.isArray(actor.capabilities)
    ? actor.capabilities.map((value) => clean(value))
    : [];
  const actorEnabled = actor.adminEnabled === true;
  const actorIsOwner = actorRole === "owner" && actorEnabled;
  const hasCapability = (capability) =>
    actorEnabled && (actorIsOwner || actorCapabilities.includes(capability));

  const canSuspend =
    actorIsOwner ||
    hasCapability("suspendUsers") ||
    hasCapability("manageUsers");
  const canManageUsers =
    actorIsOwner ||
    hasCapability("manageUsers");

  const allowedForActor =
    action === "deleteAccount"
      ? actorIsOwner
      : action === "suspend" || action === "warn" ||
          action === "restrictPrivateMessages" ||
          action === "restrictRoomChat" ||
          action === "restrictRoomEntry" ||
          action === "restrictRoomMic" ||
          Boolean(liftRestrictionFields[action])
        ? canSuspend
        : action === "enable"
          ? canManageUsers || hasCapability("suspendUsers")
          : action === "unban" ||
              action === "ban" ||
              action === "disable" ||
              action === "revokeSessions"
            ? canManageUsers
            : false;

  if (!actorSnap.exists || !allowedForActor) {
    throw new ApiError("forbidden", 403);
  }

  // Legacy direct deletion erased Firebase Auth FIRST and could orphan
  // Firestore/R2 data, balances and protected evidence on partial failure.
  // Never allow this old path to bypass the verified account-erasure lifecycle.
  // The owner may still suspend/ban/revoke sessions independently.
  if (action === "deleteAccount") {
    throw new ApiError("account_deletion_lifecycle_required", 409);
  }

  const [targetSnap, operationSnap] = await Promise.all([
    db.get(`users/${targetUid}`),
    db.get(`control_operations/${key}`),
  ]);
  if (operationSnap.exists) {
    assertMatchingOperation(operationSnap);
    return {
      ok: true,
      code: "duplicate",
      operationId: key,
      ...(operationSnap.data?.result || {}),
    };
  }
  if (!targetSnap.exists) throw new ApiError("not_found", 404);
  const target = targetSnap.data || {};
  if (clean(target.role) === "owner") throw new ApiError("owner_protected", 409);

  if (action === "unban" || action === "enable") {
    // Also repairs legacy accounts that were disabled in Firebase Auth.
    await updateAuthUser(env, targetUid, { disabled: false, revoke: true });
  } else if (action === "revokeSessions") {
    await updateAuthUser(env, targetUid, { revoke: true });
  } else {
    // suspend / ban / disable are enforced by Firestore accountStatus and
    // every Shadow API request. Keep Firebase Auth usable so the client can
    // read only its own moderation record and show the exact reason/expiry.
  }

  const maxAttempts = 3;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    let transaction = null;
    try {
      transaction = await db.beginTransaction();
      const [operationSnap, freshTargetSnap] = await Promise.all([
        db.get(`control_operations/${key}`, transaction),
        db.get(`users/${targetUid}`, transaction),
      ]);

    if (operationSnap.exists) {
      assertMatchingOperation(operationSnap);
      await db.rollback(transaction);
      return {
        ok: true,
        code: "duplicate",
        operationId: key,
        ...(operationSnap.data?.result || {}),
      };
    }
    if (!freshTargetSnap.exists) {
      await db.rollback(transaction);
      throw new ApiError("not_found", 404);
    }

    const freshTarget = freshTargetSnap.data || {};
    if (clean(freshTarget.role) === "owner") {
      await db.rollback(transaction);
      throw new ApiError("owner_protected", 409);
    }
    // A warning must not modify another admin account or an inactive account.
    if (["warn", "restrictPrivateMessages", "restrictRoomChat",
      "restrictRoomEntry", "restrictRoomMic"].includes(action) && (
        (freshTarget.adminEnabled === true && !actorIsOwner) ||
        (clean(freshTarget.accountStatus || "active") !== "active") ||
        freshTarget.authDeleted === true)) {
      await db.rollback(transaction);
      throw new ApiError("warning_target_unavailable", 409);
    }

    const now = new Date();
    const liftConfig = liftRestrictionFields[action];
    if (liftConfig) {
      if ((freshTarget.adminEnabled === true && !actorIsOwner) ||
          clean(freshTarget.accountStatus || "active") !== "active" ||
          freshTarget.authDeleted === true) {
        throw new ApiError("restriction_target_unavailable", 409);
      }
      if (restrictionTimestamp(freshTarget[liftConfig.until]) <= now.getTime()) {
        throw new ApiError("restriction_not_active", 409);
      }
    }
    const patch = statusPatch(action, body, actorUid, now);
    if (action === "restrictPrivateMessages") {
      // New action must not silently shorten an existing restriction.
      const existing = freshTarget.privateMessagesRestrictedUntil;
      const oldMs = existing instanceof Date ? existing.getTime()
        : typeof existing?.toDate === "function" ? existing.toDate().getTime()
        : Number(existing?.seconds ?? existing?._seconds ?? 0) * 1000 ||
          Date.parse(String(existing || "")) || 0;
      if (oldMs > patch.privateMessagesRestrictedUntil.getTime()) {
        patch.privateMessagesRestrictedUntil = new Date(oldMs);
        patch.privateMessageRestrictionMinutes = Math.ceil(
          (oldMs - now.getTime()) / 60000);
      }
    }
    if (action === "restrictRoomChat") {
      const existing = freshTarget.roomChatRestrictedUntil;
      const seconds = Number(existing?.seconds ?? existing?._seconds);
      const oldMs = existing instanceof Date ? existing.getTime()
        : typeof existing?.toMillis === "function" ? existing.toMillis()
        : Number.isFinite(seconds) ? seconds * 1000
        : Date.parse(String(existing || "")) || 0;
      if (oldMs > patch.roomChatRestrictedUntil.getTime()) {
        patch.roomChatRestrictedUntil = new Date(oldMs);
        patch.roomChatRestrictionMinutes =
          Math.ceil((oldMs - now.getTime()) / 60_000);
      }
    }
    if (action === "restrictRoomEntry") {
      const existing = freshTarget.roomEntryRestrictedUntil;
      const seconds = Number(existing?.seconds ?? existing?._seconds);
      const oldMs = existing instanceof Date ? existing.getTime()
        : typeof existing?.toMillis === "function" ? existing.toMillis()
        : Number.isFinite(seconds) ? seconds * 1000
        : Date.parse(String(existing || "")) || 0;
      if (oldMs > patch.roomEntryRestrictedUntil.getTime()) {
        patch.roomEntryRestrictedUntil = new Date(oldMs);
        patch.roomEntryRestrictionMinutes =
          Math.ceil((oldMs - now.getTime()) / 60_000);
      }
    }
    if (action === "restrictRoomMic") {
      const oldMs = restrictionTimestamp(freshTarget.roomMicRestrictedUntil);
      if (oldMs > patch.roomMicRestrictedUntil.getTime()) {
        patch.roomMicRestrictedUntil = new Date(oldMs);
        patch.roomMicRestrictionMinutes = Math.ceil(
          (oldMs - now.getTime()) / 60_000);
      }
    }
    // One optional point-read of the active provenance receipt. Historical
    // users without a verified source are deliberately left unlinked.
    const restrictionFields = restrictionProvenance[action];
    const accountSanction = accountStatusSourceActions.has(action);
    const accountRelease = accountStatusReleaseActions.has(action);
    const sourceField = restrictionFields?.[0] ||
      (accountSanction || accountRelease ? "accountModerationOperationId" : "");
    const savedSourceId = sourceField ? clean(freshTarget[sourceField]) : "";
    let sourceOperation = null;
    if (savedSourceId && validKey(savedSourceId) && savedSourceId !== key) {
      const snap = await db.get("control_operations/" + savedSourceId, transaction);
      const saved = snap.exists ? snap.data || {} : {};
      const savedAction = clean(saved.action);
      const sharedProof = clean(saved.targetId) === targetUid &&
        clean(saved.targetType) === "user" &&
        clean(saved.status) === "completed" &&
        clean(saved.result?.targetUid) === targetUid &&
        clean(saved.result?.action) === savedAction &&
        !saved.lifecycle;
      if (sharedProof && restrictionFields &&
          activeRestrictionActions.has(savedAction) &&
          restrictionProvenance[savedAction]?.[1] === restrictionFields[1] &&
          restrictionTimestamp(saved.result?.[restrictionFields[1]]) > now.getTime() &&
          restrictionTimestamp(saved.result?.[restrictionFields[1]]) ===
            restrictionTimestamp(freshTarget[restrictionFields[1]])) {
        sourceOperation = savedSourceId;
      } else if (sharedProof && !restrictionFields &&
          accountStatusSourceActions.has(savedAction) &&
          clean(saved.result?.accountStatus) === clean(freshTarget.accountStatus) &&
          (savedAction !== "suspend" ||
            restrictionTimestamp(saved.result?.suspendedUntil) > now.getTime())) {
        sourceOperation = savedSourceId;
      }
    }
    if (sourceField) {
      patch[sourceField] = (activeRestrictionActions.has(action) || accountSanction)
        ? key : null;
    }
    if (action === "warn") {
      // Increment from the transaction snapshot; no unbounded warning query.
      patch.warningCount = Math.min(1000000,
        Math.max(0, Number(freshTarget.warningCount) || 0) + 1);
    }
    const before = {
      ...(liftConfig ? { restrictionUntil: freshTarget[liftConfig.until] || null } : {}),
      accountStatus: clean(freshTarget.accountStatus || "active") || "active",
      suspendedUntil: freshTarget.suspendedUntil || null,
      role: clean(freshTarget.role || "user") || "user",
      adminEnabled: freshTarget.adminEnabled === true,
      authDeleted: freshTarget.authDeleted === true,
    };
    const after = {
      ...before,
      ...(liftConfig ? { restrictionUntil: null } : {}),
      accountStatus: patch.accountStatus || before.accountStatus,
      suspendedUntil: Object.prototype.hasOwnProperty.call(patch, "suspendedUntil")
        ? patch.suspendedUntil
        : before.suspendedUntil,
      adminEnabled: Object.prototype.hasOwnProperty.call(patch, "adminEnabled")
        ? patch.adminEnabled
        : before.adminEnabled,
      authDeleted: Object.prototype.hasOwnProperty.call(patch, "authDeleted")
        ? patch.authDeleted
        : before.authDeleted,
    };

    const fieldPaths = Object.keys(patch);
    const resultData = {
      targetUid,
      action,
      // Report-bound receipts cannot be replayed against another case.
      ...(linkedReportId ? { linkedReportId } : {}),
      accountStatus: after.accountStatus,
      suspendedUntil: after.suspendedUntil,
      authDeleted: after.authDeleted,
      // Effective enforced duration, not merely the requested shorter extension.
      ...(action === "suspend" ? { durationMinutes: patch.suspensionMinutes } : {}),
      ...(action === "restrictPrivateMessages" ? {
        durationMinutes: patch.privateMessageRestrictionMinutes,
      } : {}),
      ...(action === "restrictRoomChat" ? {
        durationMinutes: patch.roomChatRestrictionMinutes,
      } : {}),
      ...(action === "restrictRoomEntry" ? {
        durationMinutes: patch.roomEntryRestrictionMinutes,
      } : {}),
      ...(action === "restrictRoomMic" ? {
        durationMinutes: patch.roomMicRestrictionMinutes,
      } : {}),
      ...(action === "restrictPrivateMessages" ? {
        privateMessagesRestrictedUntil: patch.privateMessagesRestrictedUntil,
      } : {}),
      ...(action === "restrictRoomChat" ? {
        roomChatRestrictedUntil: patch.roomChatRestrictedUntil,
      } : {}),
      ...(action === "restrictRoomEntry" ? {
        roomEntryRestrictedUntil: patch.roomEntryRestrictedUntil,
      } : {}),
      ...(action === "restrictRoomMic" ? {
        roomMicRestrictedUntil: patch.roomMicRestrictedUntil,
      } : {}),
      ...(liftRestrictionFields[action] ? {
        liftedRestriction: liftRestrictionFields[action].until,
        restrictionLiftedAt: now,
      } : {}),
      ...((liftConfig || accountRelease) && sourceOperation
        ? { originalOperationId: sourceOperation } : {}),
    };

    await db.commit(transaction, [
      db.writeUpdate(`users/${targetUid}`, patch, fieldPaths),
      db.writeCreate(`admin_audit_logs/account_${key}`, {
        actorUid,
        action,
        targetType: "user",
        targetId: targetUid,
        reason,
        before,
        after,
        operationId: key,
        createdAt: now,
      }),
      db.writeCreate(`control_operations/${key}`, {
        action,
        actorUid,
        targetType: "user",
        targetId: targetUid,
        status: "completed",
        result: resultData,
        createdAt: now,
      }),
      ...(sourceOperation ? [db.writeUpdate(
        "control_operations/" + sourceOperation, {
          lifecycle: {
            type: liftConfig || accountRelease ? "lifted" : "replaced",
            operationId: key,
            action,
            actorUid,
            at: now,
            reason,
          },
        }, ["lifecycle"],
      )] : []),
      ...(action === "restrictPrivateMessages" ? [
        db.writeCreate(`notifications/account_private_messages_${key}`, {
          userId: targetUid,
          type: "account_private_messages_restricted",
          operationId: key,
          category: "social",
          title: "تقييد إرسال الرسائل الخاصة",
          body: "تم تقييد إرسال الرسائل الخاصة مؤقتًا. السبب: " + reason +
            ". تنتهي المدة: " + patch.privateMessagesRestrictedUntil.toISOString(),
          read: false,
          createdAt: now,
          updatedAt: now,
        }),
      ] : []),
      ...(action === "restrictRoomChat" ? [
        db.writeCreate(`notifications/account_room_chat_${key}`, {
          userId: targetUid,
          type: "account_room_chat_restricted",
          operationId: key,
          category: "social",
          title: "تقييد الكتابة في الغرف",
          body: "تم تقييد إرسال الرسائل داخل الغرف مؤقتًا. السبب: " + reason +
            ". موعد انتهاء التقييد: " + patch.roomChatRestrictedUntil.toISOString(),
          read: false,
          createdAt: now,
          updatedAt: now,
        }),
      ] : []),
      ...(action === "restrictRoomEntry" ? [
        db.writeCreate(`notifications/account_room_entry_${key}`, {
          userId: targetUid,
          type: "account_room_entry_restricted",
          operationId: key,
          category: "social",
          title: "منع دخول الغرف مؤقتًا",
          body: "تم منعك مؤقتًا من دخول الغرف. السبب: " + reason +
            ". موعد انتهاء المنع: " + patch.roomEntryRestrictedUntil.toISOString(),
          read: false,
          createdAt: now,
          updatedAt: now,
        }),
      ] : []),
      ...(action === "restrictRoomMic" ? [
        db.writeCreate(`notifications/account_room_mic_${key}`, {
          userId: targetUid,
          type: "account_room_mic_restricted",
          operationId: key,
          category: "social",
          title: "كتم المايكروفون في الغرف",
          body: "تم تقييد استخدام المايكروفون مؤقتًا. السبب: " + reason +
            ". موعد انتهاء الكتم: " + patch.roomMicRestrictedUntil.toISOString(),
          read: false,
          createdAt: now,
          updatedAt: now,
        }),
      ] : []),
      ...(liftRestrictionFields[action] ? [
        db.writeCreate(`notifications/account_restriction_lifted_${key}`, {
          userId: targetUid,
          type: "account_restriction_lifted",
          category: "social",
          title: "رفع تقييد إداري",
          body: "تم رفع التقييد عن " + liftRestrictionFields[action].label +
            ". السبب: " + reason,
          read: false,
          createdAt: now,
          updatedAt: now,
        }),
      ] : []),
      ...(["suspend", "ban"].includes(action) ? [
        db.writeCreate(`notifications/account_sanction_${key}`, {
          userId: targetUid,
          operationId: key,
          type: "account_sanction",
          category: "security",
          title: action === "ban" ? "قرار حظر الحساب" : "قرار تعليق الحساب",
          body: (action === "ban" ? "تم حظر حسابك. " :
            "تم تعليق حسابك مؤقتًا. ") +
            "السبب: " + reason +
            ". يمكنك طلب مراجعة القرار من إشعار الإجراءات.",
          read: false, createdAt: now, updatedAt: now,
        }),
      ] : []),
      ...(action === "warn" ? [
        db.writeCreate(`notifications/account_warning_${key}`, {
          userId: targetUid,
          type: "account_warning",
          category: "social",
          title: "تنبيه من إدارة شادو لايف",
          body: "تم توجيه تحذير إلى حسابك. السبب: " + reason,
          read: false,
          createdAt: now,
          updatedAt: now,
        }),
      ] : []),
    ]);

      return { ok: true, code: "ok", operationId: key, ...resultData };
    } catch (error) {
      if (transaction) {
        await db.rollback(transaction);
      }
      if (error instanceof ApiError) throw error;
      if (
        attempt < maxAttempts - 1 &&
        isTransientFirestoreError(error)
      ) {
        await new Promise((resolve) =>
          setTimeout(resolve, firestoreErrorRetryDelayMs(attempt)),
        );
        continue;
      }
      throw error;
    }
  }

  throw new ApiError("transaction_failed", 500);
}

export async function manageUserAccount(request, env) {
  if (request.method !== "POST") {
    return json(request, env, { ok: false, code: "method_not_allowed" }, 405);
  }

  try {
    const decoded = await verifyFirebaseIdToken(request, env, {
      checkUserState: false,
    });
    const authAge = Math.floor(Date.now() / 1000) - Number(decoded.auth_time || 0);
    if (!Number.isFinite(authAge) || authAge > 1800) {
      throw new ApiError("recent_auth_required", 401);
    }
    const body = await readJson(request);
    // A client must never manufacture a report-bound moderation receipt.
    if (Object.prototype.hasOwnProperty.call(body, "linkedReportId")) {
      throw new ApiError("invalid_request", 400);
    }
    const result = await mutateAccount(
      firestoreClient(env),
      env,
      decoded,
      body,
    );
    return json(request, env, result, 200);
  } catch (error) {
    if (error instanceof ApiError) {
      return json(request, env, { ok: false, code: error.code }, error.status);
    }
    const raw = clean(error?.message);
    if (raw === "unauthorized") {
      return json(request, env, { ok: false, code: "unauthorized" }, 401);
    }
    if (raw === "server_not_configured" || raw === "invalid_service_account_json") {
      return json(request, env, { ok: false, code: raw }, 503);
    }
    return json(
      request,
      env,
      { ok: false, code: raw || "account_management_failed" },
      500,
    );
  }
}

export async function releaseExpiredSuspensions(env) {
  const db = firestoreClient(env);
  const nowMs = Date.now();
  // Pressure Root Fix Step 12: suspendedUntil is cleared when a suspension
  // ends, so a single-field due-time query avoids re-reading up to 100 future
  // suspensions on every five-minute cron sweep.
  const rows = await db.runQuery("users", {
    filters: [{
      field: "suspendedUntil",
      op: "<=",
      value: new Date(nowMs),
    }],
    limit: 25,
  });
  const due = rows.filter((row) =>
    String(row.data?.accountStatus || "") === "suspended"
  );

  let released = 0;
  for (const row of due) {
    try {
      await updateAuthUser(env, row.id, { disabled: false, revoke: true });
      const now = new Date();
      await db.commit(null, [
        db.writeUpdate(
          `users/${row.id}`,
          {
            accountStatus: "active",
            suspendedUntil: null,
            suspensionMinutes: null,
            moderatedBy: "system",
            moderatedAt: now,
            moderationReason: "automatic suspension expiry",
          },
          [
            "accountStatus",
            "suspendedUntil",
            "suspensionMinutes",
            "moderatedBy",
            "moderatedAt",
            "moderationReason",
          ],
        ),
        db.writeCreate(
          `admin_audit_logs/auto_unsuspend_${row.id}_${nowMs}`,
          {
            actorUid: "system",
            action: "autoUnsuspend",
            targetType: "user",
            targetId: row.id,
            reason: "temporary suspension expired",
            before: {
              accountStatus: "suspended",
              suspendedUntil: row.data?.suspendedUntil || null,
            },
            after: { accountStatus: "active", suspendedUntil: null },
            operationId: `auto_unsuspend_${row.id}_${nowMs}`,
            createdAt: now,
          },
        ),
      ]);
      released++;
    } catch (_) {
      // Keep the account suspended; the next cron run retries.
    }
  }
  return { checked: rows.length, released };
}

// Reuse the same audited, permission-checked account action from reports.
export { mutateAccount };
