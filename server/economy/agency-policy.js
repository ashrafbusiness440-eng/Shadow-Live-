const clean = (value) => String(value ?? "").trim();

export const DEFAULT_AGENCY_TARGETS = Object.freeze([
  { id: "starter_g", tierId: "starter", rank: "G", thresholdCoins: 50000, salaryDiamonds: 5 },
  { id: "starter_f", tierId: "starter", rank: "F", thresholdCoins: 100000, salaryDiamonds: 10 },
  { id: "starter_e", tierId: "starter", rank: "E", thresholdCoins: 200000, salaryDiamonds: 20 },
  { id: "starter_d", tierId: "starter", rank: "D", thresholdCoins: 300000, salaryDiamonds: 30 },
  { id: "starter_c", tierId: "starter", rank: "C", thresholdCoins: 450000, salaryDiamonds: 45 },
  { id: "starter_b", tierId: "starter", rank: "B", thresholdCoins: 650000, salaryDiamonds: 65 },
  { id: "starter_a", tierId: "starter", rank: "A", thresholdCoins: 850000, salaryDiamonds: 85 },
  { id: "bronze_f", tierId: "bronze", rank: "F", thresholdCoins: 1000000, salaryDiamonds: 100 },
  { id: "bronze_a", tierId: "bronze", rank: "A", thresholdCoins: 4500000, salaryDiamonds: 450 },
  { id: "silver_f", tierId: "silver", rank: "F", thresholdCoins: 5000000, salaryDiamonds: 500 },
  { id: "silver_a", tierId: "silver", rank: "A", thresholdCoins: 18000000, salaryDiamonds: 1800 },
  { id: "gold_f", tierId: "gold", rank: "F", thresholdCoins: 20000000, salaryDiamonds: 2000 },
  { id: "gold_a", tierId: "gold", rank: "A", thresholdCoins: 48000000, salaryDiamonds: 4800 },
  { id: "diamond", tierId: "diamond", rank: "DIAMOND", thresholdCoins: 50000000, salaryDiamonds: 5000, openEnded: true },
]);

export const HOST_ACTIVITY_BONUS_BY_LEVEL = Object.freeze({
  starter_g: Object.freeze({ asset: "coins", amount: 5000 }),
  starter_f: Object.freeze({ asset: "coins", amount: 10000 }),
  starter_e: Object.freeze({ asset: "diamonds", amount: 1 }),
  starter_d: Object.freeze({ asset: "diamonds", amount: 1 }),
  starter_c: Object.freeze({ asset: "diamonds", amount: 2 }),
  starter_b: Object.freeze({ asset: "diamonds", amount: 3 }),
  starter_a: Object.freeze({ asset: "diamonds", amount: 4 }),
  bronze_f: Object.freeze({ asset: "diamonds", amount: 5 }),
  bronze_e: Object.freeze({ asset: "diamonds", amount: 7 }),
  bronze_d: Object.freeze({ asset: "diamonds", amount: 11 }),
  bronze_c: Object.freeze({ asset: "diamonds", amount: 15 }),
  bronze_b: Object.freeze({ asset: "diamonds", amount: 18 }),
  bronze_a: Object.freeze({ asset: "diamonds", amount: 22 }),
  silver_f: Object.freeze({ asset: "diamonds", amount: 25 }),
  silver_e: Object.freeze({ asset: "diamonds", amount: 35 }),
  silver_d: Object.freeze({ asset: "diamonds", amount: 45 }),
  silver_c: Object.freeze({ asset: "diamonds", amount: 57 }),
  silver_b: Object.freeze({ asset: "diamonds", amount: 72 }),
  silver_a: Object.freeze({ asset: "diamonds", amount: 90 }),
  gold_f: Object.freeze({ asset: "diamonds", amount: 100 }),
  gold_e: Object.freeze({ asset: "diamonds", amount: 120 }),
  gold_d: Object.freeze({ asset: "diamonds", amount: 145 }),
  gold_c: Object.freeze({ asset: "diamonds", amount: 175 }),
  gold_b: Object.freeze({ asset: "diamonds", amount: 207 }),
  gold_a: Object.freeze({ asset: "diamonds", amount: 240 }),
  diamond: Object.freeze({ asset: "diamonds", amount: 250 }),
});

