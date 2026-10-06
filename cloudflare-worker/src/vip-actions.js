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
  timestampToEpochMs,
  vipPublicProfilePatch,
  vipStateFromUser,
  vipUserPatch,
} from "./vip-runtime.js";
import { publishGlobalAppEvents } from "./room-realtime.js";
import {
  giftVipTrialCard,
  listVipTrialCards,
  redeemVipTrialCard,
  vip10TrialCardGrantWrites,
} from "./vip-trial-cards.js";

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
    trialVipLevel: state.trialVipLevel,
    growthPoints: state.growthPoints,
    maintenancePoints: state.maintenancePoints,
    maintenanceRequired:
      earnedLevel > 0 ? vipMaintenanceThreshold(policy, earnedLevel) : 0,
    nextThreshold: progress.nextThreshold,
    remainingToNext: progress.remaining,
    maxGrowthPoints: progress.maxGrowthPoints,
    earnedVipExpiresAtMs: state.earnedVipExpiresAtMs,
    adminGrantExpiresAtMs: state.adminGrantExpiresAtMs,
    trialVipExpiresAtMs: state.trialVipExpiresAtMs,
    validityDays:
      earnedLevel > 0 ? vipValidityDays(policy, earnedLevel) : null,
    currentThreshold:
      earnedLevel > 0 ? vipThreshold(policy, earnedLevel) : 0,
    coins: Math.max(0, Number(user.coins ?? user.balance ?? 0) || 0),
    purchaseGrowthPerCoin: policy.purchasedGrowthPerCoin,
    paidRechargeGrowthPerCoin: policy.paidRechargeGrowthPerCoin,
    canHideRankingLists: currentLevel >= 7,
    hideRankingLists: currentLevel >= 7 && user.hideRankingLists === true,
    canHideProfileVisits: currentLevel >= 9,
    hideProfileVisits: currentLevel >= 9 && user.hideProfileVisits === true,
    canUseFriendsOnlyMessages: currentLevel >= 1,
    friendsOnlyMessages: currentLevel >= 1 && user.friendsOnlyMessages === true,
    canHideNobleLevel: currentLevel >= 4,
    hideNobleLevel: currentLevel >= 4 && user.hideNobleLevel === true,
    canHideGameWinBanner: currentLevel >= 4,
    hideGameWinBanner: currentLevel >= 4 && user.hideGameWinBanner === true,
    canHideBetWinNotification: currentLevel >= 4,
    hideBetWinNotification:
      currentLevel >= 4 && user.hideBetWinNotification === true,
    canCustomizeVipFrame: currentLevel >= 6,
    vipProfileFrameLevel:
      currentLevel >= 3
        ? Math.max(
            3,
            Math.min(
              currentLevel,
              Number(user.vipProfileFrameLevel || currentLevel) || currentLevel,
            ),
          )
        : 0,
    frameCustomizationChangedAtMs:
      timestampToEpochMs(user.frameCustomizationChangedAt),
    nextFrameCustomizationAtMs:
      timestampToEpochMs(user.frameCustomizationChangedAt) > 0
        ? timestampToEpochMs(user.frameCustomizationChangedAt) +
          VIP_FRAME_CUSTOMIZATION_COOLDOWN_MS
        : 0,
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

export async function setHideProfileVisits(
  db,
  uid,
  body,
  nowMs = Date.now(),
) {
  if (typeof body?.enabled !== "boolean") {
    throw new ApiError("invalid_hide_profile_visits_state", 400);
  }

  const transaction = await db.beginTransaction();
  try {
    const userSnap = await db.get(`users/${uid}`, transaction);
    if (!userSnap.exists) throw new ApiError("user_not_found", 404);
    const user = userSnap.data || {};
    const enabled = body.enabled === true;
    const activeLevel = activeEffectiveVipLevelFromUser(user, nowMs);
    if (enabled && activeLevel < 9) {
      throw new ApiError("hide_profile_visits_requires_vip9", 403);
    }

    const updatedAt = new Date(nowMs);
    await db.commit(transaction, [
      db.writeUpdate(
        `users/${uid}`,
        {
          hideProfileVisits: enabled,
          profileVisitVisibilityUpdatedAt: updatedAt,
        },
        ["hideProfileVisits", "profileVisitVisibilityUpdatedAt"],
      ),
    ]);

    return {
      ok: true,
      hideProfileVisits: enabled && activeLevel >= 9,
      canHideProfileVisits: activeLevel >= 9,
      requiredVipLevel: 9,
    };
  } catch (error) {
    await db.rollback(transaction);
    throw error;
  }
}

