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

test("R2 fault matrix fails closed at every pre-delete operation boundary",async()=>{
  for(const scenario of [
    {stage:"initial_head",method:"HEAD",index:0,
      expected:["HEAD"],deleteAttempted:false},
    {stage:"put_fixture",method:"PUT",index:0,
      expected:["HEAD","PUT"],deleteAttempted:false},
    {stage:"head_after_put",method:"HEAD",index:1,
      expected:["HEAD","PUT","HEAD"],deleteAttempted:false},
    {stage:"get_roundtrip",method:"GET",index:0,
      expected:["HEAD","PUT","HEAD","GET"],deleteAttempted:false},
  ]){
    const {client,requests}=clientForFixture();
    const original=client.fetch.bind(client);
    let methodCount=0;
    client.fetch=async(url,options)=>{
      if(options.method===scenario.method){
        const current=methodCount++;
        if(current===scenario.index){
          requests.push({method:options.method,url});
          return new Response(null,{status:503});
        }
      }
      return original(url,options);
    };
    await assert.rejects(
      run({env,client,randomId:()=>nonce,payload:content}),
      e=>e.isolatedFixturePhase===scenario.stage&&
        e.deleteAttempted===false&&
        e.putSucceeded===(scenario.stage!=="initial_head"&&
          scenario.stage!=="put_fixture")
    );
    assert.deepEqual(requests.map(r=>r.method),scenario.expected,
      "Failure at "+scenario.stage+" must never invoke later R2 stages");
    assert.equal(requests.filter(r=>r.method==="DELETE").length,0);
  }
});

test("R2 DELETE HTTP error and unknown result always mean at most one attempt",async()=>{
  for(const responseMode of ["status_503","timeout"]){
    const {client,requests}=clientForFixture({
      deleteTimeout:responseMode==="timeout",
    });
    if(responseMode==="status_503"){
      const underlying=client.fetch.bind(client);
      client.fetch=async(url,opts)=>{
        if(opts.method==="DELETE"){
          requests.push({method:opts.method,url});
          return new Response(null,{status:503});
        }
        return underlying(url,opts);
      };
    }
    await assert.rejects(
      run({env,client,randomId:()=>nonce,payload:content}),
      e=>e.deleteAttempted===true&&
        e.isolatedFixturePhase==="delete_once"&&
        e.putSucceeded===true&&
        (responseMode==="timeout"?
          e.message==="isolated_r2_delete_outcome_unknown_no_retry":
          e.message.startsWith("isolated_r2_delete_response_unverified"))
    );
    assert.deepEqual(requests.map(r=>r.method),
      ["HEAD","PUT","HEAD","GET","DELETE"]);
  }
});

test("R2 post-delete HEAD present/error does NOT become deletion proof or retry",async()=>{
  for(const afterStatus of [200,503]){
    const {client,requests}=clientForFixture();
    const original=client.fetch.bind(client);
    let heads=0;
    client.fetch=async(url,opts)=>{
      if(opts.method==="HEAD"&&++heads===3){
        requests.push({method:"HEAD",url});
        return new Response(null,{status:afterStatus});
      }
      return original(url,opts);
    };
    await assert.rejects(
      run({env,client,randomId:()=>nonce,payload:content}),
      e=>e.message==="isolated_r2_absence_not_observed"&&
        e.isolatedFixturePhase==="head_after_delete"&&
        e.deleteAttempted===true
    );
    assert.deepEqual(requests.map(r=>r.method),
      ["HEAD","PUT","HEAD","GET","DELETE","HEAD"]);
    assert.equal(requests.filter(r=>r.method==="DELETE").length,1);
  }
});

test("provider GET bytes mismatch refuses to delete even if HTTP 200",async()=>{
  const {client,requests}=clientForFixture();
  const original=client.fetch.bind(client);
  client.fetch=async(url,opts)=>{
    if(opts.method==="GET"){
      requests.push({method:"GET",url});
      return new Response(new Uint8Array([9,9,9,9]),{status:200});
    }
    return original(url,opts);
  };
  await assert.rejects(run({env,client,randomId:()=>nonce,payload:content}),
    e=>e.message==="isolated_r2_roundtrip_mismatch"&&
      e.deleteAttempted===false&&e.isolatedFixturePhase==="get_roundtrip");
  assert.equal(requests.filter(r=>r.method==="DELETE").length,0);
});

test("manual isolated R2 workflow cannot run on push/PR/cron or production credentials",async()=>{
  const {readFileSync}=await import("node:fs");
  const workflow=readFileSync(
    ".github/workflows/account-erasure-isolated-r2-proof.yml","utf8");
  assert.match(workflow,/workflow_dispatch:/);
  assert.doesNotMatch(workflow,/^\s+(?:push|pull_request|schedule):/m);
  assert.match(workflow,/R2_ERASURE_TEST_ACCESS_KEY_ID.*secrets\.R2_ERASURE_TEST_ACCESS_KEY_ID/);
  assert.match(workflow,/R2_ERASURE_TEST_SECRET_ACCESS_KEY.*secrets\.R2_ERASURE_TEST_SECRET_ACCESS_KEY/);
  assert.doesNotMatch(workflow,/secrets\.(?:R2_ACCESS_KEY_ID|R2_SECRET_ACCESS_KEY)(?![A-Z_])/);
  assert.doesNotMatch(workflow,/uses: actions\/upload-artifact/);
  assert.match(workflow,/run: node scripts\/account-erasure-isolated-r2-smoke\.mjs/);
});
