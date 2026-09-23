import assert from "node:assert/strict";
import test from "node:test";
import {
  activityPayoutBps,
  calculateAgencyCycleSettlement,
  convertPayableCoinsToDiamonds,
  resolveRevenuePolicy,
  tierForMonthlyGross,
} from "../economy/economy-policy.js";

const policy={
  hostPerformanceBonusBps:200,
  agencyPerformanceBonusBps:200,
  hostBonusQualifiedDays:9,
  agencyBonusActiveHosts:10,
  coinsPerDiamond:10000,
  activityPayoutBpsByQualifiedDays:{
    "0":0,"1":0,"2":0,"3":2500,"4":4000,
    "5":5500,"6":7000,"7":8000,"8":9000,"9":10000,
  },
  tiers:[
    {id:"starter",minGiftCoins:0,hostShareBps:5500,agencyShareBps:500},
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

test("approved activity multiplier table is exact",()=>{
  const expected=[0,0,0,2500,4000,5500,7000,8000,9000,10000];
  for(let day=0;day<=9;day++){
    assert.equal(activityPayoutBps(policy,day),expected[day]);
  }
  assert.equal(activityPayoutBps(policy,12),10000);
});

test("host and agency bonuses apply without exceeding 100 percent",()=>{
  const revenue=resolveRevenuePolicy(
    policy,
    {giftHostActivityMonth:"2026-09",giftHostQualifiedDays:9},
    50000000,
    "agency-a",
    "2026-09",
    10,
  );
  assert.equal(revenue.tierId,"diamond");
  assert.equal(revenue.hostBaseShareBps,6300);
  assert.equal(revenue.hostBonusBps,200);
  assert.equal(revenue.hostShareBps,6500);
  assert.equal(revenue.agencyBaseShareBps,1000);
  assert.equal(revenue.agencyBonusBps,200);
  assert.equal(revenue.agencyShareBps,1200);
  assert.equal(revenue.platformShareBps,2300);
  assert.equal(
    revenue.hostShareBps+revenue.agencyShareBps+revenue.platformShareBps,
    10000,
  );

  const extreme={
    ...policy,
    hostPerformanceBonusBps:3000,
    agencyPerformanceBonusBps:3000,
    tiers:[{id:"x",minGiftCoins:0,hostShareBps:9000,agencyShareBps:1000}],
  };
  const clamped=resolveRevenuePolicy(
    extreme,
    {giftHostActivityMonth:"2026-09",giftHostQualifiedDays:9},
    1,
    "agency-a",
    "2026-09",
    10,
  );
  assert.equal(
    clamped.hostShareBps+clamped.agencyShareBps+clamped.platformShareBps,
    10000,
  );
});

test("cycle settlement uses final monthly tier for the whole cycle",()=>{
  const noBonus={...policy,hostPerformanceBonusBps:0,agencyPerformanceBonusBps:0};
  const result=calculateAgencyCycleSettlement(noBonus,{
    monthlyGrossCoins:1000000,
    supportCoins:1000000,
    qualifiedDays:9,
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

  const oldProvisionalStarterAccrual=550000;
  assert.ok(result.hostPayableCoins>oldProvisionalStarterAccrual);
});

test("activity multiplier applies to host and agency payable and remainder stays with platform",()=>{
  const noBonus={...policy,hostPerformanceBonusBps:0,agencyPerformanceBonusBps:0};
  const result=calculateAgencyCycleSettlement(noBonus,{
    monthlyGrossCoins:1000000,
    supportCoins:1000000,
    qualifiedDays:8,
    activeHostCount:0,
    hasAgency:true,
  });
  assert.equal(result.activityPayoutBps,9000);
  assert.equal(result.hostPayableCoins,513000);
  assert.equal(result.agencyPayableCoins,54000);
  assert.equal(result.platformCoins,433000);
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

test("custom Shadow Control thresholds shares and bonuses change calculations without code changes",()=>{
  const custom={
    ...policy,
    hostPerformanceBonusBps:300,
    agencyPerformanceBonusBps:100,
    hostBonusQualifiedDays:5,
    agencyBonusActiveHosts:3,
    tiers:[
      {id:"starter",minGiftCoins:0,hostShareBps:5000,agencyShareBps:400},
      {id:"custom",minGiftCoins:200000,hostShareBps:6100,agencyShareBps:700},
    ],
  };
  const result=calculateAgencyCycleSettlement(custom,{
    monthlyGrossCoins:250000,
    supportCoins:250000,
    qualifiedDays:9,
    activeHostCount:3,
    hasAgency:true,
  });
  assert.equal(result.tierId,"custom");
  assert.equal(result.hostShareBps,6400);
  assert.equal(result.agencyShareBps,800);
  assert.equal(result.platformShareBps,2800);
  assert.equal(result.hostPayableCoins,160000);
  assert.equal(result.agencyPayableCoins,20000);
  assert.equal(result.platformCoins,70000);
});
