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

export function resolveRevenuePolicy(
  economy,
  receiverData,
  monthlyGrossCoins,
  agencyId,
  monthKey,
  activeHostCount = 0,
) {
  const tier = tierForMonthlyGross(economy, monthlyGrossCoins);
  const activityMonth = clean(receiverData?.giftHostActivityMonth);
  const qualifiedDays = activityMonth === monthKey
    ? Math.max(0, Number(receiverData?.giftHostQualifiedDays || 0))
    : 0;
  const requiredDays = 14;
  // Approved policy: activity/performance bonuses are month-end payouts.
  // They must never inflate the base gift-time Host or Agency share.
  const hostBonusBps = 0;
  const agencyBonusBps = 0;
  const hostShareBps = clampBps(tier.hostShareBps);
  const requiredActiveHosts = 0;
  const agencyShareBps = agencyId
    ? Math.max(
        0,
        Math.min(10000 - hostShareBps, tier.agencyShareBps),
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

export function resolveGiftRevenuePolicy(
  economy,
  receiverData,
  monthlyGrossCoins,
  agencyId,
  monthKey,
) {
  const revenue=resolveRevenuePolicy(
    economy,
    receiverData,
    monthlyGrossCoins,
    agencyId,
    monthKey,
    0,
  );
  const agencyShareBps=agencyId
    ? Math.max(
        0,
        Math.min(10000-revenue.hostShareBps,revenue.agencyBaseShareBps),
      )
    : 0;
  return {
    ...revenue,
    agencyBonusBps:0,
    agencyShareBps,
    platformShareBps:Math.max(
      0,
      10000-revenue.hostShareBps-agencyShareBps,
    ),
    activeHostCount:0,
    agencyBonusDeferredToMonthEnd:Boolean(agencyId),
  };
}

function agencyBonusFinancialInteger(value,field){
  const parsed=Number(value);
  if(!Number.isSafeInteger(parsed)||parsed<0){
    throw new Error("invalid_agency_bonus_"+field);
  }
  return parsed;
}

export function calculateAgencyMonthlyBonus(
  economy,
  {
    supportCoins=0,
    activeHostCount=0,
    hasAgency=true,
  }={},
) {
  const support=agencyBonusFinancialInteger(
    supportCoins,
    "support_coins",
  );
  const activeHosts=agencyBonusFinancialInteger(
    activeHostCount,
    "active_host_count",
  );
  const configuredBonusBps=Math.max(
    0,
    Math.min(3000,Number(economy?.agencyPerformanceBonusBps??100)),
  );
  if(!Number.isSafeInteger(configuredBonusBps)){
    throw new Error("invalid_agency_bonus_policy");
  }
  // Aggregate support/active-host bonus was superseded. The approved
  // Agency Performance Bonus is calculated per eligible Host from that
  // Host's highest closed Target during bounded month-end host settlement.
  return {
    eligible:false,
    supportCoins:support,
    activeHostCount:activeHosts,
    requiredActiveHosts:0,
    configuredBonusBps,
    agencyBonusBps:0,
    agencyBonusCoins:0,
    mode:hasAgency===true ? "per_host_target_month_end" : "none",
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
  const hostBonusBps = 0;
  const agencyBonusBps = 0;
  const hostShareBps = clampBps(tier.hostShareBps);
  const agencyShareBps = hasAgency
    ? Math.max(
        0,
        Math.min(10000 - hostShareBps, tier.agencyShareBps),
      )
    : 0;
  const payoutBps = 10000;
  const support = Math.max(0, Number(supportCoins || 0));
  const hostGrossCoins = Math.floor(support * hostShareBps / 10000);
  const agencyGrossCoins = Math.floor(support * agencyShareBps / 10000);
  const hostPayableCoins = hostGrossCoins;
  const agencyPayableCoins = agencyGrossCoins;
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
