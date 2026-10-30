import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {test} from "node:test";
import {commitStoreFullRefundOffline}
  from "../../cloudflare-worker/src/store-full-refund-transaction-offline.js";
import {inspectStoreFinancialSettlementOffline}
  from "../../cloudflare-worker/src/store-financial-settlement-offline.js";

const buyerUid="buyer_1",productId="200001";
const operationId="store_purchase_refund_safe_001";
const key=buyerUid+"__"+operationId;
const at=Date.parse("2026-10-30T02:00:00Z");
const ownerToken={sub:"verified_owner",auth_time:Math.floor(at/1000),
  iat:Math.floor(at/1000)};
const request={buyerUid,productId,operationId,
  reason:"Owner verified full refund",confirmation:"confirmed"};
const paths={
  user:"users/"+buyerUid,
  actor:"users/verified_owner",
  receipt:"store_purchase_receipts/"+key,
  operation:"store_purchase_operations/"+key,
  ledger:"financial_ledger/store_"+key,
  audit:"admin_audit_logs/store_purchase_"+key,
  refunded:"financial_ledger/store_refund_"+key,
  refundAudit:"admin_audit_logs/store_refund_"+key,
  entitlement:"user_store_entitlements/"+buyerUid+"/items/"+productId,
  slots:"user_store_equipped/"+buyerUid,
};
function setup(opts={}){
  const price=14000;
  const docs=new Map([
    [paths.actor,{role:"owner",accountStatus:"active"}],
    [paths.user,{role:"user",accountStatus:"active",
      coins:36000,...(opts.mirror?{balance:36000}:{})}],
    [paths.operation,{
      buyerUid,productId,kind:opts.renewal?"renew":"purchase",
      status:"completed",
      result:{operationId,productId,priceCoins:price,
        durationDays:0,acquiredAtMs:100000,
        expiresAtMs:null,deliveryStatus:"delivered",
        renewal:opts.renewal||false},
    }],
    [paths.receipt,{
      buyerUid,operationId,productId,priceCoins:price,
      durationDays:0,acquiredAtMs:100000,expiresAtMs:null,
      deliveryStatus:"delivered",refundStatus:"none",
      renewal:opts.renewal||false,
    }],
    [paths.ledger,{
      userId:buyerUid,asset:"coins",delta:-price,
      openingBalance:50000,closingBalance:36000,
      reason:"store_item_purchase",sourceType:"storePurchase",
      sourceId:key,idempotencyKey:key,renewal:opts.renewal||false,
    }],
    [paths.audit,{
      actorUid:buyerUid,targetType:"store_entitlement",
      targetId:paths.entitlement,action:opts.renewal
        ?"renewStoreItem":"purchaseStoreItem",
      operationId,priceCoins:price,
    }],
    [paths.entitlement,{
      ownerUid:buyerUid,productId,category:"frames",source:"purchase",
      status:"active",equipped:opts.equipped||false,
      purchaseOperationId:operationId,
    }],
  ]);
  if(opts.equipped)docs.set(paths.slots,{
    ownerUid:buyerUid,slots:{frames:productId},
  });
  let commits=0,rollbacks=0;
  const reads=[];
  const db={
    async beginTransaction(){return {active:true};},
    async rollback(){rollbacks++;},
    async get(path){
      reads.push(path);
      return {exists:docs.has(path),data:docs.get(path)};
    },
    writeUpdate(path,data){return {kind:"update",path,data};},
    writeCreate(path,data){return {kind:"create",path,data};},
    async commit(tx,writes){
      for(const w of writes)if(w.kind==="create"&&docs.has(w.path))
        throw Error("ALREADY_EXISTS");
      for(const w of writes){
        if(w.kind==="create")docs.set(w.path,w.data);
        else docs.set(w.path,{...docs.get(w.path),...w.data});
      }
      commits++;
    },
    async runQuery(){throw Error("refund_must_not_scan");},
  };
  return {db,docs,reads,commits:()=>commits,
    rollbacks:()=>rollbacks};
}
test("full Owner refund is atomic: exact Coins, receipt, entitlement, ledger, audit",async()=>{
  const x=setup({mirror:true,equipped:true});
  const result=await commitStoreFullRefundOffline(
    x.db,ownerToken,request,at);
  assert.deepEqual(result,{ok:true,operationId,buyerUid,productId,
    refundedCoins:14000});
  assert.equal(x.commits(),1);
  assert.equal(x.docs.get(paths.user).coins,50000);
  assert.equal(x.docs.get(paths.user).balance,50000);
  assert.equal(x.docs.get(paths.receipt).refundStatus,"refunded");
  assert.equal(x.docs.get(paths.entitlement).status,"revoked");
  assert.equal(x.docs.get(paths.entitlement).equipped,false);
  assert.deepEqual(x.docs.get(paths.slots).slots,{});
  assert.equal(x.docs.get(paths.refunded).delta,14000);
  assert.equal(x.docs.get(paths.refunded).closingBalance,50000);
  assert.equal(x.docs.get(paths.refunded).idempotencyKey,
    "store_refund_"+key);
  assert.equal(x.docs.get(paths.refundAudit).action,
    "refundStorePurchase");
  const report=await inspectStoreFinancialSettlementOffline(x.db,{
    buyerUid,operationId,expectedProductId:productId,
  });
  assert.equal(report.verified,true);
  assert.equal(report.refundedCoins,14000);
  assert.equal(report.netCoins,0);
  const again=await commitStoreFullRefundOffline(
    x.db,ownerToken,request,at+1000);
  assert.equal(again.ok,true);
  assert.equal(again.duplicate,true);
  assert.equal(x.commits(),1);
  assert.equal(x.docs.get(paths.user).coins,50000);
  await assert.rejects(()=>commitStoreFullRefundOffline(
    x.db,ownerToken,{...request,reason:"Changed reason"},at+2000),
    /refund_operation_conflict/);
  assert.equal(x.commits(),1);
});
test("refund without equipped slot does not create a slot document",async()=>{
  const x=setup();
  await commitStoreFullRefundOffline(x.db,ownerToken,request,at);
  assert.equal(x.docs.has(paths.slots),false);
  assert.equal(x.docs.get(paths.user).coins,50000);
});
test("Actor must be active Owner with recent auth, not buyer/admin",async()=>{
  for(const opts of [
    {token:{...ownerToken,auth_time:1},code:"recent_auth_required"},
    {token:{...ownerToken,sub:"buyer_1"},code:"forbidden"},
    {token:ownerToken,actor:{role:"admin",accountStatus:"active"},
      code:"forbidden"},
    {token:ownerToken,actor:{role:"owner",accountStatus:"suspended"},
      code:"forbidden"},
  ]){
    const x=setup();
    if(opts.actor)x.docs.set(paths.actor,opts.actor);
    await assert.rejects(()=>commitStoreFullRefundOffline(
      x.db,opts.token,request,at),new RegExp(opts.code));
    assert.equal(x.commits(),0);
    assert.equal(x.docs.get(paths.user).coins,36000);
  }
});
test("reject invalid confirmation/ID and unsupported partial refund",async()=>{
  for(const input of [
    {...request,confirmation:"preview"},
    {...request,reason:"hi"},
    {...request,productId:"bad"},
    {...request,operationId:"invalid"},
    {...request,refundedCoins:7000,confirmation:"preview"},
  ]){
    const x=setup();
    await assert.rejects(()=>commitStoreFullRefundOffline(
      x.db,ownerToken,input,at));
    assert.equal(x.commits(),0);
  }
});
test("refuse missing original proof, pending refund, old renewal or wrong entitlement",async()=>{
  for(const variant of [
    "missing_operation","tampered_ledger","pending","renewal",
    "wrong_entitlement","other_renewal","equipped_mismatch",
    "balance_mismatch","economy_lock","deleting",
  ]){
    const x=setup();
    if(variant==="missing_operation")x.docs.delete(paths.operation);
    if(variant==="tampered_ledger")x.docs.get(paths.ledger).delta=-100;
    if(variant==="pending")x.docs.get(paths.receipt).refundStatus="requested";
    if(variant==="renewal"){
      x.docs.get(paths.operation).kind="renew";
      x.docs.get(paths.operation).result.renewal=true;
      x.docs.get(paths.receipt).renewal=true;
    }
    if(variant==="wrong_entitlement")
      x.docs.get(paths.entitlement).purchaseOperationId="other_op";
    if(variant==="other_renewal")
      x.docs.get(paths.entitlement).lastRenewalOperationId="some_renewal";
    if(variant==="equipped_mismatch")
      x.docs.get(paths.entitlement).equipped=true;
    if(variant==="balance_mismatch")
      x.docs.get(paths.user).balance=111;
    if(variant==="economy_lock")
      x.docs.set("system_config/emergency_lock",{economyLocked:true});
    if(variant==="deleting")
      x.docs.get(paths.user).deletionRequestedAt="now";
    await assert.rejects(()=>commitStoreFullRefundOffline(
      x.db,ownerToken,request,at),undefined,variant);
    assert.equal(x.commits(),0,variant);
    assert.equal(x.docs.get(paths.user).coins,36000,variant);
    assert.equal(x.docs.has(paths.refunded),false,variant);
  }
});
test("orphan refund ledger blocks issuing a duplicate credit",async()=>{
  const x=setup();
  x.docs.set(paths.refunded,{delta:14000});
  await assert.rejects(()=>commitStoreFullRefundOffline(
    x.db,ownerToken,request,at),/refund_operation_conflict/);
  assert.equal(x.commits(),0);
});
test("lost transaction acknowledgement retries idempotently, never double credits",async()=>{
  const x=setup();
  const commit=x.db.commit;
  let first=true;
  x.db.commit=async(...args)=>{
    await commit(...args);
    if(first){first=false;throw Error("firestore_network_error");}
  };
  const r=await commitStoreFullRefundOffline(
    x.db,ownerToken,request,at);
  assert.equal(r.duplicate,true);
  assert.equal(x.commits(),1);
  assert.equal(x.docs.get(paths.user).coins,50000);
});
test("no live Worker route imports offline refund executor",()=>{
  const route=readFileSync("cloudflare-worker/src/index.js","utf8");
  const ownerHandler=readFileSync(
    "cloudflare-worker/src/manage-store-purchases.js","utf8");
  assert.doesNotMatch(route,/commitStoreFullRefundOffline/);
  assert.doesNotMatch(ownerHandler,/commitStoreFullRefundOffline/);
});
