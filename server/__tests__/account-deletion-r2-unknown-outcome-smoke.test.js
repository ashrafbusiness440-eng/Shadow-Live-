import assert from "node:assert/strict";
import test from "node:test";
import {rehearseIsolatedR2LostDeleteAcknowledgment as run}
 from "../../cloudflare-worker/scripts/account-erasure-r2-unknown-outcome-smoke.mjs";
const env={
 R2_ERASURE_TEST_BUCKET:"shadow-live-erasure-test",
 R2_ERASURE_TEST_CONFIRMATION:"TEST_BUCKET_ONLY_DELETE_EPHEMERAL_FIXTURE",
 R2_AMBIGUOUS_DELETE_TEST_CONFIRMATION:"SIMULATE_LOST_DELETE_ACK_TEST_BUCKET_ONLY",
 GITHUB_RUN_ID:"40279999999",
 CLOUDFLARE_ACCOUNT_ID:"a".repeat(32),
 R2_ERASURE_TEST_ACCESS_KEY_ID:"synthetic_key",
 R2_ERASURE_TEST_SECRET_ACCESS_KEY:"synthetic_secret",
};
const nonce="00000000-aaaa-4444-bbbb-111111111111";
const bytes=new Uint8Array([1,2,3,4]);
const mock=({deleteStatus=204,probeStatus=404,deleteTimeout=false,
  mismatchGet=false}={})=>{
 const methods=[];let present=false,heads=0;
 const client={async fetch(url,opts){
  const m=opts.method;methods.push(m);
  assert.match(url,/\/shadow-live-erasure-test\/erasure-fixture\/unknown-ack-/);
  if(m==="HEAD"){
   heads++;
   if(heads===1)return new Response(null,{status:404});
   if(heads===2)return new Response(null,{status:200,headers:{
    "content-length":"4",etag:'"test"' }});
   return new Response(null,{status:probeStatus});
  }
  if(m==="PUT"){present=true;return new Response(null,{status:200});}
  if(m==="GET")return new Response(
    mismatchGet?new Uint8Array([5,5,5,5]):bytes,{status:200});
  if(m==="DELETE"){
   if(deleteTimeout)throw Error("transport_timeout");
   if(deleteStatus!==204)return new Response(null,{status:deleteStatus});
   present=false;
   return new Response(null,{status:204});
  }
  throw Error("unexpected method");
 }};
 return {client,methods};
};
test("live-style lost ACK rehearsal: one DELETE, one read-only probe, forever unresolved",async()=>{
 const {client,methods}=mock();
 const result=await run({env,client,randomId:()=>nonce,payload:bytes});
 assert.deepEqual(methods,["HEAD","PUT","HEAD","GET","DELETE","HEAD"]);
 assert.equal(result.simulatedOutcome,"unknown_no_ack");
 assert.equal(result.observedAbsentAtProbe,true);
 assert.equal(result.independentHeadStatus,404);
 assert.equal(result.deleteAttempts,1);
 assert.equal(result.originalDeleteHistoryVerified,false);
 assert.equal(result.externalIoAllowed,false);
 assert.equal(result.retryAllowed,false);
 assert.equal(result.stopRevocationEffective,false);
 assert.equal(result.accountErasureCompletionVerified,false);
 assert.equal(result.fixtureOnly,true);
});
test("lost DELETE response, 503, and later presence never cause retry or receipt",async()=>{
 for(const variation of [
  {deleteTimeout:true,error:"isolated_r2_real_delete_transport_unknown_no_retry"},
  {deleteStatus:503,error:"isolated_r2_real_delete_response_unknown_no_retry"},
  {probeStatus:200,error:"isolated_r2_absence_not_confirmed"},
  {probeStatus:503,error:"isolated_r2_absence_not_confirmed"},
 ]){
  const {client,methods}=mock(variation);
  await assert.rejects(run({env,client,randomId:()=>nonce,payload:bytes}),
   e=>e.message===variation.error&&e.deleteAttempts===1);
  assert.equal(methods.filter(m=>m==="DELETE").length,1);
  assert.equal(methods.filter(m=>m==="HEAD").length,
   variation.probeStatus?3:2);
 }
});
test("wrong bucket or missing extra confirmation has zero network operations",async()=>{
 for(const mutation of [
  {R2_ERASURE_TEST_BUCKET:"shadow-live-storage"},
  {R2_ERASURE_TEST_BUCKET:"shadow-live-erasure-test-other"},
  {R2_AMBIGUOUS_DELETE_TEST_CONFIRMATION:""},
  {R2_ERASURE_TEST_SECRET_ACCESS_KEY:""},
 ]){
  const {client,methods}=mock();
  await assert.rejects(run({env:{...env,...mutation},
   client,randomId:()=>nonce,payload:bytes}));
  assert.equal(methods.length,0);
 }
});
test("tampered GET bytes halt before DELETE",async()=>{
 const {client,methods}=mock({mismatchGet:true});
 await assert.rejects(run({env,client,randomId:()=>nonce,payload:bytes}),
  e=>e.message==="isolated_r2_fixture_roundtrip_mismatch"&&
    e.deleteAttempts===0);
 assert.equal(methods.includes("DELETE"),false);
});
