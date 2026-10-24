import assert from "node:assert/strict";
import test from "node:test";
import {readFileSync} from "node:fs";
import {
  inspectAccountFinancialReviewPage as inspect,
  FINANCIAL_REVIEW_SCOPES,
  MAX_FINANCIAL_REVIEW_PAGE,
} from "../../cloudflare-worker/src/account-deletion-financial-review-pages.js";

const uid="deleted_finance_user",other="another_finance_user";
const requestId="finance_delete_request_1234";
const req="account_deletion_requests/"+uid;
const cp="account_deletion_erasure_checkpoints/"+uid;
const account="users/"+uid;
const actor={owner:true,uid:"platform_owner_123"};
const id=i=>"finance_record_"+String(i).padStart(3,"0");
class Db {
  constructor(){
    this.docs=new Map([
      [req,{uid,requestId,status:"review_ready"}],
      [cp,{uid,requestId,phase:"preflight_blocked",destructiveAllowed:false}],
      [account,{role:"user",coins:200,diamonds:3}],
    ]);
    this.queries=[];this.reads=[];this.writes=0;
  }
  async get(path){this.reads.push(path);
    return {exists:this.docs.has(path),data:this.docs.get(path)??null};}
  async runQuery(collection,opts){
    this.queries.push({collection,opts});
    const prefix=collection+"/";
    let rows=[...this.docs].filter(([path,record])=>
      path.startsWith(prefix)&&!path.slice(prefix.length).includes("/") &&
      (opts.filters[0].op==="array-contains"
        ? Array.isArray(record[opts.filters[0].field]) &&
          record[opts.filters[0].field].includes(opts.filters[0].value)
        : record[opts.filters[0].field]===opts.filters[0].value))
      .map(([path,data])=>({id:path.slice(prefix.length),data}))
      .sort((a,b)=>a.id.localeCompare(b.id));
    if(opts.startAfter.length){
      const marker=opts.startAfter[0].referencePath.slice(prefix.length);
      rows=rows.filter(row=>row.id>marker);
    }
    return rows.slice(0,opts.limit);
  }
}
const run=(db,patch={})=>inspect(db,{
  uid,requestId,actor,scope:"ledger",...patch,
});

