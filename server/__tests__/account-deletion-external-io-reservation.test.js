import assert from "node:assert/strict";
import test from "node:test";
import {readFileSync} from "node:fs";
import {reserveAccountErasureExternalIo as reserve,
  requestAccountErasureExternalIoRevocationIntent as requestStop,
  recordAccountErasureExternalIoCoordinationHold as recordHold,
  recordAccountErasureExternalIoUncertainAttempt as recordUncertainAttempt,
  recordAccountErasureExternalIoReadOnlyProbe as recordProbe}
  from "../../cloudflare-worker/src/account-deletion-external-io-reservation.js";
import {openAccountErasureExternalIoReconciliationCase as openCase}
  from "../../cloudflare-worker/src/account-deletion-external-io-reconciliation.js";
import {recordAccountErasureExternalIoIndependentReview as reviewCase}
  from "../../cloudflare-worker/src/account-deletion-external-io-review.js";
import {seedSyntheticErasureCertificates}
  from "./helpers/account-erasure-synthetic-certificates.js";
import {REQUIRED_ERASURE_ADMISSION_DOMAINS as domains}
  from "../../cloudflare-worker/src/account-deletion-processing-admission.js";

const uid="erasure_user_123",requestId="erasure_request_123456",
  objectId="media_object_123456",token="reservation_operation_token_123456",
  owner="test_owner_123456";
