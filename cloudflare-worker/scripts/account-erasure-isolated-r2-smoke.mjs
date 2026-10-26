// ONLY a separately provisioned, isolated Cloudflare R2 TEST bucket.
// This is a manual, independent provider-operation evidence smoke test.
// It is not an account-erasure executor, an approval, a completion receipt,
// a production R2 delete, a stage permit, or a workflow on PR events.
import {randomBytes,randomUUID,createHash} from "node:crypto";
import {pathToFileURL} from "node:url";

const FIXTURE_BUCKET="shadow-live-erasure-test";
const CONFIRM="TEST_BUCKET_ONLY_DELETE_EPHEMERAL_FIXTURE";
const clean=x=>String(x??"").trim();
export function assertIsolatedR2ErasureFixtureTarget({
  bucket,confirmation,runId,
}={}){
  if(clean(bucket)!==FIXTURE_BUCKET)
    throw Error("isolated_r2_bucket_name_required");
  if(clean(confirmation)!==CONFIRM)
    throw Error("isolated_r2_explicit_confirmation_required");
  if(!/^\d{3,20}$/.test(clean(runId)))
    throw Error("isolated_r2_github_run_id_required");
  return true;
}
const verify=(result,code)=>{if(!result?.ok)throw Error(code+":"+(result?.status??"network"));};
export async function runIsolatedR2ErasureFixture({
  env=process.env,
  client,
  randomId=randomUUID,
  payload=randomBytes(39),
}={}){
  const bucket=clean(env.R2_ERASURE_TEST_BUCKET);
  const confirmation=clean(env.R2_ERASURE_TEST_CONFIRMATION);
  const runId=clean(env.GITHUB_RUN_ID);
  assertIsolatedR2ErasureFixtureTarget({bucket,confirmation,runId});
  const account=clean(env.CLOUDFLARE_ACCOUNT_ID);
  const access=clean(env.R2_ERASURE_TEST_ACCESS_KEY_ID);
  const secret=clean(env.R2_ERASURE_TEST_SECRET_ACCESS_KEY);
  if(!/^[a-f0-9]{32}$/i.test(account)||!access||!secret)
    throw Error("isolated_r2_credentials_missing");
  const nonce=clean(randomId());
  if(!/^[0-9a-f-]{36}$/.test(nonce))
    throw Error("invalid_isolated_r2_fixture_nonce");
  const key="erasure-fixture/github-"+runId+"/"+nonce+".bin";
  const base="https://"+account+".r2.cloudflarestorage.com/"+
    bucket+"/";
  const url=base+key.split("/").map(encodeURIComponent).join("/");
  // Only create/erase bytes generated for this invocation; no supplied
  // storageKey, user, request ID, wildcard, list, collection or prefix delete.
  if(!client){
    const {AwsClient}=await import("aws4fetch");
    client=new AwsClient({accessKeyId:access,secretAccessKey:secret,
      region:"auto",service:"s3"});
  }
  if(typeof client.fetch!=="function")throw Error("invalid_isolated_r2_client");
  let putSucceeded=false,deleteAttempted=false;
  // Diagnostic only. The exact phase matters when determining whether a
  // request MAY have reached R2; never infer success from any exception.
  let phase="before_initial_head";
  const evidence={bucket,key,headBefore:0,put:0,headAfterPut:0,
    get:0,delete:0,headAfterDelete:0,payloadSha256:createHash("sha256")
      .update(payload).digest("hex")};
  const request=async(method,options={})=>client.fetch(url,{
    ...options,method,signal:AbortSignal.timeout(12000),
  });
  try{
    phase="initial_head";
    const before=await request("HEAD");
    evidence.headBefore=before.status;
    if(before.status!==404)
      throw Error("isolated_r2_fixture_key_not_empty");
    phase="put_fixture";
    const written=await request("PUT",{
      headers:{"Content-Type":"application/octet-stream"},
      body:payload,
    });
    evidence.put=written.status;
    verify(written,"isolated_r2_put_failed");
    putSucceeded=true;
    phase="head_after_put";
    const head=await request("HEAD");
    evidence.headAfterPut=head.status;
    verify(head,"isolated_r2_head_after_put_failed");
    const expectedBytes=Number(head.headers?.get("content-length"));
    const etag=clean(head.headers?.get("etag"));
    if(expectedBytes!==payload.length||!etag)
      throw Error("isolated_r2_provider_metadata_missing");
    // Verify exact contents before any deletion: this is ONLY our nonce.
    phase="get_roundtrip";
    const loaded=await request("GET");
    evidence.get=loaded.status;
    verify(loaded,"isolated_r2_get_failed");
    const content=new Uint8Array(await loaded.arrayBuffer());
    if(content.length!==payload.length||
      content.some((v,i)=>v!==payload[i]))
      throw Error("isolated_r2_roundtrip_mismatch");
    phase="delete_once";
    deleteAttempted=true;
    // No retry, even if the transport times out: external history may
    // be ambiguous. Never invoke this on a production/shared bucket.
    let removed;
    try{removed=await request("DELETE");}
    catch{throw Error("isolated_r2_delete_outcome_unknown_no_retry");}
    evidence.delete=removed.status;
    verify(removed,"isolated_r2_delete_response_unverified");
    phase="head_after_delete";
    const after=await request("HEAD");
    evidence.headAfterDelete=after.status;
    if(after.status!==404)
      throw Error("isolated_r2_absence_not_observed");
    return {...evidence,
      isolatedProviderSmokeSucceeded:true,historyProof:false,
      accountErasureCompletionVerified:false,productionDeleteAllowed:false,
      deleteAttempts:1};
  }catch(error){
    // Important: never retry or 'clean up' an unknown DELETE outcome.
    // If PUT succeeded but DELETE never began, the disposable fixture
    // may need manual cleanup in the isolated test bucket.
    error.isolatedFixtureKey=key;
    error.putSucceeded=putSucceeded;
    error.deleteAttempted=deleteAttempted;
    error.isolatedFixturePhase=phase;
    throw error;
  }
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  runIsolatedR2ErasureFixture().then(result=>{
    // This JSON is supporting TEST-BUCKET evidence, not a completion proof.
    process.stdout.write(JSON.stringify(result)+"\n");
  }).catch(error=>{
    console.error("ISOLATED_R2_FIXTURE_FAILED:"+error.message);
    console.error("ISOLATED_R2_FIXTURE_PHASE:"+
      (error.isolatedFixturePhase||"validation_before_network"));
    if(error.isolatedFixtureKey)console.error(
      "ISOLATED_R2_FIXTURE_KEY_FOR_MANUAL_RECONCILIATION:"+
      error.isolatedFixtureKey);
    process.exitCode=1;
  });
}