export function hostActivityBonusForTarget(target = {}) {
  const targetId = clean(target?.id || target?.targetId).toLowerCase();
  const tierId = clean(target?.tierId || target?.targetTierId).toLowerCase();
  const rank = clean(target?.rank || target?.targetRank).toLowerCase();
  const fallbackKey = tierId === "diamond"
    ? "diamond"
    : (tierId && rank ? `${tierId}_${rank}` : "");
  const key = Object.prototype.hasOwnProperty.call(
    HOST_ACTIVITY_BONUS_BY_LEVEL,
    targetId,
  )
    ? targetId
    : fallbackKey;
  const bonus = HOST_ACTIVITY_BONUS_BY_LEVEL[key];
  return bonus
    ? { asset: bonus.asset, amount: bonus.amount }
    : { asset: "none", amount: 0 };
}

export function agencyTargetShareEntitlement({
  target = null,
  tiers = [],
} = {}) {
  if (!target) {
    return {
      targetId: "",
      tierId: "",
      hostShareBps: 0,
      agencyShareBps: 0,
      targetThresholdCoins: 0,
      entitlementCoins: 0,
    };
  }
  const targetId = clean(target.id || target.targetId);
  const tierId = clean(target.tierId || target.targetTierId).toLowerCase();
  const threshold = targetFinancialInteger(
    target.thresholdCoins ?? target.targetThresholdCoins ?? 0,
    "agency_share_target_threshold_coins",
  );
  const tier = Array.isArray(tiers)
    ? tiers.find((item) => clean(item?.id).toLowerCase() === tierId)
    : null;
  if (!tier) {
    throw new Error("agency_share_target_tier_missing");
  }
  const hostShareBps = targetFinancialInteger(
    tier.hostShareBps || 0,
    "agency_share_host_bps",
  );
  const agencyShareBps = targetFinancialInteger(
    tier.agencyShareBps || 0,
    "agency_share_agency_bps",
  );
  if (hostShareBps <= 0 || hostShareBps > 10000 || agencyShareBps > 10000) {
    throw new Error("invalid_agency_share_tier");
  }
  const entitlementBig =
    (BigInt(threshold) * BigInt(agencyShareBps)) / BigInt(hostShareBps);
  const entitlementCoins = Number(entitlementBig);
  if (!Number.isSafeInteger(entitlementCoins) || entitlementCoins < 0) {
    throw new Error("invalid_agency_share_entitlement");
  }
  return {
    targetId,
    tierId,
    hostShareBps,
    agencyShareBps,
    targetThresholdCoins: threshold,
    entitlementCoins,
  };
}

export function agencyTargetShareDelta({
  target = null,
  tiers = [],
  previousPaidCoins = 0,
} = {}) {
  const entitlement = agencyTargetShareEntitlement({ target, tiers });
  const previous = targetFinancialInteger(
    previousPaidCoins,
    "agency_share_previous_paid_coins",
  );
  const deltaCoins = Math.max(0, entitlement.entitlementCoins - previous);
  return {
    ...entitlement,
    previousPaidCoins: previous,
    deltaCoins,
    paidCoins: previous + deltaCoins,
  };
}

export function convertAgencyCoinsWithCarryover({
  carryoverCoins = 0,
  payableCoins = 0,
  coinsPerDiamond = 10000,
} = {}) {
  const carryover = targetFinancialInteger(
    carryoverCoins,
    "agency_carryover_coins",
  );
  const payable = targetFinancialInteger(
    payableCoins,
    "agency_payable_coins",
  );
  const rate = targetFinancialInteger(
    coinsPerDiamond,
    "agency_coins_per_diamond",
  );
  if (rate <= 0) throw new Error("invalid_agency_coins_per_diamond");
  const total = carryover + payable;
  if (!Number.isSafeInteger(total)) {
    throw new Error("invalid_agency_carryover_total");
  }
  return {
    openingCarryoverCoins: carryover,
    payableCoins: payable,
    diamondsEarned: Math.floor(total / rate),
    remainderCoins: total % rate,
    coinsPerDiamond: rate,
  };
}

