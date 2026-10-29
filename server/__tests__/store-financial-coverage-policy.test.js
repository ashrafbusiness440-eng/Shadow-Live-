import assert from "node:assert/strict";
import test from "node:test";
import {
  storeFinancialCountRequest,parseStoreFinancialCountResponse,
  assembleStoreFinancialCoverage,STORE_COVERAGE_COUNT_CAP,
  STORE_COVERAGE_SOURCES,
} from "../../cloudflare-worker/src/store-financial-coverage-policy.js";

test("Store Owner source COUNT always includes buyer-scoped indexed predicates and cap",()=>{
  assert.equal(STORE_COVERAGE_COUNT_CAP,501);
  const predicates={
    receipts:["buyerUid"],operations:["buyerUid"],
    ledger:["userId","sourceType"],audit:["actorUid","action"],
  };
  for(const source of STORE_COVERAGE_SOURCES){
    const request=storeFinancialCountRequest(source,"buyer_1");
    const query=request.structuredAggregationQuery.structuredQuery;
    assert.equal(query.limit,501);
    assert.deepEqual(request.structuredAggregationQuery.aggregations,
      [{alias:"matched",count:{upTo:"501"}}]);
    const parts=query.where.fieldFilter?[query.where]:
      query.where.compositeFilter.filters;
    assert.deepEqual(parts.map(x=>x.fieldFilter.field.fieldPath),
      predicates[source]);
    assert.ok(parts.some(x=>x.fieldFilter.value?.stringValue==="buyer_1"));
    assert.ok(parts.every(x=>x.fieldFilter.field.fieldPath!=="__name__"));
    if(source==="audit")assert.deepEqual(
      parts[1].fieldFilter.value.arrayValue.values.map(x=>x.stringValue),
      ["purchaseStoreItem","renewStoreItem"]);
    if(source==="ledger")assert.equal(
      parts[1].fieldFilter.value.stringValue,"storePurchase");
  }
  for(const uid of ["","../other","wrong/u","spaces uid","x".repeat(129)])
    assert.throws(()=>storeFinancialCountRequest("receipts",uid),
      /invalid_store_financial_buyer/);
  assert.throws(()=>storeFinancialCountRequest("all","buyer_1"),
    /invalid_store_financial_source/);
});

test("Store source COUNT parser fails closed on corrupt, negative and overflow data",()=>{
  const good=(n)=>[{result:{aggregateFields:{
    matched:{integerValue:String(n)},
  }},readTime:"2026-10-29T18:00:00Z"}];
  for(const n of [0,1,500,501]){
    const res=parseStoreFinancialCountResponse("receipts",good(n));
    assert.deepEqual(res,{count:n,capped:n===501});
  }
  for(const rows of [
    [],null,{},[{result:{aggregateFields:{}}}],
    good(-1),good(502),good("1.5"),good("01"),
    [{result:{aggregateFields:{matched:{doubleValue:100}}}}],
    [...good(1),...good(1)],
  ])assert.throws(()=>parseStoreFinancialCountResponse("ledger",rows),
    /invalid_store_source_count/);
  assert.throws(()=>parseStoreFinancialCountResponse("fake",good(1)),
    /invalid_store_financial_source/);
});

test("Four equal Store source cardinalities are NOT reconciliation or revenue proof",()=>{
  const rows=Object.fromEntries(STORE_COVERAGE_SOURCES
    .map(source=>[source,{count:37,capped:false}]));
  const result=assembleStoreFinancialCoverage(rows);
  assert.deepEqual(result.counts,{
    receipts:37,operations:37,ledger:37,audit:37,
  });
  assert.equal(result.cardinalitiesComparable,true);
  assert.equal(result.sourceCountsEqual,true);
  assert.equal(result.countMismatch,false);
  assert.equal(result.recordsIndividuallyReconciled,false);
  assert.equal(result.financialReportComplete,false);
  assert.equal(result.netRevenueCertified,false);
  assert.equal(result.refundSettlementCertified,false);
  assert.equal(result.partialEvidenceOnly,true);
  assert.equal("grossRevenue" in result,false);
  assert.equal("netCoins" in result,false);
});

test("Source count mismatch and capped ranges do not assert completeness",()=>{
  const rows=Object.fromEntries(STORE_COVERAGE_SOURCES
    .map(source=>[source,{count:4,capped:false}]));
  rows.ledger={count:3,capped:false};
  let result=assembleStoreFinancialCoverage(rows);
  assert.equal(result.countMismatch,true);
  assert.equal(result.sourceCountsEqual,false);
  assert.equal(result.financialReportComplete,false);
  rows.ledger={count:501,capped:true};
  result=assembleStoreFinancialCoverage(rows);
  assert.equal(result.cardinalitiesComparable,false);
  assert.deepEqual(result.cappedSources,["ledger"]);
  assert.equal(result.countMismatch,false);
  assert.equal(result.sourceCountsEqual,false);
  for(const bad of [
    {...rows,ledger:{count:501,capped:false}},
    {...rows,ledger:{count:-1,capped:false}},
    {...rows,audit:null},
    {},
  ])assert.throws(()=>assembleStoreFinancialCoverage(bad),
    /invalid_store_source_count/);
});
