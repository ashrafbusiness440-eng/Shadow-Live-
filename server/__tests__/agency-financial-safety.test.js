import assert from "node:assert/strict";
import test from "node:test";

import {
  agencyFinancialInteger,
  assertAgencySettlementMonthClosed,
  calculateAgencyTargetProgress,
  validateAgencySettlementTotals,
} from "../economy/agency-policy.js";

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
