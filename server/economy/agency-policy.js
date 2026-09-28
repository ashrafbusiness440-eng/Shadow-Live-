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

function integer(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : fallback;
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
  const month = clean(monthKey);
  if (!/^\d{4}-\d{2}$/.test(month)) {
    throw new Error("invalid_agency_month");
  }

  const sameMonth = clean(storedMonth) === month;
  const previousProgressCoins = sameMonth
    ? Math.max(0, integer(storedProgressCoins))
    : 0;
  const previousPaidDiamonds = sameMonth
    ? Math.max(0, integer(storedPaidDiamonds))
    : 0;
  const addedCoins = Math.max(0, integer(addedHostShareCoins));
  const progressCoins = previousProgressCoins + addedCoins;
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

export function agencySurplusCoins({
  progressCoins = 0,
  paidDiamonds = 0,
  coinsPerDiamond = 10000,
} = {}) {
  const rate = Math.max(1, integer(coinsPerDiamond, 10000));
  const paidValueCoins = Math.max(0, integer(paidDiamonds)) * rate;
  return Math.max(0, Math.max(0, integer(progressCoins)) - paidValueCoins);
}
