import assert from "node:assert/strict";
import test from "node:test";
import {
  activityPayoutBps,
  calculateAgencyCycleSettlement,
  convertPayableCoinsToDiamonds,
  resolveRevenuePolicy,
  tierForMonthlyGross,
} from "../economy/economy-policy.js";
import {
  agencyPerformanceBonusForTarget,
  hostActivityBonusForTarget,
} from "../economy/agency-policy.js";

const policy={
  hostPerformanceBonusBps:200,
  agencyPerformanceBonusBps:200,
  hostBonusQualifiedDays:14,
  agencyBonusActiveHosts:10,
  coinsPerDiamond:10000,
  activityPayoutBpsByQualifiedDays:{
    "0":0,"1":0,"2":0,"3":2500,"4":4000,
    "5":5500,"6":7000,"7":8000,"8":9000,"9":10000,
  },
  tiers:[
    {id:"starter",minGiftCoins:0,hostShareBps:5000,agencyShareBps:500},
    {id:"bronze",minGiftCoins:1000000,hostShareBps:5700,agencyShareBps:600},
    {id:"silver",minGiftCoins:5000000,hostShareBps:6000,agencyShareBps:800},
    {id:"gold",minGiftCoins:20000000,hostShareBps:6200,agencyShareBps:900},
    {id:"diamond",minGiftCoins:50000000,hostShareBps:6300,agencyShareBps:1000},
  ],
};

test("monthly tier boundaries match approved USD thresholds",()=>{
  assert.equal(tierForMonthlyGross(policy,0).id,"starter");
  assert.equal(tierForMonthlyGross(policy,999999).id,"starter");
  assert.equal(tierForMonthlyGross(policy,1000000).id,"bronze");
  assert.equal(tierForMonthlyGross(policy,4999999).id,"bronze");
  assert.equal(tierForMonthlyGross(policy,5000000).id,"silver");
  assert.equal(tierForMonthlyGross(policy,19999999).id,"silver");
  assert.equal(tierForMonthlyGross(policy,20000000).id,"gold");
  assert.equal(tierForMonthlyGross(policy,49999999).id,"gold");
  assert.equal(tierForMonthlyGross(policy,50000000).id,"diamond");
});

test("legacy activity multiplier helper stays isolated from agency payable",()=>{
  const expected=[0,0,0,2500,4000,5500,7000,8000,9000,10000];
  for(let day=0;day<=9;day++){
    assert.equal(activityPayoutBps(policy,day),expected[day]);
  }
  assert.equal(activityPayoutBps(policy,12),10000);
});

test("legacy percentage bonuses never inflate gift-time Host or Agency shares",()=>{
  const revenue=resolveRevenuePolicy(
    policy,
    {giftHostActivityMonth:"2026-09",giftHostQualifiedDays:14},
    50000000,
    "agency-a",
    "2026-09",
    10,
  );
  assert.equal(revenue.tierId,"diamond");
  assert.equal(revenue.hostBaseShareBps,6300);
  assert.equal(revenue.hostBonusBps,0);
  assert.equal(revenue.hostShareBps,6300);
  assert.equal(revenue.agencyBaseShareBps,1000);
  assert.equal(revenue.agencyBonusBps,0);
  assert.equal(revenue.agencyShareBps,1000);
  assert.equal(revenue.platformShareBps,2700);
  assert.equal(
    revenue.hostShareBps+revenue.agencyShareBps+revenue.platformShareBps,
    10000,
  );
});


test("approved host bonus requires 14 days even when stale config says 9",()=>{
  const stale={...policy,hostBonusQualifiedDays:9};
  const before=resolveRevenuePolicy(
    stale,
    {giftHostActivityMonth:"2026-09",giftHostQualifiedDays:9},
    1000000,
    "agency-a",
    "2026-09",
    0,
  );
  assert.equal(before.requiredDays,14);
  assert.equal(before.hostBonusBps,0);

  const qualified=resolveRevenuePolicy(
    stale,
    {giftHostActivityMonth:"2026-09",giftHostQualifiedDays:14},
    1000000,
    "agency-a",
    "2026-09",
    0,
  );
  assert.equal(qualified.requiredDays,14);
  assert.equal(qualified.hostBonusBps,0);
});

