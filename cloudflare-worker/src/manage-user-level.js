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
import {
  loadUserLevelPolicy,
  levelProgress,
} from "./user-level-policy.js";
import { summarizeUserLevelData } from "./user-level-summary.js";

class ApiError extends Error {
  constructor(code, status = 400) {
    super(code);
    this.code = code;
    this.status = status;
  }
}

const clean = (value) => String(value ?? "").trim();
const validKey = (value) => /^[A-Za-z0-9_-]{12,160}$/.test(clean(value));

const METRICS = Object.freeze({
  wealth: {
    capability: "manageWealthLevel",
    pointsField: "wealthPoints",
    policyKey: "wealth",
  },
  attraction: {
    capability: "manageAttractionLevel",
    pointsField: "attractionPoints",
    policyKey: "attraction",
  },
  games: {
    capability: "manageGameLevel",
    pointsField: "gamePoints",
    policyKey: "games",
  },
});

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

function canOpenLevelControl(actor = {}) {
  if (actor.role === "owner") return true;
  if (actor.adminEnabled !== true) return false;
  const caps = actorCapabilities(actor);
  return (
    caps.has("manageUserLevels") ||
    caps.has("manageWealthLevel") ||
    caps.has("manageAttractionLevel") ||
    caps.has("manageGameLevel")
  );
}

function canManageMetric(actor = {}, metric) {
  if (actor.role === "owner") return true;
  if (actor.adminEnabled !== true) return false;
  const config = METRICS[metric];
  if (!config) return false;
  const caps = actorCapabilities(actor);
  return caps.has("manageUserLevels") || caps.has(config.capability);
}

function safePoints(value) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
}

function userSummary(policy, uid, user, nowMs = Date.now()) {
  return summarizeUserLevelData(policy, uid, user, nowMs).summary;
}

function publicUser(uid, user, summary) {
  return {
    uid,
    displayName: clean(user.displayName || user.name || user.username || "مستخدم Shadow Live"),
    username: clean(user.username),
    publicId: clean(user.publicId),
    profileImageUrl: clean(
      user.profileImageUrl ||
      user.profileImage ||
      user.avatarUrl ||
      user.profileAvatarAsset,
    ),
    role: clean(user.role || "user") || "user",
    accountStatus: clean(user.accountStatus || "active") || "active",
    levels: {
      wealth: summary.wealth,
      attraction: summary.attraction,
      games: summary.games,
    },
  };
}

async function loadActor(db, payload) {
  const uid = clean(payload?.sub);
  if (!uid) throw new ApiError("unauthorized", 401);
  const snap = await db.get(`users/${uid}`);
  if (!snap.exists) throw new ApiError("forbidden", 403);
  const actor = snap.data || {};
  assertUserDocumentSessionState(payload, actor);
  if (!canOpenLevelControl(actor)) throw new ApiError("forbidden", 403);
  return { uid, actor };
}

async function searchUsers(db, payload, body) {
  const { actor } = await loadActor(db, payload);
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

  const profileRows = await db.runQuery("public_profiles", {
    filters: [{ field: "searchTokens", op: "array-contains", value: query }],
    limit: 20,
  }).catch(() => []);

  for (const row of profileRows) {
    const uid = clean(row.id);
    if (uid) uidCandidates.push(uid);
  }

  const unique = [...new Set(uidCandidates)].slice(0, 20);
  if (!unique.length) {
    return {
      ok: true,
      code: "ok",
      query: rawQuery,
      results: [],
      capabilities: [...actorCapabilities(actor)].sort(),
      isOwner: actor.role === "owner",
    };
  }

  const [policy, snaps] = await Promise.all([
    loadUserLevelPolicy(db),
    Promise.all(unique.map((uid) =>
      db.get(`users/${uid}`).catch(() => ({ exists: false, data: null }))
    )),
  ]);

  const results = [];
  const nowMs = Date.now();
  for (let i = 0; i < unique.length; i += 1) {
    const snap = snaps[i];
    if (!snap?.exists) continue;
    const user = snap.data || {};
    try {
      results.push(publicUser(
        unique[i],
        user,
        userSummary(policy, unique[i], user, nowMs),
      ));
    } catch (_) {}
  }

  return {
    ok: true,
    code: "ok",
    query: rawQuery,
    results,
    capabilities: [...actorCapabilities(actor)].sort(),
    isOwner: actor.role === "owner",
  };
}

