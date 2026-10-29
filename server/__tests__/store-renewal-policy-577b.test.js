import assert from "node:assert/strict";
import {test} from "node:test";
import {prepareStoreRenewal} from "../../cloudflare-worker/src/store-renewal-policy.js";

const now=1_761_740_000_000;
const day=86_400_000;
const uid="buyer_1";
const quote=(changes={})=>({
  productId:"200001",category:"frames",
  assetKey:"store.item.200001.icon",durationDays:7,
  ...changes,
});
const entitlement=(changes={})=>({
  ownerUid:uid,productId:"200001",category:"frames",
  assetKey:"store.item.200001.icon",
  source:"purchase",status:"active",equipped:true,
  acquiredAtMs:now-10*day,expiresAtMs:now+3*day,
  ...changes,
});
const renew=(current,changes={})=>prepareStoreRenewal({
  entitlement:current,uid,quote:quote(),
  expectedExpiresAtMs:current.expiresAtMs,nowMs:now,...changes,
});

test("active renewal extends from current verified deadline",()=>{
  const result=renew(entitlement());
  assert.equal(result.previousExpiresAtMs,now+3*day);
  assert.equal(result.expiresAtMs,now+10*day);
  assert.equal(result.acquiredAtMs,now-10*day);
  assert.equal(result.renewalCount,1);
});

test("expired renewal starts at current time without lost-time credit",()=>{
  const result=renew(entitlement({expiresAtMs:now-day}));
  assert.equal(result.previousExpiresAtMs,now-day);
  assert.equal(result.expiresAtMs,now+7*day);
});

test("permanent, revoked, grant and reward items cannot become paid renewals",()=>{
  for(const [changes,expected] of [
    [{expiresAtMs:null},"store_renewal_permanent"],
    [{status:"revoked"},"store_renewal_revoked"],
    [{source:"admin_grant"},"store_renewal_entitlement_invalid"],
    [{source:"reward"},"store_renewal_entitlement_invalid"],
  ]){
    const current=entitlement(changes);
    assert.throws(()=>renew(current),new RegExp(expected));
  }
  assert.throws(()=>renew(entitlement(),{
    quote:quote({durationDays:0}),
  }),/store_renewal_permanent/);
});

test("foreign ownership, category or asset tampering fail closed",()=>{
  for(const changes of [
    {ownerUid:"another_user"},{category:"nameEffects"},
    {productId:"200099"},{assetKey:"store.item.200099.icon"},
    {source:"unknown"},{acquiredAtMs:"invalid"},
    {status:"expired"},
  ]){
    assert.throws(()=>renew(entitlement(changes)),
      /store_renewal_entitlement_invalid/,JSON.stringify(changes));
  }
});

test("stale expiry quote and insane future extension never debit",()=>{
  const current=entitlement();
  assert.throws(()=>renew(current,{
    expectedExpiresAtMs:current.expiresAtMs-1,
  }),/store_renewal_quote_changed/);
  assert.throws(()=>renew(current,{
    expectedExpiresAtMs:null,
  }),/store_renewal_quote_changed/);
  assert.throws(()=>renew(entitlement({
    expiresAtMs:4_102_444_800_000-1,
  })),/store_renewal_limit/);
  assert.throws(()=>renew(entitlement({
    renewalCount:100000,
  })),/store_renewal_invalid_count/);
});
