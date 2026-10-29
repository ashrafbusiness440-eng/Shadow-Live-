import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {test} from "node:test";
import {
  storeGrantIssuanceEnabled,manageStoreGrantIssue,STORE_GRANT_RELEASE_VALUE,
} from "../../cloudflare-worker/src/manage-store-grant-issue.js";

const url="https://example.com/api/manage-store-grant-issue";
const issue=(body={},method="POST")=>new Request(url,{
  method,
  ...(method==="POST"?{
    headers:{"content-type":"application/json"},
    body:JSON.stringify({
      action:"issue",confirmation:"confirmed",targetId:"123456",
      productId:"200001",operationId:"owner_issue_000001",
      reason:"منحة تقديرية من المالك",...body,
    }),
  }:{}),
});

test("grant issuance remains hard-off without explicit Worker release switch",async()=>{
  for(const env of [
    {},{STORE_GRANT_ISSUANCE_ENABLED:true},
    {STORE_GRANT_ISSUANCE_ENABLED:"true"},
    {STORE_GRANT_ISSUANCE_ENABLED:"owner-grants-v0"},
  ]){
    assert.equal(storeGrantIssuanceEnabled(env),false);
    const response=await manageStoreGrantIssue(issue(),env);
    assert.equal(response.status,423);
    assert.deepEqual(await response.json(),{
      ok:false,code:"store_grants_disabled",grantEnabled:false,
    });
  }
  const method=await manageStoreGrantIssue(issue({},"GET"),{});
  assert.equal(method.status,405);
  const arbitrary=await manageStoreGrantIssue(issue({
    STORE_GRANT_ISSUANCE_ENABLED:STORE_GRANT_RELEASE_VALUE,
  }),{});
  assert.equal(arbitrary.status,423,
    "client-controlled body cannot bypass the release gate");
});

test("only exact Worker release value admits request validation",async()=>{
  const env={STORE_GRANT_ISSUANCE_ENABLED:STORE_GRANT_RELEASE_VALUE};
  assert.equal(storeGrantIssuanceEnabled(env),true);
  for(const body of [
    {action:"preview"},
    {confirmation:null},
    {confirmation:"confirm"},
  ]){
    const response=await manageStoreGrantIssue(issue(body),env);
    assert.equal(response.status,400);
    assert.equal((await response.json()).code,"invalid_grant_confirmation");
  }
});

test("grant route isolates operation, currency and production preview paths",()=>{
  const routes=readFileSync(new URL(
    "../../cloudflare-worker/src/index.js",import.meta.url),"utf8");
  const handler=readFileSync(new URL(
    "../../cloudflare-worker/src/manage-store-grant-issue.js",import.meta.url),"utf8");
  const preview=readFileSync(new URL(
    "../../cloudflare-worker/src/manage-store-grant-preview.js",import.meta.url),"utf8");
  assert.match(routes,/url\.pathname === "\/api\/manage-store-grant-issue"/);
  assert.match(routes,/return manageStoreGrantIssue\(request, env\)/);
  assert.match(handler,/commitStoreGrantOffline\(/);
  assert.match(handler,/verifyFirebaseIdToken\(request,env/);
  assert.match(handler,/store_grants_disabled/);
  assert.doesNotMatch(handler,/writeUpdate\(|financial_ledger\/|balance:/);
  assert.doesNotMatch(preview,/commitStoreGrantOffline|manageStoreGrantIssue/);
});
