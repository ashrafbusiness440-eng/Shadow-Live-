import { json, readJson } from "./http.js";
import { verifyFirebaseIdToken } from "./firebase-auth.js";
import { firestoreClient } from "./firestore.js";
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
const allowedActions = new Set([
  "suspend",
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

async function deleteAuthUser(env, targetUid) {
  try {
    return await identityRequest(env, "delete", { localId: targetUid });
  } catch (error) {
    if (error instanceof ApiError && /USER_NOT_FOUND/i.test(error.code)) return {};
    throw error;
  }
}

function statusPatch(action, body, actorUid, now) {
  const base = {
    moderatedBy: actorUid,
    moderatedAt: now,
    moderationReason: clean(body.reason),
  };

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
  if (action === "deleteAccount") {
    return {
      ...base,
      accountStatus: "deleted",
      authDeleted: true,
      deletedAt: now,
      deletedBy: actorUid,
      deletionReason: clean(body.reason),
      adminEnabled: false,
      capabilities: [],
      suspendedUntil: null,
      suspensionMinutes: null,
      bannedAt: null,
      disabledAt: null,
      sessionsRevokedAt: now,
    };
  }
  throw new ApiError("invalid_action", 400);
}

async function mutateAccount(db, env, actorUid, body) {
  const targetUid = clean(body.targetUid);
  const action = clean(body.accountAction);
  const reason = clean(body.reason);
  const key = clean(body.idempotencyKey);

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
      : action === "suspend"
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

  const [targetSnap, operationSnap] = await Promise.all([
    db.get(`users/${targetUid}`),
    db.get(`control_operations/${key}`),
  ]);
  if (operationSnap.exists) {
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

  if (action === "deleteAccount") {
    await deleteAuthUser(env, targetUid);
  } else if (action === "unban" || action === "enable") {
    // Also repairs legacy accounts that were disabled in Firebase Auth.
    await updateAuthUser(env, targetUid, { disabled: false, revoke: true });
  } else if (action === "revokeSessions") {
    await updateAuthUser(env, targetUid, { revoke: true });
  } else {
    // suspend / ban / disable are enforced by Firestore accountStatus and
    // every Shadow API request. Keep Firebase Auth usable so the client can
    // read only its own moderation record and show the exact reason/expiry.
  }

  const transaction = await db.beginTransaction();
  try {
    const [operationSnap, freshTargetSnap] = await Promise.all([
      db.get(`control_operations/${key}`, transaction),
      db.get(`users/${targetUid}`, transaction),
    ]);

    if (operationSnap.exists) {
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

    const now = new Date();
    const patch = statusPatch(action, body, actorUid, now);
    const before = {
      accountStatus: clean(freshTarget.accountStatus || "active") || "active",
      suspendedUntil: freshTarget.suspendedUntil || null,
      role: clean(freshTarget.role || "user") || "user",
      adminEnabled: freshTarget.adminEnabled === true,
      authDeleted: freshTarget.authDeleted === true,
    };
    const after = {
      ...before,
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
      accountStatus: after.accountStatus,
      suspendedUntil: after.suspendedUntil,
      authDeleted: after.authDeleted,
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
    ]);

    return { ok: true, code: "ok", operationId: key, ...resultData };
  } catch (error) {
    await db.rollback(transaction);
    throw error;
  }
}

export async function manageUserAccount(request, env) {
  if (request.method !== "POST") {
    return json(request, env, { ok: false, code: "method_not_allowed" }, 405);
  }

  try {
    const decoded = await verifyFirebaseIdToken(request, env);
    const authAge = Math.floor(Date.now() / 1000) - Number(decoded.auth_time || 0);
    if (!Number.isFinite(authAge) || authAge > 1800) {
      throw new ApiError("recent_auth_required", 401);
    }
    const body = await readJson(request);
    const result = await mutateAccount(
      firestoreClient(env),
      env,
      decoded.sub,
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
  const rows = await db.runQuery("users", {
    filters: [{ field: "accountStatus", op: "==", value: "suspended" }],
    limit: 100,
  });
  const nowMs = Date.now();
  const due = rows.filter((row) => {
    const until = Date.parse(String(row.data?.suspendedUntil || ""));
    return Number.isFinite(until) && until <= nowMs;
  });

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
