import assert from "node:assert/strict";
import test from "node:test";
import {readFileSync} from "node:fs";
import {reserveAccountErasureExternalIo as reserve,
  requestAccountErasureExternalIoRevocationIntent as requestStop}
  from "../../cloudflare-worker/src/account-deletion-external-io-reservation.js";
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
      ["storage_objects/"+objectId,{ownerUid:uid,scope:"chat_image"}],
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
  assert.equal(db.reads.length,19);
  assert.equal(new Set(db.reads).size,19);
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
test("reserved I/O primitive has no route, timer, bucket usage, or Auth removal",()=>{
  const src=readFileSync(
    "cloudflare-worker/src/account-deletion-external-io-reservation.js","utf8");
  const route=readFileSync("cloudflare-worker/src/admin-inbox.js","utf8");
  assert.doesNotMatch(route,/account-deletion-external-io-reservation/);
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

test("reservation groups six current-state and twelve audited-signoff reads into only two transaction-scoped batchGets",async()=>{
  const db=new Db(),calls=[];
  const real=db.getMany.bind(db);
  db.getMany=async(paths,tx)=>{
    calls.push({count:paths.length,tx});
    return real(paths,tx);
  };
  const result=await reserve(db,opts());
  assert.equal(result.externalIoAllowed,false);
  assert.deepEqual(calls.map(c=>c.count),[7,12]);
  assert.ok(calls.every(c=>c.tx==="tx_123"));
  assert.equal(db.commits.length,1);
});

test("truncated transactional batchGet never creates any reservation",async()=>{
  const db=new Db(),real=db.getMany.bind(db);
  db.getMany=async(paths,tx)=>{
    const result=await real(paths,tx);
    return paths.length===7 ? result.slice(0,6) : result;
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
    pendingReconciliation:true,externalIoAllowed:false,
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
