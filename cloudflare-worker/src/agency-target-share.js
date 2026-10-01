import {
  agencyTargetShareDelta,
  convertAgencyCoinsWithCarryover,
} from "./agency-policy.js";
import { revenueTiers } from "./economy-policy.js";

const clean = (value) => String(value ?? "").trim();

function financialInteger(value, code) {
  const parsed = Number(value ?? 0);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new Error(code);
  }
  return parsed;
}

export async function prepareAgencyTargetSharePayout(
  db,
  transaction,
  {
    agencyId,
    hostUid,
    hostUser = {},
    agencyTarget = null,
    effectiveEconomy = {},
    month,
  } = {},
) {
  const normalizedAgencyId = clean(agencyId);
  const normalizedHostUid = clean(hostUid);
  const normalizedMonth = clean(month);
  const target = agencyTarget?.reachedTarget || null;
  if (!normalizedAgencyId || !normalizedHostUid || !target || !normalizedMonth) {
    return null;
  }

  const sameMonth = clean(hostUser.agencySharePayoutMonth) === normalizedMonth;
  const previousPaidCoins = sameMonth
    ? financialInteger(
        hostUser.agencySharePaidCoinsMonth || 0,
        "invalid_agency_share_previous_paid",
      )
    : 0;
  const share = agencyTargetShareDelta({
    target,
    tiers: revenueTiers(effectiveEconomy),
    previousPaidCoins,
  });
  if (share.deltaCoins <= 0) return null;

  const coinsPerDiamond = financialInteger(
    effectiveEconomy.coinsPerDiamond ?? 10000,
    "invalid_agency_share_coins_per_diamond",
  );
  if (coinsPerDiamond <= 0) {
    throw new Error("invalid_agency_share_coins_per_diamond");
  }

  const agencyPath = `agencies/${normalizedAgencyId}`;
  const financialStatePath =
    `agency_financial_state/${normalizedAgencyId}`;
  const legacyWalletPath = `agency_wallets/${normalizedAgencyId}`;
  const [agencySnap, financialStateSnap, legacyWalletSnap] = await Promise.all([
    db.get(agencyPath, transaction),
    db.get(financialStatePath, transaction),
    db.get(legacyWalletPath, transaction),
  ]);
  if (!agencySnap.exists) throw new Error("agency_not_found");
  const agency = agencySnap.data || {};
  const ownerUid = clean(agency.ownerUid);
  if (!ownerUid) throw new Error("agency_owner_missing");

  const ownerSnap = ownerUid === normalizedHostUid
    ? { exists: true, data: hostUser }
    : await db.get(`users/${ownerUid}`, transaction);
  if (!ownerSnap.exists) throw new Error("agency_owner_missing");
  const owner = ownerSnap.data || {};
  if (clean(owner.accountStatus || "active") !== "active") {
    throw new Error("agency_owner_unavailable");
  }

  const state = financialStateSnap.exists ? financialStateSnap.data || {} : {};
  const legacy = legacyWalletSnap.exists ? legacyWalletSnap.data || {} : {};
  const legacyAlreadyMigrated =
    state.legacyWalletMigrated === true ||
    legacy.migratedToUnifiedWallet === true;
  const legacyDiamonds = legacyAlreadyMigrated
    ? 0
    : financialInteger(legacy.diamonds || 0, "invalid_legacy_agency_diamonds");
  const legacyRemainderCoins = legacyAlreadyMigrated
    ? 0
    : financialInteger(
        legacy.remainderCoins || 0,
        "invalid_legacy_agency_remainder",
      );
  const stateCarryoverCoins = financialInteger(
    state.carryoverCoins || 0,
    "invalid_agency_carryover",
  );
  const openingCarryoverCoins =
    stateCarryoverCoins + legacyRemainderCoins;
  if (!Number.isSafeInteger(openingCarryoverCoins)) {
    throw new Error("invalid_agency_carryover");
  }

  const conversion = convertAgencyCoinsWithCarryover({
    carryoverCoins: openingCarryoverCoins,
    payableCoins: share.deltaCoins,
    coinsPerDiamond,
  });
  const priorLifetimeDiamonds = financialInteger(
    state.lifetimeAgencyDiamonds ??
      legacy.lifetimeDiamonds ??
      legacy.diamonds ??
      0,
    "invalid_agency_lifetime_diamonds",
  );

  return {
    agencyId: normalizedAgencyId,
    hostUid: normalizedHostUid,
    ownerUid,
    ownerIsHost: ownerUid === normalizedHostUid,
    month: normalizedMonth,
    targetId: share.targetId,
    tierId: share.tierId,
    targetThresholdCoins: share.targetThresholdCoins,
    hostShareBps: share.hostShareBps,
    agencyShareBps: share.agencyShareBps,
    previousPaidCoins: share.previousPaidCoins,
    entitlementCoins: share.entitlementCoins,
    deltaCoins: share.deltaCoins,
    paidCoins: share.paidCoins,
    coinsPerDiamond,
    openingCarryoverCoins: conversion.openingCarryoverCoins,
    shareDiamondsEarned: conversion.diamondsEarned,
    remainderCoins: conversion.remainderCoins,
    legacyDiamonds,
    legacyRemainderCoins,
    legacyAlreadyMigrated,
    priorLifetimeDiamonds,
    lifetimeAgencyDiamonds:
      priorLifetimeDiamonds + conversion.diamondsEarned,
    ownerOpeningDiamonds: financialInteger(
      owner.diamonds || 0,
      "invalid_agency_owner_diamonds",
    ),
    financialStateExists: financialStateSnap.exists,
    legacyWalletExists: legacyWalletSnap.exists,
  };
}

