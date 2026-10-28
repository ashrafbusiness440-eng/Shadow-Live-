import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {test} from "node:test";
import {
  STORE_PURCHASING_ENABLED, validateStorePurchaseOperationId,
  prepareStorePurchase, validStoreEntitlementDocument,
} from "../../cloudflare-worker/src/store-purchase-policy.js";
import {storePurchase} from "../../cloudflare-worker/src/store-entitlements.js";

const product = () => ({
  id:"200001", nameAr:"إطار ملكي",category:"frames",
  priceCoins:25_000,durationDays:7,rarity:"rare",minVipLevel:2,
  enabled:true,sortOrder:1,assetKey:"store.item.200001.icon",
});
const context = () => ({
  catalog:{items:[product()]},productId:"200001",
  buyer:{uid:"active_uid",accountStatus:"active"},
  vipLevel:3,wealthLevel:8,nowMs:100_000,
});

test("store purchase stays hard-off regardless of request body, auth or admin config", async () => {
  assert.equal(STORE_PURCHASING_ENABLED,false);
  const response=await storePurchase(new Request("https://example.com/api/store-purchase",{
    method:"POST", headers:{"content-type":"application/json"},
    body:JSON.stringify({purchasingEnabled:true,priceCoins:0,operationId:"purchase_try_0001"}),
  }),{});
  assert.equal(response.status,423);
  const body=await response.json();
  assert.equal(body.code,"purchasing_disabled");
  assert.equal(body.purchasingEnabled,false);
  const method=await storePurchase(new Request("https://example.com/api/store-purchase"),{});
  assert.equal(method.status,405);
});

test("server preflight snapshots catalog price, TTL and identity", () => {
  const quote=prepareStorePurchase(context());
  assert.deepEqual({
    uid:quote.buyerUid,id:quote.productId,price:quote.priceCoins,
    expiry:quote.expiresAtMs,asset:quote.assetKey,
  },{
    uid:"active_uid",id:"200001",price:25_000,
    expiry:100_000 + 7*86_400_000,asset:"store.item.200001.icon",
  });
  assert.equal(Object.isFrozen(quote),true);
  assert.equal(quote.purchasedAtMs,100_000);
  assert.deepEqual(validateStorePurchaseOperationId("key_purchase_00001"),
    "key_purchase_00001");
  for(const value of ["", "../other", "a", "has space","x".repeat(101)]) {
    assert.throws(()=>validateStorePurchaseOperationId(value));
  }
});

test("purchase preflight rejects hidden, free, invalid, low VIP and unsupported wealth", () => {
  const c=context();
  for(const change of [
    {catalog:{items:[{...product(),enabled:false}]}},
    {catalog:{items:[{...product(),priceCoins:0}]}},
    {catalog:{items:[{...product(),assetKey:"store.item.200002.icon"}]}},
    {catalog:{items:[{...product(),minWealthLevel:3}]}},
    {vipLevel:1},{vipLevel:-1},{wealthLevel:36},
    {buyer:{uid:"active_uid",accountStatus:"deleting"}},
    {productId:"200002"},{nowMs:NaN},
  ]) assert.throws(()=>prepareStorePurchase({...c,...change}));
});

test("store inventory projects only owned, valid entitlements without audit identities", () => {
  const data={
    ownerUid:"user_one",productId:"200001",nameAr:"إطار",
    assetKey:"store.item.200001.icon",category:"frames",
    source:"purchase",status:"active",acquiredAtMs:1000,
    expiresAtMs:10000,actorUid:"PRIVATE_ADMIN",operationId:"PRIVATE_TX",
    priceCoins:1000,
  };
  const view=validStoreEntitlementDocument(data,"user_one",2000);
  assert.ok(view);
  assert.equal(view.active,true);
  assert.equal(view.expired,false);
  assert.deepEqual(Object.keys(view).sort(),[
    "productId","nameAr","category","assetKey","source",
    "acquiredAtMs","expiresAtMs","active","expired",
  ].sort());
  assert.ok(!JSON.stringify(view).includes("PRIVATE"));
  assert.equal(validStoreEntitlementDocument(data,"another_user",2000),null);
  assert.equal(validStoreEntitlementDocument({...data,assetKey:"other"}, "user_one",2000),null);
  assert.equal(validStoreEntitlementDocument({...data,status:"unknown"},"user_one",2000),null);
  assert.equal(validStoreEntitlementDocument(data,"user_one",10000).active,false);
  assert.equal(validStoreEntitlementDocument(data,"user_one",10000).expired,true);
});

test("own-inventory endpoint does not accept a target user or grant/mutate data", () => {
  const service=readFileSync(new URL(
    "../../cloudflare-worker/src/store-entitlements.js", import.meta.url),"utf8");
  const routes=readFileSync(new URL(
    "../../cloudflare-worker/src/index.js", import.meta.url),"utf8");
  assert.match(service,/verifyFirebaseIdToken\(request, env/);
  assert.match(service,/assertUserDocumentSessionState\(token, user.data/);
  assert.match(service,/user_store_entitlements\/\$\{uid\}\/items/);
  assert.match(service,/resultLimit:100/);
  assert.match(service,/purchasingEnabled:false/);
  assert.match(routes,/url\.pathname === "\/api\/my-store-items"/);
  assert.match(routes,/url\.pathname === "\/api\/store-purchase"/);
  assert.doesNotMatch(service,/db\.commit\(|db\.writeCreate\(|db\.writeUpdate\(|adjustBalance|wallet_operations/);
});