export async function setFriendsOnlyMessages(
  db,
  uid,
  body,
  nowMs = Date.now(),
) {
  if (typeof body?.enabled !== "boolean") {
    throw new ApiError("invalid_friends_only_messages_state", 400);
  }

  const transaction = await db.beginTransaction();
  try {
    const userSnap = await db.get(`users/${uid}`, transaction);
    if (!userSnap.exists) throw new ApiError("user_not_found", 404);
    const user = userSnap.data || {};
    const enabled = body.enabled === true;
    const activeLevel = activeEffectiveVipLevelFromUser(user, nowMs);
    if (enabled && activeLevel < 1) {
      throw new ApiError("friends_only_messages_requires_vip1", 403);
    }

    const updatedAt = new Date(nowMs);
    await db.commit(transaction, [
      db.writeUpdate(
        `users/${uid}`,
        {
          friendsOnlyMessages: enabled,
          messagePrivacyUpdatedAt: updatedAt,
        },
        ["friendsOnlyMessages", "messagePrivacyUpdatedAt"],
      ),
    ]);

    return {
      ok: true,
      friendsOnlyMessages: enabled && activeLevel >= 1,
      canUseFriendsOnlyMessages: activeLevel >= 1,
      requiredVipLevel: 1,
    };
  } catch (error) {
    await db.rollback(transaction);
    throw error;
  }
}

const VIP4_PRIVACY_FIELDS = Object.freeze({
  hideNobleLevel: "nobleLevelVisibilityUpdatedAt",
  hideGameWinBanner: "gameWinBannerVisibilityUpdatedAt",
  hideBetWinNotification: "betWinNotificationVisibilityUpdatedAt",
});

export async function setVip4PrivacyPreference(
  db,
  uid,
  body,
  nowMs = Date.now(),
) {
  const field = clean(body?.field);
  if (!Object.prototype.hasOwnProperty.call(VIP4_PRIVACY_FIELDS, field)) {
    throw new ApiError("invalid_vip4_privacy_field", 400);
  }
  if (typeof body?.enabled !== "boolean") {
    throw new ApiError("invalid_vip4_privacy_state", 400);
  }

  const transaction = await db.beginTransaction();
  try {
    const userSnap = await db.get(`users/${uid}`, transaction);
    if (!userSnap.exists) throw new ApiError("user_not_found", 404);
    const user = userSnap.data || {};
    const activeLevel = activeEffectiveVipLevelFromUser(user, nowMs);
    const enabled = body.enabled === true;
    if (enabled && activeLevel < 4) {
      throw new ApiError("vip4_privacy_requires_vip4", 403);
    }

    const updatedAtField = VIP4_PRIVACY_FIELDS[field];
    await db.commit(transaction, [
      db.writeUpdate(
        `users/${uid}`,
        {
          [field]: enabled,
          [updatedAtField]: new Date(nowMs),
        },
        [field, updatedAtField],
      ),
    ]);

    return {
      ok: true,
      field,
      enabled: enabled && activeLevel >= 4,
      canUse: activeLevel >= 4,
      requiredVipLevel: 4,
    };
  } catch (error) {
    await db.rollback(transaction);
    throw error;
  }
}

function riyadhDayKey(nowMs = Date.now()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Riyadh",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(nowMs));
}

export async function vip10GlobalEntryState(
  db,
  uid,
  nowMs = Date.now(),
) {
  const userSnap = await db.get(`users/${uid}`);
  if (!userSnap.exists) throw new ApiError("user_not_found", 404);
  const user = userSnap.data || {};
  const level = activeEffectiveVipLevelFromUser(user, nowMs);
  const dayKey = riyadhDayKey(nowMs);
  return {
    ok: true,
    eligible: level >= 10,
    effectiveVipLevel: level,
    dayKey,
    alreadyPublished:
      level >= 10 && clean(user.vip10GlobalEntryDayKey) === dayKey,
  };
}

