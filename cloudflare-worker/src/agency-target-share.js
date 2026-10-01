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
