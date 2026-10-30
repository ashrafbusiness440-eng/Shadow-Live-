import assert from "node:assert/strict";
import {test} from "node:test";
import {reviewStoreGlobalDailyPage}
  from "../../cloudflare-worker/src/store-global-daily-financial-review.js";

const day="2026-10-29";
const nowMs=Date.parse("2026-10-30T06:00:00.000Z");
const start=Date.parse(day+"T00:00:00.000Z");
const op="store_purchase_global_evidence_0001";
const uid="account_buyer_1";
const key=uid+"__"+op;
const path={
  operations:"store_purchase_operations/"+key,
  receipts:"store_purchase_receipts/"+key,
  ledger:"financial_ledger/store_"+key,
  audit:"admin_audit_logs/store_purchase_"+key,
};
function fixture(source,opts={}){
  const createdAt=new Date(start+60000).toISOString();
  const docs=new Map([
    [path.operations,{buyerUid:uid,productId:"200001",status:"completed",
      kind:"purchase",result:{
        operationId:op,productId:"200001",priceCoins:14000,
        acquiredAtMs:start+60000,durationDays:0,
        expiresAtMs:null,deliveryStatus:"delivered",renewal:false,
      }}],
    [path.receipts,{buyerUid:uid,operationId:op,productId:"200001",
      priceCoins:14000,acquiredAtMs:start+60000,
      expiresAtMs:null,durationDays:0,deliveryStatus:"delivered",
      refundStatus:"none",renewal:false}],
    [path.ledger,{userId:uid,asset:"coins",delta:-14000,
      reason:"store_item_purchase",sourceType:"storePurchase",
      sourceId:key,idempotencyKey:key,openingBalance:50000,
      closingBalance:36000,renewal:false}],
    [path.audit,{actorUid:uid,targetType:"store_entitlement",
      targetId:"user_store_entitlements/"+uid+"/items/200001",
      action:"purchaseStoreItem",operationId:op,priceCoins:14000}],
  ]);
  const pageEntry={
    id:path[source].split("/")[1],
    data:{...docs.get(path[source]),
      ...(source==="receipts"?{}:{createdAt})},
  };
  const reads=[];
  const db={
    async get(p){
      reads.push(p);
      return {exists:docs.has(p),data:docs.get(p)};
    },
    async runQuery(c,options){
      reads.push({c,options});
      return opts.rows||[pageEntry];
    },
    commit(){throw Error("must_not_write");},
    list(){throw Error("must_not_scan");},
  };
  return {db,docs,reads,pageEntry};
}

test("global Owner report scans only one UTC day, one indexed source and ten rows",async()=>{
  const expected={receipts:"acquiredAtMs",
    operations:"createdAt",ledger:"createdAt",audit:"createdAt"};
  for(const source of Object.keys(expected)){
    const {db,reads}=fixture(source);
    const result=await reviewStoreGlobalDailyPage(
      db,{day,source,nowMs});
    assert.equal(result.scope,"all_buyers_one_day_one_source_page");
    assert.equal(result.day,day);
    assert.equal(result.source,source);
    assert.equal(result.inspected,1);
    assert.equal(result.verified,1);
    assert.equal(result.needsReview,0);
    assert.equal(result.verifiedPurchaseCoins,14000);
    assert.equal(result.verifiedRenewalCoins,0);
    assert.equal(result.hasMore,false);
    assert.equal(result.financialReportComplete,false);
    assert.equal(result.netRevenueCertified,false);
    assert.equal(result.refundSettlementCertified,false);
    assert.equal(result.legacyBackfillCertified,false);
    assert.equal(result.missingDateFieldsNotCovered,true);
    assert.equal(reads.length,5);
    const query=reads[0];
    assert.equal(query.c,path[source].split("/")[0]);
    assert.equal(query.options.limit,11);
    assert.deepEqual(query.options.orderBy,[
      {field:expected[source],direction:"desc"},
      {field:"__name__",direction:"desc"},
    ]);
    assert.deepEqual(query.options.filters.slice(0,2).map(x=>x.op),
      [">=","<"]);
    if(source==="ledger"){
      assert.deepEqual(query.options.filters[2],
        {field:"sourceType",op:"==",value:"storePurchase"});
    }
    if(source==="audit"){
      assert.deepEqual(query.options.filters[2],
        {field:"action",op:"in",value:[
          "purchaseStoreItem","renewStoreItem"]});
    }
    assert.equal(JSON.stringify(result).includes("openingBalance"),false);
    assert.equal(JSON.stringify(result).includes("closingBalance"),false);
  }
});