export async function publishVip10GlobalEntry(
  db,
  env,
  uid,
  nowMs = Date.now(),
) {
  const transaction = await db.beginTransaction();
  let event;
  try {
    const userSnap = await db.get(`users/${uid}`, transaction);
    if (!userSnap.exists) throw new ApiError("user_not_found", 404);
    const user = userSnap.data || {};
    const level = activeEffectiveVipLevelFromUser(user, nowMs);
    if (level < 10) throw new ApiError("vip10_required", 403);

    const dayKey = riyadhDayKey(nowMs);
    if (clean(user.vip10GlobalEntryDayKey) === dayKey) {
      await db.rollback(transaction);
      return {
        ok: true,
        code: "already_published_today",
        alreadyPublished: true,
        dayKey,
      };
    }

    const startsAtMs = nowMs;
    const endsAtMs = nowMs + 12_000;
    const eventId = `vip10_entry_${uid}_${dayKey.replace(/-/g, "")}`;
    event = {
      eventId,
      kind: "vip10_global_entry",
      startsAtMs,
      endsAtMs,
      uid,
      displayName: clean(user.displayName || user.username) || "مستخدم Shadow Live",
      profileImageUrl: clean(user.profileImageUrl),
      publicId: clean(user.publicId),
      vipLevel: 10,
      assetKey: clean(user.vip10GlobalEntryAssetKey) || "vip/10/global_entry_banner",
    };

    await db.commit(transaction, [
      db.writeUpdate(
        `users/${uid}`,
        {
          vip10GlobalEntryDayKey: dayKey,
          vip10GlobalEntryPublishedAt: new Date(nowMs),
        },
        ["vip10GlobalEntryDayKey", "vip10GlobalEntryPublishedAt"],
      ),
      db.writeCreate(
        `vip_audit_logs/${eventId}`,
        {
          actorUid: uid,
          targetUserId: uid,
          action: "publishVip10GlobalEntry",
          dayKey,
          eventId,
          createdAt: new Date(nowMs),
        },
      ),
    ]);
  } catch (error) {
    await db.rollback(transaction);
    throw error;
  }

  const broadcast = await publishGlobalAppEvents(env, [event], nowMs).catch(() => ({
    ok: false,
    shards: 0,
    events: 0,
  }));

  return {
    ok: true,
    code: broadcast.ok ? "published" : "committed_broadcast_deferred",
    alreadyPublished: true,
    dayKey: riyadhDayKey(nowMs),
    event,
    realtimeShards: Number(broadcast.shards || 0),
  };
}

const VIP_FRAME_CUSTOMIZATION_COOLDOWN_MS = 30 * 24 * 60 * 60 * 1000;

