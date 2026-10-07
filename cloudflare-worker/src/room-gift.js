import { json, readJson } from "./http.js";
import { verifyFirebaseIdToken } from "./firebase-auth.js";
import { firestoreClient } from "./firestore.js";
import {
  agencyPolicySnapshotFor,
  economyWithAgencyPolicySnapshot,
  resolveGiftRevenuePolicy,
} from "./economy-policy.js";
import {
  agencyPublicRankingKey,
  agencyTargetAchievementDeltas,
  calculateAgencyTargetProgress,
  convertAgencyCoinsWithCarryover,
} from "./agency-policy.js";
import {
  buildAgencyTargetSharePayoutWrites,
  prepareAgencyTargetSharePayout,
} from "./agency-target-share.js";
import { advanceRoomRocket } from "./room-rocket.js";
import {
  legacyPresenceFresh,
  realtimeResolveRoomUidsFromNamespace,
  realtimeRoomParticipantsFromNamespace,
  realtimeUserPresentFromNamespace,
} from "./room-presence-authority.js";
import {
  publishGlobalAppEvents,
  publishGlobalRocketEvents,
  publishRoomRealtimeEvent,
} from "./room-realtime.js";
import { writePressureDataPoint } from "./pressure-telemetry.js";
import {
  prepareRelationshipGiftContext,
  relationshipGiftWritesForRecipient,
} from "./relationship-gift.js";
import {
  giftVisualPolicy,
  premiumGiftCelebrationEvent,
} from "./gift-visual-policy.js";
import { giftLevelPointAwards, safeAddUserLevelPoints } from "./user-level-policy.js";
import { vipCosmeticsFromUser } from "./vip-entitlements.js";

const clean = (value) => String(value ?? "").trim();
const validKey = (value) => /^[A-Za-z0-9_-]{12,220}$/.test(clean(value));

function roomFeatureEnabled(room = {}, key) {
  const type = clean(room.roomType || room.type || "personal");
  const defaultValue = type !== "customer_service";
  return Object.prototype.hasOwnProperty.call(room, key)
    ? room[key] === true
    : defaultValue;
}
const AGENCY_MONTHLY_ACCRUAL_SHARDS = 32;
const MAX_ROOM_GIFT_RECIPIENTS = 22;
const MAX_ROOM_GIFT_WRITES = 480;

function normalizeRoomGiftRecipientMode(value) {
  const mode = clean(value || "users");
  return ["users", "all_mics", "all_room"].includes(mode)
    ? mode
    : "";
}

function normalizeRoomGiftRecipientIds(body = {}) {
  const raw = Array.isArray(body.recipientIds)
    ? body.recipientIds
    : [];
  const receiverId = clean(body.receiverId);
  return Array.from(
    new Set(
      [
        ...raw.map(clean),
        ...(raw.length === 0 && receiverId ? [receiverId] : []),
      ].filter(Boolean),
    ),
  );
}

function roomGiftSubOperationId(key, index, count) {
  if (count === 1) return key;
  const suffix = "_" + String(index + 1);
  return clean(key).slice(0, 220 - suffix.length) + suffix;
}

function sameRecipientSet(left = [], right = []) {
  const a = Array.from(new Set(left.map(clean).filter(Boolean))).sort();
  const b = Array.from(new Set(right.map(clean).filter(Boolean))).sort();
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

function continueAgencyTargetSharePlan(plan, cursor) {
  if (!plan || !cursor) return plan;
  const conversion = convertAgencyCoinsWithCarryover({
    carryoverCoins: cursor.carryoverCoins,
    payableCoins: plan.deltaCoins,
    coinsPerDiamond: plan.coinsPerDiamond,
  });
  return {
    ...plan,
    openingCarryoverCoins: conversion.openingCarryoverCoins,
    shareDiamondsEarned: conversion.diamondsEarned,
    remainderCoins: conversion.remainderCoins,
    legacyDiamonds: 0,
    legacyRemainderCoins: 0,
    legacyAlreadyMigrated: true,
    priorLifetimeDiamonds: cursor.lifetimeAgencyDiamonds,
    lifetimeAgencyDiamonds:
      cursor.lifetimeAgencyDiamonds + conversion.diamondsEarned,
    financialStateExists: true,
    legacyWalletExists: false,
  };
}

function roomGiftOperationConflicts(data = {}, expected = {}) {
  if (clean(data.action) && clean(data.action) !== "sendRoomGift") return true;
  if (clean(data.senderId) && clean(data.senderId) !== clean(expected.senderId)) return true;
  if (clean(data.roomId) && clean(data.roomId) !== clean(expected.roomId)) return true;
  if (clean(data.giftId) && clean(data.giftId) !== clean(expected.giftId)) return true;
  if (data.quantity != null && Number(data.quantity) !== Number(expected.quantity)) return true;

  const storedMode = normalizeRoomGiftRecipientMode(
    data.recipientMode || (data.receiverId ? "users" : ""),
  );
  const expectedMode = normalizeRoomGiftRecipientMode(expected.recipientMode);
  if (storedMode && expectedMode && storedMode !== expectedMode) return true;

  if (expectedMode === "users") {
    const storedIds = Array.isArray(data.recipientIds)
      ? data.recipientIds
      : [data.receiverId];
    const expectedIds = Array.isArray(expected.recipientIds)
      ? expected.recipientIds
      : [expected.receiverId];
    if (!sameRecipientSet(storedIds, expectedIds)) return true;
  }
  return false;
}

function agencyAccrualShard(value) {
  const text = clean(value);
  let hash = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) % AGENCY_MONTHLY_ACCRUAL_SHARDS;
}

class ApiError extends Error {
  constructor(code, status = 400) {
    super(code);
    this.code = code;
    this.status = status;
  }
}

async function assertRoomPresence(
  db,
  transaction,
  realtimePresent,
  roomId,
  uid,
  errorCode,
) {
  if (realtimePresent === true) return "room_realtime";
  if (realtimePresent === false) throw new ApiError(errorCode, 409);

  const legacyPresence = await db.get(
    `room_presence/${roomId}/users/${uid}`,
    transaction,
  );
  if (!legacyPresenceFresh(legacyPresence)) {
    throw new ApiError(errorCode, 409);
  }
  return "legacy_room_presence";
}

function giftMinVipLevel(gift = {}) {
  const explicit = Number(gift.minVipLevel);
  if (Number.isSafeInteger(explicit) && explicit >= 0 && explicit <= 10) {
    return explicit;
  }
  return clean(gift.category) === "vip" ? 4 : 0;
}

function randomDocId(prefix) {
  return `${prefix}_${crypto.randomUUID().replace(/-/g, "")}`;
}

function operationNow(options = {}) {
  const raw = typeof options?.now === "function"
    ? options.now()
    : (options?.now ?? new Date());
  const date = raw instanceof Date ? new Date(raw.getTime()) : new Date(raw);
  if (!Number.isFinite(date.getTime())) {
    throw new Error("invalid_operation_clock");
  }
  return date;
}

function utcPeriodKeys(date = new Date()) {
  const day = date.toISOString().slice(0, 10);
  const month = day.slice(0, 7);
  const d = new Date(Date.UTC(
    date.getUTCFullYear(),
    date.getUTCMonth(),
    date.getUTCDate(),
  ));
  const weekday = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - weekday);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const week = Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
  const weekKey = d.getUTCFullYear().toString() + "-W" +
    week.toString().padStart(2, "0");
  return { day, week: weekKey, month };
}

function riyadhPeriodKeys(date = new Date()) {
  const shifted = new Date(date.getTime() + 3 * 60 * 60 * 1000);
  const day = shifted.toISOString().slice(0, 10);
  const month = day.slice(0, 7);
  const d = new Date(Date.UTC(
    shifted.getUTCFullYear(),
    shifted.getUTCMonth(),
    shifted.getUTCDate(),
  ));
  const weekday = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - weekday);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const week = Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
  return {
    day,
    week: d.getUTCFullYear().toString() + "-W" +
      week.toString().padStart(2, "0"),
    month,
  };
}

