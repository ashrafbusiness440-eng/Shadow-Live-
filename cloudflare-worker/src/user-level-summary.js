import { json } from "./http.js";
import { verifyFirebaseIdToken } from "./firebase-auth.js";
import { firestoreClient } from "./firestore.js";
import {
  gameInactivityDecayState,
  loadUserLevelPolicy,
  userLevelSummaries,
} from "./user-level-policy.js";

const clean = (value) => String(value ?? "").trim();

function safeUserId(value) {
  const uid = clean(value);
  return uid && !uid.includes("/") && uid.length <= 220 ? uid : "";
}

function timestampMs(value) {
  if (value == null || value === "") return null;
  if (value instanceof Date) {
    const ms = value.getTime();
    return Number.isSafeInteger(ms) && ms >= 0 ? ms : null;
  }
  if (typeof value?.toMillis === "function") {
    const ms = Number(value.toMillis());
    return Number.isSafeInteger(ms) && ms >= 0 ? ms : null;
  }
  const parsed = Date.parse(String(value));
  if (Number.isFinite(parsed) && parsed >= 0) return Math.trunc(parsed);
  const number = Number(value);
  return Number.isSafeInteger(number) && number >= 0 ? number : null;
}

export async function buildUserLevelSummary(
  db,
  uid,
  { nowMs = Date.now(), usePolicyCache = true } = {},
) {
  const targetUid = safeUserId(uid);
  if (!targetUid) throw new Error("invalid_user");

  const [userSnap, policy] = await Promise.all([
    db.get(`users/${targetUid}`),
    loadUserLevelPolicy(db, { useCache: usePolicyCache }),
  ]);
  if (!userSnap.exists) throw new Error("user_not_found");

  const user = userSnap.data || {};
  const lastGameActivityAtMs =
    timestampMs(user.lastGameActivityAtMs) ??
    timestampMs(user.lastGameActivityAt);

  const gameDecay = gameInactivityDecayState(policy.games, {
    gamePoints: user.gamePoints ?? 0,
    lastGameActivityAtMs,
    inactivityDecayAppliedDays:
      user.gameInactivityDecayAppliedDays ?? 0,
    nowMs,
  });
  if (!gameDecay) throw new Error("invalid_game_level_state");

  const summary = userLevelSummaries(policy, {
    wealthPoints: user.wealthPoints ?? 0,
    attractionPoints: user.attractionPoints ?? 0,
    gamePoints: gameDecay.points,
  });

  return {
    uid: targetUid,
    policyVersion: Number(policy.version || 1),
    wealth: summary.wealth,
    attraction: summary.attraction,
    games: {
      ...summary.games,
      storedPoints: Math.max(0, Number(user.gamePoints || 0)),
      pendingDecayPoints: gameDecay.pointsDecayed,
      pendingDecayDays: gameDecay.newlyAppliedDecayDays,
      lastGameActivityAtMs,
    },
  };
}

export async function userLevelSummary(request, env) {
  try {
    if (request.method !== "GET") {
      return json(request, env, { ok: false, code: "method_not_allowed" }, 405);
    }

    const decoded = await verifyFirebaseIdToken(request, env);
    const uid = safeUserId(decoded.sub);
    if (!uid) {
      return json(request, env, { ok: false, code: "unauthorized" }, 401);
    }

    const db = firestoreClient(env);
    const summary = await buildUserLevelSummary(db, uid);
    return json(request, env, { ok: true, summary });
  } catch (error) {
    const code = clean(error?.message) || "user_level_failed";
    const status = code === "unauthorized"
      ? 401
      : code === "user_not_found"
        ? 404
        : code === "invalid_user" || code === "invalid_game_level_state"
          ? 409
          : 500;
    return json(
      request,
      env,
      { ok: false, code: status === 500 ? "user_level_failed" : code },
      status,
    );
  }
}