async function updateUserLevel(db, payload, body) {
  const actorUid = clean(payload?.sub);
  const targetUid = clean(body.targetUid);
  const metric = clean(body.metric);
  const mode = clean(body.mode);
  const reason = clean(body.reason);
  const key = clean(body.idempotencyKey);
  const config = METRICS[metric];

  if (
    !actorUid ||
    !targetUid ||
    targetUid.includes("/") ||
    !config ||
    !["setPoints", "setLevel"].includes(mode) ||
    reason.length < 3 ||
    reason.length > 160 ||
    !validKey(key)
  ) {
    throw new ApiError("invalid_request", 400);
  }

  const requestedPoints = mode === "setPoints" ? safePoints(body.points) : null;
  const requestedLevel = mode === "setLevel" ? Number(body.level) : null;
  if (
    (mode === "setPoints" && requestedPoints == null) ||
    (mode === "setLevel" && !Number.isInteger(requestedLevel))
  ) {
    throw new ApiError("invalid_request", 400);
  }

  for (let attempt = 0; attempt < 3; attempt += 1) {
    let transaction = null;
    try {
      transaction = await db.beginTransaction();
      const [actorSnap, targetSnap, operationSnap, policy] = await Promise.all([
        db.get(`users/${actorUid}`, transaction),
        db.get(`users/${targetUid}`, transaction),
        db.get(`control_operations/${key}`, transaction),
        loadUserLevelPolicy(db, { transaction, useCache: false }),
      ]);

      const actor = actorSnap.data || {};
      if (!actorSnap.exists) {
        await db.rollback(transaction);
        throw new ApiError("forbidden", 403);
      }
      assertUserDocumentSessionState(payload, actor);
      if (!canManageMetric(actor, metric)) {
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
      if (target.role === "owner" && actor.role !== "owner") {
        await db.rollback(transaction);
        throw new ApiError("owner_protected", 409);
      }

      const metricPolicy = policy?.[config.policyKey];
      const maxLevel = Array.isArray(metricPolicy?.thresholds)
        ? metricPolicy.thresholds.length
        : 0;
      if (mode === "setLevel" && (
        requestedLevel < 0 ||
        requestedLevel > maxLevel
      )) {
        await db.rollback(transaction);
        throw new ApiError("invalid_level", 400);
      }

      const beforeSummary = userSummary(policy, targetUid, target);
      const beforeMetric = beforeSummary[metric];
      const beforeStoredPoints = safePoints(target[config.pointsField]) ?? 0;

      const nextPoints = mode === "setPoints"
        ? requestedPoints
        : requestedLevel === 0
          ? 0
          : Number(metricPolicy.thresholds[requestedLevel - 1]);

      if (!Number.isSafeInteger(nextPoints) || nextPoints < 0) {
        await db.rollback(transaction);
        throw new ApiError("invalid_points", 400);
      }

      const afterUser = {
        ...target,
        [config.pointsField]: nextPoints,
      };
      const updatedAt = new Date();
      const fieldData = {
        [config.pointsField]: nextPoints,
        updatedAt,
      };
      const fieldPaths = [config.pointsField, "updatedAt"];

      if (metric === "games") {
        fieldData.lastGameActivityAt = updatedAt;
        fieldData.lastGameActivityAtMs = updatedAt.getTime();
        fieldData.gameInactivityDecayAppliedDays = 0;
        afterUser.lastGameActivityAt = updatedAt;
        afterUser.lastGameActivityAtMs = updatedAt.getTime();
        afterUser.gameInactivityDecayAppliedDays = 0;
        fieldPaths.push(
          "lastGameActivityAt",
          "lastGameActivityAtMs",
          "gameInactivityDecayAppliedDays",
        );
      }

      const afterSummary = userSummary(policy, targetUid, afterUser, updatedAt.getTime());
      const afterMetric = afterSummary[metric];
      const resultData = {
        targetUid,
        metric,
        mode,
        oldPoints: beforeStoredPoints,
        oldLevel: beforeMetric.level,
        newPoints: nextPoints,
        newLevel: afterMetric.level,
        summary: afterSummary,
      };

      await db.commit(transaction, [
        db.writeUpdate(
          `users/${targetUid}`,
          fieldData,
          fieldPaths,
        ),
        db.writeCreate(`admin_audit_logs/level_${key}`, {
          actorUid,
          action: mode === "setLevel" ? "setUserLevel" : "setUserLevelPoints",
          targetType: "user",
          targetId: targetUid,
          targetUid,
          metric,
          reason,
          oldPoints: beforeStoredPoints,
          oldLevel: beforeMetric.level,
          newPoints: nextPoints,
          newLevel: afterMetric.level,
          before: {
            metric,
            points: beforeStoredPoints,
            level: beforeMetric.level,
          },
          after: {
            metric,
            points: nextPoints,
            level: afterMetric.level,
          },
          operationId: key,
          createdAt: updatedAt,
        }),
        db.writeCreate(`control_operations/${key}`, {
          action: "manageUserLevel",
          actorUid,
          targetId: targetUid,
          metric,
          mode,
          status: "completed",
          result: resultData,
          createdAt: updatedAt,
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

export async function manageUserLevel(request, env) {
  if (request.method !== "POST") {
    return json(request, env, { ok: false, code: "method_not_allowed" }, 405);
  }

  try {
    const payload = await verifyFirebaseIdToken(request, env, {
      checkUserState: false,
    });
    const body = await readJson(request);
    const action = clean(body.action);

    if (action === "search") {
      const result = await searchUsers(firestoreClient(env), payload, body);
      return json(request, env, result, 200);
    }

    if (action === "update") {
      const authAge = Math.floor(Date.now() / 1000) - Number(payload.auth_time || 0);
      if (!Number.isFinite(authAge) || authAge > 1800) {
        throw new ApiError("recent_auth_required", 401);
      }
      const result = await updateUserLevel(
        firestoreClient(env),
        payload,
        body,
      );
      return json(request, env, result, 200);
    }

    throw new ApiError("invalid_action", 400);
  } catch (error) {
    if (error instanceof ApiError) {
      return json(request, env, { ok: false, code: error.code }, error.status);
    }
    const raw = clean(error?.message);
    if (raw === "unauthorized") {
      return json(request, env, { ok: false, code: "unauthorized" }, 401);
    }
    if (
      raw === "server_not_configured" ||
      raw === "invalid_service_account_json"
    ) {
      return json(request, env, { ok: false, code: raw }, 503);
    }
    return json(
      request,
      env,
      { ok: false, code: "server_level_control_failed" },
      500,
    );
  }
}

export const userLevelControlInternals = Object.freeze({
  normalizeSearchText,
  canOpenLevelControl,
  canManageMetric,
  safePoints,
  searchUsers,
  updateUserLevel,
  publicUser,
});