export function agencyPerformanceBonusForTarget({
  targetThresholdCoins = 0,
  qualifiedDays = 0,
  bonusBps = 100,
  requiredQualifiedDays = 14,
} = {}) {
  const threshold = targetFinancialInteger(
    targetThresholdCoins,
    "agency_bonus_target_threshold_coins",
  );
  const days = Math.max(0, integer(qualifiedDays));
  const requiredDays = Math.max(1, integer(requiredQualifiedDays, 14));
  const bps = Math.max(0, Math.min(3000, integer(bonusBps, 100)));
  const eligible = threshold > 0 && days >= requiredDays && bps > 0;
  const bonusCoins = eligible
    ? Number((BigInt(threshold) * BigInt(bps)) / 10000n)
    : 0;
  return {
    eligible,
    targetThresholdCoins: threshold,
    qualifiedDays: days,
    requiredQualifiedDays: requiredDays,
    bonusBps: eligible ? bps : 0,
    bonusCoins,
  };
}

function integer(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : fallback;
}

function targetFinancialInteger(value, field) {
  const parsed = Number(value ?? 0);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new Error("invalid_agency_target_" + field);
  }
  return parsed;
}

export function normalizeAgencyTargets(rawTargets) {
  const source = Array.isArray(rawTargets) && rawTargets.length
    ? rawTargets
    : DEFAULT_AGENCY_TARGETS;

  const targets = source.map((item, index) => {
    const thresholdCoins = Math.max(1, integer(item?.thresholdCoins));
    const salaryDiamonds = Math.max(0, integer(item?.salaryDiamonds));
    return {
      id: clean(item?.id || ("target_" + String(index + 1))),
      tierId: clean(item?.tierId || "starter"),
      rank: clean(item?.rank || ""),
      thresholdCoins,
      salaryDiamonds,
      openEnded: item?.openEnded === true,
    };
  }).sort((a, b) => a.thresholdCoins - b.thresholdCoins);

  for (let i = 1; i < targets.length; i++) {
    if (targets[i].thresholdCoins <= targets[i - 1].thresholdCoins) {
      throw new Error("invalid_agency_target_order");
    }
    if (targets[i].salaryDiamonds < targets[i - 1].salaryDiamonds) {
      throw new Error("invalid_agency_salary_order");
    }
  }
  return targets;
}

export function calculateAgencyTargetProgress({
  monthKey,
  storedMonth,
  storedProgressCoins = 0,
  addedHostShareCoins = 0,
  storedPaidDiamonds = 0,
  targets,
} = {}) {
  const month = normalizeAgencyMonthKey(monthKey);
  const storedMonthText = clean(storedMonth);
  const normalizedStoredMonth = storedMonthText
    ? normalizeAgencyMonthKey(storedMonthText)
    : "";
  if (normalizedStoredMonth && normalizedStoredMonth > month) {
    throw new Error("stale_agency_target_month");
  }

  const sameMonth = normalizedStoredMonth === month;
  const previousProgressCoins = sameMonth
    ? targetFinancialInteger(storedProgressCoins, "stored_progress_coins")
    : 0;
  const previousPaidDiamonds = sameMonth
    ? targetFinancialInteger(storedPaidDiamonds, "stored_paid_diamonds")
    : 0;
  const addedCoins = targetFinancialInteger(
    addedHostShareCoins,
    "added_host_share_coins",
  );
  const progressCoins = previousProgressCoins + addedCoins;
  if (!Number.isSafeInteger(progressCoins)) {
    throw new Error("invalid_agency_target_progress_coins");
  }
  const normalizedTargets = normalizeAgencyTargets(targets);

  let reachedTarget = null;
  let nextTarget = normalizedTargets[0] || null;
  for (const target of normalizedTargets) {
    if (progressCoins >= target.thresholdCoins) {
      reachedTarget = target;
      nextTarget = null;
      continue;
    }
    nextTarget = target;
    break;
  }

  const salaryTargetDiamonds = reachedTarget?.salaryDiamonds || 0;
  const salaryDeltaDiamonds = Math.max(
    0,
    salaryTargetDiamonds - previousPaidDiamonds,
  );
  const paidDiamonds = previousPaidDiamonds + salaryDeltaDiamonds;
  const remainingToNextTargetCoins = nextTarget
    ? Math.max(0, nextTarget.thresholdCoins - progressCoins)
    : 0;

  return {
    month,
    monthReset: !sameMonth,
    previousProgressCoins,
    addedHostShareCoins: addedCoins,
    progressCoins,
    previousPaidDiamonds,
    paidDiamonds,
    salaryTargetDiamonds,
    salaryDeltaDiamonds,
    reachedTarget,
    nextTarget,
    remainingToNextTargetCoins,
  };
}

