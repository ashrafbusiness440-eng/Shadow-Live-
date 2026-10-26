import assert from "node:assert/strict";
import test from "node:test";
import {runIsolatedR2ErasureFixture as run,
  assertIsolatedR2ErasureFixtureTarget as guard}
  from "../../cloudflare-worker/scripts/account-erasure-isolated-r2-smoke.mjs";

const env={
  R2_ERASURE_TEST_BUCKET:"shadow-live-erasure-test",
  R2_ERASURE_TEST_CONFIRMATION:"TEST_BUCKET_ONLY_DELETE_EPHEMERAL_FIXTURE",
  GITHUB_RUN_ID:"40230000001",
  CLOUDFLARE_ACCOUNT_ID:"a".repeat(32),
  R2_ERASURE_TEST_ACCESS_KEY_ID:"testonlykey",
  R2_ERASURE_TEST_SECRET_ACCESS_KEY:"testonlysecret",
};
const nonce="00000000-aaaa-4444-bbbb-111111111111";
const content=new Uint8Array([1,2,3,4]);
function clientForFixture({deleteTimeout=false,wrongHead=false}={}){
  const requests=[];
  let present=false;
  return {requests,client:{
    async fetch(url,options){
      const method=options.method;
      requests.push({method,url});
      assert.match(url,/\/shadow-live-erasure-test\/erasure-fixture\/github-/);
      if(method==="HEAD"){
        return new Response(null,{
          status:present?200:404,
          headers:present?{"content-length":String(wrongHead?3:4),
            etag:'"fixture-etag"'}:{},
        });
      }
      if(method==="PUT"){present=true;return new Response(null,{status:200});}
      if(method==="GET"){return new Response(content,{status:200});}
      if(method==="DELETE"){
        if(deleteTimeout)throw Error("r2 timeout");
        present=false;return new Response(null,{status:204});
      }
      throw Error("unexpected_r2_test_method");
    },
  }};
}
test("isolated R2 fixture accepts EXACT dedicated bucket + explicit confirmation",()=>{
  assert.equal(guard({bucket:"shadow-live-erasure-test",
    confirmation:env.R2_ERASURE_TEST_CONFIRMATION,runId:env.GITHUB_RUN_ID}),true);
  for(const bucket of ["shadow-live-storage","shadow-live-erasure-test-prod",
    "shadow-live-erasure-test/",null,"", "shadow-live-erasure-test/../shadow-live-storage"]){
    assert.throws(()=>guard({bucket,confirmation:
      env.R2_ERASURE_TEST_CONFIRMATION,runId:env.GITHUB_RUN_ID}),
    /isolated_r2_bucket_name_required/);
  }
  assert.throws(()=>guard({bucket:env.R2_ERASURE_TEST_BUCKET,
    confirmation:"yes",runId:env.GITHUB_RUN_ID}),
    /isolated_r2_explicit_confirmation_required/);
});
test("test bucket smoke verifies one PUT/HEAD/GET/DELETE/HEAD, NEVER completion",async()=>{
  const {client,requests}=clientForFixture();
  const result=await run({env,client,randomId:()=>nonce,payload:content});
  assert.deepEqual(requests.map(x=>x.method),
    ["HEAD","PUT","HEAD","GET","DELETE","HEAD"]);
  assert.equal(result.isolatedProviderSmokeSucceeded,true);
  assert.equal(result.historyProof,false);
  assert.equal(result.accountErasureCompletionVerified,false);
  assert.equal(result.productionDeleteAllowed,false);
  assert.equal(result.deleteAttempts,1);
  assert.equal(result.headAfterDelete,404);
  assert.equal(requests[0].url.includes("shadow-live-storage"),false);
});
test("ambiguous DELETE failure is not silently retried, never returns receipt",async()=>{
  const {client,requests}=clientForFixture({deleteTimeout:true});
  await assert.rejects(run({env,client,randomId:()=>nonce,payload:content}),
    e=>e.message==="isolated_r2_delete_outcome_unknown_no_retry"&&
      e.deleteAttempted===true);
  assert.equal(requests.filter(x=>x.method==="DELETE").length,1);
  assert.equal(requests.at(-1).method,"DELETE");
});
test("mismatched provider HEAD metadata forbids deletion",async()=>{
  const {client,requests}=clientForFixture({wrongHead:true});
  await assert.rejects(run({env,client,randomId:()=>nonce,payload:content}),
    /isolated_r2_provider_metadata_missing/);
  assert.equal(requests.some(x=>x.method==="DELETE"),false);
});
test("missing dedicated credentials or guard never contacts R2",async()=>{
  const {client,requests}=clientForFixture();
  for(const mutation of [
    {R2_ERASURE_TEST_BUCKET:"shadow-live-storage"},
    {R2_ERASURE_TEST_CONFIRMATION:""},
    {R2_ERASURE_TEST_SECRET_ACCESS_KEY:""},
    {CLOUDFLARE_ACCOUNT_ID:"not-an-id"},
  ]){
    await assert.rejects(run({env:{...env,...mutation},
      client,randomId:()=>nonce,payload:content}));
  }
  assert.equal(requests.length,0);
});
