const clean = (value) => String(value ?? "").trim();

export const DEFAULT_REVENUE_TIERS = Object.freeze([
  {id:"starter",nameAr:"Starter",minGiftCoins:0,hostShareBps:5000,agencyShareBps:500},
  {id:"bronze",nameAr:"Bronze",minGiftCoins:1000000,hostShareBps:5700,agencyShareBps:600},
  {id:"silver",nameAr:"Silver",minGiftCoins:5000000,hostShareBps:6000,agencyShareBps:800},
  {id:"gold",nameAr:"Gold",minGiftCoins:20000000,hostShareBps:6200,agencyShareBps:900},
  {id:"diamond",nameAr:"Diamond",minGiftCoins:50000000,hostShareBps:6300,agencyShareBps:1000},
]);

const clampBps = (value) =>
  Math.max(0, Math.min(10000, Number(value || 0)));

export function revenueTiers(economy = {}) {
  const raw = Array.isArray(economy?.tiers) && economy.tiers.length
    ? economy.tiers
    : DEFAULT_REVENUE_TIERS;
  return raw.map((item,index)=>({
    id: clean(item?.id || ("tier_" + String(index + 1))),
    nameAr: clean(item?.nameAr || item?.id || ("Tier " + String(index + 1))),
    minGiftCoins: Math.max(0, Number(item?.minGiftCoins || 0)),
    hostShareBps: clampBps(item?.hostShareBps ?? economy?.recipientShareBps ?? 0),
    agencyShareBps: clampBps(item?.agencyShareBps || 0),
  })).sort((a,b)=>a.minGiftCoins-b.minGiftCoins);
}

export function tierForMonthlyGross(economy, monthlyGrossCoins) {
  const tiers = revenueTiers(economy);
  let tier = tiers[0];
  const gross = Math.max(0, Number(monthlyGrossCoins || 0));
  for (const item of tiers) {
    if (gross >= item.minGiftCoins) tier = item;
  }
  return tier;
}

function effectiveAgencyEconomy(economy = {}, receiverData = {}, agencyId = "") {
  const snapshot = agencyId && receiverData?.agencyPolicySnapshot &&
    typeof receiverData.agencyPolicySnapshot === "object"
    ? receiverData.agencyPolicySnapshot
    : null;
  if (!snapshot) return economy;
  return {
    ...economy,
    ...snapshot,
    tiers: Array.isArray(snapshot.tiers) && snapshot.tiers.length
      ? snapshot.tiers
      : economy?.tiers,
    agencyTargets: Array.isArray(snapshot.targets) && snapshot.targets.length
      ? snapshot.targets
      : economy?.agencyTargets,
  };
}

export function resolveRevenuePolicy(
  economy,
  receiverData,
  monthlyGrossCoins,
  agencyId,
  monthKey,
  activeHostCount = 0,
) {
  const effectiveEconomy = effectiveAgencyEconomy(
    economy,
    receiverData,
    agencyId,
  );
  const tier = tierForMonthlyGross(effectiveEconomy, monthlyGrossCoins);
  const activityMonth = clean(receiverData?.giftHostActivityMonth);
  const qualifiedDays = activityMonth === monthKey
    ? Math.max(0, Number(receiverData?.giftHostQualifiedDays || 0))
    : 0;
  const requiredDays = Math.max(
    1,
    Math.min(31, Number(effectiveEconomy?.hostBonusQualifiedDays || 9)),
  );
  const configuredHostBonus = Math.max(
    0,
    Math.min(3000, Number(effectiveEconomy?.hostPerformanceBonusBps ?? 200)),
  );
  const hostBonusBps = qualifiedDays >= requiredDays
    ? configuredHostBonus
    : 0;
  const hostShareBps = clampBps(tier.hostShareBps + hostBonusBps);

  const requiredActiveHosts = Math.max(
    1,
    Math.min(100000, Number(effectiveEconomy?.agencyBonusActiveHosts || 10)),
  );
  const configuredAgencyBonus = Math.max(
    0,
    Math.min(3000, Number(effectiveEconomy?.agencyPerformanceBonusBps ?? 200)),
  );
  const agencyBonusBps = agencyId && activeHostCount >= requiredActiveHosts
    ? configuredAgencyBonus
    : 0;
  const agencyShareBps = agencyId
    ? Math.max(
        0,
        Math.min(10000 - hostShareBps, tier.agencyShareBps + agencyBonusBps),
      )
    : 0;
  const platformShareBps = Math.max(
    0,
    10000 - hostShareBps - agencyShareBps,
  );

  return {
    tierId: tier.id,
    tierName: tier.nameAr,
    tierMinGiftCoins: tier.minGiftCoins,
    hostBaseShareBps: tier.hostShareBps,
    hostBonusBps,
    hostShareBps,
    agencyBaseShareBps: tier.agencyShareBps,
    agencyBonusBps,
    agencyShareBps,
    platformShareBps,
    qualifiedDays,
    requiredDays,
    activeHostCount,
    requiredActiveHosts,
  };
}

