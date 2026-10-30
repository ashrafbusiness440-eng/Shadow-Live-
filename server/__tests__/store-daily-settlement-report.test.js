import assert from "node:assert/strict";
import {test} from "node:test";
import {
  reviewStoreDailySettlement,STORE_DAILY_SETTLEMENT_MAX,
} from "../../cloudflare-worker/src/store-daily-settlement-report.js";

const day="2026-10-29";
const nowMs=Date.parse("2026-10-30T08:00:00Z");
const start=Date.parse(day+"T00:00:00Z");
const uid="buyer_1",op="store_daily_ledger_match_001";
const key=uid+"__"+op;
const productId="200001";
const docs={
  receipts:"store_purchase_receipts/"+key,
  operations:"store_purchase_operations/"+key,
  ledger:"financial_ledger/store_"+key,
  audit:"admin_audit_logs/store_purchase_"+key,
  refundLedger:"financial_ledger/store_refund_"+key,
  refundAudit:"admin_audit_logs/store_refund_"+key,
};
const sources={
  receipts:"store_purchase_receipts",
  operations:"store_purchase_operations",
  ledger:"financial_ledger",
  audit:"admin_audit_logs",
};
function fixture({refunded=false}={}){
  const at=start+60000,stamp=new Date(at).toISOString();
  const rows={
    receipts:{buyerUid:uid,operationId:op,productId,priceCoins:12000,
      acquiredAtMs:at,expiresAtMs:null,durationDays:0,
      deliveryStatus:"delivered",renewal:false,
      refundStatus:refunded?"refunded":"none",
      ...(refunded?{refundedAt:new Date(at+30000)}:{})},
    operations:{buyerUid:uid,productId,kind:"purchase",status:"completed",
      result:{operationId:op,productId,priceCoins:12000,
        acquiredAtMs:at,durationDays:0,expiresAtMs:null,
        deliveryStatus:"delivered",renewal:false},createdAt:stamp},
    ledger:{userId:uid,asset:"coins",delta:-12000,
      sourceType:"storePurchase",reason:"store_item_purchase",
      sourceId:key,idempotencyKey:key,renewal:false,
      openingBalance:50000,closingBalance:38000,createdAt:stamp},
    audit:{actorUid:uid,targetType:"store_entitlement",
      targetId:"user_store_entitlements/"+uid+"/items/"+productId,
      action:"purchaseStoreItem",operationId:op,priceCoins:12000,
      createdAt:stamp},
  };
  const canonical=new Map([
    [docs.receipts,rows.receipts],
    [docs.operations,rows.operations],
    [docs.ledger,rows.ledger],
    [docs.audit,rows.audit],
  ]);
  if(refunded){
    canonical.set(docs.refundLedger,{
      userId:uid,asset:"coins",sourceType:"storePurchaseRefund",
      reason:"store_item_refund",sourceId:key,
      idempotencyKey:"store_refund_"+key,delta:12000,
      openingBalance:38000,closingBalance:50000,
      createdAt:new Date(at+30000),
    });
    canonical.set(docs.refundAudit,{
      actorUid:"the_owner",buyerUid:uid,operationId:op,
      action:"refundStorePurchase",
      targetType:"store_purchase_receipt",targetId:docs.receipts,
      refundedCoins:12000,ledgerId:"store_refund_"+key,
      createdAt:new Date(at+30000),
    });
  }
  const indexed=Object.fromEntries(Object.keys(sources).map(source=>[
    source,[{id:docs[source].split("/")[1],data:{...rows[source]}}],
  ]));
  const queries=[],reads=[];
  const db={
    async runQuery(collection,options){
      queries.push({collection,options});
      const source=Object.keys(sources).find(k=>sources[k]===collection &&
        !(k==="ledger" && options.filters.some(f=>
          f.field==="sourceType"&&f.value!=="storePurchase")));
      return indexed[source]||[];
    },
    async get(p){
      reads.push(p);
      return {exists:canonical.has(p),data:canonical.get(p)};
    },
    async list(){throw Error("unbounded_scan_not_allowed");},
    async commit(){throw Error("financial_write_not_allowed");},
  };
  return {db,indexed,canonical,queries,reads};
}
const run=(db)=>reviewStoreDailySettlement(db,{day,nowMs});