export function agencyTargetAchievementDeltas({
  previousProgressCoins = 0,
  progressCoins = 0,
  targets,
} = {}) {
  const previousProgress = targetFinancialInteger(
    previousProgressCoins,
    "achievement_previous_progress_coins",
  );
  const progress = targetFinancialInteger(
    progressCoins,
    "achievement_progress_coins",
  );
  if (progress < previousProgress) {
    throw new Error("invalid_agency_target_achievement_progress");
  }
  const normalizedTargets = normalizeAgencyTargets(targets);
  let previousSalaryDiamonds = 0;
  const achieved = [];
  for (const target of normalizedTargets) {
    const salaryDeltaDiamonds = Math.max(
      0,
      target.salaryDiamonds - previousSalaryDiamonds,
    );
    if (
      target.thresholdCoins > previousProgress &&
      target.thresholdCoins <= progress
    ) {
      achieved.push({
        id: target.id,
        tierId: target.tierId,
        rank: target.rank,
        thresholdCoins: target.thresholdCoins,
        salaryDiamonds: target.salaryDiamonds,
        salaryDeltaDiamonds,
      });
    }
    previousSalaryDiamonds = target.salaryDiamonds;
  }
  return achieved;
}

export function resolveAgencySurplusPolicy(override = {}) {
  if (!Object.prototype.hasOwnProperty.call(override, "surplusToShadow")) {
    return {
      configured: false,
      surplusToShadow: null,
      mode: "unconfigured",
    };
  }
  if (typeof override.surplusToShadow !== "boolean") {
    throw new Error("invalid_agency_surplus_policy");
  }
  return {
    configured: true,
    surplusToShadow: override.surplusToShadow,
    mode: override.surplusToShadow ? "shadow_profit" : "host_wallet_coins",
  };
}

export function calculateAgencyMonthEndSurplusFromSnapshot({
  progressCoins = 0,
  targetThresholdCoins = 0,
  surplusToShadow,
} = {}) {
  const progress = targetFinancialInteger(
    progressCoins,
    "surplus_progress_coins",
  );
  const threshold = targetFinancialInteger(
    targetThresholdCoins,
    "surplus_target_threshold_coins",
  );
  if (typeof surplusToShadow !== "boolean") {
    throw new Error("agency_surplus_policy_unconfigured");
  }
  if (threshold > progress) {
    throw new Error("agency_surplus_target_threshold_conflict");
  }
  const surplusCoins = progress - threshold;
  if (!Number.isSafeInteger(surplusCoins) || surplusCoins < 0) {
    throw new Error("invalid_agency_target_surplus_coins");
  }
  return {
    progressCoins: progress,
    completedTargetCoins: threshold,
    surplusCoins,
    surplusToShadow,
    destination:
      surplusCoins === 0
        ? "none"
        : surplusToShadow
          ? "shadow_profit"
          : "host_wallet_coins",
  };
}

export function calculateAgencyMonthEndSurplus({
  progressCoins = 0,
  targets,
  surplusToShadow,
} = {}) {
  const progress = targetFinancialInteger(
    progressCoins,
    "surplus_progress_coins",
  );
  if (typeof surplusToShadow !== "boolean") {
    throw new Error("agency_surplus_policy_unconfigured");
  }

  const normalizedTargets = normalizeAgencyTargets(targets);
  let reachedTarget = null;
  let nextTarget = normalizedTargets[0] || null;
  for (const target of normalizedTargets) {
    if (progress >= target.thresholdCoins) {
      reachedTarget = target;
      nextTarget = null;
      continue;
    }
    nextTarget = target;
    break;
  }

  const completedTargetCoins = reachedTarget?.thresholdCoins || 0;
  const snapshot = calculateAgencyMonthEndSurplusFromSnapshot({
    progressCoins: progress,
    targetThresholdCoins: completedTargetCoins,
    surplusToShadow,
  });

  return {
    ...snapshot,
    reachedTarget,
    nextTarget,
  };
}