export function targetShareOwnerDiamondsToAdd(plan) {
  if (!plan) return 0;
  const amount =
    financialInteger(plan.legacyDiamonds || 0, "invalid_legacy_agency_diamonds") +
    financialInteger(
      plan.shareDiamondsEarned || 0,
      "invalid_agency_share_diamonds",
    );
  if (!Number.isSafeInteger(amount)) {
    throw new Error("invalid_agency_owner_diamonds");
  }
  return amount;
}


export function buildAgencyTargetSharePayoutWrites(
  db,
  plan,
  {
    operationId,
    now,
    ownerOpeningDiamonds,
    contextType,
    roomId = null,
    conversationId = null,
  } = {},
) {
  if (!plan) {
    return {
      writes: [],
      ownerClosingDiamonds: financialInteger(
        ownerOpeningDiamonds || 0,
        "invalid_agency_owner_diamonds",
      ),
    };
  }
  const opId = clean(operationId);
  if (!/^[A-Za-z0-9_-]{12,220}$/.test(opId)) {
    throw new Error("invalid_agency_share_operation_id");
  }
  const openingDiamonds = financialInteger(
    ownerOpeningDiamonds,
    "invalid_agency_owner_diamonds",
  );
  const afterMigrationDiamonds = openingDiamonds + plan.legacyDiamonds;
  const ownerClosingDiamonds =
    afterMigrationDiamonds + plan.shareDiamondsEarned;
  if (!Number.isSafeInteger(ownerClosingDiamonds)) {
    throw new Error("invalid_agency_owner_diamonds");
  }

  const statePath = `agency_financial_state/${plan.agencyId}`;
  const monthlyPath =
    `agency_target_share_monthly/${plan.agencyId}__${plan.month}`;
  const shareLedgerPath = `financial_ledger/agency_target_share_${opId}`;
  const auditPath = `admin_audit_logs/agency_target_share_${opId}`;
  const notificationPath =
    `notifications/agency_target_share_${opId}_${plan.ownerUid}`;

  const writes = [
    db.writeUpdate(
      statePath,
      {
        agencyId: plan.agencyId,
        carryoverCoins: plan.remainderCoins,
        lifetimeAgencyDiamonds: plan.lifetimeAgencyDiamonds,
        legacyWalletMigrated: true,
        lastTargetShareMonth: plan.month,
        lastTargetId: plan.targetId,
        lastTargetShareCoins: plan.deltaCoins,
        updatedAt: now,
      },
      [
        "agencyId",
        "carryoverCoins",
        "lifetimeAgencyDiamonds",
        "legacyWalletMigrated",
        "lastTargetShareMonth",
        "lastTargetId",
        "lastTargetShareCoins",
        "updatedAt",
      ],
    ),
    db.writeUpdate(
      monthlyPath,
      {
        agencyId: plan.agencyId,
        month: plan.month,
        updatedAt: now,
      },
      ["agencyId", "month", "updatedAt"],
      [
        db.increment("shareCoins", plan.deltaCoins),
        db.increment("diamondsPaid", plan.shareDiamondsEarned),
        db.increment("payoutCount", 1),
      ],
    ),
    db.writeCreate(shareLedgerPath, {
      userId: plan.ownerUid,
      agencyId: plan.agencyId,
      hostUid: plan.hostUid,
      asset: "diamonds",
      delta: plan.shareDiamondsEarned,
      openingBalance: afterMigrationDiamonds,
      closingBalance: ownerClosingDiamonds,
      payableCoins: plan.deltaCoins,
      entitlementCoins: plan.entitlementCoins,
      previousPaidCoins: plan.previousPaidCoins,
      paidCoins: plan.paidCoins,
      openingRemainderCoins: plan.openingCarryoverCoins,
      remainderCoins: plan.remainderCoins,
      coinsPerDiamond: plan.coinsPerDiamond,
      reason: "agency_target_share",
      sourceType: "agency_target_close",
      sourceId: opId,
      settlementMonth: plan.month,
      targetId: plan.targetId,
      targetTierId: plan.tierId,
      targetThresholdCoins: plan.targetThresholdCoins,
      hostShareBps: plan.hostShareBps,
      agencyShareBps: plan.agencyShareBps,
      contextType: clean(contextType) || null,
      roomId: clean(roomId) || null,
      conversationId: clean(conversationId) || null,
      idempotencyKey: "agency_target_share_" + opId,
      createdAt: now,
    }),
    db.writeCreate(auditPath, {
      actorUid: "system",
      action: "agencyTargetSharePaid",
      targetType: "agency",
      targetId: plan.agencyId,
      hostUid: plan.hostUid,
      ownerUid: plan.ownerUid,
      month: plan.month,
      targetIdReached: plan.targetId,
      targetTierId: plan.tierId,
      targetThresholdCoins: plan.targetThresholdCoins,
      agencyShareDeltaCoins: plan.deltaCoins,
      agencyShareDiamonds: plan.shareDiamondsEarned,
      carryoverCoins: plan.remainderCoins,
      sourceId: opId,
      createdAt: now,
    }),
    db.writeCreate(notificationPath, {
      userId: plan.ownerUid,
      type: "agency_target_share_paid",
      category: "system",
      title: "تم استحقاق Agency Share",
      body:
        "Target " +
        plan.targetId +
        " • الاستحقاق " +
        String(plan.deltaCoins) +
        " Coins • المضاف " +
        String(plan.shareDiamondsEarned) +
        " Diamonds • Carryover " +
        String(plan.remainderCoins) +
        " Coins",
      read: false,
      mandatory: true,
      financial: true,
      agencyId: plan.agencyId,
      hostUid: plan.hostUid,
      month: plan.month,
      targetId: plan.targetId,
      agencyShareDeltaCoins: plan.deltaCoins,
      agencyShareDiamonds: plan.shareDiamondsEarned,
      carryoverCoins: plan.remainderCoins,
      createdAt: now,
    }),
  ];

  if (!plan.ownerIsHost) {
    writes.push(
      db.writeUpdate(
        `users/${plan.ownerUid}`,
        {
          diamonds: ownerClosingDiamonds,
          walletUpdatedAt: now,
        },
        ["diamonds", "walletUpdatedAt"],
      ),
    );
  }

  if (plan.legacyWalletExists && !plan.legacyAlreadyMigrated) {
    writes.push(
      db.writeUpdate(
        `agency_wallets/${plan.agencyId}`,
        {
          diamonds: 0,
          remainderCoins: 0,
          migratedToUnifiedWallet: true,
          migratedOwnerUid: plan.ownerUid,
          migratedAt: now,
          updatedAt: now,
        },
        [
          "diamonds",
          "remainderCoins",
          "migratedToUnifiedWallet",
          "migratedOwnerUid",
          "migratedAt",
          "updatedAt",
        ],
      ),
    );
    if (plan.legacyDiamonds > 0) {
      writes.push(
        db.writeCreate(
          `financial_ledger/agency_wallet_migration_${plan.agencyId}_${opId}`,
          {
            userId: plan.ownerUid,
            agencyId: plan.agencyId,
            asset: "diamonds",
            delta: plan.legacyDiamonds,
            openingBalance: openingDiamonds,
            closingBalance: afterMigrationDiamonds,
            reason: "agency_wallet_unification_migration",
            sourceType: "agency_wallet_migration",
            sourceId: plan.agencyId,
            idempotencyKey:
              "agency_wallet_migration_" + plan.agencyId + "_" + opId,
            createdAt: now,
          },
        ),
      );
    }
  }

  return {
    writes,
    ownerClosingDiamonds,
    ownerDiamondsAdded:
      plan.legacyDiamonds + plan.shareDiamondsEarned,
  };
}