export async function setVipProfileFrame(
  db,
  uid,
  body,
  nowMs = Date.now(),
) {
  const requestedLevel = Number(body?.frameLevel);
  if (!Number.isSafeInteger(requestedLevel) || requestedLevel < 3 || requestedLevel > 10) {
    throw new ApiError("invalid_vip_frame_level", 400);
  }

  const transaction = await db.beginTransaction();
  try {
    const [userSnap, profileSnap] = await Promise.all([
      db.get(`users/${uid}`, transaction),
      db.get(`public_profiles/${uid}`, transaction),
    ]);
    if (!userSnap.exists) throw new ApiError("user_not_found", 404);

    const user = userSnap.data || {};
    const activeLevel = activeEffectiveVipLevelFromUser(user, nowMs);
    if (activeLevel < 6) {
      throw new ApiError("vip_frame_customization_requires_vip6", 403);
    }
    if (requestedLevel > activeLevel) {
      throw new ApiError("vip_frame_level_locked", 403);
    }

    const lastChangedMs = timestampToEpochMs(user.frameCustomizationChangedAt);
    const currentLevel = Number(user.vipProfileFrameLevel || 0);
    if (
      currentLevel !== requestedLevel &&
      lastChangedMs > 0 &&
      nowMs - lastChangedMs < VIP_FRAME_CUSTOMIZATION_COOLDOWN_MS
    ) {
      throw new ApiError("vip_frame_customization_cooldown", 409);
    }

    const changedAt = new Date(nowMs);
    const nextAllowedAtMs = nowMs + VIP_FRAME_CUSTOMIZATION_COOLDOWN_MS;
    const writes = [
      db.writeUpdate(
        `users/${uid}`,
        {
          vipProfileFrameLevel: requestedLevel,
          frameCustomizationChangedAt: changedAt,
        },
        ["vipProfileFrameLevel", "frameCustomizationChangedAt"],
      ),
    ];

    if (profileSnap.exists) {
      writes.push(
        db.writeUpdate(
          `public_profiles/${uid}`,
          {
            vipProfileFrameLevel: requestedLevel,
            frameCustomizationChangedAt: changedAt,
            updatedAt: changedAt,
          },
          [
            "vipProfileFrameLevel",
            "frameCustomizationChangedAt",
            "updatedAt",
          ],
        ),
      );
    }

    await db.commit(transaction, writes);
    return {
      ok: true,
      vipProfileFrameLevel: requestedLevel,
      frameCustomizationChangedAtMs: nowMs,
      nextFrameCustomizationAtMs: nextAllowedAtMs,
      effectiveVipLevel: activeLevel,
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
      const trialGrant = vip10TrialCardGrantWrites(
        db,
        uid,
        user,
        policy,
        beforeState,
        afterState,
        nowMs,
      );
      const result = {
        growthPointsPurchased: requestedGrowthPoints,
        coinsSpent: coinCost,
        coins: closingCoins,
        vip: summaryPayload(
          policy,
          afterState,
          { ...user, coins: closingCoins, ...trialGrant.userPatch },
        ),
        trialCardsGranted: trialGrant.cardIds,
      };

      await db.commit(transaction, [
        db.writeUpdate(
          `users/${uid}`,
          {
            coins: closingCoins,
            walletUpdatedAt: now,
            ...vipUserPatch(afterState, now),
            ...trialGrant.userPatch,
          },
          [
            "coins",
            "walletUpdatedAt",
            "earnedVipLevel",
            "effectiveVipLevel",
            "adminGrantVipLevel",
            "trialVipLevel",
            "earnedVipExpiresAt",
            "adminGrantExpiresAt",
            "trialVipExpiresAt",
            "effectiveVipSource",
            "vipGrowthPoints",
            "vipMaintenancePoints",
            "vipLevel",
            "vipExpiresAt",
            "vipSource",
            "vipUpdatedAt",
            ...Object.keys(trialGrant.userPatch),
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
        ...trialGrant.writes,
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
    if (action === "setHideProfileVisits") {
      return json(
        request,
        env,
        await setHideProfileVisits(db, decoded.sub, body),
      );
    }
    if (action === "setFriendsOnlyMessages") {
      return json(
        request,
        env,
        await setFriendsOnlyMessages(db, decoded.sub, body),
      );
    }
    if (action === "setVip4PrivacyPreference") {
      return json(
        request,
        env,
        await setVip4PrivacyPreference(db, decoded.sub, body),
      );
    }
    if (action === "setVipProfileFrame") {
      return json(
        request,
        env,
        await setVipProfileFrame(db, decoded.sub, body),
      );
    }
    if (action === "vip10GlobalEntryState") {
      return json(
        request,
        env,
        await vip10GlobalEntryState(db, decoded.sub),
      );
    }
    if (action === "publishVip10GlobalEntry") {
      return json(
        request,
        env,
        await publishVip10GlobalEntry(db, env, decoded.sub),
      );
    }
    if (action === "listTrialCards") {
      return json(request, env, await listVipTrialCards(db, decoded.sub));
    }
    if (action === "giftTrialCard") {
      try {
        return json(
          request,
          env,
          await giftVipTrialCard(db, decoded.sub, body),
        );
      } catch (error) {
        const code = clean(error?.message);
        const status =
          code === "mutual_follow_required" ? 403 :
          code === "trial_card_unavailable" ? 409 :
          code === "vip_trial_inventory_limit" ? 409 :
          code === "not_found" ? 404 :
          400;
        throw new ApiError(code || "trial_card_gift_failed", status);
      }
    }
    if (action === "redeemTrialCard") {
      try {
        return json(
          request,
          env,
          await redeemVipTrialCard(db, decoded.sub, body),
        );
      } catch (error) {
        const code = clean(error?.message);
        const status =
          code === "trial_card_unavailable" ? 409 :
          code === "not_found" ? 404 :
          400;
        throw new ApiError(code || "trial_card_redeem_failed", status);
      }
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
