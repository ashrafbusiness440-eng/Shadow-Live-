import { json, readJson } from "./http.js";
import { verifyFirebaseIdToken } from "./firebase-auth.js";
import { firestoreClient } from "./firestore.js";
import { annotatePressureRequest } from "./pressure-telemetry.js";
import {
  loadVipPolicy,
  vipMaintenanceThreshold,
  vipProgress,
  vipThreshold,
  vipValidityDays,
} from "./vip-policy.js";
import {
  applyVipGrowth,
  materializeVipState,
} from "./vip-state.js";
import {
  activeEffectiveVipLevelFromUser,
  vipPublicProfilePatch,
  vipStateFromUser,
  vipUserPatch,
} from "./vip-runtime.js";

const clean = (value) => String(value ?? "").trim();

class ApiError extends Error {
  constructor(code, status = 400) {
    super(code);
    this.code = code;
    this.status = status;
  }
}

function asPositiveInt(value) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number > 0 ? number : 0;
}

function operationKey(value) {
  const key = clean(value);
  if (!/^[A-Za-z0-9_-]{12,160}$/.test(key)) {
    throw new ApiError("invalid_idempotency_key", 400);
  }
  return key;
}

async function actor(request, env) {
  const decoded = await verifyFirebaseIdToken(request, env);
  if (decoded.firebase?.sign_in_provider === "anonymous") {
    throw new ApiError("account_required", 403);
  }
  return decoded;
}

function summaryPayload(policy, state, user = {}) {
  const progress = vipProgress(policy, state.growthPoints);
  const currentLevel = state.effectiveVipLevel;
  const earnedLevel = state.earnedVipLevel;
  return {
    effectiveVipLevel: currentLevel,
    effectiveVipSource: state.effectiveVipSource,
    earnedVipLevel: earnedLevel,
    adminGrantVipLevel: state.adminGrantVipLevel,
    growthPoints: state.growthPoints,
    maintenancePoints: state.maintenancePoints,
    maintenanceRequired:
      earnedLevel > 0 ? vipMaintenanceThreshold(policy, earnedLevel) : 0,
    nextThreshold: progress.nextThreshold,
    remainingToNext: progress.remaining,
    maxGrowthPoints: progress.maxGrowthPoints,
    earnedVipExpiresAtMs: state.earnedVipExpiresAtMs,
    adminGrantExpiresAtMs: state.adminGrantExpiresAtMs,
    validityDays:
      earnedLevel > 0 ? vipValidityDays(policy, earnedLevel) : null,
    currentThreshold:
      earnedLevel > 0 ? vipThreshold(policy, earnedLevel) : 0,
    coins: Math.max(0, Number(user.coins ?? user.balance ?? 0) || 0),
    purchaseGrowthPerCoin: policy.purchasedGrowthPerCoin,
    paidRechargeGrowthPerCoin: policy.paidRechargeGrowthPerCoin,
    canHideRankingLists: currentLevel >= 7,
    hideRankingLists: currentLevel >= 7 && user.hideRankingLists === true,
  };
}

export async function vipSummary(db, uid, nowMs = Date.now()) {
  const [userSnap, policy] = await Promise.all([
    db.get(`users/${uid}`),
    loadVipPolicy(db),
  ]);
  if (!userSnap.exists) throw new ApiError("user_not_found", 404);
  const user = userSnap.data || {};
  const state = materializeVipState(
    policy,
    vipStateFromUser(user),
    nowMs,
  );
  return summaryPayload(policy, state, user);
}

