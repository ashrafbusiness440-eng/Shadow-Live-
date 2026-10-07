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
import { loadVipPolicy } from "./vip-policy.js";
import {
  applyAdminVipGrant,
  materializeVipState,
  removeAdminVipGrant,
} from "./vip-state.js";
import {
  vipPublicProfilePatch,
  vipStateFromUser,
  vipUserPatch,
} from "./vip-runtime.js";

class ApiError extends Error {
  constructor(code, status = 400) {
    super(code);
    this.code = code;
    this.status = status;
  }
}

const clean = (value) => String(value ?? "").trim();
const validKey = (value) => /^[A-Za-z0-9_-]{12,160}$/.test(clean(value));
const ALL_VIP_LEVELS = Object.freeze([1,2,3,4,5,6,7,8,9,10]);
const MAX_DATE_MS = 8_640_000_000_000_000;

function normalizeDigits(value) {
  let text = clean(value);
  const arabic = "٠١٢٣٤٥٦٧٨٩";
  const persian = "۰۱۲۳۴۵۶۷۸۹";
  for (let i = 0; i < 10; i += 1) {
    text = text
      .split(arabic[i]).join(String(i))
      .split(persian[i]).join(String(i));
  }
  return text;
}

function normalizeSearchText(value) {
  let text = String(value ?? "").toLowerCase();
  const arabic = "٠١٢٣٤٥٦٧٨٩";
  const persian = "۰۱۲۳۴۵۶۷۸۹";
  for (let i = 0; i < 10; i += 1) {
    text = text
      .split(arabic[i]).join(String(i))
      .split(persian[i]).join(String(i));
  }
  return text
    .replace(/[\u064B-\u065F\u0670\u06D6-\u06ED]/g, "")
    .replace(/ـ/g, "")
    .replace(/[أإآٱ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/\s+/g, " ")
    .trim();
}

function actorCapabilities(actor = {}) {
  return new Set(
    Array.isArray(actor.capabilities)
      ? actor.capabilities.map(clean).filter(Boolean)
      : [],
  );
}

export function normalizeAllowedVipGrantLevels(value) {
  if (!Array.isArray(value) || value.length > 10) return [];
  const levels = [];
  for (const raw of value) {
    const level = Number(raw);
    if (!Number.isInteger(level) || level < 1 || level > 10) return [];
    levels.push(level);
  }
  return [...new Set(levels)].sort((a, b) => a - b);
}

export function vipControlAccess(actor = {}) {
  if (clean(actor.role) === "owner") {
    return {
      canManageVipLevels: true,
      isOwner: true,
      allowedVipGrantLevels: [...ALL_VIP_LEVELS],
    };
  }
  const role = clean(actor.role);
  const capabilities = actorCapabilities(actor);
  const eligibleRole = role === "admin" || role === "super_admin";
  const canManageVipLevels =
    actor.adminEnabled === true &&
    eligibleRole &&
    capabilities.has("manageVipLevels");
  return {
    canManageVipLevels,
    isOwner: false,
    allowedVipGrantLevels: canManageVipLevels
      ? normalizeAllowedVipGrantLevels(actor.allowedVipGrantLevels)
      : [],
  };
}

async function loadActor(db, payload) {
  const uid = clean(payload?.sub);
  if (!uid) throw new ApiError("unauthorized", 401);
  const snap = await db.get(`users/${uid}`);
  if (!snap.exists) throw new ApiError("forbidden", 403);
  const actor = snap.data || {};
  assertUserDocumentSessionState(payload, actor);
  const access = vipControlAccess(actor);
  if (!access.canManageVipLevels) throw new ApiError("forbidden", 403);
  return { uid, actor, access };
}

function publicUser(uid, user, state) {
  const expiry = (value) => {
    const number = Number(value || 0);
    return Number.isSafeInteger(number) && number > 0 ? number : 0;
  };
  return {
    uid,
    displayName: clean(
      user.displayName || user.name || user.username || "مستخدم Shadow Live",
    ),
    username: clean(user.username),
    publicId: clean(user.publicId),
    profileImageUrl: clean(
      user.profileImageUrl ||
      user.profileImage ||
      user.avatarUrl,
    ),
    profileAvatarAsset: clean(user.profileAvatarAsset),
    activeProfileFrameAssetKey: clean(user.activeProfileFrameAssetKey),
    activeProfileFrameImageUrl: clean(user.activeProfileFrameImageUrl),
    activeProfileFrameExpiresAtMs: Math.max(
      0,
      Number(user.activeProfileFrameExpiresAtMs || 0),
    ),
    activeProfileFramePermanent:
      user.activeProfileFramePermanent === true,
    role: clean(user.role || "user") || "user",
    accountStatus: clean(user.accountStatus || "active") || "active",
    vip: {
      earnedVipLevel: Number(state.earnedVipLevel || 0),
      effectiveVipLevel: Number(state.effectiveVipLevel || 0),
      effectiveVipSource: clean(state.effectiveVipSource || "none"),
      adminGrantVipLevel: Number(state.adminGrantVipLevel || 0),
      trialVipLevel: Number(state.trialVipLevel || 0),
      growthPoints: Number(state.growthPoints || 0),
      maintenancePoints: Number(state.maintenancePoints || 0),
      earnedVipExpiresAtMs: expiry(state.earnedVipExpiresAtMs),
      adminGrantExpiresAtMs: expiry(state.adminGrantExpiresAtMs),
      trialVipExpiresAtMs: expiry(state.trialVipExpiresAtMs),
    },
  };
}

export async function searchVipUsers(db, payload, body) {
  const { access } = await loadActor(db, payload);
  const rawQuery = clean(body.query);
  const query = normalizeSearchText(rawQuery);
  if (!query || query.length > 120) throw new ApiError("invalid_request", 400);

  const uidCandidates = [];
  const directUid = clean(rawQuery);
  if (directUid && !directUid.includes("/") && directUid.length <= 220) {
    const direct = await db.get(`users/${directUid}`).catch(() => ({ exists: false }));
    if (direct.exists) uidCandidates.push(directUid);
  }

  const numericId = normalizeDigits(rawQuery);
  if (/^\d{3,8}$/.test(numericId)) {
    const registry = await db.get(`public_ids/${numericId}`).catch(() => ({ exists: false }));
    const mappedUid = clean(registry.data?.uid);
    if (registry.exists && mappedUid) uidCandidates.push(mappedUid);
  }

  if (uidCandidates.length === 0) {
    const profileRows = await db.runQuery("public_profiles", {
      filters: [{ field: "searchTokens", op: "array-contains", value: query }],
      limit: 20,
    }).catch(() => []);
    for (const row of profileRows) {
      const uid = clean(row.id);
      if (uid) uidCandidates.push(uid);
    }
  }

  const unique = [...new Set(uidCandidates)].slice(0, 20);
  if (unique.length === 0) {
    return {
      ok: true,
      code: "ok",
      query: rawQuery,
      results: [],
      isOwner: access.isOwner,
      allowedVipGrantLevels: [...access.allowedVipGrantLevels],
    };
  }

  const nowMs = Date.now();
  const [policy, snaps] = await Promise.all([
    loadVipPolicy(db),
    Promise.all(unique.map((uid) =>
      db.get(`users/${uid}`).catch(() => ({ exists: false, data: null }))
    )),
  ]);

  const results = [];
  for (let i = 0; i < unique.length; i += 1) {
    const snap = snaps[i];
    if (!snap?.exists) continue;
    const user = snap.data || {};
    const state = materializeVipState(policy, vipStateFromUser(user), nowMs);
    results.push(publicUser(unique[i], user, state));
  }

  return {
    ok: true,
    code: "ok",
    query: rawQuery,
    results,
    isOwner: access.isOwner,
    allowedVipGrantLevels: [...access.allowedVipGrantLevels],
  };
}

function requestedGrantExpiry(nowMs, body) {
  const durationMinutes = Number(body.durationMinutes);
  if (!Number.isSafeInteger(durationMinutes) || durationMinutes <= 0) {
    throw new ApiError("invalid_grant_duration", 400);
  }
  const durationMs = durationMinutes * 60_000;
  if (!Number.isSafeInteger(durationMs)) {
    throw new ApiError("invalid_grant_duration", 400);
  }
  const expiresAtMs = nowMs + durationMs;
  if (
    !Number.isSafeInteger(expiresAtMs) ||
    expiresAtMs <= nowMs ||
    expiresAtMs > MAX_DATE_MS
  ) {
    throw new ApiError("invalid_grant_duration", 400);
  }
  return expiresAtMs;
}

export async function updateAdminVipGrant(db, payload, body, nowMs = Date.now()) {
  const actorUid = clean(payload?.sub);
  const targetUid = clean(body.targetUid);
  const mode = clean(body.mode);
  const reason = clean(body.reason);
  const key = clean(body.idempotencyKey);
  const requestedLevel = Number(body.vipLevel);

  if (
    !actorUid ||
    !targetUid ||
    targetUid.includes("/") ||
    !["grant", "change", "remove"].includes(mode) ||
    reason.length > 160 ||
    !validKey(key)
  ) {
    throw new ApiError("invalid_request", 400);
  }
  if (mode !== "remove" && (
    !Number.isInteger(requestedLevel) ||
    requestedLevel < 1 ||
    requestedLevel > 10
  )) {
    throw new ApiError("invalid_vip_level", 400);
  }
  const expiresAtMs =
    mode === "remove" ? 0 : requestedGrantExpiry(nowMs, body);

  for (let attempt = 0; attempt < 3; attempt += 1) {
    let transaction = null;
    try {
      transaction = await db.beginTransaction();
      const [actorSnap, targetSnap, operationSnap, policy] = await Promise.all([
        db.get(`users/${actorUid}`, transaction),
        db.get(`users/${targetUid}`, transaction),
        db.get(`control_operations/${key}`, transaction),
        loadVipPolicy(db, { transaction, useCache: false }),
      ]);

      if (!actorSnap.exists) {
        await db.rollback(transaction);
        throw new ApiError("forbidden", 403);
      }
      const actor = actorSnap.data || {};
      assertUserDocumentSessionState(payload, actor);
      const access = vipControlAccess(actor);
      if (!access.canManageVipLevels) {
        await db.rollback(transaction);
        throw new ApiError("forbidden", 403);
      }

      if (operationSnap.exists) {
        await db.rollback(transaction);
        return {
          ok: true,
          code: "duplicate",
          operationId: key,
          ...(operationSnap.data?.result || {}),
        };
      }

      if (!targetSnap.exists) {
        await db.rollback(transaction);
        throw new ApiError("not_found", 404);
      }
      const target = targetSnap.data || {};
      if (clean(target.role) === "owner" && !access.isOwner) {
        await db.rollback(transaction);
        throw new ApiError("owner_protected", 409);
      }

      const beforeState = materializeVipState(
        policy,
        vipStateFromUser(target),
        nowMs,
      );
      const currentAdminGrantLevel = Number(
        beforeState.adminGrantVipLevel || 0,
      );
      if (mode === "grant" && currentAdminGrantLevel > 0) {
        await db.rollback(transaction);
        throw new ApiError("admin_vip_grant_exists", 409);
      }
      if (mode === "change" && currentAdminGrantLevel < 1) {
        await db.rollback(transaction);
        throw new ApiError("admin_vip_grant_missing", 409);
      }
      if (!access.isOwner) {
        const allowed = new Set(access.allowedVipGrantLevels);
        if (
          (mode === "grant" && !allowed.has(requestedLevel)) ||
          (mode === "change" &&
            (!allowed.has(currentAdminGrantLevel) ||
              !allowed.has(requestedLevel))) ||
          (mode === "remove" &&
            (currentAdminGrantLevel < 1 ||
              !allowed.has(currentAdminGrantLevel)))
        ) {
          await db.rollback(transaction);
          throw new ApiError("vip_level_not_allowed", 403);
        }
      }

      let afterState;
      if (mode === "remove") {
        afterState = removeAdminVipGrant(policy, beforeState, nowMs);
      } else {
        afterState = applyAdminVipGrant(
          policy,
          beforeState,
          { vipLevel: requestedLevel, expiresAtMs },
          nowMs,
        );
        if (!afterState) {
          await db.rollback(transaction);
          throw new ApiError("invalid_vip_grant", 400);
        }
      }

      const now = new Date(nowMs);
      const userPatch = vipUserPatch(afterState, now);
      const profilePatch = vipPublicProfilePatch(afterState, now);
      const resultData = {
        targetUid,
        mode,
        oldVipLevel: Number(beforeState.effectiveVipLevel || 0),
        newVipLevel: Number(afterState.effectiveVipLevel || 0),
        oldAdminGrantVipLevel: Number(beforeState.adminGrantVipLevel || 0),
        newAdminGrantVipLevel: Number(afterState.adminGrantVipLevel || 0),
        adminGrantExpiresAtMs: Number(afterState.adminGrantExpiresAtMs || 0),
        earnedVipLevel: Number(afterState.earnedVipLevel || 0),
        growthPoints: Number(afterState.growthPoints || 0),
        effectiveVipSource: clean(afterState.effectiveVipSource || "none"),
      };

      await db.commit(transaction, [
        db.writeUpdate(
          `users/${targetUid}`,
          userPatch,
          Object.keys(userPatch),
        ),
        db.writeUpdate(
          `public_profiles/${targetUid}`,
          profilePatch,
          Object.keys(profilePatch),
        ),
        db.writeCreate(`vip_audit_logs/control_${key}`, {
          actorId: actorUid,
          actorUid,
          targetUserId: targetUid,
          targetUid,
          action:
            mode === "remove"
              ? "removeAdminVipGrant"
              : mode === "change"
                ? "changeAdminVipGrant"
                : "grantAdminVip",
          oldVipLevel: resultData.oldVipLevel,
          newVipLevel: resultData.newVipLevel,
          oldAdminGrantVipLevel: resultData.oldAdminGrantVipLevel,
          newAdminGrantVipLevel: resultData.newAdminGrantVipLevel,
          adminGrantExpiresAt:
            resultData.adminGrantExpiresAtMs > 0
              ? new Date(resultData.adminGrantExpiresAtMs)
              : null,
          reason: reason || null,
          timestamp: now,
          createdAt: now,
          operationId: key,
        }),
        db.writeCreate(`control_operations/${key}`, {
          action: "manageVipLevels",
          actorUid,
          targetId: targetUid,
          mode,
          status: "completed",
          result: resultData,
          createdAt: now,
        }),
      ]);

      return {
        ok: true,
        code: "ok",
        operationId: key,
        ...resultData,
      };
    } catch (error) {
      if (transaction) await db.rollback(transaction).catch(() => {});
      if (error instanceof ApiError) throw error;
      if (attempt < 2 && isTransientFirestoreError(error)) {
        await new Promise((resolve) =>
          setTimeout(resolve, firestoreErrorRetryDelayMs(attempt))
        );
        continue;
      }
      throw error;
    }
  }

  throw new ApiError("transaction_failed", 500);
}

export async function manageVipLevel(request, env) {
  if (request.method !== "POST") {
    return json(request, env, { ok: false, code: "method_not_allowed" }, 405);
  }

  try {
    const payload = await verifyFirebaseIdToken(request, env, {
      checkUserState: false,
    });
    const authAge = Math.floor(Date.now() / 1000) - Number(payload.auth_time || 0);
    if (!Number.isFinite(authAge) || authAge > 1800) {
      throw new ApiError("recent_auth_required", 401);
    }
    const body = await readJson(request);
    const action = clean(body.action);
    if (action === "search") {
      return json(
        request,
        env,
        await searchVipUsers(firestoreClient(env), payload, body),
        200,
      );
    }
    if (action === "update") {
      return json(
        request,
        env,
        await updateAdminVipGrant(firestoreClient(env), payload, body),
        200,
      );
    }
    throw new ApiError("invalid_action", 400);
  } catch (error) {
    if (error instanceof ApiError) {
      return json(request, env, { ok: false, code: error.code }, error.status);
    }
    const raw = clean(error?.message);
    if (raw === "unauthorized") {
      return json(request, env, { ok: false, code: raw }, 401);
    }
    if (raw === "server_not_configured" || raw === "invalid_service_account_json") {
      return json(request, env, { ok: false, code: raw }, 503);
    }
    return json(request, env, { ok: false, code: "server_vip_control_failed" }, 500);
  }
}

export const vipLevelControlInternals = Object.freeze({
  normalizeAllowedVipGrantLevels,
  vipControlAccess,
  searchVipUsers,
  updateAdminVipGrant,
});
