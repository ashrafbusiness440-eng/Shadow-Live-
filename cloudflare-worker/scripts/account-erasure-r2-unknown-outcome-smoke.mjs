// TEST-ONLY Cloudflare R2 live simulation of losing the DELETE acknowledgment.
// This cannot delete a user object: it generates a fresh unique key under
// erasure-fixture/ in an exact independently provisioned bucket.
import {randomUUID,randomBytes,createHash} from "node:crypto";
import {pathToFileURL} from "node:url";
import {assertIsolatedR2ErasureFixtureTarget} from
  "./account-erasure-isolated-r2-smoke.mjs";

const clean=x=>String(x??"").trim();
const verifyResponse=(r,label)=>{if(!r?.ok)throw Error(label+"_failed_"+(r?.status??"network"));};
export async function rehearseIsolatedR2LostDeleteAcknowledgment({
  env=process.env,client,randomId=randomUUID,payload=randomBytes(37),
}={}){
  const bucket=clean(env.R2_ERASURE_TEST_BUCKET);
  const runId=clean(env.GITHUB_RUN_ID);
  assertIsolatedR2ErasureFixtureTarget({
    bucket,confirmation:env.R2_ERASURE_TEST_CONFIRMATION,runId,
  });
  if(clean(env.R2_AMBIGUOUS_DELETE_TEST_CONFIRMATION)!==
    "SIMULATE_LOST_DELETE_ACK_TEST_BUCKET_ONLY")
    throw Error("isolated_r2_ambiguous_delete_confirmation_required");
  const account=clean(env.CLOUDFLARE_ACCOUNT_ID);
  const access=clean(env.R2_ERASURE_TEST_ACCESS_KEY_ID);
  const secret=clean(env.R2_ERASURE_TEST_SECRET_ACCESS_KEY);
  if(!/^[a-f0-9]{32}$/i.test(account)||!access||!secret)
    throw Error("isolated_r2_credentials_missing");
  const nonce=clean(randomId());
  if(!/^[0-9a-f-]{36}$/.test(nonce))
    throw Error("isolated_r2_fixture_nonce_invalid");
  const key="erasure-fixture/unknown-ack-"+runId+"/"+nonce+".bin";
  const url="https://"+account+".r2.cloudflarestorage.com/"+
    bucket+"/"+key.split("/").map(encodeURIComponent).join("/");
  if(!client){
    const {AwsClient}=await import("aws4fetch");
    client=new AwsClient({accessKeyId:access,secretAccessKey:secret,
      region:"auto",service:"s3"});
  }
  if(typeof client.fetch!=="function")
    throw Error("isolated_r2_provider_client_invalid");

  let deleteAttempts=0,phase="initial_head",putSucceeded=false;
  const req=(method,options={})=>client.fetch(url,{
    ...options,method,signal:AbortSignal.timeout(12000),
  });
  try{
    const initial=await req("HEAD");
    if(initial?.status!==404)
      throw Error("isolated_r2_fixture_not_initially_absent");
    phase="put";
    const put=await req("PUT",{
      headers:{"Content-Type":"application/octet-stream"},body:payload,
    });
    verifyResponse(put,"isolated_r2_fixture_put");
    putSucceeded=true;
    phase="head_after_put";
    const head=await req("HEAD");
    verifyResponse(head,"isolated_r2_fixture_head");
    if(Number(head.headers?.get("content-length"))!==payload.length||
       !clean(head.headers?.get("etag")))
      throw Error("isolated_r2_fixture_metadata_mismatch");
    phase="get";
    const get=await req("GET");
    verifyResponse(get,"isolated_r2_fixture_get");
    const bytes=new Uint8Array(await get.arrayBuffer());
    if(bytes.length!==payload.length||bytes.some((v,i)=>v!==payload[i]))
      throw Error("isolated_r2_fixture_roundtrip_mismatch");

    // This harness performs exactly one real DELETE. It deliberately
    // withholds any returned HTTP status from the simulated reconciler.
    // A real transport timeout can occur before or after provider commit;
    // this tests ONLY the 'commit succeeded, ACK lost' branch.
    phase="delete_ack_suppressed";
    deleteAttempts++;
    let providerReturned;
    try{providerReturned=await req("DELETE");}
    catch{
      throw Error("isolated_r2_real_delete_transport_unknown_no_retry");
    }
    if(!providerReturned?.ok)
      throw Error("isolated_r2_real_delete_response_unknown_no_retry");
    // Simulate losing the ACK: never pass its status to the reconciler.
    const simulatedOutcome="unknown_no_ack";
    phase="independent_read_only_head";
    let readOnlyHead;
    try{readOnlyHead=await req("HEAD");}
    catch{throw Error("isolated_r2_independent_head_unknown");}
    if(readOnlyHead?.status!==404)
      throw Error("isolated_r2_absence_not_confirmed");
    return {
      bucket,key,simulatedOutcome,
      independentHeadStatus:404,deleteAttempts,
      observedAbsentAtProbe:true,
      originalDeleteHistoryVerified:false,
      externalIoAllowed:false,retryAllowed:false,
      stopRevocationEffective:false,accountErasureCompletionVerified:false,
      // Explicitly NOT a production object or an account-deletion receipt.
      fixtureOnly:true,
      payloadSha256:createHash("sha256").update(payload).digest("hex"),
    };
  }catch(error){
    error.fixtureKey=key;error.phase=phase;
    error.putSucceeded=putSucceeded;error.deleteAttempts=deleteAttempts;
    throw error;
  }
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  rehearseIsolatedR2LostDeleteAcknowledgment().then(evidence=>{
    process.stdout.write(JSON.stringify(evidence)+"\n");
  }).catch(error=>{
    console.error("ISOLATED_R2_UNKNOWN_ACK_FAILURE:"+error.message);
    console.error("ISOLATED_R2_UNKNOWN_ACK_PHASE:"+error.phase);
    if(error.fixtureKey)console.error("ISOLATED_R2_FIXTURE_KEY:"+error.fixtureKey);
    process.exitCode=1;
  });
}