export async function setHideRankingLists(
  db,
  uid,
  body,
  nowMs = Date.now(),
) {
  if (typeof body?.enabled !== "boolean") {
    throw new ApiError("invalid_hide_lists_state", 400);
  }

  const transaction = await db.beginTransaction();
  try {
    const userSnap = await db.get(`users/${uid}`, transaction);
    if (!userSnap.exists) throw new ApiError("user_not_found", 404);

    const user = userSnap.data || {};
    const enabled = body.enabled === true;
    const activeLevel = activeEffectiveVipLevelFromUser(user, nowMs);
    if (enabled && activeLevel < 7) {
      throw new ApiError("hide_lists_requires_vip7", 403);
    }

    const updatedAt = new Date(nowMs);
    await db.commit(transaction, [
      db.writeUpdate(
        `users/${uid}`,
        {
          hideRankingLists: enabled,
          rankingVisibilityUpdatedAt: updatedAt,
        },
        ["hideRankingLists", "rankingVisibilityUpdatedAt"],
      ),
    ]);

    return {
      ok: true,
      hideRankingLists: enabled && activeLevel >= 7,
      canHideRankingLists: activeLevel >= 7,
      requiredVipLevel: 7,
    };
  } catch (error) {
    await db.rollback(transaction);
    throw error;
  }
}

export async function buyVipGrowth(db, uid, body, nowMs = Date.now()) {
  const requestedGrowthPoints = asPositiveInt(body.growthPoints);
  const key = operationKey(body.idempotencyKey);
  if (!requestedGrowthPoints) {
    throw new ApiError("invalid_growth_amount", 400);
  }

  for (let attempt = 0; attempt < 3; attempt++) {
    const transaction = await db.beginTransaction();
    try {
      const [userSnap, publicProfileSnap, operationSnap, lockSnap, policy] =
        await Promise.all([
          db.get(`users/${uid}`, transaction),
          db.get(`public_profiles/${uid}`, transaction),
          db.get(`vip_operations/${uid}__${key}`, transaction),
          db.get("system_config/emergency_lock", transaction),
          loadVipPolicy(db, { transaction, useCache: false }),
        ]);

      if (!userSnap.exists) throw new ApiError("user_not_found", 404);
      if (operationSnap.exists) {
        await db.rollback(transaction);
        return {
          ok: true,
          code: "duplicate",
          operationId: key,
          ...(operationSnap.data?.result || {}),
        };
      }

      const lock = lockSnap.data || {};
      if (lock.enabled === true || lock.economyLocked === true) {
        throw new ApiError("emergency_locked", 409);
      }

      const ratio = Number(policy.purchasedGrowthPerCoin || 3);
      if (
        !Number.isSafeInteger(ratio) ||
        ratio < 1 ||
        requestedGrowthPoints % ratio !== 0
      ) {
        throw new ApiError("growth_amount_must_match_ratio", 400);
      }

      const coinCost = requestedGrowthPoints / ratio;
      const user = userSnap.data || {};
      const openingCoins = Math.max(
        0,
        Number(user.coins ?? user.balance ?? 0) || 0,
      );
      if (!Number.isSafeInteger(openingCoins)) {
        throw new ApiError("invalid_wallet_state", 400);
      }
      if (openingCoins < coinCost) {
        throw new ApiError("insufficient_coins", 409);
      }

      const now = new Date(nowMs);
      const beforeState = materializeVipState(
        policy,
        vipStateFromUser(user),
        nowMs,
      );
      const afterState = applyVipGrowth(
        policy,
        beforeState,
        requestedGrowthPoints,
        nowMs,
      );
      if (!afterState) throw new ApiError("invalid_vip_state", 409);

      const closingCoins = openingCoins - coinCost;
      const result = {
        growthPointsPurchased: requestedGrowthPoints,
        coinsSpent: coinCost,
        coins: closingCoins,
        vip: summaryPayload(
          policy,
          afterState,
          { ...user, coins: closingCoins },
        ),
      };

      await db.commit(transaction, [
        db.writeUpdate(
          `users/${uid}`,
          {
            coins: closingCoins,
            walletUpdatedAt: now,
            ...vipUserPatch(afterState, now),
          },
          [
            "coins",
            "walletUpdatedAt",
            "earnedVipLevel",
            "effectiveVipLevel",
            "adminGrantVipLevel",
            "earnedVipExpiresAt",
            "adminGrantExpiresAt",
            "effectiveVipSource",
            "vipGrowthPoints",
            "vipMaintenancePoints",
            "vipLevel",
            "vipExpiresAt",
            "vipSource",
            "vipUpdatedAt",
          ],
        ),
        ...(publicProfileSnap.exists
          ? [
              db.writeUpdate(
                `public_profiles/${uid}`,
                vipPublicProfilePatch(afterState, now),
                [
                  "vipLevel",
                  "effectiveVipLevel",
                  "vipExpiresAt",
                  "updatedAt",
                ],
              ),
            ]
          : []),
        db.writeCreate(`financial_ledger/${uid}__${key}__vip_growth`, {
          userId: uid,
          asset: "coins",
          delta: -coinCost,
          openingBalance: openingCoins,
          closingBalance: closingCoins,
          reason: "vip_growth_purchase",
          sourceType: "vipGrowthPurchase",
          sourceId: key,
          actorUid: uid,
          idempotencyKey: key,
          createdAt: now,
        }),
        db.writeCreate(`vip_growth_history/${uid}__${key}`, {
          userId: uid,
          eventType: "growth_purchase",
          source: "coins",
          deltaGrowthPoints: requestedGrowthPoints,
          growthPointsBefore: beforeState.growthPoints,
          growthPointsAfter: afterState.growthPoints,
          earnedVipBefore: beforeState.earnedVipLevel,
          earnedVipAfter: afterState.earnedVipLevel,
          effectiveVipAfter: afterState.effectiveVipLevel,
          coinCost,
          operationId: key,
          createdAt: now,
        }),
        db.writeCreate(`vip_audit_logs/${uid}__${key}`, {
          actorUid: uid,
          targetUserId: uid,
          action: "buyVipGrowth",
          growthPoints: requestedGrowthPoints,
          coinsSpent: coinCost,
          oldVipLevel: beforeState.effectiveVipLevel,
          newVipLevel: afterState.effectiveVipLevel,
          idempotencyKey: key,
          createdAt: now,
        }),
        db.writeCreate(`vip_operations/${uid}__${key}`, {
          uid,
          action: "buyGrowth",
          status: "completed",
          result,
          createdAt: now,
        }),
      ]);

      return { ok: true, code: "ok", operationId: key, ...result };
    } catch (error) {
      await db.rollback(transaction);
      if (error instanceof ApiError) throw error;
      if (
        (error?.message === "ABORTED" || error?.status === 409) &&
        attempt < 2
      ) {
        continue;
      }
      throw error;
    }
  }
  throw new ApiError("transaction_failed", 500);
}

