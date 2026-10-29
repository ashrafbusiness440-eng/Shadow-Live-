import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {test} from "node:test";
import {
  storePurchase,storeCheckoutIssuanceEnabled,STORE_PURCHASE_RELEASE_VALUE,
} from "../../cloudflare-worker/src/store-entitlements.js";
import {
  manageStoreGrantIssue,storeGrantIssuanceEnabled,STORE_GRANT_RELEASE_VALUE,
} from "../../cloudflare-worker/src/manage-store-grant-issue.js";
import {
  manageStoreGrantRevoke,storeGrantRevokeEnabled,
  STORE_GRANT_REVOKE_RELEASE_VALUE,
} from "../../cloudflare-worker/src/manage-store-grant-revoke.js";


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

test("581A independent Worker switches default OFF even with forged admin bodies",async()=>{
  const cases=[
    {
      handler:manageStoreGrantIssue,check:storeGrantIssuanceEnabled,
      flag:"STORE_GRANT_ISSUANCE_ENABLED",invalid:"owner-grants-v0",
      route:"manage-store-grant-issue",action:"issue",
      code:"store_grants_disabled",switchName:"grantEnabled",
      otherFlag:"STORE_GRANT_REVOCATION_ENABLED",
      otherValue:STORE_GRANT_REVOKE_RELEASE_VALUE,
    },
    {
      handler:manageStoreGrantRevoke,check:storeGrantRevokeEnabled,
      flag:"STORE_GRANT_REVOCATION_ENABLED",
      invalid:"owner-grant-revoke-v0",
      route:"manage-store-grant-revoke",action:"revoke",
      code:"store_grant_revocation_disabled",
      switchName:"revocationEnabled",
      otherFlag:"STORE_GRANT_ISSUANCE_ENABLED",
      otherValue:STORE_GRANT_RELEASE_VALUE,
    },
  ];
  for(const selected of cases){
    for(const env of [
      {},{[selected.flag]:true},{[selected.flag]:"true"},
      {[selected.flag]:selected.invalid},
      {[selected.otherFlag]:selected.otherValue,
        STORE_PURCHASE_ISSUANCE_ENABLED:STORE_PURCHASE_RELEASE_VALUE},
    ]){
      assert.equal(selected.check(env),false);
      const req=new Request("https://example.com/api/"+selected.route,{
        method:"POST",headers:{"content-type":"application/json"},
        body:JSON.stringify({
          action:selected.action,confirmation:"confirmed",
          productId:"200001",targetId:"claimed_owner",
          grantsEnabled:true,revocationEnabled:true,purchasingEnabled:true,
          [selected.flag]:selected.otherValue,
        }),
      });
      const response=await selected.handler(req,env);
      assert.equal(response.status,423);
      assert.deepEqual(await response.json(),{
        ok:false,code:selected.code,[selected.switchName]:false,
      });
      // The disabled gate must run before JSON parsing or authentication.
      const malformed=new Request("https://example.com/api/"+selected.route,{
        method:"POST",headers:{"content-type":"application/json"},
        body:"{this is intentionally invalid json",
      });
      assert.equal((await selected.handler(malformed,env)).status,423);
    }
    const get=new Request("https://example.com/api/"+selected.route);
    assert.equal((await selected.handler(get,{})).status,405);
  }
});

test("581A toggling one explicit Worker release never toggles the other two",()=>{
  const all={
    STORE_PURCHASE_ISSUANCE_ENABLED:STORE_PURCHASE_RELEASE_VALUE,
    STORE_GRANT_ISSUANCE_ENABLED:STORE_GRANT_RELEASE_VALUE,
    STORE_GRANT_REVOCATION_ENABLED:STORE_GRANT_REVOKE_RELEASE_VALUE,
  };
  const switches=[
    ["STORE_PURCHASE_ISSUANCE_ENABLED",storeCheckoutIssuanceEnabled],
    ["STORE_GRANT_ISSUANCE_ENABLED",storeGrantIssuanceEnabled],
    ["STORE_GRANT_REVOCATION_ENABLED",storeGrantRevokeEnabled],
  ];
  for(const [missing,check] of switches){
    const env={...all};
    delete env[missing];
    assert.equal(check(env),false);
    for(const [other,otherCheck] of switches){
      if(other!==missing)assert.equal(otherCheck(env),true);
    }
  }
  for(const [,check] of switches)assert.equal(check({}),false);
});

test("581A even a valid grant/revoke flag requires explicit confirmation",async()=>{
  for(const [handler,route,env] of [
    [manageStoreGrantIssue,"manage-store-grant-issue",
      {STORE_GRANT_ISSUANCE_ENABLED:STORE_GRANT_RELEASE_VALUE}],
    [manageStoreGrantRevoke,"manage-store-grant-revoke",
      {STORE_GRANT_REVOCATION_ENABLED:STORE_GRANT_REVOKE_RELEASE_VALUE}],
  ]){
    const response=await handler(new Request("https://example.com/api/"+route,{
      method:"POST",headers:{"content-type":"application/json"},
      body:JSON.stringify({action:"preview",confirmation:"confirmed",
        productId:"200001",targetId:"claimed_owner"}),
    }),env);
    assert.equal(response.status,400);
    const body=await response.json();
    assert.match(body.code,/invalid_.*_confirmation/);
  }
});