const fallbackGifts = [
  {id:"rose",nameAr:"وردة",priceCoins:100,enabled:true,assetKey:"gifts.placeholder.default"},
  {id:"coffee",nameAr:"قهوة",priceCoins:300,enabled:true,assetKey:"gifts.placeholder.default"},
  {id:"heart",nameAr:"قلب",priceCoins:500,enabled:true,assetKey:"gifts.placeholder.default"},
  {id:"chocolate",nameAr:"شوكولا",priceCoins:1000,enabled:true,assetKey:"gifts.placeholder.default"},
  {id:"crown",category:"vip",minVipLevel:4,nameAr:"تاج",priceCoins:2500,enabled:true,assetKey:"gifts.placeholder.default"},
  {id:"ring",category:"vip",minVipLevel:4,nameAr:"خاتم ألماس",priceCoins:5000,enabled:true,assetKey:"gifts.placeholder.default"},
  {id:"sports_car",category:"vip",minVipLevel:4,nameAr:"سيارة رياضية",priceCoins:10000,enabled:true,assetKey:"gifts.placeholder.default"},
  {id:"yacht",category:"vip",minVipLevel:4,nameAr:"يخت فاخر",priceCoins:25000,enabled:true,assetKey:"gifts.placeholder.default"},
  {id:"private_jet",category:"vip",minVipLevel:4,nameAr:"طائرة خاصة",priceCoins:50000,enabled:true,assetKey:"gifts.placeholder.default"},
  {id:"castle",category:"vip",minVipLevel:4,nameAr:"قصر ملكي",priceCoins:100000,enabled:true,assetKey:"gifts.placeholder.default"},
  {id:"golden_dragon",category:"vip",minVipLevel:4,nameAr:"التنين الذهبي",priceCoins:250000,enabled:true,assetKey:"gifts.placeholder.default"},
  {id:"galaxy",category:"vip",minVipLevel:4,nameAr:"مجرة شادو",priceCoins:500000,enabled:true,assetKey:"gifts.placeholder.default"},
];

async function runTransaction(db, body) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const transaction = await db.beginTransaction();
    try {
      return await body(transaction);
    } catch (error) {
      await db.rollback(transaction);
      if (error instanceof ApiError) throw error;
      if ((error?.message === "ABORTED" || error?.status === 409) && attempt < 2) continue;
      throw error;
    }
  }
  throw new ApiError("transaction_failed", 500);
}