export async function vipActions(request, env) {
  if (request.method !== "POST") {
    return json(request, env, { ok: false, code: "method_not_allowed" }, 405);
  }
  try {
    const decoded = await actor(request, env);
    const body = await readJson(request);
    const action = clean(body.action);
    annotatePressureRequest(request, { action: `vip:${action}` });
    const db = firestoreClient(env);

    if (action === "summary") {
      return json(request, env, {
        ok: true,
        ...(await vipSummary(db, decoded.sub)),
      });
    }
    if (action === "buyGrowth") {
      return json(request, env, await buyVipGrowth(db, decoded.sub, body));
    }
    if (action === "setHideRankingLists") {
      return json(
        request,
        env,
        await setHideRankingLists(db, decoded.sub, body),
      );
    }
    throw new ApiError("invalid_action", 400);
  } catch (error) {
    if (error instanceof ApiError) {
      return json(request, env, { ok: false, code: error.code }, error.status);
    }
    const code = clean(error?.message);
    if (code === "unauthorized") {
      return json(request, env, { ok: false, code }, 401);
    }
    if (
      code === "server_not_configured" ||
      code === "invalid_service_account_json"
    ) {
      return json(request, env, { ok: false, code }, 503);
    }
    return json(request, env, { ok: false, code: "server_vip_failed" }, 500);
  }
}