test("all eight writer-based financial query scopes are defined",()=>{
  assert.deepEqual(Object.keys(FINANCIAL_REVIEW_SCOPES),[
    "purchase","ledger","ledger_counterparty",
    "ledger_counterparty_group","gift_sender","gift_recipient",
    "wallet_sender","wallet_recipient",
  ]);
});
test("ledger five/five/one cursor paging without leaking amounts or modifying balances",async()=>{
  const db=new Db();
  for(let i=0;i<11;i++)db.docs.set("financial_ledger/"+id(i),{
    userId:uid,delta:i+20,reason:"sensitive_financial",
    sourceId:"sensitive_history",createdAt:new Date(),
  });
  db.docs.set("financial_ledger/other_person_record",{
    userId:other,delta:999,
  });
  const sizes=[];let cursor=null;
  for(let i=0;i<3;i++){
    const page=await run(db,{cursor});
    sizes.push(page.checked);cursor=page.nextCursor;
    assert.equal(page.erasureAllowed,false);
    assert.equal(page.completionVerified,false);
    assert.equal(page.financialSettlementVerified,false);
    assert.equal(page.items.every(item=>item.recordReviewRequired),true);
    assert.equal(page.items.every(item=>
      item.financialSettlementVerified===false),true);
    assert.equal(JSON.stringify(page).includes("sensitive_financial"),false);
    assert.equal(JSON.stringify(page).includes("sensitive_history"),false);
  }
  assert.deepEqual(sizes,[5,5,1]);
  assert.equal(cursor,null);
  assert.deepEqual(db.queries.map(q=>q.opts.limit),[6,6,6]);
  assert.equal(db.docs.get(account).coins,200);
  assert.equal(db.docs.get("financial_ledger/other_person_record").delta,999);
  assert.equal(db.writes,0);
});
test("Google Play purchase reviews compare exact ledger and never certify refund",async()=>{
  const db=new Db();
  for(let i=0;i<3;i++){
    const hash=id(i);
    db.docs.set("google_play_purchases/"+hash,{
      uid,tokenHash:hash,status:"credited",refundState:"none",
      disputeState:"none",orderId:"sensitive_order_"+i,
      purchaseToken:"secret_token_"+i,
    });
    if(i<2)db.docs.set("financial_ledger/play_"+hash,{
      userId:uid,sourceType:"googlePlayPurchase",sourceId:hash,
      reason:"google_play_recharge",delta:100,
    });
  }
  db.docs.get("google_play_purchases/"+id(1)).disputeState="pending";
  const page=await run(db,{scope:"purchase"});
  assert.equal(page.checked,3);
  assert.deepEqual(page.items.map(x=>x.ledgerLinked),[true,true,false]);
  assert.deepEqual(page.items.map(x=>x.billingUnresolved),[false,true,false]);
  assert.equal(page.items.every(x=>!x.financialSettlementVerified),true);
  assert.equal(JSON.stringify(page).includes("sensitive_order_"),false);
  assert.equal(JSON.stringify(page).includes("secret_token_"),false);
  assert.equal(db.queries[0].collection,"google_play_purchases");
  assert.equal(db.reads.filter(p=>p.startsWith("financial_ledger/play_")).length,3);
});
test("ledger group and transfer counterpart indexes never expose other people",async()=>{
  for(const [scope,field,value,collection] of [
    ["ledger_counterparty","counterpartyUid",uid,"financial_ledger"],
    ["ledger_counterparty_group","counterpartyUids",[uid,other],"financial_ledger"],
    ["gift_sender","senderId",uid,"gift_transactions"],
    ["gift_recipient","receiverId",uid,"gift_transactions"],
    ["wallet_sender","senderUid",uid,"wallet_transfers"],
    ["wallet_recipient","recipientUid",uid,"wallet_transfers"],
  ]){
    const db=new Db();
    db.docs.set(collection+"/"+id(4),{
      [field]:value,anotherUid:other,coins:750,
    });
    const page=await run(db,{scope});
    assert.equal(page.checked,1);
    assert.equal(JSON.stringify(page).includes(other),false);
    assert.equal(JSON.stringify(page).includes("750"),false);
    assert.equal(page.items[0].recordReviewRequired,true);
    assert.equal(db.queries[0].opts.filters[0].op,
      scope==="ledger_counterparty_group"?"array-contains":"==");
  }
});
test("holds, deleted account and stale request fail before query",async()=>{
  const cases=[
    d=>d.docs.get(req).status="cancelled",
    d=>d.docs.get(req).requestId="other_request_12345",
    d=>d.docs.get(req).investigationHold=true,
    d=>d.docs.get(cp).requestId="other_request_12345",
    d=>d.docs.get(cp).reported=true,
    d=>d.docs.get(account).role="owner",
    d=>d.docs.get(account).authDeleted=true,
    d=>d.docs.get(account).legalHold=true,
  ];
  for(const modify of cases){
    const db=new Db();modify(db);
    await assert.rejects(run(db),e=>e.code==="financial_review_blocked");
    assert.equal(db.queries.length,0);
  }
});
test("protected transaction remains visible only as a review flag",async()=>{
  const db=new Db();
  db.docs.set("financial_ledger/"+id(1),{
    userId:uid,legalHold:true,coins:50000,
  });
  const page=await run(db);
  assert.equal(page.items[0].legalHoldPresent,true);
  assert.equal(page.items[0].recordReviewRequired,true);
  assert.equal(JSON.stringify(page).includes("50000"),false);
});
test("invalid input rejected before IO; forged query ownership fails closed",async()=>{
  for(const patch of [
    {uid:"../invalid"},{requestId:"bad"},{scope:"all"},
    {cursor:"../bad"},{limit:0},{limit:MAX_FINANCIAL_REVIEW_PAGE+1},
    {actor:{owner:false,uid:"ordinary_user"}},
  ]){
    const db=new Db();db.get=async()=>{throw Error("unexpected_read");};
    await assert.rejects(run(db,patch),e=>e.status===400||e.status===403);
    assert.equal(db.queries.length,0);
  }
  const db=new Db();
  db.runQuery=async()=>[{id:id(1),data:{userId:other}}];
  await assert.rejects(run(db),e=>e.code==="financial_review_index_mismatch");
});
test("this is not a settlement, financial write, Auth operation or scan",()=>{
  const s=readFileSync(
    "cloudflare-worker/src/account-deletion-financial-review-pages.js",
    "utf8");
  assert.doesNotMatch(s,/db\.commit\(|writeDelete\(|writeUpdate\(|writeCreate\(|deleteAuthUser\(|setInterval\(/);
  assert.match(s,/financialSettlementVerified:false/);
  assert.match(s,/completionVerified:false/);
});
