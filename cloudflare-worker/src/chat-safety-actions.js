import { json, readJson } from "./http.js";
import { verifyFirebaseIdToken } from "./firebase-auth.js";
import { firestoreClient } from "./firestore.js";
import { resolveRevenuePolicy } from "./economy-policy.js";
import {
  legacyPresenceFresh,
  realtimeUserPresentFromNamespace,
} from "./room-presence-authority.js";

const clean = (value) => String(value ?? "").trim();
const validKey = (value) => /^[A-Za-z0-9_-]{12,220}$/.test(clean(value));
const bounded = (value, fallback, min, max) => {
  const n = Number(value);
  return Number.isFinite(n) ? Math.max(min, Math.min(max, Math.floor(n))) : fallback;
};

class ApiError extends Error {
  constructor(code, status = 400) {
    super(code);
    this.code = code;
    this.status = status;
  }
}

function timestampMs(value) {
  const ms = Date.parse(String(value || ""));
  return Number.isFinite(ms) ? ms : 0;
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
  return {
    day,
    week: d.getUTCFullYear().toString() + "-W" + week.toString().padStart(2, "0"),
    month,
    cycle: month + "-" + (date.getUTCDate() <= 15 ? "C1" : "C2"),
  };
}

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

async function sendMessage(db, uid, body) {
  const receiverId = clean(body.receiverId);
  const conversationId = clean(body.conversationId);
  const message = clean(body.text);
  const key = clean(body.idempotencyKey);

  if (
    !receiverId ||
    receiverId === uid ||
    !conversationId ||
    conversationId.includes("/") ||
    !message ||
    message.length > 2000 ||
    !validKey(key)
  ) {
    throw new ApiError("invalid_request", 400);
  }

  const nowMs = Date.now();

  return runTransaction(db, async (transaction) => {
    const opPath = `message_operations/${key}`;
    const senderPath = `users/${uid}`;
    const receiverPath = `users/${receiverId}`;
    const conversationPath = `conversations/${conversationId}`;
    const outgoingFollowPath = `follows/${uid}__${receiverId}`;
    const incomingFollowPath = `follows/${receiverId}__${uid}`;
    const outgoingBlockPath = `user_blocks/${uid}/items/${receiverId}`;
    const incomingBlockPath = `user_blocks/${receiverId}/items/${uid}`;
    const senderLimitPath = `dm_limits/${conversationId}__${uid}`;
    const receiverLimitPath = `dm_limits/${conversationId}__${receiverId}`;
    const ratePath = `message_rate_limits/${uid}`;
    const configPath = "system_config/messaging";

    const [
      op,
      sender,
      receiver,
      conversation,
      outgoingFollow,
      incomingFollow,
      outgoingBlock,
      incomingBlock,
      senderLimit,
      rate,
      config,
    ] = await Promise.all([
      db.get(opPath, transaction),
      db.get(senderPath, transaction),
      db.get(receiverPath, transaction),
      db.get(conversationPath, transaction),
      db.get(outgoingFollowPath, transaction),
      db.get(incomingFollowPath, transaction),
      db.get(outgoingBlockPath, transaction),
      db.get(incomingBlockPath, transaction),
      db.get(senderLimitPath, transaction),
      db.get(ratePath, transaction),
      db.get(configPath, transaction),
    ]);

    if (op.exists) {
      await db.rollback(transaction);
      return { ok: true, code: "duplicate", ...(op.data?.result || {}) };
    }
    if (!sender.exists || !receiver.exists || !conversation.exists) {
      throw new ApiError("not_found", 404);
    }

    const conversationData = conversation.data || {};
    const participants = Array.isArray(conversationData.participants)
      ? conversationData.participants
      : [];
    if (
      participants.length !== 2 ||
      !participants.includes(uid) ||
      !participants.includes(receiverId)
    ) {
      throw new ApiError("invalid_conversation", 409);
    }
    if (outgoingBlock.exists || incomingBlock.exists) {
      throw new ApiError("blocked", 403);
    }

    const cfg = config.data || {};
    const windowSeconds = bounded(cfg.messageRateWindowSeconds, 10, 2, 60);
    const maxMessages = bounded(cfg.messageRateMax, 8, 1, 50);
    const startedMs = timestampMs(rate.data?.windowStartedAt);
    const sameWindow = startedMs > 0 && (nowMs - startedMs) < windowSeconds * 1000;
    const currentCount = sameWindow ? Math.max(0, Number(rate.data?.count || 0)) : 0;
    if (currentCount >= maxMessages) {
      throw new ApiError("rate_limited", 429);
    }

    const mutual = outgoingFollow.exists && incomingFollow.exists;
    const senderData = sender.data || {};
    const assignedModerator =
      clean(conversationData.customerServiceModeratorUid) === uid &&
      clean(senderData.role) === "moderator";

    if (!mutual && !assignedModerator && !outgoingFollow.exists) {
      throw new ApiError("follow_required", 403);
    }

    const unanswered = Math.max(0, Number(senderLimit.data?.unansweredCount || 0));
    if (!mutual && !assignedModerator && unanswered >= 3) {
      throw new ApiError("message_limit_reached", 429);
    }

    const now = new Date();
    const counts = { ...(conversationData.unreadCounts || {}) };
    counts[uid] = 0;
    counts[receiverId] = Number(counts[receiverId] || 0) + 1;
    const messageId = randomDocId("msg");
    const messagePath = `${conversationPath}/messages/${messageId}`;
    const writes = [
      db.writeUpdate(ratePath, {
        windowStartedAt: new Date(sameWindow ? startedMs : nowMs),
        count: currentCount + 1,
        updatedAt: now,
      }, ["windowStartedAt", "count", "updatedAt"]),
      db.writeUpdate(conversationPath, {
        lastMessage: message,
        lastSenderId: uid,
        updatedAt: now,
        unreadCounts: counts,
      }, ["lastMessage", "lastSenderId", "updatedAt", "unreadCounts"]),
      db.writeCreate(messagePath, {
        senderId: uid,
        receiverId,
        text: message,
        type: "text",
        createdAt: now,
      }),
    ];

    if (mutual) {
      writes.push(
        db.writeUpdate(senderLimitPath, {
          unansweredCount: 0,
          updatedAt: now,
        }, ["unansweredCount", "updatedAt"]),
        db.writeUpdate(receiverLimitPath, {
          unansweredCount: 0,
          updatedAt: now,
        }, ["unansweredCount", "updatedAt"]),
      );
    } else if (assignedModerator) {
      writes.push(
        db.writeUpdate(receiverLimitPath, {
          unansweredCount: 0,
          updatedAt: now,
        }, ["unansweredCount", "updatedAt"]),
      );
    } else {
      writes.push(
        db.writeUpdate(senderLimitPath, {
          unansweredCount: unanswered + 1,
          updatedAt: now,
        }, ["unansweredCount", "updatedAt"]),
        db.writeUpdate(receiverLimitPath, {
          unansweredCount: 0,
          updatedAt: now,
        }, ["unansweredCount", "updatedAt"]),
      );
    }

    const resultData = {
      messageId,
      mutual,
      assignedCustomerServiceModerator: assignedModerator,
      remaining: mutual || assignedModerator ? null : Math.max(0, 2 - unanswered),
    };
    writes.push(
      db.writeCreate(opPath, {
        senderId: uid,
        receiverId,
        conversationId,
        action: "sendMessage",
        status: "completed",
        result: resultData,
        createdAt: now,
      }),
    );

    await db.commit(transaction, writes);
    return { ok: true, code: "ok", ...resultData };
  });
}

