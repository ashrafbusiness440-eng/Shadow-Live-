import { json, readJson } from "./http.js";
import { verifyFirebaseIdToken } from "./firebase-auth.js";
import { firestoreClient } from "./firestore.js";
import { resolveRevenuePolicy } from "./economy-policy.js";
import { advanceRoomRocket } from "./room-rocket.js";
import {
  legacyPresenceFresh,
  realtimeUserPresentFromNamespace,
} from "./room-presence-authority.js";

const clean = (value) => String(value ?? "").trim();
const validKey = (value) => /^[A-Za-z0-9_-]{12,220}$/.test(clean(value));

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
  const cycle = month + "-" + (date.getUTCDate() <= 15 ? "C1" : "C2");
  return { day, week: weekKey, month, cycle };
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

  const periods = utcPeriodKeys();
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

  return runTransaction(db, async (transaction) => {
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

    let activeHostCount = 0;
    if (agencyId) {
      const agencyMonthSnap = await db.get(
        `agency_support_stats/${agencyId}/monthly/${periods.month}`,
        transaction,
      );
      const activeHostIds = Array.isArray(agencyMonthSnap.data?.activeHostIds)
        ? agencyMonthSnap.data.activeHostIds
        : [];
      activeHostCount = activeHostIds.length;
    }

    const previousMonthCoins =
      clean(receiver.giftRevenueMonth) === periods.month
        ? Math.max(0, Number(receiver.giftRevenueMonthCoins || 0))
        : 0;
    const monthlyGrossCoins = previousMonthCoins + totalCost;
    const revenue = resolveRevenuePolicy(
      economy,
      receiver,
      monthlyGrossCoins,
      agencyId,
      periods.month,
      activeHostCount,
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
    const agencySettlementPending = Boolean(agencyId);

    const previousPendingGiftCoins = Math.max(
      0,
      Number(receiver.pendingGiftEarningCoins || 0),
    );
    const accumulatedGiftCoins = previousPendingGiftCoins + recipientShareCoins;
    const diamondsEarned = earningsEnabled && !agencySettlementPending
      ? Math.floor(accumulatedGiftCoins / 10000)
      : 0;
    const pendingGiftEarningCoins = earningsEnabled && !agencySettlementPending
      ? accumulatedGiftCoins % 10000
      : previousPendingGiftCoins;
    const pendingAgencyBefore = Math.max(
      0,
      Number(receiver.pendingAgencyGiftEarningCoins || 0),
    );
    const pendingAgencyAfter = agencySettlementPending && earningsEnabled
      ? pendingAgencyBefore + recipientShareCoins
      : pendingAgencyBefore;
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

    const nowMs = Date.now();

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

    const now = new Date();
    const messageId = randomDocId("msg");
    const messagePath = `${roomPath}/messages/${messageId}`;
    const transactionPath = `gift_transactions/${key}`;
    const ledgerPath = `financial_ledger/gift_${key}`;
    const earningsLedgerPath = `financial_ledger/gift_earnings_${key}`;
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
      giftRevenueMonth: periods.month,
      giftRevenueMonthCoins: monthlyGrossCoins,
      currentGiftRevenueTier: revenue.tierId,
    };
    const receiverMask = [
      "giftRevenueMonth",
      "giftRevenueMonthCoins",
      "currentGiftRevenueTier",
    ];
    const receiverTransforms = [
      db.increment("totalGiftsReceived", quantity),
      db.increment("totalValueReceived", totalCost),
      db.increment("giftSupportReceivedCoins", totalCost),
    ];
    if (earningsEnabled) {
      receiverTransforms.push(
        db.increment("giftEarningCoinsLifetime", recipientShareCoins),
      );
      if (agencySettlementPending) {
        receiverFields.pendingAgencyGiftEarningCoins = pendingAgencyAfter;
        receiverMask.push("pendingAgencyGiftEarningCoins");
      } else {
        receiverFields.diamonds = closingDiamonds;
        receiverFields.pendingGiftEarningCoins = pendingGiftEarningCoins;
        receiverMask.push("diamonds", "pendingGiftEarningCoins");
        receiverTransforms.push(
          db.increment("giftDiamondsLifetime", diamondsEarned),
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

    const roomDailySupport =
      room.dailySupportDate === periods.day
        ? Math.max(0, Number(room.dailySupport || 0)) + totalCost
        : totalCost;
    const roomWeeklySupport =
      room.weeklySupportKey === periods.week
        ? Math.max(0, Number(room.weeklySupport || 0)) + totalCost
        : totalCost;
    const roomMonthlySupport =
      room.monthlySupportKey === periods.month
        ? Math.max(0, Number(room.monthlySupport || 0)) + totalCost
        : totalCost;
    writes.push(
      db.writeUpdate(
        roomPath,
        {
          dailySupport: roomDailySupport,
          dailySupportDate: periods.day,
          weeklySupport: roomWeeklySupport,
          weeklySupportKey: periods.week,
          monthlySupport: roomMonthlySupport,
          monthlySupportKey: periods.month,
        },
        [
          "dailySupport",
          "dailySupportDate",
          "weeklySupport",
          "weeklySupportKey",
          "monthlySupport",
          "monthlySupportKey",
        ],
        [db.increment("totalSupport", totalCost)],
      ),
    );

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
        `agency_support_stats/${agencyId}/daily/${periods.day}`,
        `agency_support_stats/${agencyId}/weekly/${periods.week}`,
        `agency_support_stats/${agencyId}/monthly/${periods.month}`,
      ]) {
        writes.push(
          db.writeUpdate(
            path,
            {
              activeHostCount,
              updatedAt: now,
            },
            ["activeHostCount", "updatedAt"],
            agencyStatsTransforms,
          ),
        );
      }

      writes.push(
        db.writeUpdate(
          `agency_settlement_accruals/${agencyId}__${periods.cycle}__${receiverId}`,
          {
            agencyId,
            hostUid: receiverId,
            cycleKey: periods.cycle,
            month: periods.month,
            status: "open",
            updatedAt: now,
          },
          ["agencyId", "hostUid", "cycleKey", "month", "status", "updatedAt"],
          [
            db.increment("supportCoins", totalCost),
            db.increment("hostGrossEarningCoins", recipientShareCoins),
            db.increment("agencyGrossEarningCoins", agencyShareCoins),
            db.increment("platformShareCoins", platformShareCoins),
            db.increment("giftCount", quantity),
          ],
        ),
      );
    }

    if (earningsEnabled && agencySettlementPending && recipientShareCoins > 0) {
      writes.push(
        db.writeCreate(earningsLedgerPath, {
          userId: receiverId,
          asset: "pendingAgencyGiftEarningCoins",
          delta: recipientShareCoins,
          openingBalance: pendingAgencyBefore,
          closingBalance: pendingAgencyAfter,
          reason: "agency_gift_earning_accrual",
          sourceType: "gift",
          sourceId: key,
          actorUid: senderUid,
          counterpartyUid: senderUid,
          roomId,
          settlementCycleKey: periods.cycle,
          idempotencyKey: key + "_earnings",
          createdAt: now,
        }),
      );
    } else if (earningsEnabled && diamondsEarned > 0) {
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
        pendingAgencyGiftEarningCoins: pendingAgencyAfter,
        settlementMode: agencySettlementPending ? "agency_cycle" : "immediate",
        settlementCycleKey: agencySettlementPending ? periods.cycle : null,
        earningsStatus: !earningsEnabled
          ? "disabled"
          : agencySettlementPending
            ? "accrued_for_cycle"
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
        : agencySettlementPending
          ? "accrued_for_cycle"
          : "applied",
      settlementCycleKey: agencySettlementPending ? periods.cycle : null,
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
        action: "sendRoomGift",
        status: "completed",
        result: resultData,
        createdAt: now,
      }),
    );

    await db.commit(transaction, writes);
    return { ok: true, code: "ok", ...resultData };
  });
}

export async function roomGift(request, env) {
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
    return json(request, env, { ok: false, code: "room_gift_failed" }, 500);
  }
}
