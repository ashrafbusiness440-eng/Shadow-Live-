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

function summaryFromUser(policy, targetUid, user, nowMs) {
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
    summary: {
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
    },
    gameDecay,
  };
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

  return summaryFromUser(
    policy,
    targetUid,
    userSnap.data || {},
    nowMs,
  ).summary;
}

export async function materializeUserLevelSummary(
  db,
  uid,
  { nowMs = Date.now(), usePolicyCache = true } = {},
) {
  const targetUid = safeUserId(uid);
  if (!targetUid) throw new Error("invalid_user");
  const policy = await loadUserLevelPolicy(db, { useCache: usePolicyCache });

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const transaction = await db.beginTransaction();
    try {
      const userSnap = await db.get(`users/${targetUid}`, transaction);
      if (!userSnap.exists) throw new Error("user_not_found");

      const calculated = summaryFromUser(
        policy,
        targetUid,
        userSnap.data || {},
        nowMs,
      );
      const { gameDecay } = calculated;

      if (gameDecay.newlyAppliedDecayDays > 0) {
        await db.commit(transaction, [
          db.writeUpdate(
            `users/${targetUid}`,
            {
              gamePoints: gameDecay.points,
              gameInactivityDecayAppliedDays:
                gameDecay.inactivityDecayAppliedDays,
            },
            ["gamePoints", "gameInactivityDecayAppliedDays"],
          ),
        ]);
        return {
          ...calculated.summary,
          games: {
            ...calculated.summary.games,
            storedPoints: gameDecay.points,
            pendingDecayPoints: 0,
            pendingDecayDays: 0,
            decayAppliedPoints: gameDecay.pointsDecayed,
            decayAppliedDays: gameDecay.newlyAppliedDecayDays,
          },
        };
      }

      await db.rollback(transaction);
      return {
        ...calculated.summary,
        games: {
          ...calculated.summary.games,
          decayAppliedPoints: 0,
          decayAppliedDays: 0,
        },
      };
    } catch (error) {
      await db.rollback(transaction).catch(() => {});
      if (
        (clean(error?.message) === "ABORTED" || Number(error?.status) === 409) &&
        attempt < 2
      ) {
        continue;
      }
      throw error;
    }
  }

  throw new Error("transaction_failed");
}

export async function userLevelSummary(request, env) {
  try {
    if (request.method !== "GET") {
      return json(request, env, { ok: false, code: "method_not_allowed" }, 405);
    }

    const decoded = await verifyFirebaseIdToken(request, env);
    const actorUid = safeUserId(decoded.sub);
    if (!actorUid) {
      return json(request, env, { ok: false, code: "unauthorized" }, 401);
    }

    const url = new URL(request.url);
    const targetUid = safeUserId(url.searchParams.get("uid") || actorUid);
    if (!targetUid) {
      return json(request, env, { ok: false, code: "invalid_user" }, 400);
    }

    const db = firestoreClient(env);
    const summary = await materializeUserLevelSummary(db, targetUid);
    return json(request, env, { ok: true, summary });
  } catch (error) {
    const code = clean(error?.message) || "user_level_failed";
    const status = code === "unauthorized"
      ? 401
      : code === "user_not_found"
        ? 404
        : code === "invalid_user"
          ? 400
          : code === "invalid_game_level_state"
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
