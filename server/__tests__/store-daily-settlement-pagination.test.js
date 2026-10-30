import assert from "node:assert/strict";
import {test} from "node:test";
import {reviewStoreDailySettlementPage}
  from "../../cloudflare-worker/src/store-daily-settlement-report.js";

const day="2026-10-29";
const nowMs=Date.parse("2026-10-30T08:00:00Z");
const at=Date.parse(day+"T00:00:00Z")+60000;
const uid="buyer_1",productId="200001",price=12000;
const config={
  receipts:["store_purchase_receipts","acquiredAtMs",""],
  operations:["store_purchase_operations","createdAt",""],
  ledger:["financial_ledger","createdAt","store_"],
  audit:["admin_audit_logs","createdAt","store_purchase_"],
};
const run=(db,cursor=null,requestedDay=day)=>
  reviewStoreDailySettlementPage(db,{day:requestedDay,cursor,nowMs});
function fixture(count=25){
  const lists=Object.fromEntries(Object.keys(config).map(x=>[x,[]]));
  const canonical=new Map(),queries=[],reads=[];
  const stamp=new Date(at).toISOString();
  for(let i=0;i<count;i++){
    const opId="store_daily_paged_operation_"+String(i).padStart(3,"0");
    const id=uid+"__"+opId;
    const data={
      receipts:{buyerUid:uid,operationId:opId,productId,
        priceCoins:price,acquiredAtMs:at,
        expiresAtMs:null,durationDays:0,deliveryStatus:"delivered",
        renewal:false,refundStatus:"none"},
      operations:{buyerUid:uid,productId,kind:"purchase",
        status:"completed",result:{
          operationId:opId,productId,priceCoins:price,
          acquiredAtMs:at,expiresAtMs:null,durationDays:0,
          deliveryStatus:"delivered",renewal:false,
        },createdAt:stamp},
      ledger:{userId:uid,sourceType:"storePurchase",
        asset:"coins",delta:-price,openingBalance:50000,
        closingBalance:38000,reason:"store_item_purchase",
        sourceId:id,idempotencyKey:id,renewal:false,createdAt:stamp},
      audit:{actorUid:uid,targetType:"store_entitlement",
        targetId:"user_store_entitlements/"+uid+"/items/"+productId,
        action:"purchaseStoreItem",operationId:opId,
        priceCoins:price,createdAt:stamp},
    };
    for(const [source,[collection,,prefix]] of Object.entries(config)){
      const name=prefix+id;
      const row={id:name,data:data[source]};
      lists[source].push(row);
      canonical.set(collection+"/"+name,data[source]);
    }
  }
  for(const source of Object.keys(lists)){
    lists[source].sort((a,b)=>b.id.localeCompare(a.id));
  }
  const db={
    async runQuery(collection,options){
      const source=Object.keys(config)
        .find(x=>config[x][0]===collection);
      if(!source)throw Error("unexpected_collection");
      queries.push({source,collection,options});
      let index=0;
      if(options.startAfter?.length){
        const last=options.startAfter[1]?.referencePath
          ?.split("/").at(-1);
        const atIndex=lists[source].findIndex(row=>row.id===last);
        if(atIndex<0)throw Error("cursor_not_in_source");
        index=atIndex+1;
      }
      return lists[source].slice(index,index+options.limit);
    },
    async get(path){
      reads.push(path);
      return {exists:canonical.has(path),data:canonical.get(path)};
    },
    async commit(){throw Error("financial_write_forbidden");},
    async list(){throw Error("collection_scan_forbidden");},
  };
  return {db,lists,canonical,queries,reads};
}
test("25 purchases review as 20 + 5, four source pages in aligned order",async()=>{
  const x=fixture();
  const first=await run(x.db);
  assert.equal(first.scope,
    "all_buyers_one_utc_day_four_source_settlement_page");
  assert.equal(first.reviewStatus,"reviewed");
  assert.equal(first.inspected,20);
  assert.equal(first.pageGrossCoins,240000);
  assert.equal(first.pageRefundedCoins,0);
  assert.equal(first.pageNetCoins,240000);
  assert.equal(first.hasMore,true);
  assert.equal(typeof first.nextCursor,"string");
  assert.equal(first.financialReportComplete,false);
  assert.equal(first.cursorSnapshotCertified,false);
  assert.equal(first.allPagesReviewed,false);
  assert.equal(first.accountingBasis,
    "sale_day_cohort_current_refund_state");
  assert.equal(first.refundPostingDayCertified,false);
  assert.equal(first.independentRefundSourceCoverageCertified,false);
  assert.equal(x.queries.length,4);
  assert.equal(x.reads.length,120);
  const second=await run(x.db,first.nextCursor);
  assert.equal(second.reviewStatus,"reviewed");
  assert.equal(second.inspected,5);
  assert.equal(second.hasMore,false);
  assert.equal(second.nextCursor,null);
  assert.equal(second.pageGrossCoins,60000);
  assert.equal(second.pageNetCoins,60000);
  assert.equal(second.allPagesReviewed,false);
  assert.equal(x.queries.length,8);
  assert.equal(x.reads.length,150);
  for(const source of Object.keys(config)){
    const firstQuery=x.queries.find(x=>x.source===source);
    const secondQuery=x.queries.find((x,i)=>i>=4&&x.source===source);
    assert.equal(firstQuery.options.limit,21);
    assert.deepEqual(firstQuery.options.startAfter,[]);
    assert.equal(secondQuery.options.startAfter.length,2);
    assert.equal(secondQuery.options.startAfter[0] instanceof Date,
      source!=="receipts");
    assert.equal(secondQuery.options.startAfter[1].referencePath,
      config[source][0]+"/"+
      (config[source][2]||"")+uid+
      "__store_daily_paged_operation_005");
  }
});
test("zero-operation day has one reviewed empty page without certified close",async()=>{
  const x=fixture(0);
  const r=await run(x.db);
  assert.equal(r.inspected,0);
  assert.equal(r.pageNetCoins,0);
  assert.equal(r.hasMore,false);
  assert.equal(r.financialReportComplete,false);
  assert.equal(x.queries.length,4);
  assert.equal(x.reads.length,0);
});
test("mismatched 21st extra row blocks pagination rather than losing operations",async()=>{
  const x=fixture();
  x.lists.audit[20].id="store_purchase_"+uid+"__other_operation_missing";
  const r=await run(x.db);
  assert.equal(r.reviewStatus,"blocked");
  assert.equal(r.periodAmountsAvailable,false);
  assert.equal("pageNetCoins" in r,false);
  assert.equal(r.blockingReason,"invalid_source_page_boundary");
});
test("one source has no next page: refuse false completeness",async()=>{
  const x=fixture();
  x.lists.audit.splice(20);
  const r=await run(x.db);
  assert.equal(r.reviewStatus,"blocked");
  assert.equal(r.blockingReason,"source_page_boundary_mismatch");
  assert.equal("pageGrossCoins" in r,false);
});
test("middle source orphan/missing operation cannot offset cursor",async()=>{
  const x=fixture();
  x.lists.ledger.splice(8,1);
  const r=await run(x.db);
  assert.equal(r.reviewStatus,"blocked");
  assert.ok(["source_operation_ids_mismatch",
    "source_page_boundary_mismatch"].includes(r.blockingReason));
  assert.equal("pageNetCoins" in r,false);
});
test("different indexed timestamp in a source fails without page amounts",async()=>{
  const x=fixture();
  x.lists.operations[5].data.createdAt=new Date(at+300).toISOString();
  const r=await run(x.db);
  assert.equal(r.reviewStatus,"blocked");
  assert.equal(r.blockingReason,"source_page_order_or_time_mismatch");
  assert.equal("pageNetCoins" in r,false);
});
test("invalid, cross-day and forged cursor cannot query a collection",async()=>{
  const x=fixture();
  const first=await run(x.db);
  const before=x.queries.length;
  const value=JSON.parse(atob(first.nextCursor));
  for(const raw of [
    "not-base64",
    btoa(JSON.stringify({...value,day:"2026-10-28"})),
    btoa(JSON.stringify({...value,atMs:0})),
    btoa(JSON.stringify({...value,uid:"../not-valid"})),
    btoa(JSON.stringify({...value,id:"other_user__"+value.opId})),
    "z".repeat(700),
  ]){
    await assert.rejects(()=>run(x.db,raw),
      /invalid_store_settlement_cursor/);
    assert.equal(x.queries.length,before);
  }
});
test("refund pending or orphan credit in 6-doc proofs cannot show page totals",async()=>{
  for(const fault of ["refund_pending","unexpected_credit","missing_sale"]){
    const x=fixture(2);
    const id=uid+"__store_daily_paged_operation_001";
    if(fault==="refund_pending")
      x.canonical.get("store_purchase_receipts/"+id)
        .refundStatus="requested";
    if(fault==="unexpected_credit")
      x.canonical.set("financial_ledger/store_refund_"+id,
        {delta:price});
    if(fault==="missing_sale")
      x.canonical.delete("financial_ledger/store_"+id);
    const r=await run(x.db);
    assert.equal(r.reviewStatus,"blocked");
    assert.equal("pageNetCoins" in r,false);
  }
});