export function activityPayoutBps(economy, qualifiedDays) {
  const defaults = {
    "0":0,"1":0,"2":0,"3":2500,"4":4000,
    "5":5500,"6":7000,"7":8000,"8":9000,"9":10000,
  };
  const table = economy?.activityPayoutBpsByQualifiedDays || defaults;
  const normalizedDays = Math.max(
    0,
    Math.min(9, Math.floor(Number(qualifiedDays || 0))),
  );
  const key = String(normalizedDays);
  return clampBps(table[key] ?? defaults[key] ?? 0);
}

export function calculateAgencyCycleSettlement(
  economy,
  {
    monthlyGrossCoins = 0,
    supportCoins = 0,
    qualifiedDays = 0,
    activeHostCount = 0,
    hasAgency = true,
  } = {},
) {
  const tier = tierForMonthlyGross(economy, monthlyGrossCoins);
  const fullDays = Math.max(
    1,
    Math.min(31, Number(effectiveEconomy?.hostBonusQualifiedDays || 9)),
  );
  const hostBonusBps = qualifiedDays >= fullDays
    ? Math.max(
        0,
        Math.min(3000, Number(economy?.hostPerformanceBonusBps || 0)),
      )
    : 0;
  const agencyBonusThreshold = Math.max(
    1,
    Number(effectiveEconomy?.agencyBonusActiveHosts || 10),
  );
  const agencyBonusBps = hasAgency && activeHostCount >= agencyBonusThreshold
    ? Math.max(
        0,
        Math.min(3000, Number(economy?.agencyPerformanceBonusBps || 0)),
      )
    : 0;

  const hostShareBps = clampBps(tier.hostShareBps + hostBonusBps);
  const agencyShareBps = hasAgency
    ? Math.max(
        0,
        Math.min(10000 - hostShareBps, tier.agencyShareBps + agencyBonusBps),
      )
    : 0;
  const payoutBps = activityPayoutBps(economy, qualifiedDays);
  const support = Math.max(0, Number(supportCoins || 0));
  const hostGrossCoins = Math.floor(support * hostShareBps / 10000);
  const agencyGrossCoins = Math.floor(support * agencyShareBps / 10000);
  const hostPayableCoins = Math.floor(hostGrossCoins * payoutBps / 10000);
  const agencyPayableCoins = Math.floor(agencyGrossCoins * payoutBps / 10000);
  const platformCoins = Math.max(
    0,
    support - hostPayableCoins - agencyPayableCoins,
  );

  return {
    tierId: tier.id,
    tierName: tier.nameAr,
    tierMinGiftCoins: tier.minGiftCoins,
    hostBaseShareBps: tier.hostShareBps,
    hostBonusBps,
    hostShareBps,
    agencyBaseShareBps: tier.agencyShareBps,
    agencyBonusBps,
    agencyShareBps,
    platformShareBps: Math.max(0, 10000 - hostShareBps - agencyShareBps),
    activityPayoutBps: payoutBps,
    qualifiedDays: Math.max(0, Number(qualifiedDays || 0)),
    activeHostCount: Math.max(0, Number(activeHostCount || 0)),
    supportCoins: support,
    hostGrossCoins,
    agencyGrossCoins,
    hostPayableCoins,
    agencyPayableCoins,
    platformCoins,
  };
}

export function convertPayableCoinsToDiamonds(
  pendingRemainderCoins,
  payableCoins,
  coinsPerDiamond = 10000,
) {
  const rate = Math.max(1, Number(coinsPerDiamond || 10000));
  const accumulated =
    Math.max(0, Number(pendingRemainderCoins || 0)) +
    Math.max(0, Number(payableCoins || 0));
  return {
    accumulatedCoins: accumulated,
    diamondsEarned: Math.floor(accumulated / rate),
    remainderCoins: accumulated % rate,
  };
}
