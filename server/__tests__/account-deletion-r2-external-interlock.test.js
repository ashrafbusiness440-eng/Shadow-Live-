import assert from "node:assert/strict";
import test from "node:test";
import {rehearseAccountErasureR2Dispatch as dispatch}
  from "../../cloudflare-worker/src/account-deletion-r2-external-interlock.js";
import {
  reserveAccountErasureExternalIo as reserve,
  recordAccountErasureExternalIoCoordinationHold as hold,
  recordAccountErasureExternalIoUncertainAttempt as journal,
  requestAccountErasureExternalIoRevocationIntent as stop,
} from "../../cloudflare-worker/src/account-deletion-external-io-reservation.js";
import {seedSyntheticErasureCertificates}
  from "./helpers/account-erasure-synthetic-certificates.js";
import {REQUIRED_ERASURE_ADMISSION_DOMAINS as domains}
  from "../../cloudflare-worker/src/account-deletion-processing-admission.js";

const uid="erasure_fixture_user", requestId="erasure_fixture_request_123456",
  objectId="erasure_fixture_media_123456",
  token="erasure_fixture_operation_token_123456", owner="fixture_owner_123456";
const nowMs=Date.parse("2026-10-25T15:00:00Z"), requestedAtMs=nowMs-40*86400_000;
const opts=()=>({uid,requestId,objectId,token,
  actor:{uid:owner,owner:true},nowMs});
const stopOpts=()=>({uid,requestId,actor:{uid:owner,owner:true},nowMs});
class Db {
  constructor(key="erasure-fixture/test-object.webp"){
    this.docs=new Map([
      ["account_deletion_requests/"+uid,{uid,requestId,status:"processing",
        requestedAt:new Date(requestedAtMs),
        eligibleAt:new Date(requestedAtMs+30*86400_000)}],
      ["account_deletion_erasure_checkpoints/"+uid,{uid,requestId,
        phase:"storage_media",destructiveAllowed:true,
        storageRetentionApproved:true,sharedMediaOwnershipReviewed:true,
        legalEvidenceReviewComplete:true,financialSettlementApproved:true,
        playBillingReviewComplete:true}],
      ["users/"+uid,{role:"user",accountStatus:"deletion_processing"}],
      ["storage_objects/"+objectId,{ownerUid:uid,storageKey:key}],
      ["admin_audit_logs/erasure_processing_start_"+requestId,{
        targetId:uid,requestId,action:"accountErasureProcessingAdmitted",
        certifiedDomains:[...domains]}],
    ]);
    seedSyntheticErasureCertificates(this.docs,{uid,requestId,nowMs});
    this.commits=0;
  }
  async beginTransaction(){return "tx";}
  async get(p){return {exists:this.docs.has(p),data:this.docs.get(p)||null};}
  async getMany(paths){return paths.map(p=>({exists:this.docs.has(p),
    data:this.docs.get(p)||null}));}
  writeCreate(path,data){return {path,data};}
  async commit(_,writes){
    for(const write of writes)if(this.docs.has(write.path))
      throw Error("conflicting_create");
    for(const write of writes)this.docs.set(write.path,write.data);
    this.commits++;
  }
  async rollback(){}
}
async function prepared(db){
  await reserve(db,opts());
  await hold(db,opts());
  await journal(db,opts());
}
test("synthetic external delete runs once, but no completion or retry is authorized",async()=>{
  const db=new Db();await prepared(db);let deleted=0;
  const bucket={async delete(key){
    assert.equal(key,"erasure-fixture/test-object.webp");deleted++;
  }};
  const answer=await dispatch(db,bucket,opts());
  assert.equal(answer.dispatched,true);
  assert.equal(answer.completionVerified,false);
  assert.equal(answer.retryAllowed,false);
  assert.equal(deleted,1);
  await assert.rejects(dispatch(db,bucket,opts()),/already_dispatched/);
  assert.equal(deleted,1);
  const saved=db.docs.get("account_erasure_external_io_fixture_dispatches/"+
    uid+"__"+requestId);
  assert.equal(saved.state,"fixture_external_io_may_have_started");
  assert.equal(saved.completionVerified,false);
});
test("owner stop BEFORE dispatch blocks external operation",async()=>{
  const db=new Db();await prepared(db);
  await stop(db,stopOpts());
  let deletes=0;
  await assert.rejects(dispatch(db,{async delete(){deletes++;}},opts()),
    /stopped_or_already_dispatched/);
  assert.equal(deletes,0);
});
test("owner stop DURING delete remains pending, never claims canceled",async()=>{
  const db=new Db();await prepared(db);let deletes=0;
  const answer=await dispatch(db,{async delete(){
    deletes++;
    const revoked=await stop(db,stopOpts());
    assert.equal(revoked.revocationEffective,false);
  }},opts());
  assert.equal(deletes,1);
  assert.equal(answer.revocationEffective,false);
  const intent=db.docs.get("account_erasure_external_io_revocation_intents/"+
    uid+"__"+requestId);
  assert.equal(intent.status,"pending_reconciliation");
  assert.equal(intent.revocationEffective,false);
  assert.equal(db.docs.get("account_erasure_external_io_fixture_dispatches/"+
    uid+"__"+requestId).completionVerified,false);
});
test("unknown R2 outcome freezes dispatch even if initial call timed out",async()=>{
  const db=new Db();await prepared(db);let deletes=0;
  const bucket={async delete(){deletes++;throw Error("network_timeout");}};
  const answer=await dispatch(db,bucket,opts());
  assert.equal(answer.outcome,"unknown");
  assert.equal(answer.retryAllowed,false);
  await assert.rejects(dispatch(db,bucket,opts()),/already_dispatched/);
  assert.equal(deletes,1);
});
test("live-shaped keys and revoked synthetic certificates never dispatch",async()=>{
  for(const live of [true,false]){
    const db=new Db(live?"chats/shared-real-photo.webp":
      "erasure-fixture/test-object.webp");
    await prepared(db);
    if(!live){
      const entries=[...db.docs.entries()];
      const approval=entries.find(([path])=>
        path.startsWith("account_deletion_erasure_approvals/"));
      // Revocation by a participating domain, not checkpoint flags.
      assert.ok(approval,"synthetic approval should exist");
      approval[1].decision="revoked";
    }
    let deleted=0;
    await assert.rejects(dispatch(db,{async delete(){deleted++;}},opts()));
    assert.equal(deleted,0);
  }
});
