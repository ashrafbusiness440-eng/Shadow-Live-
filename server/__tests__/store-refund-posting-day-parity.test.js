import assert from "node:assert/strict";
import {test} from "node:test";
import {reviewStoreRefundPostingDayPage}
  from "../../cloudflare-worker/src/store-refund-posting-day-review.js";
import {loadStoreRefundPostingDayPageForOwner}
  from "../../cloudflare-worker/src/manage-store-purchases.js";

const day="2026-10-29",nowMs=Date.parse("2026-10-30T08:00:00Z");
const refundAt=Date.parse(day+"T00:01:00Z");
const saleAt=refundAt-86400000,stamp=new Date(saleAt).toISOString();
const uid="buyer_1",productId="200001",amount=12000;
const sources={
  receipts:["store_purchase_receipts","refundedAt",""],
  ledger:["financial_ledger","createdAt","store_refund_"],
  audit:["admin_audit_logs","createdAt","store_refund_"],
};
const run=(db,cursor=null,requestedDay=day)=>
  reviewStoreRefundPostingDayPage(db,{day:requestedDay,cursor,nowMs});

function fixture(count=25){
  const pages=Object.fromEntries(Object.keys(sources).map(k=>[k,[]]));
  const docs=new Map(),queries=[],reads=[];
  for(let i=0;i<count;i++){
    const opId="store_refund_posting_operation_"+String(i).padStart(3,"0");
    const id=uid+"__"+opId,ref="store_refund_"+id;
    const receipt={
      buyerUid:uid,operationId:opId,productId,priceCoins:amount,
      durationDays:0,acquiredAtMs:saleAt,expiresAtMs:null,
      deliveryStatus:"delivered",renewal:false,refundStatus:"refunded",
      refundedCoins:amount,refundedAt:new Date(refundAt),
      refundLedgerId:ref,
    };
    const ledger={
      userId:uid,asset:"coins",sourceType:"storePurchaseRefund",
      reason:"store_item_refund",sourceId:id,idempotencyKey:ref,
      delta:amount,openingBalance:38000,closingBalance:50000,
      createdAt:new Date(refundAt),
    };
    const audit={
      actorUid:"verified_owner",buyerUid:uid,operationId:opId,
      action:"refundStorePurchase",targetType:"store_purchase_receipt",
      targetId:"store_purchase_receipts/"+id,refundedCoins:amount,
      ledgerId:ref,createdAt:new Date(refundAt),
    };
    for(const [source,[collection,,prefix]] of Object.entries(sources)){
      const row={id:prefix+id,data:{receipts:receipt,ledger,audit}[source]};
      pages[source].push(row);
      docs.set(collection+"/"+row.id,row.data);
    }
    docs.set("store_purchase_operations/"+id,{
      buyerUid:uid,productId,kind:"purchase",status:"completed",
      createdAt:stamp,result:{operationId:opId,productId,
        priceCoins:amount,durationDays:0,acquiredAtMs:saleAt,
        expiresAtMs:null,deliveryStatus:"delivered",renewal:false},
    });
    docs.set("financial_ledger/store_"+id,{
      userId:uid,asset:"coins",sourceType:"storePurchase",
      reason:"store_item_purchase",sourceId:id,idempotencyKey:id,
      renewal:false,delta:-amount,openingBalance:50000,
      closingBalance:38000,createdAt:stamp,
    });
    docs.set("admin_audit_logs/store_purchase_"+id,{
      actorUid:uid,action:"purchaseStoreItem",
      targetType:"store_entitlement",
      targetId:"user_store_entitlements/"+uid+"/items/"+productId,
      operationId:opId,priceCoins:amount,createdAt:stamp,
    });
  }
  const db={
    async runQuery(collection,options){
      assert.equal(options.limit,21);
      queries.push({collection,options});
      const source=Object.keys(sources).find(x=>sources[x][0]===collection);
      assert.ok(source,"unknown_collection");
      assert.deepEqual(options.orderBy,[
        {field:sources[source][1],direction:"desc"},
        {field:"__name__",direction:"desc"},
      ]);
      assert.equal(options.filters[0].field,sources[source][1]);
      assert.equal(options.filters[0].op,">=");
      assert.equal(options.filters[1].op,"<");
      if(source==="ledger")assert.deepEqual(options.filters[2],
        {field:"sourceType",op:"==",value:"storePurchaseRefund"});
      if(source==="audit")assert.deepEqual(options.filters[2],
        {field:"action",op:"==",value:"refundStorePurchase"});
      const after=options.startAfter?.[1]?.referencePath?.split("/").at(-1);
      const filtered=pages[source].filter(row=>{
        const t=row.data[sources[source][1]];
        const ms=t instanceof Date?t.getTime():Date.parse(t);
        return ms>=options.filters[0].value.getTime()&&
          ms<options.filters[1].value.getTime();
      }).sort((a,b)=>{
        const field=sources[source][1];
        const aMs=new Date(a.data[field]).getTime();
        const bMs=new Date(b.data[field]).getTime();
        return bMs-aMs||b.id.localeCompare(a.id);
      });
      const index=after?filtered.findIndex(x=>x.id===after):-1;
      if(after&&index===-1)throw Error("invalid_test_cursor");
      return filtered.slice(index+1,index+1+options.limit);
    },
    async get(path){
      reads.push(path);
      if(path==="users/verified_owner")
        return {exists:true,data:{role:"owner",accountStatus:"active"}};
      if(path==="users/readonly_admin")
        return {exists:true,data:{role:"admin",adminEnabled:true,
          accountStatus:"active",capabilities:["viewStorePurchases"]}};
      return {exists:docs.has(path),data:docs.get(path)};
    },
    async commit(){throw Error("financial_write_forbidden");},
    async list(){throw Error("collection_scan_forbidden");},
  };
  return {db,pages,docs,queries,reads};
}
test("25 refund postings reconcile three sources as 20 and 5 pages",async()=>{
  const x=fixture();
  const first=await run(x.db);
  assert.equal(first.scope,"all_buyers_one_utc_refund_posting_day_page");
  assert.equal(first.reviewStatus,"reviewed");
  assert.equal(first.pageRefundedCoins,20*amount);
  assert.equal(first.inspected,20);
  assert.equal(first.hasMore,true);
  assert.equal(first.independentRefundSourceCoverageCertified,false);
  assert.equal(first.financialReportComplete,false);
  assert.equal(x.queries.length,3);
  assert.equal(x.reads.length,120);
  const second=await run(x.db,first.nextCursor);
  assert.equal(second.pageRefundedCoins,5*amount);
  assert.equal(second.inspected,5);
  assert.equal(second.hasMore,false);
  assert.equal(second.nextCursor,null);
  assert.equal(second.allPagesReviewed,false);
  assert.equal(x.queries.length,6);
  assert.equal(x.reads.length,150);
  for(const name of Object.keys(sources)){
    const follow=x.queries.slice(3).find(q=>q.collection===sources[name][0]);
    assert.equal(follow.options.startAfter.length,2);
    assert.equal(follow.options.startAfter[0] instanceof Date,true);
    assert.equal(follow.options.startAfter[1].referencePath,
      sources[name][0]+"/"+sources[name][2]+uid+
      "__store_refund_posting_operation_005");
  }
});
test("empty refund posting day is not financial-period certification",async()=>{
  const x=fixture(0),row=await run(x.db);
  assert.equal(row.reviewStatus,"reviewed");
  assert.equal(row.pageRefundedCoins,0);
  assert.equal(row.independentRefundSourceCoverageCertified,false);
  assert.equal(x.queries.length,3);
  assert.equal(x.reads.length,0);
});
test("orphan, missing or altered source suppresses all financial amounts",async()=>{
  for(const fault of ["missing_ledger","orphan_audit","wrong_time",
    "wrong_amount","bad_refund_status","bad_credit_proof"]){
    const x=fixture(25),id=uid+"__store_refund_posting_operation_019";
    if(fault==="missing_ledger")x.pages.ledger.splice(8,1);
    if(fault==="orphan_audit")
      x.pages.audit[10].id="store_refund_"+uid+
        "__store_refund_orphan_999";
    if(fault==="wrong_time")
      x.pages.audit[6].data.createdAt=new Date(refundAt+1000);
    // Queries use ID DESC: index 24 is on page 1; index 0 is page 2.
    if(fault==="wrong_amount")
      x.pages.receipts[24].data.refundedCoins=amount+1;
    if(fault==="bad_refund_status")
      x.pages.receipts[24].data.refundStatus="requested";
    if(fault==="bad_credit_proof")
      x.docs.get("financial_ledger/store_refund_"+id).closingBalance=1;
    const result=await run(x.db);
    assert.equal(result.reviewStatus,"blocked",fault);
    assert.equal(result.pageAmountsAvailable,false,fault);
    assert.equal("pageRefundedCoins" in result,false,fault);
  }
});
test("the independently discovered 21st entry matches in all sources",async()=>{
  const x=fixture();
  x.pages.ledger[20].id="store_refund_"+uid+"__another_operation_001";
  const r=await run(x.db);
  assert.equal(r.reviewStatus,"blocked");
  assert.equal("pageRefundedCoins" in r,false);
});
test("forged, invalid and cross-day cursors rejected before query",async()=>{
  const x=fixture(),first=await run(x.db);
  const parsed=JSON.parse(atob(first.nextCursor));
  const before=x.queries.length;
  for(const cursor of ["invalid_base64", "x".repeat(700),
    btoa(JSON.stringify({...parsed,day:"2026-10-28"})),
    btoa(JSON.stringify({...parsed,atMs:0})),
    btoa(JSON.stringify({...parsed,uid:"../bad"})),
    btoa(JSON.stringify({...parsed,id:"someone_else__"+parsed.opId})),
  ]){
    await assert.rejects(()=>run(x.db,cursor),
      /invalid_store_refund_posting_cursor/);
    assert.equal(x.queries.length,before);
  }
});
test("Owner + recent auth gate excludes delegated admin and stale sessions",async()=>{
  const x=fixture(1);
  const current=Math.floor(Date.now()/1000);
  const owner={sub:"verified_owner",auth_time:current,iat:current};
  const valid=await loadStoreRefundPostingDayPageForOwner(x.db,owner,day);
  assert.equal(valid.reviewStatus,"reviewed");
  const queries=x.queries.length;
  await assert.rejects(()=>loadStoreRefundPostingDayPageForOwner(x.db,
    {...owner,sub:"readonly_admin"},day),/forbidden/);
  await assert.rejects(()=>loadStoreRefundPostingDayPageForOwner(x.db,
    {...owner,auth_time:1},day),/recent_auth_required/);
  assert.equal(x.queries.length,queries);
});