test("global daily pages reject orphan source debits and refund across buyers",async()=>{
  for(const source of ["receipts","operations","ledger","audit"]){
    for(const fault of ["missing_receipt","refund"]){
      const {db,docs}=fixture(source);
      if(fault==="missing_receipt")docs.delete(path.receipts);
      if(fault==="refund")docs.get(path.receipts).refundStatus="requested";
      const r=await reviewStoreGlobalDailyPage(db,{day,source,nowMs});
      assert.equal(r.verified,0);
      assert.equal(r.needsReview,1);
      assert.equal(r.verifiedPurchaseCoins,0);
      assert.equal(r.financialReportComplete,false);
      assert.ok(["incomplete_evidence","requires_refund_review"]
        .includes(r.evidence[0].code));
    }
  }
});

test("global daily Owner bounded page cursor binds day, source and document",async()=>{
  const {db,pageEntry,reads}=fixture("operations");
  let round=0;
  db.runQuery=async(c,options)=>{
    reads.push({c,options});
    round++;
    if(round===1)return Array.from({length:11},(_,i)=>({
      ...pageEntry,id:pageEntry.id+"_"+String(i).padStart(2,"0"),
      data:{...pageEntry.data,result:{
        ...pageEntry.data.result,
        operationId:op+"_"+String(i).padStart(2,"0"),
      }},
    }));
    return [];
  };
  const first=await reviewStoreGlobalDailyPage(db,{
    day,source:"operations",nowMs});
  assert.equal(first.inspected,10);
  assert.equal(first.hasMore,true);
  assert.equal(first.paginationBlocked,false);
  assert.ok(first.nextCursor);
  const second=await reviewStoreGlobalDailyPage(db,{
    day,source:"operations",cursor:first.nextCursor,nowMs});
  assert.equal(second.inspected,0);
  assert.deepEqual(reads.filter(x=>typeof x==="object")[1]
    .options.startAfter,[
    new Date(start+60000),
    {referencePath:path.operations+"_09"},
  ]);
  await assert.rejects(()=>reviewStoreGlobalDailyPage(db,{
    day:"2026-10-28",source:"operations",
    cursor:first.nextCursor,nowMs}),/invalid_store_global_cursor/);
  await assert.rejects(()=>reviewStoreGlobalDailyPage(db,{
    day,source:"audit",cursor:first.nextCursor,nowMs}),
    /invalid_store_global_cursor/);
});

test("global daily report never hides malformed cursor or partial last row",async()=>{
  const {db,pageEntry}=fixture("receipts");
  db.runQuery=async()=>Array.from({length:11},(_,i)=>({
    ...pageEntry,id:i===9?"../bad":pageEntry.id+"_"+i,
  }));
  const r=await reviewStoreGlobalDailyPage(db,{
    day,source:"receipts",nowMs});
  assert.equal(r.hasMore,true);
  assert.equal(r.nextCursor,null);
  assert.equal(r.paginationBlocked,true);
  assert.equal(r.financialReportComplete,false);
});

test("global daily report refuses unbounded day, future, today and forged scope",async()=>{
  const {db,reads}=fixture("audit");
  for(const invalid of ["2026-10-30","2026-10-31","2024-01-01",
    "2026-02-29","2026-10-32","notaday"]){
    await assert.rejects(()=>reviewStoreGlobalDailyPage(db,{
      day:invalid,source:"audit",nowMs}),/invalid_store_global_day/);
  }
  await assert.rejects(()=>reviewStoreGlobalDailyPage(db,{
    day,source:"all",nowMs}),/invalid_store_global_source/);
  await assert.rejects(()=>reviewStoreGlobalDailyPage(db,{
    day,source:"audit",cursor:"../../bad",nowMs}),
    /invalid_store_global_cursor/);
  assert.equal(reads.length,0);
});
