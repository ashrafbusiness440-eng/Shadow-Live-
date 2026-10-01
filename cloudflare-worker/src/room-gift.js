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
  calculateAgencyTargetProgress,
} from "./agency-policy.js";
import { advanceRoomRocket } from "./room-rocket.js";
import {
  legacyPresenceFresh,
  realtimeUserPresentFromNamespace,
} from "./room-presence-authority.js";
import { publishGlobalRocketEvents } from "./room-realtime.js";
import { writePressureDataPoint } from "./pressure-telemetry.js";

const clean = (value) => String(value ?? "").trim();
const validKey = (value) => /^[A-Za-z0-9_-]{12,220}$/.test(clean(value));
const AGENCY_MONTHLY_ACCRUAL_SHARDS = 32;

function roomGiftOperationConflicts(data = {}, expected = {}) {
  if (clean(data.action) && clean(data.action) !== "sendRoomGift") return true;
  if (clean(data.senderId) && clean(data.senderId) !== clean(expected.senderId)) return true;
  if (clean(data.receiverId) && clean(data.receiverId) !== clean(expected.receiverId)) return true;
  if (clean(data.roomId) && clean(data.roomId) !== clean(expected.roomId)) return true;
  if (clean(data.giftId) && clean(data.giftId) !== clean(expected.giftId)) return true;
  if (data.quantity != null && Number(data.quantity) !== Number(expected.quantity)) return true;
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
  {id:"crown",nameAr:"تاج",priceCoins:2500,enabled:true,assetKey:"gifts.placeholder.default"},
  {id:"ring",nameAr:"خاتم ألماس",priceCoins:5000,enabled:true,assetKey:"gifts.placeholder.default"},
  {id:"sports_car",nameAr:"سيارة رياضية",priceCoins:10000,enabled:true,assetKey:"gifts.placeholder.default"},
  {id:"yacht",nameAr:"يخت فاخر",priceCoins:25000,enabled:true,assetKey:"gifts.placeholder.default"},
  {id:"private_jet",nameAr:"طائرة خاصة",priceCoins:50000,enabled:true,assetKey:"gifts.placeholder.default"},
  {id:"castle",nameAr:"قصر ملكي",priceCoins:100000,enabled:true,assetKey:"gifts.placeholder.default"},
  {id:"golden_dragon",nameAr:"التنين الذهبي",priceCoins:250000,enabled:true,assetKey:"gifts.placeholder.default"},
  {id:"galaxy",nameAr:"مجرة شادو",priceCoins:500000,enabled:true,assetKey:"gifts.placeholder.default"},
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
  const receiverId = clean(body.receiverId);
  const giftId = clean(body.giftId);
  const quantity = Number(body.quantity || 1);
  const key = clean(body.idempotencyKey);

  if (
    !/^[A-Za-z0-9_-]{1,180}$/.test(roomId) ||
    !receiverId ||
    receiverId === senderUid ||
    !giftId ||
    ![1, 7, 77, 777].includes(quantity) ||
    !validKey(key)
  ) {
    throw new ApiError("invalid_request", 400);
  }

  const realtimeNamespace = options?.realtimeNamespace || null;
  const [senderRealtimePresence, receiverRealtimePresence] = await Promise.all([
    realtimeUserPresentFromNamespace(
      realtimeNamespace,
      roomId,
      senderUid,
    ),
    realtimeUserPresentFromNamespace(
      realtimeNamespace,
      roomId,
      receiverId,
    ),
  ]);

  let transactionAttempts = 0;
  return runTransaction(db, async (transaction) => {
    transactionAttempts += 1;
    const now = operationNow(options);
    const periods = utcPeriodKeys(now);
    const agencyPeriods = riyadhPeriodKeys(now);
    const nowMs = now.getTime();
    const roomPath = `rooms/${roomId}`;
    const senderPath = `users/${senderUid}`;
    const receiverPath = `users/${receiverId}`;
    const senderBlockPath = `user_blocks/${senderUid}/items/${receiverId}`;
    const receiverBlockPath = `user_blocks/${receiverId}/items/${senderUid}`;
    const catalogPath = "system_config/gift_catalog";
    const economyPath = "system_config/gift_economy";
    const rocketConfigPath = "system_config/room_rocket";
    const rocketStatePath = `room_rocket_state/${roomId}`;
    const rocketGlobalQueuePath = "system_state/room_rocket_global_queue";
    const opPath = `gift_operations/${key}`;
    const lockPath = "system_config/emergency_lock";

    const [
      roomSnap,
      senderSnap,
      receiverSnap,
      senderBlock,
      receiverBlock,
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
      db.get(receiverPath, transaction),
      db.get(senderBlockPath, transaction),
      db.get(receiverBlockPath, transaction),
      db.get(catalogPath, transaction),
      db.get(economyPath, transaction),
      db.get(rocketConfigPath, transaction),
      db.get(rocketStatePath, transaction),
      db.get(rocketGlobalQueuePath, transaction),
      db.get(opPath, transaction),
      db.get(lockPath, transaction),
    ]);

    if (opSnap.exists) {
      if (roomGiftOperationConflicts(opSnap.data, {
        senderId: senderUid,
        receiverId,
        roomId,
        giftId,
        quantity,
      })) {
        throw new ApiError("idempotency_conflict", 409);
      }
      await db.rollback(transaction);
      return { ok: true, code: "duplicate", ...(opSnap.data?.result || {}) };
    }

    if (!roomSnap.exists || roomSnap.data?.isActive === false) {
      throw new ApiError("room_unavailable", 409);
    }
    if (!senderSnap.exists || !receiverSnap.exists) {
      throw new ApiError("user_not_found", 404);
    }
    if (senderBlock.exists || receiverBlock.exists) {
      throw new ApiError("blocked", 409);
    }

    const economyLock = lockSnap.data || {};
    if (
      economyLock.enabled === true ||
      economyLock.economyLocked === true ||
      economyLock.giftsLocked === true
    ) {
      throw new ApiError("emergency_locked", 409);
    }

    await Promise.all([
      assertRoomPresence(
        db,
        transaction,
        senderRealtimePresence,
        roomId,
        senderUid,
        "sender_not_in_room",
      ),
      assertRoomPresence(
        db,
        transaction,
        receiverRealtimePresence,
        roomId,
        receiverId,
        "receiver_not_in_room",
      ),
    ]);

    const rawCatalog =
      catalogSnap.exists && Array.isArray(catalogSnap.data?.gifts)
        ? catalogSnap.data.gifts
        : fallbackGifts;
    const gift = rawCatalog.find((item) => clean(item?.id) === giftId);
    if (!gift) throw new ApiError("gift_not_found", 404);
    if (gift.enabled === false) throw new ApiError("gift_inactive", 409);

    const unitCoins = Number(gift.priceCoins || 0);
    if (!Number.isSafeInteger(unitCoins) || unitCoins <= 0) {
      throw new ApiError("invalid_gift_price", 400);
    }
    const totalCost = unitCoins * quantity;
    if (!Number.isSafeInteger(totalCost) || totalCost <= 0) {
      throw new ApiError("invalid_gift_price", 400);
    }

    const sender = senderSnap.data || {};
    const receiver = receiverSnap.data || {};
    const room = roomSnap.data || {};
    const economy = economySnap.data || {};
    const agencyId = clean(receiver.agencyId || "");
    const revenueMonth = agencyId ? agencyPeriods.month : periods.month;

    const previousMonthCoins =
      clean(receiver.giftRevenueMonth) === revenueMonth
        ? Math.max(0, Number(receiver.giftRevenueMonthCoins || 0))
        : 0;
    const monthlyGrossCoins = previousMonthCoins + totalCost;
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
      previousAgencyPublicSupportCoins + totalCost;
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
    const policyEnabled = economy.policyMode === "tiered_host_agency"
      ? economy.enabled !== false
      : true;
    const earningsEnabled = policyEnabled && revenue.hostShareBps > 0;
    const recipientShareBps = earningsEnabled ? revenue.hostShareBps : 0;

    const before = Number(sender.coins ?? sender.balance ?? 0);
    if (!Number.isFinite(before) || before < 0) {
      throw new ApiError("invalid_wallet_state", 400);
    }
    if (before < totalCost) throw new ApiError("insufficient_balance", 409);
    const after = before - totalCost;

    const recipientShareCoins = earningsEnabled
      ? Math.floor((totalCost * recipientShareBps) / 10000)
      : 0;
    const agencyShareCoins = policyEnabled && agencyId
      ? Math.floor((totalCost * revenue.agencyShareBps) / 10000)
      : 0;
    const platformShareCoins = policyEnabled
      ? Math.max(0, totalCost - recipientShareCoins - agencyShareCoins)
      : totalCost;

    const previousPendingGiftCoins = Math.max(
      0,
      Number(receiver.pendingGiftEarningCoins || 0),
    );
    const accumulatedGiftCoins = previousPendingGiftCoins + recipientShareCoins;
    const agencyTarget = agencyId && earningsEnabled
      ? calculateAgencyTargetProgress({
          monthKey: agencyPeriods.month,
          storedMonth: receiver.agencyTargetMonth,
          storedProgressCoins: receiver.agencyTargetProgressCoins,
          addedHostShareCoins: recipientShareCoins,
          storedPaidDiamonds: receiver.agencySalaryPaidDiamonds,
          targets:
            agencyPolicySnapshot?.targets ||
            economy.agencyTargets,
        })
      : null;
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
    const openingDiamonds = Math.max(0, Number(receiver.diamonds || 0));
    const closingDiamonds = openingDiamonds + diamondsEarned;

    const senderName = clean(
      sender.displayName ||
      sender.username ||
      "مستخدم Shadow Live",
    );
    const receiverName = clean(
      receiver.displayName ||
      receiver.username ||
      "مستخدم Shadow Live",
    );
    const senderPhoto = clean(sender.profileImageUrl);
    const giftName = clean(gift.nameAr || "هدية");
    const assetKey = clean(gift.assetKey || "gifts.placeholder.default");
    const imageUrl = clean(gift.imageUrl);

    const rocketAdvance = advanceRoomRocket({
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
    });

    const messageId = randomDocId("msg");
    const messagePath = `${roomPath}/messages/${messageId}`;
    const transactionPath = `gift_transactions/${key}`;
    const ledgerPath = `financial_ledger/gift_${key}`;
    const earningsLedgerPath = `financial_ledger/gift_earnings_${key}`;
    const targetSalaryAuditPath = `admin_audit_logs/agency_target_salary_${key}`;
    const roomDailyPath = `${roomPath}/support_daily/${periods.day}`;
    const roomWeeklyPath = `${roomPath}/support_weekly/${periods.week}`;
    const roomMonthlyPath = `${roomPath}/support_monthly/${periods.month}`;
    const roomDailyUserPath = `${roomDailyPath}/users/${senderUid}`;
    const roomWeeklyUserPath = `${roomWeeklyPath}/users/${senderUid}`;
    const roomMonthlyUserPath = `${roomMonthlyPath}/users/${senderUid}`;
    const userDailyPath = `gift_user_stats/${receiverId}/daily/${periods.day}`;
    const userWeeklyPath = `gift_user_stats/${receiverId}/weekly/${periods.week}`;
    const userMonthlyPath = `gift_user_stats/${receiverId}/monthly/${periods.month}`;
    const showcasePath = `public_gift_showcases/${receiverId}/items/${giftId}`;

    const writes = [
      db.writeUpdate(
        senderPath,
        {
          coins: after,
          walletUpdatedAt: now,
        },
        ["coins", "walletUpdatedAt"],
        [db.increment("totalGiftsSent", quantity)],
      ),
    ];

    const receiverFields = {
      giftRevenueMonth: revenueMonth,
      giftRevenueMonthCoins: monthlyGrossCoins,
      currentGiftRevenueTier: revenue.tierId,
    };
    const receiverMask = [
      "giftRevenueMonth",
      "giftRevenueMonthCoins",
      "currentGiftRevenueTier",
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
      db.increment("totalValueReceived", totalCost),
      db.increment("giftSupportReceivedCoins", totalCost),
    ];
    if (earningsEnabled) {
      receiverTransforms.push(
        db.increment("giftEarningCoinsLifetime", recipientShareCoins),
      );
      receiverFields.diamonds = closingDiamonds;
      receiverFields.pendingGiftEarningCoins = pendingGiftEarningCoins;
      receiverMask.push("diamonds", "pendingGiftEarningCoins");
      receiverTransforms.push(
        db.increment("giftDiamondsLifetime", diamondsEarned),
      );
      if (agencyTarget) {
        receiverFields.agencyTargetMonth = agencyPeriods.month;
        receiverFields.agencyTargetProgressCoins = agencyTarget.progressCoins;
        receiverFields.agencySalaryPaidDiamonds = agencyTarget.paidDiamonds;
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
      }
    }
    writes.push(
      db.writeUpdate(
        receiverPath,
        receiverFields,
        receiverMask,
        receiverTransforms,
      ),
    );

    // High-frequency room support lives in the period support documents below.
    // Do not mutate rooms/{roomId} for every gift: room-root listeners fan this
    // write out to every connected participant. Room insights/bootstrap read
    // the exact period documents instead.

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

    for (const explosion of rocketAdvance.explosions) {
      writes.push(
        db.writeCreate(
          `room_rocket_explosions/${explosion.explosionId}`,
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
          ["queueAvailableAtMs", "lastRoomId", "lastExplosionId", "updatedAt"],
        ),
      );
    }

    const supportTransforms = [
      db.increment("supportCoins", totalCost),
      db.increment("giftCount", quantity),
    ];
    for (const path of [roomDailyPath, roomWeeklyPath, roomMonthlyPath]) {
      writes.push(
        db.writeUpdate(
          path,
          { updatedAt: now },
          ["updatedAt"],
          supportTransforms,
        ),
      );
    }
    for (const path of [
      roomDailyUserPath,
      roomWeeklyUserPath,
      roomMonthlyUserPath,
    ]) {
      writes.push(
        db.writeUpdate(
          path,
          {
            uid: senderUid,
            displayName: senderName,
            profileImageUrl: senderPhoto,
            updatedAt: now,
          },
          ["uid", "displayName", "profileImageUrl", "updatedAt"],
          supportTransforms,
        ),
      );
    }

    const receiverStatsTransforms = [
      db.increment("receivedCoins", totalCost),
      db.increment("giftCount", quantity),
      db.increment("diamondsEarned", diamondsEarned),
      db.increment("earningCoins", recipientShareCoins),
    ];
    for (const path of [userDailyPath, userWeeklyPath, userMonthlyPath]) {
      writes.push(
        db.writeUpdate(
          path,
          { updatedAt: now },
          ["updatedAt"],
          receiverStatsTransforms,
        ),
      );
    }

    if (agencyId) {
      const agencyStatsTransforms = [
        ...supportTransforms,
        db.increment("hostEarningCoins", recipientShareCoins),
        db.increment("agencyEarningCoins", agencyShareCoins),
        db.increment("platformShareCoins", platformShareCoins),
      ];
      for (const path of [
        `agency_support_stats/${agencyId}/daily/${agencyPeriods.day}`,
        `agency_support_stats/${agencyId}/weekly/${agencyPeriods.week}`,
        `agency_support_stats/${agencyId}/monthly/${agencyPeriods.month}`,
      ]) {
        writes.push(
          db.writeUpdate(
            path,
            {
              updatedAt: now,
            },
            ["updatedAt"],
            agencyStatsTransforms,
          ),
        );
      }

      const agencyShard = agencyAccrualShard(key);
      writes.push(
        db.writeUpdate(
          `agency_monthly_accrual_shards/${agencyId}__${agencyPeriods.month}__${String(agencyShard).padStart(2, "0")}`,
          {
            agencyId,
            month: agencyPeriods.month,
            shard: agencyShard,
            updatedAt: now,
          },
          ["agencyId", "month", "shard", "updatedAt"],
          [
            db.increment("supportCoins", totalCost),
            db.increment("hostShareCoins", recipientShareCoins),
            db.increment("agencyShareCoins", agencyShareCoins),
            db.increment("platformShareCoins", platformShareCoins),
            db.increment("giftCount", quantity),
          ],
        ),
      );
      writes.push(
        db.writeUpdate(
          `agency_host_monthly/${agencyId}__${agencyPeriods.month}__${receiverId}`,
          {
            agencyId,
            hostUid: receiverId,
            month: agencyPeriods.month,
            targetId: agencyTarget?.reachedTarget?.id || "",
            targetTierId: agencyTarget?.reachedTarget?.tierId || "",
            targetRank: agencyTarget?.reachedTarget?.rank || "",
            targetThresholdCoins:
              agencyTarget?.reachedTarget?.thresholdCoins || 0,
            surplusPageKey:
              `${agencyId}__${agencyPeriods.month}__${receiverId}`,
            publicRankingKey: agencyPublicRankingKey({
              agencyId,
              month: agencyPeriods.month,
              hostUid: receiverId,
              supportCoins: agencyPublicSupportCoins,
            }),
            publicSupportCoins: agencyPublicSupportCoins,
            nextTargetCoins: agencyTarget?.remainingToNextTargetCoins || 0,
            salaryPaidDiamonds: agencyTarget?.paidDiamonds || 0,
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
            "updatedAt",
          ],
          [
            db.increment("supportCoins", totalCost),
            db.increment("hostShareCoins", recipientShareCoins),
            db.increment("agencyShareCoins", agencyShareCoins),
            db.increment("giftCount", quantity),
          ],
        ),
      );
    }

    if (earningsEnabled && agencyTarget && diamondsEarned > 0) {
      writes.push(
        db.writeCreate(earningsLedgerPath, {
          userId: receiverId,
          agencyId,
          asset: "diamonds",
          delta: diamondsEarned,
          openingBalance: openingDiamonds,
          closingBalance: closingDiamonds,
          reason: "agency_target_salary",
          sourceType: "gift",
          sourceId: key,
          actorUid: senderUid,
          counterpartyUid: senderUid,
          roomId,
          month: agencyPeriods.month,
          targetId: agencyTarget.reachedTarget?.id || "",
          targetProgressCoins: agencyTarget.progressCoins,
          salaryPaidDiamonds: agencyTarget.paidDiamonds,
          idempotencyKey: key + "_agency_target_salary",
          createdAt: now,
        }),
        db.writeCreate(targetSalaryAuditPath, {
          actorUid: "system",
          action: "agencyTargetSalaryPaid",
          targetType: "user",
          targetId: receiverId,
          triggerUid: senderUid,
          agencyId,
          contextType: "room",
          roomId,
          sourceType: "gift",
          sourceId: key,
          month: agencyPeriods.month,
          targetIdReached: agencyTarget.reachedTarget?.id || "",
          targetProgressCoins: agencyTarget.progressCoins,
          salaryDeltaDiamonds: diamondsEarned,
          salaryPaidDiamonds: agencyTarget.paidDiamonds,
          openingBalance: openingDiamonds,
          closingBalance: closingDiamonds,
          createdAt: now,
        }),
        db.writeCreate(
          `notifications/agency_target_salary_${key}_${receiverId}`,
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
            targetId: agencyTarget.reachedTarget?.id || null,
            targetTierId: agencyTarget.reachedTarget?.tierId || null,
            targetRank: agencyTarget.reachedTarget?.rank || null,
            salaryDeltaDiamonds: diamondsEarned,
            salaryPaidDiamonds: agencyTarget.paidDiamonds,
            createdAt: now,
          },
        ),
      );
    } else if (earningsEnabled && !agencyTarget && diamondsEarned > 0) {
      writes.push(
        db.writeCreate(earningsLedgerPath, {
          userId: receiverId,
          asset: "diamonds",
          delta: diamondsEarned,
          openingBalance: openingDiamonds,
          closingBalance: closingDiamonds,
          reason: "gift_earnings",
          sourceType: "gift",
          sourceId: key,
          actorUid: senderUid,
          counterpartyUid: senderUid,
          roomId,
          idempotencyKey: key + "_earnings",
          createdAt: now,
        }),
      );
    }

    writes.push(
      db.writeCreate(messagePath, {
        type: "gift",
        senderUid,
        receiverUid: receiverId,
        displayName: senderName,
        profileImageUrl: senderPhoto,
        giftId,
        giftName,
        quantity,
        unitCoins,
        totalCost,
        assetKey,
        imageUrl,
        text:
          senderName +
          " أرسل " +
          giftName +
          " ×" +
          quantity +
          " إلى " +
          receiverName +
          " — " +
          totalCost +
          " كوينز",
        createdAt: now,
      }),
      db.writeCreate(transactionPath, {
        senderId: senderUid,
        receiverId,
        contextType: "room",
        roomId,
        giftId,
        giftName,
        quantity,
        unitCoins,
        totalCost,
        assetKey,
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
        agencyBonusDeferredToMonthEnd: revenue.agencyBonusDeferredToMonthEnd,
        agencyShareBps: revenue.agencyShareBps,
        agencyShareCoins,
        agencyActiveHostCount: revenue.activeHostCount,
        agencyRequiredActiveHosts: revenue.requiredActiveHosts,
        platformShareBps: revenue.platformShareBps,
        platformShareCoins,
        qualifiedDays: revenue.qualifiedDays,
        requiredQualifiedDays: revenue.requiredDays,
        diamondsEarned,
        pendingGiftEarningCoins,
        settlementMode: agencyTarget ? "target_immediate" : "immediate",
        settlementCycleKey: null,
        agencyTargetMonth: agencyTarget?.month || null,
        agencyTargetProgressCoins: agencyTarget?.progressCoins || 0,
        agencyTargetId: agencyTarget?.reachedTarget?.id || null,
        agencyNextTargetCoins: agencyTarget?.remainingToNextTargetCoins || 0,
        agencySalaryPaidDiamonds: agencyTarget?.paidDiamonds || 0,
        salaryDeltaDiamonds: agencyTarget?.salaryDeltaDiamonds || 0,
        earningsStatus: !earningsEnabled
          ? "disabled"
          : agencyTarget
            ? (agencyTarget.salaryDeltaDiamonds > 0 ? "target_paid" : "target_progress")
            : "applied",
        periods,
        agencyId: agencyId || null,
        createdAt: now,
      }),
      db.writeCreate(ledgerPath, {
        userId: senderUid,
        asset: "coins",
        delta: -totalCost,
        openingBalance: before,
        closingBalance: after,
        reason: "room_gift_send",
        sourceType: "gift",
        sourceId: key,
        actorUid: senderUid,
        counterpartyUid: receiverId,
        roomId,
        idempotencyKey: key,
        createdAt: now,
      }),
      db.writeUpdate(
        showcasePath,
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

    const resultData = {
      giftId,
      giftName,
      receiverId,
      receiverName,
      quantity,
      totalCost,
      balance: after,
      revenueTierId: revenue.tierId,
      recipientShareCoins,
      agencyShareCoins,
      platformShareCoins,
      diamondsEarned,
      earningsApplied: earningsEnabled,
      earningsStatus: !earningsEnabled
        ? "disabled"
        : agencyTarget
          ? (agencyTarget.salaryDeltaDiamonds > 0 ? "target_paid" : "target_progress")
          : "applied",
      settlementCycleKey: null,
      agencyTargetMonth: agencyTarget?.month || null,
      agencyTargetProgressCoins: agencyTarget?.progressCoins || 0,
      agencyTargetId: agencyTarget?.reachedTarget?.id || null,
      agencyNextTargetCoins: agencyTarget?.remainingToNextTargetCoins || 0,
      agencySalaryPaidDiamonds: agencyTarget?.paidDiamonds || 0,
      salaryDeltaDiamonds: agencyTarget?.salaryDeltaDiamonds || 0,
      messageId,
      rocketCurrentLevel: rocketAdvance.nextState.currentLevel,
      rocketProgressCoins: rocketAdvance.nextState.progressCoins,
      rocketThresholdCoins: rocketAdvance.nextState.levelThresholdCoins,
      rocketExplosionIds: rocketAdvance.explosions.map((item) => item.explosionId),
    };

    writes.push(
      db.writeCreate(opPath, {
        senderId: senderUid,
        receiverId,
        roomId,
        giftId,
        quantity,
        action: "sendRoomGift",
        status: "completed",
        result: resultData,
        createdAt: now,
      }),
    );

    await db.commit(transaction, writes);
    return {
      ok: true,
      code: "ok",
      ...resultData,
      _rocketFeedEvents: rocketAdvance.explosions,
      _transactionAttempts: transactionAttempts,
      _agencyStatsTouched: Boolean(agencyId),
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