// Legacy compatibility helper. Stage 09 canonical logic uses
// calculateAgencyMonthEndSurplus() so custom target thresholds never depend
// on salary-Diamond conversion math.
export function agencySurplusCoins({
  progressCoins = 0,
  paidDiamonds = 0,
  coinsPerDiamond = 10000,
} = {}) {
  const rate = Math.max(1, integer(coinsPerDiamond, 10000));
  const paidValueCoins = Math.max(0, integer(paidDiamonds)) * rate;
  return Math.max(0, Math.max(0, integer(progressCoins)) - paidValueCoins);
}

export function normalizeAgencyMonthKey(value) {
  const month = clean(value);
  if (!/^\d{4}-\d{2}$/.test(month)) {
    throw new Error("invalid_agency_month");
  }
  const monthNumber = Number(month.slice(5, 7));
  if (monthNumber < 1 || monthNumber > 12) {
    throw new Error("invalid_agency_month");
  }
  return month;
}

export function currentAgencyMonthKey(now = new Date()) {
  const date = now instanceof Date ? now : new Date(now);
  if (!Number.isFinite(date.getTime())) {
    throw new Error("invalid_agency_now");
  }
  const riyadh = new Date(date.getTime() + 3 * 60 * 60 * 1000);
  return riyadh.toISOString().slice(0, 7);
}

export function agencyPublicRankingPrefix(agencyIdInput, monthInput) {
  const agencyId = clean(agencyIdInput);
  if (!/^[A-Za-z0-9_-]{3,180}$/.test(agencyId)) {
    throw new Error("invalid_agency_ranking_agency_id");
  }
  const month = normalizeAgencyMonthKey(monthInput);
  return agencyId + "__" + month + "__";
}

export function agencyPublicRankingKey({
  agencyId,
  month,
  hostUid,
  supportCoins,
} = {}) {
  const prefix = agencyPublicRankingPrefix(agencyId, month);
  const uid = clean(hostUid);
  if (!uid || uid.length > 180 || uid.includes("/")) {
    throw new Error("invalid_agency_ranking_host_uid");
  }
  const coins = agencyFinancialInteger(
    supportCoins || 0,
    "public_ranking_support_coins",
  );
  const inverted = Number.MAX_SAFE_INTEGER - coins;
  return (
    prefix +
    String(inverted).padStart(16, "0") +
    "__" +
    uid
  );
}

export function assertAgencySettlementMonthClosed(monthInput, now = new Date()) {
  const month = normalizeAgencyMonthKey(monthInput);
  const currentMonth = currentAgencyMonthKey(now);
  if (month >= currentMonth) {
    throw new Error("agency_month_not_closed");
  }
  return month;
}

export function agencyFinancialInteger(value, field = "amount") {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new Error("invalid_agency_financial_" + field);
  }
  return parsed;
}

export function validateAgencySettlementTotals(totals = {}) {
  const normalized = {
    supportCoins: agencyFinancialInteger(totals.supportCoins || 0, "support_coins"),
    hostShareCoins: agencyFinancialInteger(totals.hostShareCoins || 0, "host_share_coins"),
    agencyShareCoins: agencyFinancialInteger(totals.agencyShareCoins || 0, "agency_share_coins"),
    platformShareCoins: agencyFinancialInteger(totals.platformShareCoins || 0, "platform_share_coins"),
    giftCount: agencyFinancialInteger(totals.giftCount || 0, "gift_count"),
  };
  const distributed =
    normalized.hostShareCoins +
    normalized.agencyShareCoins +
    normalized.platformShareCoins;
  if (!Number.isSafeInteger(distributed) || distributed !== normalized.supportCoins) {
    throw new Error("agency_settlement_invariant_failed");
  }
  return normalized;
}