export async function sendGift(db, uid, body) {
  const receiverId = clean(body.receiverId);
  const giftId = clean(body.giftId);
  const conversationId = clean(body.conversationId);
  const key = clean(body.idempotencyKey);
  const quantity = Number(body.quantity || 1);

  if (
    !receiverId ||
    receiverId === uid ||
    !giftId ||
    !conversationId ||
    conversationId.includes("/") ||
    ![1, 7, 77, 777].includes(quantity) ||
    !validKey(key)
  ) {
    throw new ApiError("invalid_request", 400);
  }

  const fallback = [
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

  return runTransaction(db, async (transaction) => {
    const opPath = `gift_operations/${key}`;
    const senderPath = `users/${uid}`;
    const receiverPath = `users/${receiverId}`;
    const catalogPath = "system_config/gift_catalog";
    const economyPath = "system_config/gift_economy";
    const lockPath = "system_config/emergency_lock";
    const conversationPath = `conversations/${conversationId}`;
    const outgoingBlockPath = `user_blocks/${uid}/items/${receiverId}`;
    const incomingBlockPath = `user_blocks/${receiverId}/items/${uid}`;
    const periods = utcPeriodKeys();

    const [
      op,
      sender,
      receiver,
      catalog,
      economy,
      lock,
      conversation,
      outgoingBlock,
      incomingBlock,
    ] = await Promise.all([
      db.get(opPath, transaction),
      db.get(senderPath, transaction),
      db.get(receiverPath, transaction),
      db.get(catalogPath, transaction),
      db.get(economyPath, transaction),
      db.get(lockPath, transaction),
      db.get(conversationPath, transaction),
      db.get(outgoingBlockPath, transaction),
      db.get(incomingBlockPath, transaction),
    ]);

    if (op.exists) {
      await db.rollback(transaction);
      return { ok: true, code: "duplicate", ...(op.data?.result || {}) };
    }
    if (!sender.exists || !receiver.exists || !conversation.exists) {
      throw new ApiError("not_found", 404);
    }

    const conversationData = conversation.data || {};
    const participants = Array.isArray(conversationData.participants)
      ? conversationData.participants
      : [];
    if (
      participants.length !== 2 ||
      !participants.includes(uid) ||
      !participants.includes(receiverId)
    ) {
      throw new ApiError("invalid_conversation", 409);
    }
    if (outgoingBlock.exists || incomingBlock.exists) {
      throw new ApiError("blocked", 403);
    }

    const economyLock = lock.data || {};
    if (
      economyLock.enabled === true ||
      economyLock.economyLocked === true ||
      economyLock.giftsLocked === true
    ) {
      throw new ApiError("emergency_locked", 409);
    }

    const rawCatalog =
      catalog.exists && Array.isArray(catalog.data?.gifts)
        ? catalog.data.gifts
        : fallback;
    const giftData = rawCatalog.find((item) => clean(item?.id) === giftId);
    if (!giftData) throw new ApiError("not_found", 404);
    if (giftData.enabled === false) throw new ApiError("gift_inactive", 409);

    const unitCoins = Number(giftData.priceCoins || 0);
    if (!Number.isSafeInteger(unitCoins) || unitCoins <= 0) {
      throw new ApiError("invalid_gift_price", 409);
    }
    const totalCost = unitCoins * quantity;
    if (!Number.isSafeInteger(totalCost) || totalCost <= 0) {
      throw new ApiError("invalid_gift_price", 409);
    }

    const senderData = sender.data || {};
    const receiverData = receiver.data || {};
    const before = Number(senderData.coins || 0);
    if (!Number.isSafeInteger(before) || before < totalCost) {
      throw new ApiError("insufficient_balance", 409);
    }

    const economyData = economy.data || {};
    const agencyId = clean(receiverData.agencyId);
    let activeHostCount = 0;
    if (agencyId) {
      const agencyMonth = await db.get(
        `agency_support_stats/${agencyId}/monthly/${periods.month}`,
        transaction,
      );
      const activeHostIds = Array.isArray(agencyMonth.data?.activeHostIds)
        ? agencyMonth.data.activeHostIds
        : [];
      activeHostCount = activeHostIds.length;
    }

    const previousMonthCoins =
      clean(receiverData.giftRevenueMonth) === periods.month
        ? Math.max(0, Number(receiverData.giftRevenueMonthCoins || 0))
        : 0;
    const monthlyGrossCoins = previousMonthCoins + totalCost;
    const revenue = resolveRevenuePolicy(
      economyData,
      receiverData,
      monthlyGrossCoins,
      agencyId,
      periods.month,
      activeHostCount,
    );

    const policyEnabled = economyData.enabled !== false;
    const earningsEnabled = policyEnabled && revenue.hostShareBps > 0;
    const recipientShareBps = earningsEnabled ? revenue.hostShareBps : 0;
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
    const previousPending = Math.max(
      0,
      Number(receiverData.pendingGiftEarningCoins || 0),
    );
    const accumulated = previousPending + recipientShareCoins;
    const diamondsEarned = earningsEnabled && !agencySettlementPending
      ? Math.floor(accumulated / 10000)
      : 0;
    const pendingGiftEarningCoins = earningsEnabled && !agencySettlementPending
      ? accumulated % 10000
      : previousPending;
    const pendingAgencyBefore = Math.max(
      0,
      Number(receiverData.pendingAgencyGiftEarningCoins || 0),
    );
    const pendingAgencyAfter = agencySettlementPending && earningsEnabled
      ? pendingAgencyBefore + recipientShareCoins
      : pendingAgencyBefore;
    const openingDiamonds = Math.max(0, Number(receiverData.diamonds || 0));
    const closingDiamonds = openingDiamonds + diamondsEarned;
    const after = before - totalCost;

    const now = new Date();
    const giftName = clean(giftData.nameAr || "هدية");
    const imageUrl = clean(giftData.imageUrl);
    const assetKey = clean(giftData.assetKey || "gifts.placeholder.default");
    const messageId = randomDocId("msg");
    const messagePath = `${conversationPath}/messages/${messageId}`;
    const transactionPath = `gift_transactions/${key}`;
    const ledgerPath = `financial_ledger/gift_${key}`;
    const earningsLedgerPath = `financial_ledger/gift_earnings_${key}`;
    const userDailyPath = `gift_user_stats/${receiverId}/daily/${periods.day}`;
    const userWeeklyPath = `gift_user_stats/${receiverId}/weekly/${periods.week}`;
    const userMonthlyPath = `gift_user_stats/${receiverId}/monthly/${periods.month}`;
    const showcasePath = `public_gift_showcases/${receiverId}/items/${giftId}`;
    const counts = { ...(conversationData.unreadCounts || {}) };
    counts[uid] = 0;
    counts[receiverId] = Number(counts[receiverId] || 0) + 1;

    const writes = [
      db.writeUpdate(
        senderPath,
        { coins: after },
        ["coins"],
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

    const receiverStatsTransforms = [
      db.increment("receivedCoins", totalCost),
      db.increment("giftCount", quantity),
      db.increment("earningCoins", recipientShareCoins),
      db.increment("diamondsEarned", diamondsEarned),
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
        db.increment("supportCoins", totalCost),
        db.increment("giftCount", quantity),
        db.increment("hostEarningCoins", recipientShareCoins),
        db.increment("agencyEarningCoins", agencyShareCoins),
        db.increment("platformShareCoins", platformShareCoins),
      ];
      for (const periodPath of [
        `agency_support_stats/${agencyId}/daily/${periods.day}`,
        `agency_support_stats/${agencyId}/weekly/${periods.week}`,
        `agency_support_stats/${agencyId}/monthly/${periods.month}`,
      ]) {
        writes.push(
          db.writeUpdate(
            periodPath,
            { activeHostCount, updatedAt: now },
            ["activeHostCount", "updatedAt"],
            agencyStatsTransforms,
          ),
        );
      }

      const accrualPath =
        `agency_settlement_accruals/${agencyId}__${periods.cycle}__${receiverId}`;
      writes.push(
        db.writeUpdate(
          accrualPath,
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
          actorUid: uid,
          counterpartyUid: uid,
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
          actorUid: uid,
          counterpartyUid: uid,
          idempotencyKey: key + "_earnings",
          createdAt: now,
        }),
      );
    }

    writes.push(
      db.writeUpdate(
        conversationPath,
        {
          lastMessage: `🎁 ${giftName} ×${quantity}`,
          lastSenderId: uid,
          updatedAt: now,
          unreadCounts: counts,
        },
        ["lastMessage", "lastSenderId", "updatedAt", "unreadCounts"],
      ),
      db.writeCreate(messagePath, {
        senderId: uid,
        receiverId,
        type: "gift",
        giftId,
        giftName,
        quantity,
        unitCoins,
        totalCost,
        imageUrl,
        assetKey,
        createdAt: now,
      }),
      db.writeCreate(transactionPath, {
        senderId: uid,
        receiverId,
        contextType: "chat",
        conversationId,
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
        userId: uid,
        asset: "coins",
        delta: -totalCost,
        openingBalance: before,
        closingBalance: after,
        reason: "gift_send",
        sourceType: "gift",
        sourceId: key,
        actorUid: uid,
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
      quantity,
      totalCost,
      messageId,
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
    };

    writes.push(
      db.writeCreate(opPath, {
        senderId: uid,
        receiverId,
        action: "sendGift",
        status: "completed",
        result: resultData,
        createdAt: now,
      }),
    );

    await db.commit(transaction, writes);
    return { ok: true, code: "ok", ...resultData };
  });
}

async function sendRoomInvite(db, uid, body, options = {}) {
  const receiverId = clean(body.receiverId);
  const conversationId = clean(body.conversationId);
  const roomId = clean(body.roomId);
  const key = clean(body.idempotencyKey);

  if (
    !receiverId ||
    receiverId === uid ||
    !conversationId ||
    conversationId.includes("/") ||
    !roomId ||
    roomId.includes("/") ||
    !validKey(key)
  ) {
    throw new ApiError("invalid_request", 400);
  }

  const realtimePresence = await realtimeUserPresentFromNamespace(
    options?.realtimeNamespace || null,
    roomId,
    uid,
  );

  return runTransaction(db, async (transaction) => {
    const opPath = `message_operations/${key}`;
    const receiverPath = `users/${receiverId}`;
    const conversationPath = `conversations/${conversationId}`;
    const roomPath = `rooms/${roomId}`;
    const senderPresencePath = `room_presence/${roomId}/users/${uid}`;
    const inviteRatePath = `room_invite_rate_limits/${roomId}__${uid}__${receiverId}`;
    const outgoingFollowPath = `follows/${uid}__${receiverId}`;
    const incomingFollowPath = `follows/${receiverId}__${uid}`;
    const outgoingBlockPath = `user_blocks/${uid}/items/${receiverId}`;
    const incomingBlockPath = `user_blocks/${receiverId}/items/${uid}`;

    const [
      op,
      receiver,
      conversation,
      room,
      inviteRate,
      outgoingFollow,
      incomingFollow,
      outgoingBlock,
      incomingBlock,
    ] = await Promise.all([
      db.get(opPath, transaction),
      db.get(receiverPath, transaction),
      db.get(conversationPath, transaction),
      db.get(roomPath, transaction),
      db.get(inviteRatePath, transaction),
      db.get(outgoingFollowPath, transaction),
      db.get(incomingFollowPath, transaction),
      db.get(outgoingBlockPath, transaction),
      db.get(incomingBlockPath, transaction),
    ]);

    if (op.exists) {
      await db.rollback(transaction);
      return { ok: true, code: "duplicate", ...(op.data?.result || {}) };
    }
    if (!receiver.exists || !room.exists) throw new ApiError("not_found", 404);
    if (outgoingBlock.exists || incomingBlock.exists) throw new ApiError("blocked", 403);
    if (!outgoingFollow.exists || !incomingFollow.exists) {
      throw new ApiError("mutual_follow_required", 403);
    }

    const conversationData = conversation.data || {};
    if (conversation.exists) {
      const participants = Array.isArray(conversationData.participants)
        ? conversationData.participants
        : [];
      if (
        participants.length !== 2 ||
        !participants.includes(uid) ||
        !participants.includes(receiverId)
      ) {
        throw new ApiError("invalid_conversation", 409);
      }
    }

    const roomData = room.data || {};
    if (roomData.isActive === false) throw new ApiError("room_unavailable", 409);

    const roomOwnerUid = clean(
      roomData.ownerUid || roomData.ownerId || roomData.hostId || "",
    );
    if (roomOwnerUid !== uid) {
      if (realtimePresence === false) {
        throw new ApiError("not_in_room", 403);
      }
      if (realtimePresence === null) {
        const senderPresence = await db.get(senderPresencePath, transaction);
        if (!legacyPresenceFresh(senderPresence)) {
          throw new ApiError("not_in_room", 403);
        }
      }
    }

    const nowMs = Date.now();
    const lastInviteMs = timestampMs(inviteRate.data?.lastSentAt);
    if (lastInviteMs > 0 && nowMs - lastInviteMs < 30000) {
      throw new ApiError("rate_limited", 429);
    }

    const roomName = clean(roomData.name || roomData.title || "غرفة صوتية");
    const roomPublicId = clean(roomData.publicId);
    const now = new Date();
    const counts = { ...(conversationData.unreadCounts || {}) };
    counts[uid] = 0;
    counts[receiverId] = Number(counts[receiverId] || 0) + 1;
    const messageId = randomDocId("msg");
    const messagePath = `${conversationPath}/messages/${messageId}`;
    const roomInviteAccessPath = `room_invites/${roomId}/users/${receiverId}`;

    const writes = [];
    if (conversation.exists) {
      writes.push(
        db.writeUpdate(conversationPath, {
          lastMessage: `🔊 دعوة إلى ${roomName}`,
          lastSenderId: uid,
          updatedAt: now,
          unreadCounts: counts,
        }, ["lastMessage", "lastSenderId", "updatedAt", "unreadCounts"]),
      );
    } else {
      writes.push(
        db.writeCreate(conversationPath, {
          participants: [uid, receiverId].sort(),
          createdAt: now,
          updatedAt: now,
          lastMessage: `🔊 دعوة إلى ${roomName}`,
          lastSenderId: uid,
          unreadCounts: counts,
        }),
      );
    }

    writes.push(
      db.writeCreate(messagePath, {
        senderId: uid,
        receiverId,
        type: "room_invite",
        roomId,
        roomName,
        roomPublicId,
        roomOwnerUid,
        createdAt: now,
      }),
      db.writeUpdate(roomInviteAccessPath, {
        roomId,
        userId: receiverId,
        invitedBy: uid,
        createdAt: now,
        expiresAt: new Date(nowMs + 12 * 60 * 60 * 1000),
      }, ["roomId", "userId", "invitedBy", "createdAt", "expiresAt"]),
      db.writeUpdate(inviteRatePath, {
        roomId,
        senderUid: uid,
        receiverUid: receiverId,
        lastSentAt: new Date(nowMs),
        updatedAt: now,
      }, ["roomId", "senderUid", "receiverUid", "lastSentAt", "updatedAt"]),
    );

    const resultData = { messageId, roomId, roomName };
    writes.push(
      db.writeCreate(opPath, {
        senderId: uid,
        receiverId,
        conversationId,
        action: "sendRoomInvite",
        status: "completed",
        result: resultData,
        createdAt: now,
      }),
    );

    await db.commit(transaction, writes);
    return { ok: true, code: "ok", ...resultData };
  });
}

async function setFollow(db, uid, body) {
  const targetUserId = clean(body.targetUserId);
  const following = body.following === true;
  if (!targetUserId || targetUserId === uid) {
    throw new ApiError("invalid_request", 400);
  }

  return runTransaction(db, async (transaction) => {
    const targetPath = `users/${targetUserId}`;
    const relationPath = `follows/${uid}__${targetUserId}`;
    const outgoingBlockPath = `user_blocks/${uid}/items/${targetUserId}`;
    const incomingBlockPath = `user_blocks/${targetUserId}/items/${uid}`;

    const [target, relation, outgoingBlock, incomingBlock] = await Promise.all([
      db.get(targetPath, transaction),
      db.get(relationPath, transaction),
      db.get(outgoingBlockPath, transaction),
      db.get(incomingBlockPath, transaction),
    ]);

    if (!target.exists) throw new ApiError("not_found", 404);
    if (following && (outgoingBlock.exists || incomingBlock.exists)) {
      throw new ApiError("blocked", 403);
    }

    if (following && !relation.exists) {
      await db.commit(transaction, [
        db.writeCreate(relationPath, {
          followerUid: uid,
          followingUid: targetUserId,
          createdAt: new Date(),
        }),
      ]);
    } else if (!following && relation.exists) {
      await db.commit(transaction, [db.writeDelete(relationPath)]);
    } else {
      await db.rollback(transaction);
    }

    return { ok: true, following };
  });
}

async function safetyStatus(db, uid, body) {
  const targetUserId = clean(body.targetUserId);
  if (!targetUserId || targetUserId === uid) {
    throw new ApiError("invalid_request", 400);
  }

  const [target, outgoingBlock, incomingBlock] = await Promise.all([
    db.get(`users/${targetUserId}`),
    db.get(`user_blocks/${uid}/items/${targetUserId}`),
    db.get(`user_blocks/${targetUserId}/items/${uid}`),
  ]);

  if (!target.exists) throw new ApiError("not_found", 404);
  return {
    ok: true,
    blockedByMe: outgoingBlock.exists,
    blockedByOther: incomingBlock.exists,
    blocked: outgoingBlock.exists || incomingBlock.exists,
  };
}

async function setBlock(db, uid, body) {
  const targetUserId = clean(body.targetUserId);
  const blocked = body.blocked === true;
  if (!targetUserId || targetUserId === uid) {
    throw new ApiError("invalid_request", 400);
  }

  return runTransaction(db, async (transaction) => {
    const targetPath = `users/${targetUserId}`;
    const blockPath = `user_blocks/${uid}/items/${targetUserId}`;
    const outgoingFollowPath = `follows/${uid}__${targetUserId}`;
    const incomingFollowPath = `follows/${targetUserId}__${uid}`;

    const [target, currentBlock, outgoingFollow, incomingFollow] = await Promise.all([
      db.get(targetPath, transaction),
      db.get(blockPath, transaction),
      db.get(outgoingFollowPath, transaction),
      db.get(incomingFollowPath, transaction),
    ]);

    if (!target.exists) throw new ApiError("not_found", 404);

    const writes = [];
    if (blocked) {
      const now = new Date();
      const oldCreatedMs = timestampMs(currentBlock.data?.createdAt);
      writes.push(db.writeUpdate(blockPath, {
        blockerUid: uid,
        blockedUid: targetUserId,
        createdAt: oldCreatedMs > 0 ? new Date(oldCreatedMs) : now,
        updatedAt: now,
      }, ["blockerUid", "blockedUid", "createdAt", "updatedAt"]));

      if (outgoingFollow.exists) writes.push(db.writeDelete(outgoingFollowPath));
      if (incomingFollow.exists) writes.push(db.writeDelete(incomingFollowPath));
    } else if (currentBlock.exists) {
      writes.push(db.writeDelete(blockPath));
    }

    if (writes.length) await db.commit(transaction, writes);
    else await db.rollback(transaction);

    return { ok: true, blocked };
  });
}

async function reportUser(db, uid, body) {
  const targetUserId = clean(body.targetUserId);
  const conversationId = clean(body.conversationId);
  const reason = clean(body.reason);
  const details = clean(body.details);
  const key = clean(body.idempotencyKey);
  const allowedReasons = new Set([
    "spam",
    "harassment",
    "inappropriate_content",
    "scam",
    "other",
  ]);

  if (
    !targetUserId ||
    targetUserId === uid ||
    !conversationId ||
    conversationId.includes("/") ||
    !allowedReasons.has(reason) ||
    details.length > 500 ||
    !validKey(key)
  ) {
    throw new ApiError("invalid_request", 400);
  }

  const nowMs = Date.now();

  return runTransaction(db, async (transaction) => {
    const opPath = `report_operations/${key}`;
    const targetPath = `users/${targetUserId}`;
    const conversationPath = `conversations/${conversationId}`;
    const ratePath = `report_rate_limits/${uid}`;
    const configPath = "system_config/messaging";
    const reportPath = `reports/report_${key}`;

    const [op, target, conversation, rate, config] = await Promise.all([
      db.get(opPath, transaction),
      db.get(targetPath, transaction),
      db.get(conversationPath, transaction),
      db.get(ratePath, transaction),
      db.get(configPath, transaction),
    ]);

    if (op.exists) {
      await db.rollback(transaction);
      return { ok: true, code: "duplicate", ...(op.data?.result || {}) };
    }
    if (!target.exists || !conversation.exists) {
      throw new ApiError("not_found", 404);
    }

    const participants = Array.isArray(conversation.data?.participants)
      ? conversation.data.participants
      : [];
    if (
      participants.length !== 2 ||
      !participants.includes(uid) ||
      !participants.includes(targetUserId)
    ) {
      throw new ApiError("invalid_conversation", 409);
    }

    const cfg = config.data || {};
    const windowMinutes = bounded(cfg.reportRateWindowMinutes, 60, 5, 1440);
    const maxReports = bounded(cfg.reportRateMax, 5, 1, 20);
    const startedMs = timestampMs(rate.data?.windowStartedAt);
    const sameWindow = startedMs > 0 && (nowMs - startedMs) < windowMinutes * 60 * 1000;
    const currentCount = sameWindow ? Math.max(0, Number(rate.data?.count || 0)) : 0;
    if (currentCount >= maxReports) throw new ApiError("rate_limited", 429);

    const windowStartedAt = new Date(sameWindow ? startedMs : nowMs);
    const now = new Date();
    const resultData = { reportId: `report_${key}` };

    await db.commit(transaction, [
      db.writeUpdate(ratePath, {
        windowStartedAt,
        count: currentCount + 1,
        updatedAt: now,
      }, ["windowStartedAt", "count", "updatedAt"]),
      db.writeCreate(reportPath, {
        type: "user",
        reporterId: uid,
        targetUserId,
        conversationId,
        reason,
        details,
        source: "private_chat",
        status: "open",
        createdAt: now,
        updatedAt: now,
      }),
      db.writeCreate(opPath, {
        reporterId: uid,
        targetUserId,
        action: "reportUser",
        status: "completed",
        result: resultData,
        createdAt: now,
      }),
    ]);

    return { ok: true, code: "ok", ...resultData };
  });
}

export async function chatSafetyActions(request, env) {
  if (request.method !== "POST") {
    return json(request, env, { ok: false, code: "method_not_allowed" }, 405);
  }

  try {
    const decoded = await verifyFirebaseIdToken(request, env);
    const body = await readJson(request);
    const action = clean(body.action);
    const db = firestoreClient(env);

    let result;
    switch (action) {
      case "sendMessage":
        result = await sendMessage(db, decoded.sub, body);
        break;
      case "sendRoomInvite":
        result = await sendRoomInvite(
          db,
          decoded.sub,
          body,
          { realtimeNamespace: env.ROOM_REALTIME },
        );
        break;
      case "setFollow":
        result = await setFollow(db, decoded.sub, body);
        break;
      case "safetyStatus":
        result = await safetyStatus(db, decoded.sub, body);
        break;
      case "setBlock":
        result = await setBlock(db, decoded.sub, body);
        break;
      case "reportUser":
        result = await reportUser(db, decoded.sub, body);
        break;
      case "sendGift":
        result = await sendGift(db, decoded.sub, body);
        break;
      default:
        throw new ApiError("invalid_action", 400);
    }
    return json(request, env, result, 200);
  } catch (error) {
    if (error instanceof ApiError) {
      return json(request, env, { ok: false, code: error.code }, error.status);
    }
    const code = clean(error?.message);
    if (code === "unauthorized") {
      return json(request, env, { ok: false, code: "unauthorized" }, 401);
    }
    if (code === "server_not_configured" || code === "invalid_service_account_json") {
      return json(request, env, { ok: false, code }, 503);
    }
    return json(request, env, { ok: false, code: "server_failed" }, 500);
  }
}