const nowMs=Date.parse("2026-10-25T15:00:00Z");
const requestedAtMs=nowMs-40*86400_000;
const resPath="account_erasure_external_io_reservations/"+uid+"__"+objectId;
const opts=(patch={})=>({
  uid,requestId,objectId,token,actor:{uid:owner,owner:true},
  nowMs,...patch,
});
class Db {
  constructor(){
    this.docs=new Map([
      ["account_deletion_requests/"+uid,{
        uid,requestId,status:"processing",
        requestedAt:new Date(requestedAtMs),
        eligibleAt:new Date(requestedAtMs+30*86400_000),
      }],
      ["account_deletion_erasure_checkpoints/"+uid,{
        uid,requestId,phase:"storage_media",destructiveAllowed:true,
        storageRetentionApproved:true,sharedMediaOwnershipReviewed:true,
        legalEvidenceReviewComplete:true,financialSettlementApproved:true,
        playBillingReviewComplete:true,
      }],
      ["users/"+uid,{role:"user",accountStatus:"deletion_processing"}],
      ["storage_objects/"+objectId,{ownerUid:uid,scope:"chat_image",
        storageKey:"chats/synthetic-account/test-photo.webp"}],
      ["admin_audit_logs/erasure_processing_start_"+requestId,{
        targetId:uid,requestId,action:"accountErasureProcessingAdmitted",
        certifiedDomains:[...domains],
      }],
    ]);
    seedSyntheticErasureCertificates(this.docs,{uid,requestId,nowMs});
    this.reads=[];this.commits=[];this.rollbacks=0;
  }
  async beginTransaction(){return "tx_123";}
  async get(path,tx){
    assert.equal(tx,"tx_123");
    this.reads.push(path);
    return {exists:this.docs.has(path),data:this.docs.get(path)||null};
  }
  async getMany(paths,tx){
    assert.equal(tx,"tx_123");
    this.reads.push(...paths);
    return paths.map(path=>({
      exists:this.docs.has(path),data:this.docs.get(path)||null,
    }));
  }
  writeCreate(path,data){return {path,data,op:"create"};}
  async commit(tx,writes){
    assert.equal(tx,"tx_123");
    for(const write of writes){
      if(this.docs.has(write.path))throw Error("document_already_exists");
    }
    this.commits.push(...writes);
    for(const write of writes)this.docs.set(write.path,write.data);
  }
  async rollback(){this.rollbacks++;}
}
test("reservation is an exact one-record Firestore transaction and NEVER R2 delete permission",async()=>{
  const db=new Db();
  const r=await reserve(db,opts());
  assert.deepEqual(r,{
    ok:true,reserved:true,externalIoAllowed:false,
    completionVerified:false,requiresReconciliation:true,
  });
  assert.equal(db.commits.length,1);
  assert.equal(db.commits[0].path,resPath);
  assert.equal(db.docs.get(resPath).state,"reserved_requires_external_interlock");
  assert.equal(db.docs.get(resPath).externalIoAllowed,false);
  assert.equal(db.reads.length,26);
  assert.equal(new Set(db.reads).size,26);
  assert.equal(db.reads.filter(x=>x.startsWith("account_deletion_erasure_approvals/")).length,6);
});
test("reserved token never permits duplicate or stale recovery",async()=>{
  const db=new Db();
  await reserve(db,opts());
  await assert.rejects(reserve(db,opts({token:"another_reservation_token_234567"})),
    e=>e.code==="external_io_reservation_requires_reconciliation");
  assert.equal(db.commits.length,1);
});
test("missing, revoked or appealed independent approval blocks before reservation",async()=>{
  for(const mutate of [
    db=>db.docs.delete("admin_audit_logs/erasure_domain_cert_"+requestId+"__play_billing"),
    db=>db.docs.get("account_deletion_erasure_approvals/"+requestId+
      "__financial_settlement").decision="revoked",
    db=>db.docs.get("account_deletion_erasure_approvals/"+requestId+
      "__moderation_legal").appealPending=true,
  ]){
    const db=new Db();mutate(db);
    await assert.rejects(reserve(db,opts()),
      e=>e.code==="erasure_transactional_certification_blocked");
    assert.equal(db.commits.length,0);
    assert.equal(db.docs.has(resPath),false);
  }
});
test("holds, wrong owner, unauthorized actor, and active production OFF all fail closed",async()=>{
  const cases=[
    db=>db.docs.get("account_deletion_requests/"+uid).legalHold=true,
    db=>db.docs.get("storage_objects/"+objectId).investigationHold=true,
    db=>db.docs.get("storage_objects/"+objectId).ownerUid="another_user",
    db=>db.docs.get("account_deletion_erasure_checkpoints/"+uid).destructiveAllowed=false,
  ];
  for(const mutate of cases){
    const db=new Db();mutate(db);
    await assert.rejects(reserve(db,opts()),
      e=>e.code==="external_io_reservation_not_authorized");
    assert.equal(db.commits.length,0);
  }
  const db=new Db();
  await assert.rejects(reserve(db,opts({actor:{uid:owner,owner:false}})),
    e=>e.code==="owner_required");
  assert.equal(db.reads.length,0);
});
test("30 day grace and wrong request are blockers",async()=>{
  const db=new Db();
  db.docs.get("account_deletion_requests/"+uid).eligibleAt=
    new Date(nowMs+86400_000);
  await assert.rejects(reserve(db,opts()),
    e=>e.code==="external_io_reservation_grace_not_elapsed");
  assert.equal(db.commits.length,0);
  const wrong=new Db();
  wrong.docs.get("account_deletion_requests/"+uid).requestId="other_request_123456";
  await assert.rejects(reserve(wrong,opts()),
    e=>e.code==="external_io_reservation_not_authorized");
});
test("reservation and dispatch stay unrouted; Owner emergency stop is non-destructive",()=>{
  const src=readFileSync(
    "cloudflare-worker/src/account-deletion-external-io-reservation.js","utf8");
  const route=readFileSync("cloudflare-worker/src/admin-inbox.js","utf8");
  // The safe immutable STOP is now intentionally routed through the
  // verified Owner and fresh-auth gate. No reservation/holder/probe or
  // destructive R2 operation is made available through the admin API.
  assert.match(route,/requestAccountErasureExternalIoRevocationIntent\(db/);
  assert.doesNotMatch(route,/(?:reserveAccountErasureExternalIo|recordAccountErasureExternalIoCoordinationHold|recordAccountErasureExternalIoUncertainAttempt|recordAccountErasureExternalIoReadOnlyProbe|rehearseAccountErasureR2Dispatch)\(/);
  for(const bad of ["bucket.delete(", "deleteAuthUser(", "setInterval(", "setTimeout("]){
    assert.equal(src.includes(bad),false);
  }
  assert.match(src,/externalIoAllowed:false/);
});

test("two racing workers cannot both reserve the same immutable object key",async()=>{
  const db=new Db();
  const first=opts({token:"independent_worker_one_123456"});
  const second=opts({token:"independent_worker_two_123456"});
  const outcomes=await Promise.allSettled([
    reserve(db,first),reserve(db,second),
  ]);
  assert.equal(outcomes.filter(x=>x.status==="fulfilled").length,1);
  assert.equal(outcomes.filter(x=>x.status==="rejected").length,1);
  assert.equal(db.commits.length,1);
  assert.equal(db.docs.get(resPath).externalIoAllowed,false);
  assert.equal(db.docs.get(resPath).completionVerified,false);
});
test("unverified prior admission or financial clearance cannot create a reservation",async()=>{
  for(const invalidate of [
    db=>db.docs.delete("admin_audit_logs/erasure_processing_start_"+requestId),
    db=>db.docs.get("account_deletion_erasure_checkpoints/"+uid)
      .financialSettlementApproved=false,
    db=>db.docs.get("account_deletion_erasure_checkpoints/"+uid)
      .sharedMediaOwnershipReviewed=false,
    db=>db.docs.get("admin_audit_logs/erasure_processing_start_"+requestId)
      .certifiedDomains=["moderation_legal"],
  ]){
    const db=new Db();invalidate(db);
    await assert.rejects(reserve(db,opts()),
      e=>e.code==="external_io_reservation_not_authorized");
    assert.equal(db.docs.has(resPath),false);
  }
});

test("reservation groups eight current-state and twelve audited-signoff reads into only two transaction-scoped batchGets",async()=>{
  const db=new Db(),calls=[];
  const real=db.getMany.bind(db);
  db.getMany=async(paths,tx)=>{
    calls.push({count:paths.length,tx});
    return real(paths,tx);
  };
  const result=await reserve(db,opts());
  assert.equal(result.externalIoAllowed,false);
  assert.deepEqual(calls.map(c=>c.count),[8,18]);
  assert.ok(calls.every(c=>c.tx==="tx_123"));
  assert.equal(db.commits.length,1);
});

test("truncated transactional batchGet never creates any reservation",async()=>{
  const db=new Db(),real=db.getMany.bind(db);
  db.getMany=async(paths,tx)=>{
    const result=await real(paths,tx);
    return paths.length===8 ? result.slice(0,7) : result;
  };
  await assert.rejects(reserve(db,opts()),
    e=>e.code==="external_io_transaction_read_failed");
  assert.equal(db.commits.length,0);
  assert.equal(db.docs.has(resPath),false);
});

test("Owner revocation intent is immutable, audited and blocks any NEW reservation",async()=>{
  const db=new Db();
  const payload={uid,requestId,actor:{uid:owner,owner:true},nowMs};
  const intentPath="account_erasure_external_io_revocation_intents/"+
    uid+"__"+requestId;
  const auditPath="admin_audit_logs/erasure_external_io_revocation_intent_"+
    requestId;
  const stopped=await requestStop(db,payload);
  assert.deepEqual(stopped,{
    ok:true,revocationIntentCreated:true,revocationEffective:false,
    pendingReconciliation:true,coordinationHoldObserved:false,
    uncertainAttemptObserved:false,externalIoAllowed:false,
  });
  assert.equal(db.docs.get(intentPath).status,"pending_reconciliation");
  assert.equal(db.docs.get(intentPath).revocationEffective,false);
  assert.equal(db.docs.get(auditPath).action,
    "accountErasureExternalIoRevocationIntent");
  assert.equal(db.commits.length,2);
  await assert.rejects(reserve(db,opts()),
    e=>e.code==="external_io_revocation_intent_pending");
  assert.equal(db.docs.has(resPath),false);
  await assert.rejects(requestStop(db,payload),
    e=>e.code==="external_io_revocation_requires_reconciliation");
  assert.equal(db.commits.length,2);
});
test("revocation intent works without active signoffs but NEVER revokes them itself",async()=>{
  const db=new Db();
  const approvalPath="account_deletion_erasure_approvals/"+
    requestId+"__play_billing";
  const before={...db.docs.get(approvalPath)};
  db.docs.get(approvalPath).decision="revoked";
  const result=await requestStop(db,{
    uid,requestId,actor:{uid:owner,owner:true},nowMs,
  });
  assert.equal(result.revocationEffective,false);
  assert.equal(db.docs.get(approvalPath).decision,"revoked");
  assert.equal(before.requestId,db.docs.get(approvalPath).requestId);
  assert.equal(db.commits.length,2);
});
test("revocation-intent invalid targets and actors cannot write",async()=>{
  const db=new Db();
  for (const patch of [
    {actor:{uid:owner,owner:false}},
    {uid:"bad!"},
    {requestId:"short"},
    {nowMs:-1},
  ]) {
    await assert.rejects(requestStop(db,{
      uid,requestId,actor:{uid:owner,owner:true},nowMs,...patch,
    }));
  }
  assert.equal(db.reads.length,0);
  assert.equal(db.commits.length,0);
});

test("revocation requested after an existing reservation remains pending, never effective",async()=>{
  const db=new Db();
  await reserve(db,opts());
  const stateBefore={...db.docs.get(resPath)};
  const outcome=await requestStop(db,{
    uid,requestId,actor:{uid:owner,owner:true},nowMs,
  });
  assert.equal(outcome.revocationEffective,false);
  assert.equal(outcome.pendingReconciliation,true);
  assert.deepEqual(db.docs.get(resPath),stateBefore);
  assert.equal(db.docs.get(resPath).externalIoAllowed,false);
  await assert.rejects(reserve(db,opts({
    token:"another_operation_token_987654",
  })),e=>e.code==="external_io_revocation_intent_pending");
  assert.equal(db.commits.length,3);
});

test("malformed intent batchGet slot FAILS CLOSED instead of treating it as no revocation",async()=>{
  for(const corrupted of [undefined,null,{},{
    exists:"false",data:null,
  }]){
    const db=new Db(),read=db.getMany.bind(db);
    db.getMany=async(paths,tx)=>{
      const docs=await read(paths,tx);
      if(paths.length===8)docs[6]=corrupted;
      return docs;
    };
    await assert.rejects(reserve(db,opts()),
      e=>e.code==="external_io_transaction_read_failed");
    assert.equal(db.docs.has(resPath),false);
    assert.equal(db.commits.length,0);
  }
});

test("request-wide hold blocks reservations for OTHER objects even before Owner stop",async()=>{
  const db=new Db(),secondId="another_media_object_999999";
  db.docs.set("storage_objects/"+secondId,{ownerUid:uid,scope:"chat_image"});
  await reserve(db,opts());
  await recordHold(db,opts());
  const existingWrites=db.commits.length;
  await assert.rejects(reserve(db,opts({
    objectId:secondId,token:"another_media_token_1234567890",
  })),e=>e.code==="external_io_coordination_requires_reconciliation");
  assert.equal(db.commits.length,existingWrites);
  assert.equal(db.docs.has(
    "account_erasure_external_io_reservations/"+uid+"__"+secondId),false);
  assert.equal(db.docs.get("account_erasure_external_io_coordination_holds/"+
    uid+"__"+requestId).externalIoAllowed,false);
});

test("malformed request-wide hold batchGet slot always blocks new reservations",async()=>{
  for(const invalid of [undefined,null,{}, {exists:"false"}]){
    const db=new Db(),orig=db.getMany.bind(db);
    db.getMany=async(paths,tx)=>{
      const rows=await orig(paths,tx);
      if(paths.length===8)rows[7]=invalid;
      return rows;
    };
    await assert.rejects(reserve(db,opts()),
      e=>e.code==="external_io_transaction_read_failed");
    assert.equal(db.commits.length,0);
  }
});

test("non-permissive coordination holder and stop writer share immutable request fence",async()=>{
  const db=new Db();
  const holdPath="account_erasure_external_io_coordination_holds/"+
    uid+"__"+requestId;
  await reserve(db,opts());
  const held=await recordHold(db,opts());
  assert.deepEqual(held,{
    ok:true,holdRecorded:true,externalIoAllowed:false,
    revocationEffective:false,pendingReconciliation:true,
  });
  const saved={...db.docs.get(holdPath)};
  assert.equal(saved.state,"claimed_requires_external_interlock");
  assert.equal(saved.externalIoAllowed,false);
  assert.equal(saved.completionVerified,false);
  await assert.rejects(recordHold(db,opts()),
    e=>e.code==="external_io_coordination_requires_reconciliation");
  const stopped=await requestStop(db,{
    uid,requestId,actor:{uid:owner,owner:true},nowMs,
  });
  assert.equal(stopped.coordinationHoldObserved,true);
  assert.equal(stopped.revocationEffective,false);
  assert.equal(db.docs.get("account_erasure_external_io_revocation_intents/"+
    uid+"__"+requestId).coordinationHoldObserved,true);
  assert.deepEqual(db.docs.get(holdPath),saved);
  assert.equal(db.docs.get(resPath).externalIoAllowed,false);
  await assert.rejects(recordHold(db,opts()),
    e=>e.code==="external_io_revocation_intent_pending");
  assert.equal(db.docs.get(holdPath).externalIoAllowed,false);
});

test("stop before holder or invalid operation token permanently denies coordination hold",async()=>{
  const prior=new Db();
  await reserve(prior,opts());
  await requestStop(prior,{uid,requestId,actor:{uid:owner,owner:true},nowMs});
  await assert.rejects(recordHold(prior,opts()),
    e=>e.code==="external_io_revocation_intent_pending");
  assert.equal([...prior.docs.keys()].some(p=>
    p.startsWith("account_erasure_external_io_coordination_holds/")),false);
  const invalid=new Db();
  await reserve(invalid,opts());
  await assert.rejects(recordHold(invalid,opts({token:"wrong_reservation_token_123456"})),
    e=>e.code==="external_io_coordination_not_authorized");
  assert.equal([...invalid.docs.keys()].some(p=>
    p.startsWith("account_erasure_external_io_coordination_holds/")),false);
  invalid.docs.get("account_deletion_requests/"+uid).legalHold=true;
  await assert.rejects(recordHold(invalid,opts()),
    e=>e.code==="external_io_coordination_not_authorized");
});

test("two workers cannot create two coordination holders, including different objects",async()=>{
  const db=new Db(),object2="media_object_654321",token2="holder_second_token_123456";
  await reserve(db,opts());
  db.docs.set("storage_objects/"+object2,{ownerUid:uid,scope:"chat_image"});
  await reserve(db,opts({objectId:object2,token:token2}));
  const races=await Promise.allSettled([
    recordHold(db,opts()),
    recordHold(db,opts({objectId:object2,token:token2})),
  ]);
  assert.equal(races.filter(r=>r.status==="fulfilled").length,1);
  assert.equal(races.filter(r=>r.status==="rejected").length,1);
  assert.equal([...db.docs.keys()].filter(p=>
    p.startsWith("account_erasure_external_io_coordination_holds/")).length,1);
});

test("incomplete coordination or stop transaction snapshot never writes a hold or stop",async()=>{
  for(const fn of ["holder","stop"]){
    const db=new Db();
    if(fn==="holder")await reserve(db,opts());
    const commits=db.commits.length,read=db.getMany.bind(db);
    db.getMany=async(paths,tx)=>{
      const docs=await read(paths,tx);
      if(paths.length===(fn==="holder"?8:6))
        docs[docs.length-1]=undefined;
      return docs;
    };
    await assert.rejects(fn==="holder" ? recordHold(db,opts())
      : requestStop(db,{uid,requestId,actor:{uid:owner,owner:true},nowMs}),
      e=>e.code==="external_io_transaction_read_failed");
    assert.equal(db.commits.length,commits);
  }
});

test("uncertain R2 attempt journal is immutable, non-permissive and never retryable",async()=>{
  const db=new Db();
  await reserve(db,opts());
  await recordHold(db,opts());
  const recorded=await recordUncertainAttempt(db,opts());
  assert.deepEqual(recorded,{
    ok:true,uncertainAttemptRecorded:true,
    outcomeUnknown:true,retryAllowed:false,externalIoAllowed:false,
    completionVerified:false,pendingReconciliation:true,
  });
  const path="account_erasure_external_io_uncertain_attempts/"+
    uid+"__"+requestId;
  const journal={...db.docs.get(path)};
  assert.equal(journal.state,"outcome_unknown_requires_reconciliation");
  assert.equal(journal.retryAllowed,false);
  await assert.rejects(recordUncertainAttempt(db,opts()),
    e=>e.code==="external_io_uncertain_attempt_requires_reconciliation");
  assert.deepEqual(db.docs.get(path),journal);
  const stop=await requestStop(db,{
    uid,requestId,actor:{uid:owner,owner:true},nowMs,
  });
  assert.equal(stop.uncertainAttemptObserved,true);
  assert.equal(stop.coordinationHoldObserved,true);
  assert.equal(stop.revocationEffective,false);
  assert.equal(db.docs.get("account_erasure_external_io_revocation_intents/"+
    uid+"__"+requestId).uncertainAttemptObserved,true);
  assert.deepEqual(db.docs.get(path),journal);
  await assert.rejects(recordUncertainAttempt(db,opts()),
    e=>e.code==="external_io_revocation_intent_pending");
});

test("Owner stop before unknown-outcome journal blocks record without new writes",async()=>{
  const db=new Db();await reserve(db,opts());await recordHold(db,opts());
  await requestStop(db,{uid,requestId,actor:{uid:owner,owner:true},nowMs});
  const count=db.commits.length;
  await assert.rejects(recordUncertainAttempt(db,opts()),
    e=>e.code==="external_io_revocation_intent_pending");
  assert.equal(db.commits.length,count);
  assert.equal([...db.docs.keys()].some(path=>
    path.startsWith("account_erasure_external_io_uncertain_attempts/")),false);
});

test("unknown-outcome journal requires matching claimed hold, token, and fresh approvals",async()=>{
  const cases=[
    db=>db.docs.delete("account_erasure_external_io_coordination_holds/"+
      uid+"__"+requestId),
    db=>db.docs.get("account_erasure_external_io_coordination_holds/"+
      uid+"__"+requestId).operationToken="another_operation_token_123456",
    db=>db.docs.get("account_erasure_external_io_reservations/"+
      uid+"__"+objectId).externalIoAllowed=true,
    db=>db.docs.get("account_deletion_erasure_approvals/"+
      requestId+"__play_billing").decision="revoked",
    db=>db.docs.get("account_deletion_requests/"+uid).legalHold=true,
  ];
  for(const mutate of cases){
    const db=new Db();await reserve(db,opts());await recordHold(db,opts());
    mutate(db);const count=db.commits.length;
    await assert.rejects(recordUncertainAttempt(db,opts()));
    assert.equal(db.commits.length,count);
    assert.equal([...db.docs.keys()].some(path=>
      path.startsWith("account_erasure_external_io_uncertain_attempts/")),false);
  }
});

test("read-only R2 head records immutable PRESENT evidence without allowing delete or retry",async()=>{
  const db=new Db();await reserve(db,opts());await recordHold(db,opts());
  await recordUncertainAttempt(db,opts());
  let heads=0,deletes=0;
  const result=await recordProbe(db,{
    async head(key){
      heads++;
      assert.equal(key,"chats/synthetic-account/test-photo.webp");
      return {etag:"fake-etag-one",size:172};
    },
    async delete(){deletes++;throw Error("delete_is_forbidden");},
  },{...opts(),probeId:"probe_first_observation_123456"});
  assert.deepEqual(result,{
    ok:true,observationRecorded:true,
    presenceAtProbe:"present_at_probe",stopObservedAtCommit:false,
    retryAllowed:false,externalIoAllowed:false,
    completionVerified:false,pendingReconciliation:true,
  });
  assert.equal(heads,1);assert.equal(deletes,0);
  const path="account_erasure_external_io_probe_observations/"+
    uid+"__"+requestId+"__probe_first_observation_123456";
  const doc={...db.docs.get(path)};
  assert.equal(doc.observedEtag,"fake-etag-one");
  assert.equal(doc.observedSizeBytes,172);
  assert.equal(doc.completionVerified,false);
  await assert.rejects(recordProbe(db,{
    async head(){heads++;throw Error("duplicate_must_not_call_head");},
  },{...opts(),probeId:"probe_first_observation_123456"}),
    e=>e.code==="external_io_probe_already_recorded");
  assert.equal(heads,1);
  assert.deepEqual(db.docs.get(path),doc);
});

test("read-only R2 head absence cannot certify an earlier delete or effective stop",async()=>{
  const db=new Db();await reserve(db,opts());await recordHold(db,opts());
  await recordUncertainAttempt(db,opts());
  const stopped=await requestStop(db,{
    uid,requestId,actor:{uid:owner,owner:true},nowMs,
  });
  assert.equal(stopped.revocationEffective,false);
  const found=await recordProbe(db,{
    async head(){return null;},
    async delete(){throw Error("forbidden");},
  },{...opts(),probeId:"probe_after_stop_observation_123456"});
  assert.equal(found.presenceAtProbe,"absent_at_probe");
  assert.equal(found.stopObservedAtCommit,true);
  assert.equal(found.completionVerified,false);
  assert.equal(found.retryAllowed,false);
  assert.equal(db.docs.get("account_erasure_external_io_revocation_intents/"+
    uid+"__"+requestId).revocationEffective,false);
  assert.equal(db.docs.get("account_erasure_external_io_uncertain_attempts/"+
    uid+"__"+requestId).retryAllowed,false);
});

test("R2 probe error and object metadata replacement leave no false evidence",async()=>{
  const cases=[
    async(db)=>({
      async head(){throw Error("R2_TIMEOUT");},
    }),
    async(db)=>({
      async head(){return undefined;},
    }),
    async(db)=>({
      async head(){
        db.docs.get("storage_objects/"+objectId).storageKey=
          "other/key/possibly-reused.webp";
        return {etag:"fake"};
      },
    }),
  ];
  for(const setup of cases){
    const db=new Db();await reserve(db,opts());await recordHold(db,opts());
    await recordUncertainAttempt(db,opts());
    const bucket=await setup(db);
    const count=db.commits.length;
    await assert.rejects(recordProbe(db,bucket,{
      ...opts(),probeId:"probe_error_guard_123456789",
    }));
    assert.equal(db.commits.length,count);
    assert.equal([...db.docs.keys()].some(path=>
      path.startsWith("account_erasure_external_io_probe_observations/")),false);
  }
});

test("a stop arriving DURING read-only R2 head remains pending and appears in evidence",async()=>{
  const db=new Db();await reserve(db,opts());await recordHold(db,opts());
  await recordUncertainAttempt(db,opts());
  let headCount=0;
  const result=await recordProbe(db,{
    async head(){
      headCount++;
      const stop=await requestStop(db,{
        uid,requestId,actor:{uid:owner,owner:true},nowMs,
      });
      assert.equal(stop.revocationEffective,false);
      return {etag:"inflight-probe"};
    },
    async delete(){throw Error("forbidden");},
  },{...opts(),probeId:"probe_concurrent_stop_123456789"});
  assert.equal(headCount,1);
  assert.equal(result.stopObservedAtCommit,true);
  assert.equal(result.completionVerified,false);
});

test("uncertain journal truncated Firestore snapshots fail closed",async()=>{
  const db=new Db();await reserve(db,opts());await recordHold(db,opts());
  const before=db.commits.length,read=db.getMany.bind(db);
  db.getMany=async(paths,tx)=>{
    const rows=await read(paths,tx);
    return paths.length===9?rows.slice(0,8):rows;
  };
  await assert.rejects(recordUncertainAttempt(db,opts()),
    e=>e.code==="external_io_transaction_read_failed");
  assert.equal(db.commits.length,before);
});

const manualCaseOpts=(patch={})=>({...opts(),firstProbeId:
  "reconcile_probe_first_123456",secondProbeId:
  "reconcile_probe_second_123456",nowMs:nowMs+2000,...patch});
async function prepareManualCase(db,heads=[{etag:"still-present",size:17},null]){
  await reserve(db,opts());
  await recordHold(db,opts());
  await recordUncertainAttempt(db,opts());
  await requestStop(db,{uid,requestId,actor:{uid:owner,owner:true},nowMs});
  for(const [i,head] of heads.entries()){
    await recordProbe(db,{async head(key){
      assert.equal(key,"chats/synthetic-account/test-photo.webp");
      return head;
    },async delete(){throw Error("no_reconciliation_delete");}},{
      ...opts(),
      nowMs:nowMs+i*1000,
      probeId:i===0?"reconcile_probe_first_123456":
        "reconcile_probe_second_123456",
    });
  }
}
test("two ordered post-stop observations produce a durable non-permissive manual case",async()=>{
  const db=new Db();
  await prepareManualCase(db);
  const result=await openCase(db,manualCaseOpts());
  assert.deepEqual(result,{
    ok:true,caseOpened:true,
    classification:"absence_does_not_prove_historical_deletion",
    pendingIndependentReview:true,requiresProviderEvidence:true,
    retryAllowed:false,externalIoAllowed:false,
    completionVerified:false,revocationEffective:false,
  });
  const casePath="account_erasure_external_io_reconciliation_cases/"+
    uid+"__"+requestId;
  const evidence=db.docs.get(casePath);
  assert.equal(evidence.observations.length,2);
  assert.equal(evidence.observations[0].presenceAtProbe,"present_at_probe");
  assert.equal(evidence.observations[1].presenceAtProbe,"absent_at_probe");
  assert.equal(evidence.status,"awaiting_independent_evidence_review");
  assert.equal(evidence.retryAllowed,false);
  assert.equal(evidence.completionVerified,false);
  assert.equal(db.docs.get("admin_audit_logs/erasure_external_io_reconciliation_case_"+
    requestId).completionVerified,false);
  await assert.rejects(openCase(db,manualCaseOpts()),
    e=>e.code==="external_io_reconciliation_case_already_open");
  assert.equal(db.docs.get(casePath),evidence);
});
test("still-present two-probe result stays blocked; missing metadata cannot rewrite pinned key",async()=>{
  const db=new Db();
  await prepareManualCase(db,[{etag:"same-object",size:17},
    {etag:"same-object",size:17}]);
  db.docs.delete("storage_objects/"+objectId);
  const result=await openCase(db,manualCaseOpts());
  assert.equal(result.classification,
    "object_present_requires_non_destructive_resolution");
  assert.equal(result.externalIoAllowed,false);
  assert.equal(result.completionVerified,false);
  assert.equal(db.docs.get("account_erasure_external_io_uncertain_attempts/"+
    uid+"__"+requestId).retryAllowed,false);
});
test("out-of-order, missing, tampered and pre-stop observations cannot open a case",async()=>{
  const cases=[
    db=>db.docs.delete("account_erasure_external_io_probe_observations/"+
      uid+"__"+requestId+"__reconcile_probe_second_123456"),
    db=>db.docs.get("account_erasure_external_io_probe_observations/"+
      uid+"__"+requestId+"__reconcile_probe_second_123456").
      storageKey="a/replaced-key",
    db=>db.docs.get("account_erasure_external_io_probe_observations/"+
      uid+"__"+requestId+"__reconcile_probe_first_123456").
      stopObservedAtCommit=false,
    db=>db.docs.get("account_erasure_external_io_probe_observations/"+
      uid+"__"+requestId+"__reconcile_probe_first_123456").
      completionVerified=true,
    db=>db.docs.get("account_erasure_external_io_probe_observations/"+
      uid+"__"+requestId+"__reconcile_probe_first_123456").
      observedAt=new Date(nowMs+1500),
    db=>db.docs.get("account_erasure_external_io_revocation_intents/"+
      uid+"__"+requestId).revocationEffective=true,
    db=>db.docs.get("storage_objects/"+objectId).
      storageKey="a/replaced-key",
  ];
  for(const corrupt of cases){
    const db=new Db();await prepareManualCase(db);
    corrupt(db);
    await assert.rejects(openCase(db,manualCaseOpts()));
    assert.equal(db.docs.has("account_erasure_external_io_reconciliation_cases/"+
      uid+"__"+requestId),false);
    assert.equal(db.docs.has("admin_audit_logs/erasure_external_io_reconciliation_case_"+
      requestId),false);
  }
});
test("withdrawn approval never blocks emergency reconciliation but never grants R2 retry",async()=>{
  const db=new Db();await prepareManualCase(db);
  db.docs.get("account_deletion_erasure_approvals/"+
    requestId+"__play_billing").decision="revoked";
  const result=await openCase(db,manualCaseOpts());
  assert.equal(result.ok,true);
  assert.equal(result.retryAllowed,false);
  assert.equal(result.revocationEffective,false);
  await assert.rejects(openCase(db,manualCaseOpts({
    actor:{uid:owner,owner:false},
  })),e=>e.code==="owner_required");
});

test("historical withdrawal audit defeats an approved decision resurrected later",async()=>{
  const db=new Db();
  db.docs.set("admin_audit_logs/erasure_domain_withdrawal_"+
    requestId+"__play_billing",{action:"accountErasureDomainWithdrawnWithExternalIoStop",
      targetId:uid,requestId,domain:"play_billing"});
  await assert.rejects(reserve(db,opts()),
    e=>e.code==="erasure_transactional_certification_blocked");
  assert.equal(db.docs.has(resPath),false);
});

const independentReviewer="independent_reviewer_user_456789";
const externalReviewOpts=(patch={})=>({
  uid,requestId,objectId,token,grantIssuerUid:owner,
  actor:{uid:independentReviewer,evidenceReviewer:true},
  assessment:"provider_evidence_submitted_unverified",
  evidenceDigestSha256:"a".repeat(64),
  nowMs:nowMs+3000,...patch,
});
function seedIndependentReviewerGrant(db,patch={}){
  const reviewer=independentReviewer;
  const grantPath="account_erasure_external_io_reviewer_grants/"+
    uid+"__"+requestId+"__"+reviewer;
  const auditPath="admin_audit_logs/erasure_external_io_reviewer_grant_"+
    requestId+"__"+reviewer;
  const issuedAt=new Date(nowMs+2000);
  db.docs.set("users/"+reviewer,{uid:reviewer,role:"admin",
    adminEnabled:true,capabilities:["reviewAccountErasureR2Evidence"],
    accountStatus:"active"});
  db.docs.set("users/"+owner,{uid:owner,role:"owner",
    accountStatus:"active"});
  db.docs.set(grantPath,{uid,requestId,objectId,reviewerUid:reviewer,
    grantedByUid:owner,scope:"account_erasure_r2_reconciliation",
    status:"active",revoked:false,grantedAt:issuedAt,
    expiresAt:new Date(issuedAt.getTime()+3600_000),...patch});
  db.docs.set(auditPath,{action:"accountErasureExternalIoReviewerGrantRecorded",
    targetId:uid,requestId,objectId,reviewerUid:reviewer,
    actorUid:owner,createdAt:issuedAt});
}
async function readyReviewCase(db){
  await prepareManualCase(db);
  await openCase(db,manualCaseOpts());
  seedIndependentReviewerGrant(db);
}
test("independent review writes two immutable records and never resolves R2 outcome",async()=>{
  const db=new Db();await readyReviewCase(db);
  const result=await reviewCase(db,externalReviewOpts());
  assert.deepEqual(result,{
    ok:true,reviewRecorded:true,
    assessment:"provider_evidence_submitted_unverified",
    stillUnresolved:true,externalIoAllowed:false,retryAllowed:false,
    completionVerified:false,revocationEffective:false,
  });
  const p="account_erasure_external_io_independent_reviews/"+
    uid+"__"+requestId,review=db.docs.get(p);
  assert.equal(review.reviewerUid,independentReviewer);
  assert.equal(review.claimedEvidenceDigestSha256,"a".repeat(64));
  assert.equal(review.evidenceAuthenticityVerified,false);
  assert.equal(review.providerHistoryVerified,false);
  assert.equal(review.completionVerified,false);
  assert.equal(review.retryAllowed,false);
  assert.equal(db.docs.get("account_erasure_external_io_reconciliation_cases/"+
    uid+"__"+requestId).status,"awaiting_independent_evidence_review");
  assert.equal(db.docs.get("account_erasure_external_io_revocation_intents/"+
    uid+"__"+requestId).revocationEffective,false);
  assert.equal(db.docs.get("admin_audit_logs/erasure_external_io_independent_review_"+
    requestId).completionVerified,false);
  await assert.rejects(reviewCase(db,externalReviewOpts()),
    e=>e.code==="independent_external_io_review_already_recorded");
});
test("reviewer cannot be Owner who requested stop or observed either HEAD",async()=>{
  const db=new Db();await readyReviewCase(db);
  await assert.rejects(reviewCase(db,externalReviewOpts({
    actor:{uid:owner,evidenceReviewer:true},
  })),e=>e.code==="independent_external_io_review_identity_or_fence_mismatch"||
      e.code==="independent_external_io_review_grant_invalid");
  await assert.rejects(reviewCase(db,externalReviewOpts({
    actor:{uid:independentReviewer,evidenceReviewer:false},
  })),e=>e.code==="independent_evidence_reviewer_required");
  assert.equal(db.docs.has("account_erasure_external_io_independent_reviews/"+
    uid+"__"+requestId),false);
});
test("independent review rejects raw evidence/URL payloads and permits only opaque SHA256",async()=>{
  const db=new Db();await readyReviewCase(db);
  for(const patch of [
    {evidenceDigestSha256:"https://example.invalid/private-evidence"},
    {evidenceDigestSha256:""},
    {assessment:"confirmed_deleted"},
    {assessment:"external_proof_complete"},
    {nowMs:-1},
    {requestId:"other"},
    {grantIssuerUid:"wrong_issuer_123456"},
  ]){
    await assert.rejects(reviewCase(db,externalReviewOpts(patch)));
  }
  assert.equal(db.docs.has("account_erasure_external_io_independent_reviews/"+
    uid+"__"+requestId),false);
});
test("tampered case/probe/stop or missing transaction slots block independent reviewer",async()=>{
  for(const damage of [
    db=>db.docs.get("account_erasure_external_io_reconciliation_cases/"+
      uid+"__"+requestId).completionVerified=true,
    db=>db.docs.get("account_erasure_external_io_reconciliation_cases/"+
      uid+"__"+requestId).storageKey="changed/shared-key",
    db=>db.docs.get("account_erasure_external_io_probe_observations/"+
      uid+"__"+requestId+"__reconcile_probe_second_123456").completionVerified=true,
    db=>db.docs.get("account_erasure_external_io_probe_observations/"+
      uid+"__"+requestId+"__reconcile_probe_first_123456").observedByUid=
      independentReviewer,
    db=>db.docs.get("account_erasure_external_io_revocation_intents/"+
      uid+"__"+requestId).revocationEffective=true,
    db=>db.docs.delete("account_erasure_external_io_coordination_holds/"+
      uid+"__"+requestId),
    db=>db.getMany=async()=>[],
  ]){
    const db=new Db();await readyReviewCase(db);
    damage(db);
    await assert.rejects(reviewCase(db,externalReviewOpts()));
    assert.equal(db.docs.has("account_erasure_external_io_independent_reviews/"+
      uid+"__"+requestId),false);
    assert.equal(db.docs.has("admin_audit_logs/erasure_external_io_independent_review_"+
      requestId),false);
  }
});
test("emergency independent review remains non-destructive after prior certificate withdrawal",async()=>{
  const db=new Db();await readyReviewCase(db);
  db.docs.get("account_deletion_erasure_approvals/"+
    requestId+"__play_billing").decision="revoked";
  const review=await reviewCase(db,externalReviewOpts({
    assessment:"external_history_discrepancy",
  }));
  assert.equal(review.stillUnresolved,true);
  assert.equal(review.completionVerified,false);
  assert.equal(db.docs.get("account_erasure_external_io_uncertain_attempts/"+
    uid+"__"+requestId).retryAllowed,false);
});

test("caller evidenceReviewer flag alone cannot replace current audited case-scoped grant",async()=>{
  for(const revoke of [
    db=>db.docs.delete("account_erasure_external_io_reviewer_grants/"+
      uid+"__"+requestId+"__"+independentReviewer),
    db=>db.docs.delete("admin_audit_logs/erasure_external_io_reviewer_grant_"+
      requestId+"__"+independentReviewer),
    db=>db.docs.delete("users/"+independentReviewer),
    db=>db.docs.get("users/"+independentReviewer).adminEnabled=false,
    db=>db.docs.get("users/"+independentReviewer).capabilities=[],
    db=>db.docs.get("users/"+independentReviewer).accountStatus="deleted",
    db=>db.docs.get("account_erasure_external_io_reviewer_grants/"+
      uid+"__"+requestId+"__"+independentReviewer).status="revoked",
    db=>db.docs.get("account_erasure_external_io_reviewer_grants/"+
      uid+"__"+requestId+"__"+independentReviewer).expiresAt=new Date(nowMs+1000),
    db=>db.docs.get("account_erasure_external_io_reviewer_grants/"+
      uid+"__"+requestId+"__"+independentReviewer).scope="all",
    db=>db.docs.get("account_erasure_external_io_reviewer_grants/"+
      uid+"__"+requestId+"__"+independentReviewer).requestId="other_request_123456",
    db=>db.docs.get("admin_audit_logs/erasure_external_io_reviewer_grant_"+
      requestId+"__"+independentReviewer).actorUid=independentReviewer,
    db=>db.docs.get("users/"+owner).role="admin",
  ]){
    const db=new Db();await readyReviewCase(db);
    revoke(db);
    await assert.rejects(reviewCase(db,externalReviewOpts()),
      e=>e.code==="independent_external_io_review_grant_invalid"||
        e.code==="independent_external_io_review_grant_issuer_invalid");
    assert.equal(db.docs.has("account_erasure_external_io_independent_reviews/"+
      uid+"__"+requestId),false);
  }
});

test("immutable revoked-grant tombstone overrides restored active mutable grant",async()=>{
  const db=new Db();await readyReviewCase(db);
  const revoked="admin_audit_logs/erasure_external_io_reviewer_grant_revoked_"+
    requestId+"__"+independentReviewer;
  db.docs.set(revoked,{
    action:"accountErasureExternalIoReviewerGrantRevoked",
    targetId:uid,requestId,reviewerUid:independentReviewer,
  });
  // Maliciously restored mutable fields are insufficient.
  const mutable=db.docs.get("account_erasure_external_io_reviewer_grants/"+
    uid+"__"+requestId+"__"+independentReviewer);
  mutable.status="active";mutable.revoked=false;
  await assert.rejects(reviewCase(db,externalReviewOpts()),
    e=>e.code==="independent_external_io_review_grant_invalid");
  assert.equal(db.docs.has("account_erasure_external_io_independent_reviews/"+
    uid+"__"+requestId),false);
  assert.equal(db.docs.get("account_erasure_external_io_revocation_intents/"+
    uid+"__"+requestId).revocationEffective,false);
});
