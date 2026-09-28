import assert from "node:assert/strict";
import test from "node:test";

import {
  DEFAULT_AGENCY_TARGETS,
  agencyFinancialInteger,
  assertAgencySettlementMonthClosed,
  calculateAgencyTargetProgress,
  validateAgencySettlementTotals,
} from "../economy/agency-policy.js";

test("06-A canonical target ladder stays on the approved Starter to Diamond values",()=>{
  assert.deepEqual(
    DEFAULT_AGENCY_TARGETS.map((target)=>[
      target.id,
      target.thresholdCoins,
      target.salaryDiamonds,
    ]),
    [
      ["starter_g",50000,5],
      ["starter_f",100000,10],
      ["starter_e",200000,20],
      ["starter_d",300000,30],
      ["starter_c",450000,45],
      ["starter_b",650000,65],
      ["starter_a",850000,85],
      ["bronze_f",1000000,100],
      ["bronze_a",4500000,450],
      ["silver_f",5000000,500],
      ["silver_a",18000000,1800],
      ["gold_f",20000000,2000],
      ["gold_a",48000000,4800],
      ["diamond",50000000,5000],
    ],
  );
  assert.equal(DEFAULT_AGENCY_TARGETS.at(-1).openEnded,true);
});

test("06-A target boundaries expose current next and remaining coins exactly",()=>{
  const below=calculateAgencyTargetProgress({
    monthKey:"2026-09",
    storedMonth:"2026-09",
    storedProgressCoins:0,
    addedHostShareCoins:49999,
    storedPaidDiamonds:0,
  });
  assert.equal(below.reachedTarget,null);
  assert.equal(below.nextTarget?.id,"starter_g");
  assert.equal(below.remainingToNextTargetCoins,1);

  const exact=calculateAgencyTargetProgress({
    monthKey:"2026-09",
    storedMonth:"2026-09",
    storedProgressCoins:49999,
    addedHostShareCoins:1,
    storedPaidDiamonds:0,
  });
  assert.equal(exact.reachedTarget?.id,"starter_g");
  assert.equal(exact.nextTarget?.id,"starter_f");
  assert.equal(exact.remainingToNextTargetCoins,50000);

  const diamond=calculateAgencyTargetProgress({
    monthKey:"2026-09",
    storedMonth:"2026-09",
    storedProgressCoins:48000000,
    addedHostShareCoins:2000000,
    storedPaidDiamonds:4800,
  });
  assert.equal(diamond.reachedTarget?.id,"diamond");
  assert.equal(diamond.nextTarget,null);
  assert.equal(diamond.remainingToNextTargetCoins,0);
});

test("06-A target progress fails closed on invalid month and corrupted financial values",()=>{
  assert.throws(
    ()=>calculateAgencyTargetProgress({monthKey:"2026-13"}),
    /invalid_agency_month/,
  );
  assert.throws(
    ()=>calculateAgencyTargetProgress({
      monthKey:"2026-09",
      storedMonth:"2026-09",
      storedProgressCoins:-1,
    }),
    /invalid_agency_target_stored_progress_coins/,
  );
  assert.throws(
    ()=>calculateAgencyTargetProgress({
      monthKey:"2026-09",
      addedHostShareCoins:1.5,
    }),
    /invalid_agency_target_added_host_share_coins/,
  );
  assert.throws(
    ()=>calculateAgencyTargetProgress({
      monthKey:"2026-09",
      storedMonth:"2026-09",
      storedProgressCoins:Number.MAX_SAFE_INTEGER,
      addedHostShareCoins:1,
    }),
    /invalid_agency_target_progress_coins/,
  );
});

test("target salary pays only the incremental difference in the same month",()=>{
  const first=calculateAgencyTargetProgress({
    monthKey:"2026-09",
    storedMonth:"2026-09",
    storedProgressCoins:0,
    addedHostShareCoins:100000,
    storedPaidDiamonds:0,
  });
  assert.equal(first.salaryDeltaDiamonds,10);
  assert.equal(first.paidDiamonds,10);

  const second=calculateAgencyTargetProgress({
    monthKey:"2026-09",
    storedMonth:"2026-09",
    storedProgressCoins:first.progressCoins,
    addedHostShareCoins:100000,
    storedPaidDiamonds:first.paidDiamonds,
  });
  assert.equal(second.salaryTargetDiamonds,20);
  assert.equal(second.salaryDeltaDiamonds,10);
  assert.equal(second.paidDiamonds,20);
});

test("target month rollover resets progress and paid salary without replaying prior month",()=>{
  const nextMonth=calculateAgencyTargetProgress({
    monthKey:"2026-10",
    storedMonth:"2026-09",
    storedProgressCoins:48000000,
    addedHostShareCoins:50000,
    storedPaidDiamonds:4800,
  });
  assert.equal(nextMonth.monthReset,true);
  assert.equal(nextMonth.previousProgressCoins,0);
  assert.equal(nextMonth.previousPaidDiamonds,0);
  assert.equal(nextMonth.progressCoins,50000);
  assert.equal(nextMonth.salaryDeltaDiamonds,5);
  assert.equal(nextMonth.paidDiamonds,5);
});

test("month-end settlement accepts only a closed UTC month",()=>{
  const now=new Date("2026-09-28T12:00:00.000Z");
  assert.equal(assertAgencySettlementMonthClosed("2026-08",now),"2026-08");
  assert.throws(
    ()=>assertAgencySettlementMonthClosed("2026-09",now),
    /agency_month_not_closed/,
  );
  assert.throws(
    ()=>assertAgencySettlementMonthClosed("2026-10",now),
    /agency_month_not_closed/,
  );
  assert.throws(
    ()=>assertAgencySettlementMonthClosed("2026-13",now),
    /invalid_agency_month/,
  );
});

test("agency financial values reject negative non-integer unsafe and non-finite input",()=>{
  assert.equal(agencyFinancialInteger(0,"value"),0);
  assert.equal(agencyFinancialInteger(5000,"value"),5000);
  for(const value of [-1,1.5,Number.MAX_SAFE_INTEGER+1,Infinity,NaN]){
    assert.throws(()=>agencyFinancialInteger(value,"value"),/invalid_agency_financial_value/);
  }
});

test("settlement totals must balance exactly before wallet mutation",()=>{
  assert.deepEqual(validateAgencySettlementTotals({
    supportCoins:100000,
    hostShareCoins:50000,
    agencyShareCoins:5000,
    platformShareCoins:45000,
    giftCount:1,
  }),{
    supportCoins:100000,
    hostShareCoins:50000,
    agencyShareCoins:5000,
    platformShareCoins:45000,
    giftCount:1,
  });
  assert.throws(()=>validateAgencySettlementTotals({
    supportCoins:100000,
    hostShareCoins:50000,
    agencyShareCoins:5000,
    platformShareCoins:44000,
    giftCount:1,
  }),/agency_settlement_invariant_failed/);
});