test("monthly settlement helper uses final monthly tier for the period",()=>{
  const noBonus={...policy,hostPerformanceBonusBps:0,agencyPerformanceBonusBps:0};
  const result=calculateAgencyCycleSettlement(noBonus,{
    monthlyGrossCoins:1000000,
    supportCoins:1000000,
    qualifiedDays:14,
    activeHostCount:0,
    hasAgency:true,
  });
  assert.equal(result.tierId,"bronze");
  assert.equal(result.hostShareBps,5700);
  assert.equal(result.agencyShareBps,600);
  assert.equal(result.hostGrossCoins,570000);
  assert.equal(result.hostPayableCoins,570000);
  assert.equal(result.agencyPayableCoins,60000);
  assert.equal(result.platformCoins,370000);

  const approvedStarterAccrual=500000;
  assert.ok(result.hostPayableCoins>approvedStarterAccrual);
});

test("activity is bonus-only and never reduces base host or agency payable",()=>{
  const noBonus={...policy,hostPerformanceBonusBps:0,agencyPerformanceBonusBps:0};
  const result=calculateAgencyCycleSettlement(noBonus,{
    monthlyGrossCoins:1000000,
    supportCoins:1000000,
    qualifiedDays:8,
    activeHostCount:0,
    hasAgency:true,
  });
  assert.equal(result.activityPayoutBps,10000);
  assert.equal(result.hostBonusBps,0);
  assert.equal(result.hostPayableCoins,570000);
  assert.equal(result.agencyPayableCoins,60000);
  assert.equal(result.platformCoins,370000);
  assert.equal(
    result.hostPayableCoins+result.agencyPayableCoins+result.platformCoins,
    result.supportCoins,
  );
});

test("diamond conversion preserves sub-10000 coin remainder",()=>{
  assert.deepEqual(
    convertPayableCoinsToDiamonds(9000,12500,10000),
    {accumulatedCoins:21500,diamondsEarned:2,remainderCoins:1500},
  );
});

test("custom Shadow Control tiers change base shares while bonuses remain month-end only",()=>{
  const custom={
    ...policy,
    hostPerformanceBonusBps:300,
    agencyPerformanceBonusBps:100,
    agencyPerformanceBonusMode:"per_host_target_month_end",
    tiers:[
      {id:"starter",minGiftCoins:0,hostShareBps:5000,agencyShareBps:400},
      {id:"custom",minGiftCoins:200000,hostShareBps:6100,agencyShareBps:700},
    ],
  };
  const result=calculateAgencyCycleSettlement(custom,{
    monthlyGrossCoins:250000,
    supportCoins:250000,
    qualifiedDays:14,
    activeHostCount:99,
    hasAgency:true,
  });
  assert.equal(result.tierId,"custom");
  assert.equal(result.hostBonusBps,0);
  assert.equal(result.agencyBonusBps,0);
  assert.equal(result.hostShareBps,6100);
  assert.equal(result.agencyShareBps,700);
  assert.equal(result.platformShareBps,3200);
  assert.equal(result.hostPayableCoins,152500);
  assert.equal(result.agencyPayableCoins,17500);
  assert.equal(result.platformCoins,80000);
});

test("approved Host Activity Bonus table is fixed by highest Target",()=>{
  assert.deepEqual(
    hostActivityBonusForTarget({id:"starter_g"}),
    {asset:"coins",amount:5000},
  );
  assert.deepEqual(
    hostActivityBonusForTarget({tierId:"starter",rank:"F"}),
    {asset:"coins",amount:10000},
  );
  assert.deepEqual(
    hostActivityBonusForTarget({id:"silver_c"}),
    {asset:"diamonds",amount:57},
  );
  assert.deepEqual(
    hostActivityBonusForTarget({id:"gold_a"}),
    {asset:"diamonds",amount:240},
  );
  assert.deepEqual(
    hostActivityBonusForTarget({id:"diamond"}),
    {asset:"diamonds",amount:250},
  );
});

test("Agency Performance Bonus is per eligible Host highest Target",()=>{
  assert.deepEqual(
    agencyPerformanceBonusForTarget({
      targetThresholdCoins:850000,
      qualifiedDays:13,
      bonusBps:100,
    }),
    {
      eligible:false,
      targetThresholdCoins:850000,
      qualifiedDays:13,
      requiredQualifiedDays:14,
      bonusBps:0,
      bonusCoins:0,
    },
  );
  assert.deepEqual(
    agencyPerformanceBonusForTarget({
      targetThresholdCoins:850000,
      qualifiedDays:14,
      bonusBps:100,
    }),
    {
      eligible:true,
      targetThresholdCoins:850000,
      qualifiedDays:14,
      requiredQualifiedDays:14,
      bonusBps:100,
      bonusCoins:8500,
    },
  );
});
