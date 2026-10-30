import assert from "node:assert/strict";
import test from "node:test";
import {
  STORE_GLOBAL_DAY_COUNT_CAP,STORE_GLOBAL_DAY_SOURCES,
  storeGlobalDailyCountRequest,parseStoreGlobalDailyCount,
  assembleStoreGlobalDailyCoverage,
} from "../../cloudflare-worker/src/store-global-daily-coverage-policy.js";

const day="2026-10-29";
const now=Date.parse("2026-10-30T08:00:00.000Z");
const start=Date.parse("2026-10-29T00:00:00.000Z");
test("global financial UTC-day count scopes ALL four source queries to one complete day",()=>{
  assert.equal(STORE_GLOBAL_DAY_COUNT_CAP,501);
  const fields={receipts:"acquiredAtMs",operations:"createdAt",
    ledger:"createdAt",audit:"createdAt"};
  for(const source of STORE_GLOBAL_DAY_SOURCES){
    const request=storeGlobalDailyCountRequest(source,day,now);
    const query=request.structuredAggregationQuery.structuredQuery;
    assert.equal(query.limit,501);
    assert.equal(query.from.length,1);
    assert.deepEqual(request.structuredAggregationQuery.aggregations,[
      {alias:"matched",count:{upTo:"501"}},
    ]);
    const filters=query.where.compositeFilter.filters;
    assert.equal(filters[0].fieldFilter.field.fieldPath,fields[source]);
    assert.equal(filters[0].fieldFilter.op,"GREATER_THAN_OR_EQUAL");
    assert.equal(filters[1].fieldFilter.field.fieldPath,fields[source]);
    assert.equal(filters[1].fieldFilter.op,"LESS_THAN");
    if(source==="receipts"){
      assert.equal(filters[0].fieldFilter.value.integerValue,String(start));
      assert.equal(filters[1].fieldFilter.value.integerValue,
        String(start+86400000));
    }else{
      assert.equal(filters[0].fieldFilter.value.timestampValue,
        "2026-10-29T00:00:00.000Z");
      assert.equal(filters[1].fieldFilter.value.timestampValue,
        "2026-10-30T00:00:00.000Z");
    }
    assert.equal(filters.length,source==="receipts"||
      source==="operations"?2:3);
    assert.equal(filters.some(f=>f.fieldFilter.field.fieldPath==="buyerUid"),false);
    if(source==="ledger"){
      assert.deepEqual(filters[2].fieldFilter,{
        field:{fieldPath:"sourceType"},op:"EQUAL",
        value:{stringValue:"storePurchase"},
      });
    }
    if(source==="audit"){
      assert.deepEqual(filters[2].fieldFilter,{
        field:{fieldPath:"action"},op:"IN",
        value:{arrayValue:{values:[
          {stringValue:"purchaseStoreItem"},
          {stringValue:"renewStoreItem"},
        ]}},
      });
    }
  }
  for(const bad of ["2026-10-30","2026-10-31","2026-02-29",
    "2025-01-01","tomorrow",null]){
    assert.throws(()=>storeGlobalDailyCountRequest("audit",bad,now),
      /invalid_store_global_day/);
  }
  assert.throws(()=>storeGlobalDailyCountRequest("unknown",day,now),
    /invalid_store_global_source/);
});

test("global finance count parser rejects malformed, decimal, overflow, duplicate results",()=>{
  const row=n=>[{result:{aggregateFields:{matched:{integerValue:String(n)}}}}];
  for(const count of [0,1,500,501])
    assert.deepEqual(parseStoreGlobalDailyCount("receipts",row(count)),
      {count,capped:count===501});
  for(const invalid of [
    null,{},[],row(-1),row(502),row("1.5"),row("01"),
    [{result:{aggregateFields:{matched:{doubleValue:1}}}}],
    [...row(1),...row(1)],
  ])assert.throws(()=>parseStoreGlobalDailyCount("ledger",invalid),
    /invalid_store_global_count/);
});

test("four equal daily source counts still cannot certify money or historical completeness",()=>{
  const records=Object.fromEntries(STORE_GLOBAL_DAY_SOURCES
    .map(s=>[s,{count:3,capped:false}]));
  const result=assembleStoreGlobalDailyCoverage(day,records,now);
  assert.equal(result.scope,"all_buyers_one_utc_day_indexed_counts");
  assert.deepEqual(result.counts,{
    receipts:3,operations:3,ledger:3,audit:3,
  });
  assert.equal(result.cardinalitiesComparable,true);
  assert.equal(result.sourceCountsEqual,true);
  assert.equal(result.countMismatch,false);
  assert.equal(result.recordsIndividuallyReconciled,false);
  assert.equal(result.historicalRowsWithoutDateNotCovered,true);
  assert.equal(result.sourceCompletenessCertified,false);
  assert.equal(result.legacyBackfillCertified,false);
  assert.equal(result.financialReportComplete,false);
  assert.equal(result.netRevenueCertified,false);
  assert.equal(result.refundSettlementCertified,false);
  assert.equal("totalRevenue" in result,false);
  assert.equal("netCoins" in result,false);
});

test("daily source count mismatch and capped result avoid false equality",()=>{
  const records=Object.fromEntries(STORE_GLOBAL_DAY_SOURCES
    .map(s=>[s,{count:14,capped:false}]));
  records.audit={count:13,capped:false};
  let result=assembleStoreGlobalDailyCoverage(day,records,now);
  assert.equal(result.countMismatch,true);
  assert.equal(result.sourceCountsEqual,false);
  records.audit={count:501,capped:true};
  result=assembleStoreGlobalDailyCoverage(day,records,now);
  assert.equal(result.cardinalitiesComparable,false);
  assert.deepEqual(result.cappedSources,["audit"]);
  assert.equal(result.countMismatch,false);
  assert.equal(result.sourceCountsEqual,false);
  for(const invalid of [
    {...records,audit:{count:501,capped:false}},
    {...records,ledger:{count:-1,capped:false}},
    {...records,receipts:null},
    {},
  ])assert.throws(()=>assembleStoreGlobalDailyCoverage(day,invalid,now),
    /invalid_store_global_count/);
});