test("one UTC-day reconciles all four indexed source IDs, gross/refund/net exact proof",async()=>{
  for(const refunded of [false,true]){
    const x=fixture({refunded});
    const r=await run(x.db);
    assert.equal(STORE_DAILY_SETTLEMENT_MAX,20);
    assert.equal(r.scope,"all_buyers_one_completed_utc_day_four_source_settlement");
    assert.equal(r.reviewStatus,"reviewed");
    assert.equal(r.periodAmountsAvailable,true);
    assert.equal(r.inspected,1);
    assert.equal(r.verified,1);
    assert.equal(r.reviewedGrossCoins,12000);
    assert.equal(r.reviewedRefundedCoins,refunded?12000:0);
    assert.equal(r.reviewedNetCoins,refunded?0:12000);
    assert.equal(r.reviewedPurchases,1);
    assert.equal(r.reviewedRenewals,0);
    assert.equal(r.financialReportComplete,false);
    assert.equal(r.netRevenueCertified,false);
    assert.equal(r.refundSettlementCertified,false);
    assert.equal(r.snapshotIsolationCertified,false);
    assert.equal(r.historicalDateCoverageCertified,false);
    assert.equal(r.externalChargebacksCertified,false);
    assert.equal(r.productionFinancialWritesPerformed,false);
    assert.equal(x.queries.length,4);
    assert.equal(x.reads.length,6);
    for(const {collection,options} of x.queries){
      assert.equal(options.limit,21);
      assert.equal(options.orderBy[0].direction,"desc");
      assert.equal(options.orderBy[1].field,"__name__");
      assert.equal(options.filters[0].op,">=");
      assert.equal(options.filters[1].op,"<");
      if(collection==="financial_ledger")
        assert.deepEqual(options.filters[2],
          {field:"sourceType",op:"==",value:"storePurchase"});
      if(collection==="admin_audit_logs")
        assert.deepEqual(options.filters[2],
          {field:"action",op:"in",value:[
            "purchaseStoreItem","renewStoreItem",
          ]});
    }
    assert.equal("userId" in r,false);
    assert.equal("openingBalance" in r,false);
  }
});
test("zero records yields zero reviewed amounts but never certified global revenue",async()=>{
  const x=fixture();
  for(const s of Object.keys(x.indexed))x.indexed[s]=[];
  const r=await run(x.db);
  assert.equal(r.reviewStatus,"reviewed");
  assert.equal(r.reviewedGrossCoins,0);
  assert.equal(r.reviewedNetCoins,0);
  assert.equal(r.fullPeriodSettlementCertified,false);
  assert.equal(x.reads.length,0);
});
test("one mismatched independent operation identity blocks whole period totals",async()=>{
  for(const source of ["receipts","operations","ledger","audit"]){
    const x=fixture();
    x.indexed[source]=[];
    const r=await run(x.db);
    assert.equal(r.reviewStatus,"blocked");
    assert.equal(r.blockingReason,"source_operation_ids_mismatch");
    assert.equal(r.periodAmountsAvailable,false);
    assert.equal("reviewedNetCoins" in r,false);
    assert.equal(x.reads.length,0);
  }
});
test("bad individual ledger/refund evidence cannot produce partial totals",async()=>{
  for(const fault of [
    "operation_missing","ledger_debit_changed","refund_pending",
    "refund_audit_missing","refund_wrong_credit","receipt_snapshot_changed",
    "audit_snapshot_changed","operation_snapshot_changed",
  ]){
    const x=fixture({refunded:fault.startsWith("refund_")&&
      !["refund_pending"].includes(fault)});
    if(fault==="operation_missing")x.canonical.delete(docs.operations);
    if(fault==="ledger_debit_changed")
      x.canonical.get(docs.ledger).delta=-11000;
    if(fault==="refund_pending"){
      x.canonical.get(docs.receipts).refundStatus="requested";
      x.indexed.receipts[0].data.refundStatus="requested";
    }
    if(fault==="refund_audit_missing")x.canonical.delete(docs.refundAudit);
    if(fault==="refund_wrong_credit")
      x.canonical.get(docs.refundLedger).delta=11999;
    if(fault==="receipt_snapshot_changed")
      x.indexed.receipts[0].data.priceCoins=11900;
    if(fault==="audit_snapshot_changed")
      x.indexed.audit[0].data.priceCoins=11900;
    if(fault==="operation_snapshot_changed")
      x.indexed.operations[0].data.kind="renew";
    const r=await run(x.db);
    assert.equal(r.reviewStatus,"blocked",fault);
    assert.equal("reviewedNetCoins" in r,false,fault);
  }
});
test("21st source row prevents a falsely complete day",async()=>{
  for(const source of Object.keys(sources)){
    const x=fixture();
    x.indexed[source]=Array.from({length:21},(_,i)=>({
      ...x.indexed[source][0],
      id:x.indexed[source][0].id+"_"+i,
    }));
    const r=await run(x.db);
    assert.equal(r.blockingReason,"day_exceeds_safe_operation_limit");
    assert.equal(r.periodAmountsAvailable,false);
    assert.equal("reviewedGrossCoins" in r,false);
  }
});
test("invalid indexed date, duplicate id or invalid identity blocks all sums",async()=>{
  for(const fault of ["date","duplicate","identity"]){
    const x=fixture();
    if(fault==="date")x.indexed.operations[0].data.createdAt=
      "2026-10-30T00:00:00Z";
    if(fault==="duplicate")x.indexed.audit.push(x.indexed.audit[0]);
    if(fault==="identity")x.indexed.receipts[0].data.buyerUid=
      "not_original";
    const r=await run(x.db);
    assert.equal(r.reviewStatus,"blocked");
    assert.equal("reviewedNetCoins" in r,false);
  }
});
test("future, current and invalid days fail before any Firestore query",async()=>{
  const x=fixture();
  for(const wrong of ["2026-10-30","2026-10-31",
    "not-a-day","2024-01-01"]){
    await assert.rejects(()=>reviewStoreDailySettlement(x.db,{
      day:wrong,nowMs,
    }),/invalid_store_global_day/);
  }
  assert.equal(x.queries.length,0);
});