export async function sendRoomGift(db, senderUid, body = {}, options = {}) {
  const roomId = clean(body.roomId);
  const recipientMode = normalizeRoomGiftRecipientMode(body.recipientMode);
  const requestedRecipientIds = normalizeRoomGiftRecipientIds(body);
  const giftId = clean(body.giftId);
  const quantity = Number(body.quantity || 1);
  const key = clean(body.idempotencyKey);

  if (
    !/^[A-Za-z0-9_-]{1,180}$/.test(roomId) ||
    !recipientMode ||
    !giftId ||
    ![1, 7, 77, 777].includes(quantity) ||
    !validKey(key) ||
    (recipientMode === "users" &&
      (requestedRecipientIds.length < 1 ||
        requestedRecipientIds.length > MAX_ROOM_GIFT_RECIPIENTS))
  ) {
    throw new ApiError("invalid_request", 400);
  }

  const realtimeNamespace = options?.realtimeNamespace || null;
  let realtimeSelection = null;
  if (recipientMode === "users") {
    realtimeSelection = await realtimeResolveRoomUidsFromNamespace(
      realtimeNamespace,
      roomId,
      [senderUid, ...requestedRecipientIds],
    );
  } else if (recipientMode === "all_room") {
    realtimeSelection = await realtimeRoomParticipantsFromNamespace(
      realtimeNamespace,
      roomId,
      MAX_ROOM_GIFT_RECIPIENTS + 1,
      senderUid,
    );
  }

  let transactionAttempts = 0;
  return runTransaction(db, async (transaction) => {
    transactionAttempts += 1;
    const now = operationNow(options);
    const periods = utcPeriodKeys(now);
    const agencyPeriods = riyadhPeriodKeys(now);
    const nowMs = now.getTime();
    const roomPath = "rooms/" + roomId;
    const senderPath = "users/" + senderUid;
    const catalogPath = "system_config/gift_catalog";
    const economyPath = "system_config/gift_economy";
    const rocketConfigPath = "system_config/room_rocket";
    const rocketStatePath = "room_rocket_state/" + roomId;
    const rocketGlobalQueuePath = "system_state/room_rocket_global_queue";
    const opPath = "gift_operations/" + key;
    const lockPath = "system_config/emergency_lock";

    const [
      roomSnap,
      senderSnap,
      catalogSnap,
      economySnap,
      rocketConfigSnap,
      rocketStateSnap,
      rocketGlobalQueueSnap,
      opSnap,
      lockSnap,
    ] = await Promise.all([
      db.get(roomPath, transaction),
      db.get(senderPath, transaction),
      db.get(catalogPath, transaction),
      db.get(economyPath, transaction),
      db.get(rocketConfigPath, transaction),
      db.get(rocketStatePath, transaction),
      db.get(rocketGlobalQueuePath, transaction),
      db.get(opPath, transaction),
      db.get(lockPath, transaction),
    ]);

    if (opSnap.exists) {
      if (
        roomGiftOperationConflicts(opSnap.data, {
          senderId: senderUid,
          roomId,
          giftId,
          quantity,
          recipientMode,
          recipientIds: requestedRecipientIds,
          receiverId: requestedRecipientIds[0] || "",
        })
      ) {
        throw new ApiError("idempotency_conflict", 409);
      }
      await db.rollback(transaction);
      return { ok: true, code: "duplicate", ...(opSnap.data?.result || {}) };
    }

    if (!roomSnap.exists || roomSnap.data?.isActive === false) {
      throw new ApiError("room_unavailable", 409);
    }
    const room = roomSnap.data || {};
    if (!roomFeatureEnabled(room, "giftsEnabled")) {
      throw new ApiError("room_gifts_disabled", 409);
    }
    if (!senderSnap.exists) throw new ApiError("user_not_found", 404);

    const economyLock = lockSnap.data || {};
    if (
      economyLock.enabled === true ||
      economyLock.economyLocked === true ||
      economyLock.giftsLocked === true
    ) {
      throw new ApiError("emergency_locked", 409);
    }

    let recipientIds = [];
    if (recipientMode === "users") {
      recipientIds = requestedRecipientIds;
      if (realtimeSelection !== null) {
        const present = new Set(realtimeSelection.map(clean));
        if (!present.has(senderUid)) {
          throw new ApiError("sender_not_in_room", 409);
        }
        if (recipientIds.some((uid) => !present.has(uid))) {
          throw new ApiError("receiver_not_in_room", 409);
        }
      } else {
        await assertRoomPresence(
          db,
          transaction,
          null,
          roomId,
          senderUid,
          "sender_not_in_room",
        );
        for (const uid of recipientIds) {
          await assertRoomPresence(
            db,
            transaction,
            null,
            roomId,
            uid,
            "receiver_not_in_room",
          );
        }
      }
    } else if (recipientMode === "all_room") {
      if (!realtimeSelection) {
        throw new ApiError("room_presence_unavailable", 503);
      }
      if (realtimeSelection.requiredUidPresent === false) {
        throw new ApiError("sender_not_in_room", 409);
      }
      if (
        realtimeSelection.onlineCount > MAX_ROOM_GIFT_RECIPIENTS ||
        realtimeSelection.truncated === true
      ) {
        throw new ApiError("room_gift_recipient_limit", 409);
      }
      recipientIds = Array.from(
        new Set(
          realtimeSelection.participants
            .map((item) => clean(item?.uid))
            .filter(Boolean),
        ),
      );
    } else {
      const seatIds = Array.from(
        new Set(
          (Array.isArray(room.seats) ? room.seats : [])
            .map((item) => clean(item?.uid))
            .filter(Boolean),
        ),
      );
      if (seatIds.length > MAX_ROOM_GIFT_RECIPIENTS) {
        throw new ApiError("room_gift_recipient_limit", 409);
      }
      const presentIds = await realtimeResolveRoomUidsFromNamespace(
        realtimeNamespace,
        roomId,
        [senderUid, ...seatIds],
      );
      if (presentIds === null) {
        throw new ApiError("room_presence_unavailable", 503);
      }
      const present = new Set(presentIds.map(clean));
      if (!present.has(senderUid)) {
        throw new ApiError("sender_not_in_room", 409);
      }
      recipientIds = seatIds.filter((uid) => present.has(uid));
    }

    recipientIds = Array.from(new Set(recipientIds.map(clean).filter(Boolean)));
    if (
      recipientIds.length < 1 ||
      recipientIds.length > MAX_ROOM_GIFT_RECIPIENTS
    ) {
      throw new ApiError(
        recipientIds.length > MAX_ROOM_GIFT_RECIPIENTS
          ? "room_gift_recipient_limit"
          : "recipient_required",
        409,
      );
    }

    const recipientRecords = await Promise.all(
      recipientIds.map(async (receiverId) => {
        if (receiverId === senderUid) {
          return {
            receiverId,
            receiverSnap: senderSnap,
            senderBlock: { exists: false },
            receiverBlock: { exists: false },
          };
        }
        const [receiverSnap, senderBlock, receiverBlock] = await Promise.all([
          db.get("users/" + receiverId, transaction),
          db.get(
            "user_blocks/" + senderUid + "/items/" + receiverId,
            transaction,
          ),
          db.get(
            "user_blocks/" + receiverId + "/items/" + senderUid,
            transaction,
          ),
        ]);
        return { receiverId, receiverSnap, senderBlock, receiverBlock };
      }),
    );

    for (const item of recipientRecords) {
      if (!item.receiverSnap.exists) {
        throw new ApiError("user_not_found", 404);
      }
      if (item.senderBlock.exists || item.receiverBlock.exists) {
        throw new ApiError("blocked", 409);
      }
    }

    const rawCatalog =
      catalogSnap.exists && Array.isArray(catalogSnap.data?.gifts)
        ? catalogSnap.data.gifts
        : fallbackGifts;
    const gift = rawCatalog.find((item) => clean(item?.id) === giftId);
    if (!gift) throw new ApiError("gift_not_found", 404);
    if (gift.enabled === false) throw new ApiError("gift_inactive", 409);
    const visualPolicy = giftVisualPolicy(gift, quantity);

    let relationshipGiftContext = null;
    try {
      relationshipGiftContext = await prepareRelationshipGiftContext(
        db,
        transaction,
        {
          senderUid,
          gift,
        },
      );
    } catch (error) {
      const code = clean(error?.message);
      if (code === "invalid_affinity_base_points") {
        throw new ApiError(code, 409);
      }
      throw error;
    }

    const sender = senderSnap.data || {};
    const senderVip = vipCosmeticsFromUser(sender, nowMs).level;
    const requiredVipLevel = giftMinVipLevel(gift);
    if (requiredVipLevel > 0 && senderVip < requiredVipLevel) {
      throw new ApiError("vip_gift_requires_level", 403);
    }

    const unitCoins = Number(gift.priceCoins || 0);
    if (!Number.isSafeInteger(unitCoins) || unitCoins <= 0) {
      throw new ApiError("invalid_gift_price", 400);
    }
    const recipientCost = unitCoins * quantity;
    const totalCost = recipientCost * recipientIds.length;
    if (
      !Number.isSafeInteger(recipientCost) ||
      recipientCost <= 0 ||
      !Number.isSafeInteger(totalCost) ||
      totalCost <= 0
    ) {
      throw new ApiError("invalid_gift_price", 400);
    }

    const senderLevelAwards = giftLevelPointAwards({
      nominalCoins: totalCost,
      paidCoins: totalCost,
    });
    const nextWealthPoints = senderLevelAwards
      ? safeAddUserLevelPoints(
          sender.wealthPoints,
          senderLevelAwards.wealthPoints,
        )
      : null;
    if (!senderLevelAwards || nextWealthPoints === null) {
      throw new ApiError("invalid_level_points", 409);
    }

    const before = Number(sender.coins ?? sender.balance ?? 0);
    if (!Number.isFinite(before) || before < 0) {
      throw new ApiError("invalid_wallet_state", 400);
    }
    if (before < totalCost) throw new ApiError("insufficient_balance", 409);
    const after = before - totalCost;

    const economy = economySnap.data || {};
    const senderName = clean(
      sender.displayName || sender.username || "مستخدم Shadow Live",
    );
    const senderPhoto = clean(sender.profileImageUrl);
    const senderFrameAssetKey = clean(sender.activeProfileFrameAssetKey);
    const senderFrameImageUrl = clean(sender.activeProfileFrameImageUrl);
    const senderFrameExpiresAtMs = Math.max(
      0,
      Number(sender.activeProfileFrameExpiresAtMs || 0),
    );
    const senderFramePermanent =
      sender.activeProfileFramePermanent === true;
    const senderVipCosmetics = vipCosmeticsFromUser(sender, nowMs);
    const giftName = clean(gift.nameAr || "هدية");
    const assetKey = clean(gift.assetKey || "gifts.placeholder.default");
    const imageUrl = clean(gift.imageUrl);

    const roomRocketEnabled = roomFeatureEnabled(room, "roomRocketEnabled");
    const rocketAdvance = roomRocketEnabled
      ? advanceRoomRocket({
          state: {
            ...(rocketStateSnap.data || {}),
            queueAvailableAtMs: Math.max(
              Number(rocketStateSnap.data?.queueAvailableAtMs || 0),
              Number(rocketGlobalQueueSnap.data?.queueAvailableAtMs || 0),
            ),
          },
          config: rocketConfigSnap.data || {},
          roomId,
          sender: {
            uid: senderUid,
            displayName: senderName,
            profileImageUrl: senderPhoto,
          },
          contributionCoins: totalCost,
          nowMs,
          operationId: key,
        })
      : {
          nextState: {
            currentLevel: Math.max(
              1,
              Number(rocketStateSnap.data?.currentLevel || 1),
            ),
            progressCoins: Math.max(
              0,
              Number(rocketStateSnap.data?.progressCoins || 0),
            ),
            levelThresholdCoins: Math.max(
              1,
              Number(
                rocketStateSnap.data?.levelThresholdCoins ||
                  rocketStateSnap.data?.thresholdCoins ||
                  100000,
              ),
            ),
            queueAvailableAtMs: Math.max(
              0,
              Number(rocketStateSnap.data?.queueAvailableAtMs || 0),
            ),
          },
          explosions: [],
        };

    const messageId = randomDocId("msg");
    const writes = [
      db.writeUpdate(
        senderPath,
        {
          coins: after,
          walletUpdatedAt: now,
          wealthPoints: nextWealthPoints,
        },
        ["coins", "walletUpdatedAt", "wealthPoints"],
        [
          db.increment(
            "totalGiftsSent",
            quantity * recipientIds.length,
          ),
        ],
      ),
    ];

    if (roomRocketEnabled) {
      writes.push(
        db.writeUpdate(
          rocketStatePath,
          {
            ...rocketAdvance.nextState,
            roomId,
            lastContributorUid: senderUid,
            lastContributorDisplayName: senderName,
            lastContributorProfileImageUrl: senderPhoto,
            lastContributionCoins: totalCost,
            lastOperationId: key,
            updatedAt: now,
          },
        ),
      );
    }

    for (const explosion of rocketAdvance.explosions) {
      writes.push(
        db.writeCreate(
          "room_rocket_explosions/" + explosion.explosionId,
          {
            ...explosion,
            operationId: key,
            createdAt: now,
          },
        ),
      );
    }
    if (rocketAdvance.explosions.length > 0) {
      const lastExplosion =
        rocketAdvance.explosions[rocketAdvance.explosions.length - 1];
      writes.push(
        db.writeUpdate(
          rocketGlobalQueuePath,
          {
            queueAvailableAtMs: rocketAdvance.nextState.queueAvailableAtMs,
            lastRoomId: roomId,
            lastExplosionId: lastExplosion.explosionId,
            updatedAt: now,
          },
          [
            "queueAvailableAtMs",
            "lastRoomId",
            "lastExplosionId",
            "updatedAt",
          ],
        ),
      );
    }

    const roomSupportTransforms = [
      db.increment("supportCoins", totalCost),
      db.increment("giftCount", quantity * recipientIds.length),
    ];
    // High-frequency room support lives in the period support documents below.
    // Do not mutate rooms/{roomId} for every gift: room-root listeners fan this
    // write out to every connected participant.
    const roomDailyPath =
      roomPath + "/support_daily/" + periods.day;
    const roomWeeklyPath =
      roomPath + "/support_weekly/" + periods.week;
    const roomMonthlyPath =
      roomPath + "/support_monthly/" + periods.month;
    for (const supportPath of [
      roomDailyPath,
      roomWeeklyPath,
      roomMonthlyPath,
    ]) {
      writes.push(
        db.writeUpdate(
          supportPath,
          { updatedAt: now },
          ["updatedAt"],
          roomSupportTransforms,
        ),
      );
    }
    for (const supportPath of [
      roomDailyPath + "/users/" + senderUid,
      roomWeeklyPath + "/users/" + senderUid,
      roomMonthlyPath + "/users/" + senderUid,
    ]) {
      writes.push(
        db.writeUpdate(
          supportPath,
          {
            uid: senderUid,
            displayName: senderName,
            profileImageUrl: senderPhoto,
            activeProfileFrameAssetKey: senderFrameAssetKey,
            activeProfileFrameImageUrl: senderFrameImageUrl,
            activeProfileFrameExpiresAtMs: senderFrameExpiresAtMs,
            activeProfileFramePermanent: senderFramePermanent,
            updatedAt: now,
          },
          [
            "uid",
            "displayName",
            "profileImageUrl",
            "activeProfileFrameAssetKey",
            "activeProfileFrameImageUrl",
            "activeProfileFrameExpiresAtMs",
            "activeProfileFramePermanent",
            "updatedAt",
          ],
          roomSupportTransforms,
        ),
      );
    }

    const agencyFinancialCursor = new Map();
    const userDiamondCursor = new Map();
    const recipientResults = [];
    let agencyStatsTouched = false;
    let totalRecipientShareCoins = 0;
    let totalAgencyShareCoins = 0;
    let totalPlatformShareCoins = 0;
    let totalDiamondsEarned = 0;

    for (let index = 0; index < recipientRecords.length; index += 1) {
      const record = recipientRecords[index];
      const receiverId = record.receiverId;
      const receiver = record.receiverSnap.data || {};
      const subKey = roomGiftSubOperationId(
        key,
        index,
        recipientRecords.length,
      );
      const recipientLevelAwards = giftLevelPointAwards({
        nominalCoins: recipientCost,
        paidCoins: recipientCost,
      });
      const nextAttractionPoints = recipientLevelAwards
        ? safeAddUserLevelPoints(
            receiver.attractionPoints,
            recipientLevelAwards.attractionPoints,
          )
        : null;
      if (!recipientLevelAwards || nextAttractionPoints === null) {
        throw new ApiError("invalid_level_points", 409);
      }

      const agencyId = clean(receiver.agencyId || "");
      const revenueMonth = agencyId ? agencyPeriods.month : periods.month;
      const previousMonthCoins =
        clean(receiver.giftRevenueMonth) === revenueMonth
          ? Math.max(0, Number(receiver.giftRevenueMonthCoins || 0))
          : 0;
      const monthlyGrossCoins = previousMonthCoins + recipientCost;
      const previousAgencyPublicSupportCoins =
        agencyId &&
        clean(receiver.agencyPublicSupportAgencyId) === agencyId &&
        clean(receiver.agencyPublicSupportMonth) === agencyPeriods.month
          ? Math.max(
              0,
              Number(receiver.agencyPublicSupportCoins || 0),
            )
          : 0;
      const agencyPublicSupportCoins =
        previousAgencyPublicSupportCoins + recipientCost;
      if (
        agencyId &&
        !Number.isSafeInteger(agencyPublicSupportCoins)
      ) {
        throw new ApiError("invalid_agency_public_support", 409);
      }

      const agencyPolicySnapshot = agencyPolicySnapshotFor(
        receiver,
        agencyId,
      );
      const effectiveEconomy = economyWithAgencyPolicySnapshot(
        economy,
        receiver,
        agencyId,
      );
      const revenue = resolveGiftRevenuePolicy(
        effectiveEconomy,
        receiver,
        monthlyGrossCoins,
        agencyId,
        revenueMonth,
      );
      const policyEnabled =
        economy.policyMode === "tiered_host_agency"
          ? economy.enabled !== false
          : true;
      const earningsEnabled = policyEnabled && revenue.hostShareBps > 0;
      const recipientShareBps = earningsEnabled
        ? revenue.hostShareBps
        : 0;
      const recipientShareCoins = earningsEnabled
        ? Math.floor((recipientCost * recipientShareBps) / 10000)
        : 0;
      const agencyShareCoins =
        policyEnabled && agencyId
          ? Math.floor(
              (recipientCost * revenue.agencyShareBps) / 10000,
            )
          : 0;
      const platformShareCoins = policyEnabled
        ? Math.max(
            0,
            recipientCost - recipientShareCoins - agencyShareCoins,
          )
        : recipientCost;

      const previousPendingGiftCoins = Math.max(
        0,
        Number(receiver.pendingGiftEarningCoins || 0),
      );
      const accumulatedGiftCoins =
        previousPendingGiftCoins + recipientShareCoins;
      const agencyTargetPolicy =
        agencyPolicySnapshot?.targets || economy.agencyTargets;
      const agencyTarget =
        agencyId && earningsEnabled
          ? calculateAgencyTargetProgress({
              monthKey: agencyPeriods.month,
              storedMonth: receiver.agencyTargetMonth,
              storedProgressCoins: receiver.agencyTargetProgressCoins,
              addedHostShareCoins: recipientShareCoins,
              storedPaidDiamonds: receiver.agencySalaryPaidDiamonds,
              targets: agencyTargetPolicy,
            })
          : null;
      const agencyTargetAchievements = agencyTarget
        ? agencyTargetAchievementDeltas({
            previousProgressCoins: agencyTarget.previousProgressCoins,
            progressCoins: agencyTarget.progressCoins,
            targets: agencyTargetPolicy,
          })
        : [];
      const diamondsEarned = agencyTarget
        ? agencyTarget.salaryDeltaDiamonds
        : earningsEnabled
          ? Math.floor(accumulatedGiftCoins / 10000)
          : 0;
      const pendingGiftEarningCoins = agencyTarget
        ? previousPendingGiftCoins
        : earningsEnabled
          ? accumulatedGiftCoins % 10000
          : previousPendingGiftCoins;

      const openingDiamonds = Math.max(
        0,
        Number(
          userDiamondCursor.has(receiverId)
            ? userDiamondCursor.get(receiverId)
            : receiver.diamonds || 0,
        ),
      );
      const hostSalaryClosingDiamonds =
        openingDiamonds + diamondsEarned;

      let agencyTargetSharePlan = agencyTarget
        ? await prepareAgencyTargetSharePayout(
            db,
            transaction,
            {
              agencyId,
              hostUid: receiverId,
              hostUser: receiver,
              agencyTarget,
              effectiveEconomy,
              month: agencyPeriods.month,
            },
          )
        : null;
      if (agencyTargetSharePlan && agencyFinancialCursor.has(agencyId)) {
        agencyTargetSharePlan = continueAgencyTargetSharePlan(
          agencyTargetSharePlan,
          agencyFinancialCursor.get(agencyId),
        );
      }

      let agencyTargetSharePayout = null;
      if (agencyTargetSharePlan) {
        const ownerOpeningDiamonds =
          agencyTargetSharePlan.ownerIsHost
            ? hostSalaryClosingDiamonds
            : userDiamondCursor.has(agencyTargetSharePlan.ownerUid)
              ? userDiamondCursor.get(agencyTargetSharePlan.ownerUid)
              : agencyTargetSharePlan.ownerOpeningDiamonds;
        agencyTargetSharePayout = buildAgencyTargetSharePayoutWrites(
          db,
          agencyTargetSharePlan,
          {
            operationId: subKey,
            now,
            ownerOpeningDiamonds,
            contextType: "room",
            roomId,
          },
        );
        writes.push(...agencyTargetSharePayout.writes);
        agencyFinancialCursor.set(agencyId, {
          carryoverCoins: agencyTargetSharePlan.remainderCoins,
          lifetimeAgencyDiamonds:
            agencyTargetSharePlan.lifetimeAgencyDiamonds,
        });
        userDiamondCursor.set(
          agencyTargetSharePlan.ownerUid,
          agencyTargetSharePayout.ownerClosingDiamonds,
        );
      }

      const closingDiamonds =
        agencyTargetSharePlan?.ownerIsHost === true
          ? agencyTargetSharePayout.ownerClosingDiamonds
          : hostSalaryClosingDiamonds;
      if (earningsEnabled) {
        userDiamondCursor.set(receiverId, closingDiamonds);
      }

      const receiverFields = {
        giftRevenueMonth: revenueMonth,
        giftRevenueMonthCoins: monthlyGrossCoins,
        currentGiftRevenueTier: revenue.tierId,
        attractionPoints: nextAttractionPoints,
      };
      const receiverMask = [
        "giftRevenueMonth",
        "giftRevenueMonthCoins",
        "currentGiftRevenueTier",
        "attractionPoints",
      ];
      if (agencyId) {
        receiverFields.agencyPublicSupportAgencyId = agencyId;
        receiverFields.agencyPublicSupportMonth = agencyPeriods.month;
        receiverFields.agencyPublicSupportCoins =
          agencyPublicSupportCoins;
        receiverMask.push(
          "agencyPublicSupportAgencyId",
          "agencyPublicSupportMonth",
          "agencyPublicSupportCoins",
        );
      }
      const receiverTransforms = [
        db.increment("totalGiftsReceived", quantity),
        db.increment("totalValueReceived", recipientCost),
        db.increment("giftSupportReceivedCoins", recipientCost),
      ];
      if (earningsEnabled) {
        receiverTransforms.push(
          db.increment(
            "giftEarningCoinsLifetime",
            recipientShareCoins,
          ),
        );
        receiverFields.diamonds = closingDiamonds;
        receiverFields.pendingGiftEarningCoins =
          pendingGiftEarningCoins;
        receiverMask.push(
          "diamonds",
          "pendingGiftEarningCoins",
        );
        receiverTransforms.push(
          db.increment("giftDiamondsLifetime", diamondsEarned),
        );
        if (agencyTarget) {
          receiverFields.agencyTargetMonth = agencyPeriods.month;
          receiverFields.agencyTargetProgressCoins =
            agencyTarget.progressCoins;
          receiverFields.agencySalaryPaidDiamonds =
            agencyTarget.paidDiamonds;
          receiverFields.agencyCurrentTargetId =
            agencyTarget.reachedTarget?.id || "";
          receiverFields.agencyNextTargetCoins =
            agencyTarget.remainingToNextTargetCoins;
          receiverFields.agencyTargetUpdatedAt = now;
          receiverMask.push(
            "agencyTargetMonth",
            "agencyTargetProgressCoins",
            "agencySalaryPaidDiamonds",
            "agencyCurrentTargetId",
            "agencyNextTargetCoins",
            "agencyTargetUpdatedAt",
          );
          if (agencyTargetSharePlan) {
            receiverFields.agencySharePayoutMonth =
              agencyPeriods.month;
            receiverFields.agencySharePaidCoinsMonth =
              agencyTargetSharePlan.paidCoins;
            receiverFields.agencySharePaidTargetIdMonth =
              agencyTargetSharePlan.targetId;
            receiverMask.push(
              "agencySharePayoutMonth",
              "agencySharePaidCoinsMonth",
              "agencySharePaidTargetIdMonth",
            );
          }
        }
      }
      writes.push(
        db.writeUpdate(
          "users/" + receiverId,
          receiverFields,
          receiverMask,
          receiverTransforms,
        ),
      );

      const receiverStatsTransforms = [
        db.increment("receivedCoins", recipientCost),
        db.increment("giftCount", quantity),
        db.increment("diamondsEarned", diamondsEarned),
        db.increment("earningCoins", recipientShareCoins),
      ];
      for (const statsPath of [
        "gift_user_stats/" + receiverId + "/daily/" + periods.day,
        "gift_user_stats/" + receiverId + "/weekly/" + periods.week,
        "gift_user_stats/" + receiverId + "/monthly/" + periods.month,
      ]) {
        writes.push(
          db.writeUpdate(
            statsPath,
            { updatedAt: now },
            ["updatedAt"],
            receiverStatsTransforms,
          ),
        );
      }

      if (agencyId) {
        agencyStatsTouched = true;
        const agencyStatsTransforms = [
          db.increment("supportCoins", recipientCost),
          db.increment("giftCount", quantity),
          db.increment("hostEarningCoins", recipientShareCoins),
          db.increment("agencyEarningCoins", agencyShareCoins),
          db.increment("platformShareCoins", platformShareCoins),
        ];
        for (const statsPath of [
          "agency_support_stats/" +
            agencyId +
            "/daily/" +
            agencyPeriods.day,
          "agency_support_stats/" +
            agencyId +
            "/weekly/" +
            agencyPeriods.week,
          "agency_support_stats/" +
            agencyId +
            "/monthly/" +
            agencyPeriods.month,
        ]) {
          writes.push(
            db.writeUpdate(
              statsPath,
              { updatedAt: now },
              ["updatedAt"],
              agencyStatsTransforms,
            ),
          );
        }

        const agencyShard = agencyAccrualShard(key);
        writes.push(
          db.writeUpdate(
            "agency_monthly_accrual_shards/" +
              agencyId +
              "__" +
              agencyPeriods.month +
              "__" +
              String(agencyShard).padStart(2, "0"),
            {
              agencyId,
              month: agencyPeriods.month,
              shard: agencyShard,
              updatedAt: now,
            },
            ["agencyId", "month", "shard", "updatedAt"],
            [
              db.increment("supportCoins", recipientCost),
              db.increment("hostShareCoins", recipientShareCoins),
              db.increment("agencyShareCoins", agencyShareCoins),
              db.increment("platformShareCoins", platformShareCoins),
              db.increment("giftCount", quantity),
            ],
          ),
        );
        writes.push(
          db.writeUpdate(
            "agency_host_monthly/" +
              agencyId +
              "__" +
              agencyPeriods.month +
              "__" +
              receiverId,
            {
              agencyId,
              hostUid: receiverId,
              month: agencyPeriods.month,
              targetId: agencyTarget?.reachedTarget?.id || "",
              targetTierId:
                agencyTarget?.reachedTarget?.tierId || "",
              targetRank: agencyTarget?.reachedTarget?.rank || "",
              targetThresholdCoins:
                agencyTarget?.reachedTarget?.thresholdCoins || 0,
              surplusPageKey:
                agencyId +
                "__" +
                agencyPeriods.month +
                "__" +
                receiverId,
              publicRankingKey: agencyPublicRankingKey({
                agencyId,
                month: agencyPeriods.month,
                hostUid: receiverId,
                supportCoins: agencyPublicSupportCoins,
              }),
              publicSupportCoins: agencyPublicSupportCoins,
              nextTargetCoins:
                agencyTarget?.remainingToNextTargetCoins || 0,
              salaryPaidDiamonds: agencyTarget?.paidDiamonds || 0,
              agencyTargetSharePaidTargetId:
                agencyTarget?.reachedTarget?.id || "",
              updatedAt: now,
            },
            [
              "agencyId",
              "hostUid",
              "month",
              "targetId",
              "targetTierId",
              "targetRank",
              "targetThresholdCoins",
              "surplusPageKey",
              "publicRankingKey",
              "publicSupportCoins",
              "nextTargetCoins",
              "salaryPaidDiamonds",
              "agencyTargetSharePaidTargetId",
              "updatedAt",
            ],
            [
              db.increment("supportCoins", recipientCost),
              db.increment("hostShareCoins", recipientShareCoins),
              db.increment("agencyShareCoins", agencyShareCoins),
              db.increment(
                "agencyTargetSharePaidCoins",
                agencyTargetSharePlan?.deltaCoins || 0,
              ),
              db.increment(
                "agencyTargetSharePaidDiamonds",
                agencyTargetSharePlan?.shareDiamondsEarned || 0,
              ),
              db.increment("giftCount", quantity),
            ],
          ),
        );
      }

      if (
        earningsEnabled &&
        agencyTarget &&
        diamondsEarned > 0
      ) {
        writes.push(
          db.writeCreate(
            "financial_ledger/gift_earnings_" + subKey,
            {
              userId: receiverId,
              agencyId,
              asset: "diamonds",
              delta: diamondsEarned,
              openingBalance: openingDiamonds,
              closingBalance: hostSalaryClosingDiamonds,
              reason: "agency_target_salary",
              sourceType: "gift",
              sourceId: subKey,
              actorUid: senderUid,
              counterpartyUid: senderUid,
              roomId,
              month: agencyPeriods.month,
              targetId: agencyTarget.reachedTarget?.id || "",
              targetProgressCoins: agencyTarget.progressCoins,
              salaryPaidDiamonds: agencyTarget.paidDiamonds,
              idempotencyKey:
                subKey + "_agency_target_salary",
              createdAt: now,
            },
          ),
          db.writeCreate(
            "admin_audit_logs/agency_target_salary_" + subKey,
            {
              actorUid: "system",
              action: "agencyTargetSalaryPaid",
              targetType: "user",
              targetId: receiverId,
              triggerUid: senderUid,
              agencyId,
              contextType: "room",
              roomId,
              sourceType: "gift",
              sourceId: subKey,
              month: agencyPeriods.month,
              targetIdReached:
                agencyTarget.reachedTarget?.id || "",
              targetProgressCoins: agencyTarget.progressCoins,
              salaryDeltaDiamonds: diamondsEarned,
              salaryPaidDiamonds: agencyTarget.paidDiamonds,
              openingBalance: openingDiamonds,
              closingBalance: hostSalaryClosingDiamonds,
              createdAt: now,
            },
          ),
          db.writeCreate(
            "notifications/agency_target_salary_" +
              subKey +
              "_" +
              receiverId,
            {
              userId: receiverId,
              type: "agency_target_salary_paid",
              category: "system",
              title: "تم تحقيق Target جديد",
              body:
                "تم تحقيق " +
                String(
                  agencyTarget.reachedTarget?.tierId ||
                    agencyTarget.reachedTarget?.id ||
                    "Target",
                ) +
                " " +
                String(agencyTarget.reachedTarget?.rank || "") +
                " وإضافة " +
                String(diamondsEarned) +
                " Diamonds إلى محفظتك.",
              read: false,
              mandatory: true,
              financial: true,
              agencyId,
              month: agencyPeriods.month,
              targetId:
                agencyTarget.reachedTarget?.id || null,
              targetTierId:
                agencyTarget.reachedTarget?.tierId || null,
              targetRank:
                agencyTarget.reachedTarget?.rank || null,
              salaryDeltaDiamonds: diamondsEarned,
              salaryPaidDiamonds: agencyTarget.paidDiamonds,
              createdAt: now,
            },
          ),
        );
      } else if (
        earningsEnabled &&
        !agencyTarget &&
        diamondsEarned > 0
      ) {
        writes.push(
          db.writeCreate(
            "financial_ledger/gift_earnings_" + subKey,
            {
              userId: receiverId,
              asset: "diamonds",
              delta: diamondsEarned,
              openingBalance: openingDiamonds,
              closingBalance: closingDiamonds,
              reason: "gift_earnings",
              sourceType: "gift",
              sourceId: subKey,
              actorUid: senderUid,
              counterpartyUid: senderUid,
              roomId,
              idempotencyKey: subKey + "_earnings",
              createdAt: now,
            },
          ),
        );
      }

      let relationshipGiftAward = {
        writes: [],
        relationshipId: null,
        relationshipType: null,
        affinityBasePoints: 0,
        affinityPointsAwarded: 0,
      };
      try {
        relationshipGiftAward =
          await relationshipGiftWritesForRecipient(
            db,
            transaction,
            relationshipGiftContext,
            {
              receiverId,
              giftId,
              quantity,
              operationId: subKey,
              now,
            },
          );
      } catch (error) {
        const code = clean(error?.message);
        if (
          code === "relationship_gift_not_eligible" ||
          code === "invalid_affinity_points" ||
          code === "invalid_affinity_quantity" ||
          code === "invalid_relationship_gift_operation"
        ) {
          throw new ApiError(code, 409);
        }
        throw error;
      }
      writes.push(...relationshipGiftAward.writes);

      const receiverName = clean(
        receiver.displayName ||
          receiver.username ||
          "مستخدم Shadow Live",
      );
      const receiverProfileImageUrl = clean(receiver.profileImageUrl);
      writes.push(
        db.writeCreate(
          "gift_transactions/" + subKey,
          {
            operationId: key,
            recipientIndex: index,
            recipientCount: recipientIds.length,
            senderId: senderUid,
            receiverId,
            contextType: "room",
            roomId,
            giftId,
            giftName,
            quantity,
            unitCoins,
            totalCost: recipientCost,
            operationTotalCost: totalCost,
            assetKey,
            wealthPointsAwarded:
              recipientIds.length === 1
                ? senderLevelAwards.wealthPoints
                : 0,
            attractionPointsAwarded:
              recipientLevelAwards.attractionPoints,
            policyMode: "tiered_host_agency",
            revenueTierId: revenue.tierId,
            revenueTierName: revenue.tierName,
            revenueTierMinGiftCoins: revenue.tierMinGiftCoins,
            monthlyGrossCoins,
            recipientShareBps,
            recipientShareCoins,
            hostBaseShareBps: revenue.hostBaseShareBps,
            hostBonusBps: revenue.hostBonusBps,
            agencyBaseShareBps: revenue.agencyBaseShareBps,
            agencyBonusBps: revenue.agencyBonusBps,
            agencyBonusDeferredToMonthEnd:
              revenue.agencyBonusDeferredToMonthEnd,
            agencyShareBps: revenue.agencyShareBps,
            agencyShareCoins,
            agencyShareSettlementMode:
              agencyId ? "target_close" : "none",
            agencyTargetShareDeltaCoins:
              agencyTargetSharePlan?.deltaCoins || 0,
            agencyTargetShareDiamonds:
              agencyTargetSharePlan?.shareDiamondsEarned || 0,
            agencyTargetShareCarryoverCoins:
              agencyTargetSharePlan?.remainderCoins || 0,
            agencyOwnerUid:
              agencyTargetSharePlan?.ownerUid || null,
            agencyActiveHostCount: revenue.activeHostCount,
            agencyRequiredActiveHosts:
              revenue.requiredActiveHosts,
            platformShareBps: revenue.platformShareBps,
            platformShareCoins,
            qualifiedDays: revenue.qualifiedDays,
            requiredQualifiedDays: revenue.requiredDays,
            diamondsEarned,
            pendingGiftEarningCoins,
            settlementMode:
              agencyTarget ? "target_immediate" : "immediate",
            settlementCycleKey: null,
            agencyTargetMonth: agencyTarget?.month || null,
            agencyTargetProgressCoins:
              agencyTarget?.progressCoins || 0,
            agencyTargetId:
              agencyTarget?.reachedTarget?.id || null,
            agencyTargetAchievements,
            agencyNextTargetCoins:
              agencyTarget?.remainingToNextTargetCoins || 0,
            agencySalaryPaidDiamonds:
              agencyTarget?.paidDiamonds || 0,
            salaryDeltaDiamonds:
              agencyTarget?.salaryDeltaDiamonds || 0,
            earningsStatus: !earningsEnabled
              ? "disabled"
              : agencyTarget
                ? agencyTarget.salaryDeltaDiamonds > 0
                  ? "target_paid"
                  : "target_progress"
                : "applied",
            periods,
            agencyId: agencyId || null,
            relationshipId: relationshipGiftAward.relationshipId,
            relationshipType: relationshipGiftAward.relationshipType,
            affinityBasePoints:
              relationshipGiftAward.affinityBasePoints,
            affinityPointsAwarded:
              relationshipGiftAward.affinityPointsAwarded,
            affinityMultiplierBps:
              relationshipGiftAward.relationshipId ? 15000 : 0,
            createdAt: now,
          },
        ),
        db.writeUpdate(
          "public_gift_showcases/" +
            receiverId +
            "/items/" +
            giftId,
          {
            giftId,
            name: giftName,
            imageUrl,
            assetKey,
            updatedAt: now,
          },
          ["giftId", "name", "imageUrl", "assetKey", "updatedAt"],
          [db.increment("count", quantity)],
        ),
      );

      totalRecipientShareCoins += recipientShareCoins;
      totalAgencyShareCoins += agencyShareCoins;
      totalPlatformShareCoins += platformShareCoins;
      totalDiamondsEarned += diamondsEarned;

      recipientResults.push({
        receiverId,
        receiverName,
        receiverProfileImageUrl,
        attractionPointsAwarded:
          recipientLevelAwards.attractionPoints,
        revenueTierId: revenue.tierId,
        recipientShareCoins,
        agencyShareCoins,
        agencyShareSettlementMode:
          agencyId ? "target_close" : "none",
        agencyTargetShareDeltaCoins:
          agencyTargetSharePlan?.deltaCoins || 0,
        agencyTargetShareDiamonds:
          agencyTargetSharePlan?.shareDiamondsEarned || 0,
        agencyTargetShareCarryoverCoins:
          agencyTargetSharePlan?.remainderCoins || 0,
        agencyOwnerUid:
          agencyTargetSharePlan?.ownerUid || null,
        platformShareCoins,
        diamondsEarned,
        earningsApplied: earningsEnabled,
        earningsStatus: !earningsEnabled
          ? "disabled"
          : agencyTarget
            ? agencyTarget.salaryDeltaDiamonds > 0
              ? "target_paid"
              : "target_progress"
            : "applied",
        settlementCycleKey: null,
        agencyTargetMonth: agencyTarget?.month || null,
        agencyTargetProgressCoins:
          agencyTarget?.progressCoins || 0,
        agencyTargetId:
          agencyTarget?.reachedTarget?.id || null,
        agencyTargetAchievements,
        agencyNextTargetCoins:
          agencyTarget?.remainingToNextTargetCoins || 0,
        agencySalaryPaidDiamonds:
          agencyTarget?.paidDiamonds || 0,
        salaryDeltaDiamonds:
          agencyTarget?.salaryDeltaDiamonds || 0,
        relationshipId: relationshipGiftAward.relationshipId,
        relationshipType: relationshipGiftAward.relationshipType,
        affinityBasePoints:
          relationshipGiftAward.affinityBasePoints,
        affinityPointsAwarded:
          relationshipGiftAward.affinityPointsAwarded,
      });
    }

    writes.push(
      db.writeCreate(
        "financial_ledger/gift_" + key,
        {
          userId: senderUid,
          asset: "coins",
          delta: -totalCost,
          openingBalance: before,
          closingBalance: after,
          reason: "room_gift_send",
          sourceType: "gift",
          sourceId: key,
          actorUid: senderUid,
          counterpartyUid:
            recipientIds.length === 1
              ? recipientIds[0]
              : null,
          counterpartyUids:
            recipientIds.length > 1 ? recipientIds : null,
          roomId,
          recipientMode,
          recipientCount: recipientIds.length,
          idempotencyKey: key,
          createdAt: now,
        },
      ),
    );

    const first = recipientResults[0];
    const resultData = {
      giftId,
      giftName,
      receiverId:
        recipientIds.length === 1 ? first.receiverId : "",
      receiverName:
        recipientIds.length === 1
          ? first.receiverName
          : String(recipientIds.length) + " مستخدمين",
      recipientMode,
      recipientIds,
      recipientCount: recipientIds.length,
      quantity,
      totalCost,
      balance: after,
      wealthPointsAwarded: senderLevelAwards.wealthPoints,
      attractionPointsAwarded:
        recipientIds.length === 1
          ? first.attractionPointsAwarded
          : recipientResults.reduce(
              (sum, item) =>
                sum + Number(item.attractionPointsAwarded || 0),
              0,
            ),
      revenueTierId:
        recipientIds.length === 1 ? first.revenueTierId : "mixed",
      recipientShareCoins: totalRecipientShareCoins,
      agencyShareCoins: totalAgencyShareCoins,
      agencyShareSettlementMode:
        recipientIds.length === 1
          ? first.agencyShareSettlementMode
          : "per_recipient",
      agencyTargetShareDeltaCoins:
        recipientResults.reduce(
          (sum, item) =>
            sum + Number(item.agencyTargetShareDeltaCoins || 0),
          0,
        ),
      agencyTargetShareDiamonds:
        recipientResults.reduce(
          (sum, item) =>
            sum + Number(item.agencyTargetShareDiamonds || 0),
          0,
        ),
      agencyTargetShareCarryoverCoins:
        recipientIds.length === 1
          ? first.agencyTargetShareCarryoverCoins
          : 0,
      agencyOwnerUid:
        recipientIds.length === 1
          ? first.agencyOwnerUid
          : null,
      platformShareCoins: totalPlatformShareCoins,
      diamondsEarned: totalDiamondsEarned,
      earningsApplied:
        recipientResults.some((item) => item.earningsApplied),
      earningsStatus:
        recipientIds.length === 1
          ? first.earningsStatus
          : "per_recipient",
      settlementCycleKey: null,
      agencyTargetMonth:
        recipientIds.length === 1
          ? first.agencyTargetMonth
          : null,
      agencyTargetProgressCoins:
        recipientIds.length === 1
          ? first.agencyTargetProgressCoins
          : 0,
      agencyTargetId:
        recipientIds.length === 1
          ? first.agencyTargetId
          : null,
      agencyTargetAchievements:
        recipientIds.length === 1
          ? first.agencyTargetAchievements
          : [],
      agencyNextTargetCoins:
        recipientIds.length === 1
          ? first.agencyNextTargetCoins
          : 0,
      agencySalaryPaidDiamonds:
        recipientIds.length === 1
          ? first.agencySalaryPaidDiamonds
          : 0,
      salaryDeltaDiamonds:
        recipientIds.length === 1
          ? first.salaryDeltaDiamonds
          : 0,
      relationshipId:
        recipientIds.length === 1
          ? first.relationshipId
          : null,
      relationshipType:
        recipientIds.length === 1
          ? first.relationshipType
          : null,
      affinityBasePoints:
        recipientIds.length === 1
          ? first.affinityBasePoints
          : 0,
      affinityPointsAwarded:
        recipientResults.reduce(
          (sum, item) =>
            sum + Number(item.affinityPointsAwarded || 0),
          0,
        ),
      recipients: recipientResults,
      messageId,
      roomRocketEnabled,
      rocketCurrentLevel:
        rocketAdvance.nextState.currentLevel,
      rocketProgressCoins:
        rocketAdvance.nextState.progressCoins,
      rocketThresholdCoins:
        rocketAdvance.nextState.levelThresholdCoins,
      rocketExplosionIds:
        rocketAdvance.explosions.map(
          (item) => item.explosionId,
        ),
      roomEffect: visualPolicy.roomEffect
        ? {
            eventId: "gift_fx_" + key,
            giftId,
            giftName,
            quantity,
            ...visualPolicy.roomEffect,
            recipientUids: recipientIds,
          }
        : null,
      premiumCelebration:
        visualPolicy.premiumBanner != null,
    };

    writes.push(
      db.writeCreate(opPath, {
        senderId: senderUid,
        receiverId:
          recipientIds.length === 1 ? recipientIds[0] : "",
        recipientMode,
        recipientIds,
        recipientCount: recipientIds.length,
        roomId,
        giftId,
        quantity,
        action: "sendRoomGift",
        status: "completed",
        result: resultData,
        createdAt: now,
      }),
    );

    if (writes.length > MAX_ROOM_GIFT_WRITES) {
      throw new ApiError("room_gift_write_limit", 409);
    }

    await db.commit(transaction, writes);

    const recipientLabel =
      recipientIds.length === 1
        ? first.receiverName
        : String(recipientIds.length) + " مستخدمين";
    const premiumEvent = premiumGiftCelebrationEvent({
      operationId: key,
      gift,
      quantity,
      totalCost,
      sender: {
        uid: senderUid,
        displayName: senderName,
        profileImageUrl: senderPhoto,
        publicId: clean(sender.publicId),
      },
      receiver: recipientIds.length === 1
        ? {
            uid: first.receiverId,
            displayName: first.receiverName,
            profileImageUrl: first.receiverProfileImageUrl,
          }
        : {},
      roomId,
      nowMs,
    });
    return {
      ok: true,
      code: "ok",
      ...resultData,
      _rocketFeedEvents: rocketAdvance.explosions,
      _globalAppEvents: premiumEvent ? [premiumEvent] : [],
      _chatEvent: {
        roomId,
        message: {
          id: messageId,
          type: "gift",
          systemKind: "gift",
          senderUid,
          receiverUid:
            recipientIds.length === 1 ? first.receiverId : "",
          receiverUids:
            recipientIds.length > 1 ? recipientIds : null,
          recipientCount: recipientIds.length,
          displayName: senderName,
          profileImageUrl: senderPhoto,
          activeProfileFrameAssetKey:
            senderFrameAssetKey,
          activeProfileFrameImageUrl:
            senderFrameImageUrl,
          activeProfileFrameExpiresAtMs:
            senderFrameExpiresAtMs,
          activeProfileFramePermanent:
            senderFramePermanent,
          giftId,
          giftName,
          quantity,
          unitCoins,
          totalCost,
          assetKey,
          imageUrl,
          vipLevel: senderVipCosmetics.level,
          giftEffectEventId:
            visualPolicy.roomEffect ? "gift_fx_" + key : "",
          giftEffectMode:
            visualPolicy.roomEffect?.mode || "none",
          giftEffectAssetKey:
            visualPolicy.roomEffect?.assetKey || "",
          giftEffectSoundAssetKey:
            visualPolicy.roomEffect?.soundAssetKey || "",
          giftEffectDurationMs:
            visualPolicy.roomEffect?.durationMs || 0,
          giftEffectRecipientUids:
            visualPolicy.roomEffect ? recipientIds : [],
          text:
            senderName +
            " أرسل " +
            giftName +
            " ×" +
            String(quantity) +
            " إلى " +
            recipientLabel +
            " — " +
            String(totalCost) +
            " كوينز",
          createdAtMs: nowMs,
        },
      },
      _transactionAttempts: transactionAttempts,
      _agencyStatsTouched: agencyStatsTouched,
    };
  });
}
export async function roomGift(request, env, ctx) {
  if (request.method !== "POST") {
    return json(request, env, { ok: false, code: "method_not_allowed" }, 405);
  }

  try {
    const decoded = await verifyFirebaseIdToken(request, env);
    if (decoded.firebase?.sign_in_provider === "anonymous") {
      throw new ApiError("account_required", 403);
    }
    const body = await readJson(request);
    const result = await sendRoomGift(
      firestoreClient(env),
      decoded.sub,
      body,
      { realtimeNamespace: env.ROOM_REALTIME },
    );
    const rocketFeedEvents = Array.isArray(result?._rocketFeedEvents)
      ? result._rocketFeedEvents
      : [];
    const globalAppEvents = Array.isArray(result?._globalAppEvents)
      ? result._globalAppEvents
      : [];
    if (globalAppEvents.length > 0) {
      const publishTask = publishGlobalAppEvents(env, globalAppEvents).catch(
        (error) => {
          console.error(
            "Premium gift celebration publish failed",
            String(error?.message || error),
          );
        },
      );
      if (typeof ctx?.waitUntil === "function") {
        ctx.waitUntil(publishTask);
      } else {
        await publishTask;
      }
    }
    if (rocketFeedEvents.length > 0) {
      const publishTask = publishGlobalRocketEvents(env, rocketFeedEvents).catch(
        (error) => {
          console.error(
            "Rocket feed publish failed",
            String(error?.message || error),
          );
        },
      );
      if (typeof ctx?.waitUntil === "function") {
        ctx.waitUntil(publishTask);
      } else {
        await publishTask;
      }
    }
    const chatEvent = result?._chatEvent;
    if (chatEvent?.roomId && chatEvent?.message) {
      const publishTask = publishRoomRealtimeEvent(
        env,
        chatEvent.roomId,
        "room.chat_message",
        { message: chatEvent.message },
      ).catch((error) => {
        console.error(
          "Room gift chat publish failed",
          String(error?.message || error),
        );
      });
      if (typeof ctx?.waitUntil === "function") {
        ctx.waitUntil(publishTask);
      } else {
        await publishTask;
      }
    }

    const giftRetries = Math.max(
      0,
      Number(result?._transactionAttempts || 1) - 1,
    );
    writePressureDataPoint(env, {
      kind: "hot_document",
      primary: "room_rocket_state",
      action: "room_gift_commit",
      outcome: "ok",
      reads: 1,
      writes: 1,
      retries: giftRetries,
    });
    writePressureDataPoint(env, {
      kind: "hot_document",
      primary: "room_root",
      action: "room_gift_commit",
      outcome: "no_root_write",
      writes: 0,
      retries: giftRetries,
    });
    writePressureDataPoint(env, {
      kind: "hot_document",
      primary: "room_support_periods",
      action: "room_gift_commit",
      outcome: "daily_weekly_monthly",
      writes: 3,
      retries: giftRetries,
    });
    if (result?._agencyStatsTouched === true) {
      writePressureDataPoint(env, {
        kind: "hot_document",
        primary: "agency_support_stats",
        action: "room_gift_commit",
        outcome: "daily_weekly_monthly",
        reads: 0,
        writes: 3,
        retries: giftRetries,
      });
      writePressureDataPoint(env, {
        kind: "hot_document",
        primary: "agency_monthly_accrual_shard",
        action: "room_gift_commit",
        outcome: "monthly_sharded_32",
        writes: 1,
        retries: giftRetries,
      });
      writePressureDataPoint(env, {
        kind: "hot_document",
        primary: "agency_host_monthly",
        action: "room_gift_commit",
        outcome: "monthly_host",
        writes: 1,
        retries: giftRetries,
      });
    }
    const {
      _rocketFeedEvents,
      _globalAppEvents,
      _chatEvent,
      _transactionAttempts,
      _agencyStatsTouched,
      ...publicResult
    } = result;
    return json(request, env, publicResult, 200);
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
    return json(request, env, { ok: false, code: "room_gift_failed" }, 500);
  }
}
