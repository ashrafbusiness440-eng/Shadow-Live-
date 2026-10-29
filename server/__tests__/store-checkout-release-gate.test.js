import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {test} from "node:test";
import {
  storePurchase,storeCheckoutIssuanceEnabled,STORE_PURCHASE_RELEASE_VALUE,
} from "../../cloudflare-worker/src/store-entitlements.js";

const url="https://example.com/api/store-purchase";
const request=(body={},method="POST")=>new Request(url,{
  method,
  ...(method==="POST"?{
    headers:{"content-type":"application/json"},
    body:JSON.stringify({
      action:"purchase",confirmation:"confirmed",
      productId:"200001",operationId:"store_purchase_regression_0001",
      ...body,
    }),
  }:{}),
});

test("checkout remains HTTP 423 with no Worker rollout flag, even on forged body",async()=>{
  for(const env of [
    {},{STORE_PURCHASE_ISSUANCE_ENABLED:true},
    {STORE_PURCHASE_ISSUANCE_ENABLED:"true"},
    {STORE_PURCHASE_ISSUANCE_ENABLED:"owner-purchases-v0"},
  ]){
    assert.equal(storeCheckoutIssuanceEnabled(env),false);
    const response=await storePurchase(request({
      purchasingEnabled:true,priceCoins:0,
      vipLevel:35,wealthLevel:35,
    }),env);
    assert.equal(response.status,423);
    assert.deepEqual(await response.json(),{
      ok:false,code:"purchasing_disabled",purchasingEnabled:false,
    });
  }
  const response=await storePurchase(request({},"GET"),{});
  assert.equal(response.status,405);
});

test("release flag enables only request-validation stage; wallet still needs catalog gate",async()=>{
  const env={STORE_PURCHASE_ISSUANCE_ENABLED:STORE_PURCHASE_RELEASE_VALUE};
  assert.equal(storeCheckoutIssuanceEnabled(env),true);
  for(const patch of [
    {action:"preview"},
    {confirmation:null},
    {confirmation:"confirm"},
  ]){
    const response=await storePurchase(request(patch),env);
    assert.equal(response.status,400);
    assert.equal((await response.json()).code,"invalid_purchase_confirmation");
  }
  const catalog=readFileSync(new URL(
    "../../cloudflare-worker/src/manage-store-catalog.js",import.meta.url),"utf8");
  const engine=readFileSync(new URL(
    "../../cloudflare-worker/src/store-purchase-transaction.js",import.meta.url),"utf8");
  assert.match(engine,/catalog\.data\?\.purchasingEnabled!==true/);
  assert.match(engine,/commit\(tx,\[/);
  assert.match(engine,/financial_ledger\/store_/);
  assert.match(catalog,/purchasingEnabled: false/);
});

test("checkout endpoint never trusts client coin price, level or wallet balance",()=>{
  const handler=readFileSync(new URL(
    "../../cloudflare-worker/src/store-entitlements.js",import.meta.url),"utf8");
  assert.match(handler,/verifyFirebaseIdToken/);
  assert.match(handler,/commitStorePurchaseOffline/);
  assert.match(handler,/storeCheckoutIssuanceEnabled\(env\)/);
  assert.doesNotMatch(handler,/db\.writeUpdate\(|db\.commit\(|wallet_operations\//);
});
