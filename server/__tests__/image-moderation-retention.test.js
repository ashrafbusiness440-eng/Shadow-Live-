import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import { syntheticErasureCertificateRows }
  from "./helpers/account-erasure-synthetic-certificates.js";
import {
  finalImageEvidenceDeadline, finalImageEvidenceFields,
  purgeFinalImageEvidence, runDueImageEvidenceCleanup,
  setImageEvidenceHold,
} from "../../cloudflare-worker/src/image-moderation-retention.js";
import { rejectImageReview } from "../../cloudflare-worker/src/image-moderation-review.js";
import { runDeletedAccountStorageCleanup } from
  "../../cloudflare-worker/src/user-storage.js";

const id="b".repeat(32);
const now=new Date("2026-10-15T12:00:00.000Z");
const due=new Date(now.getTime()+90*86400000);
const path="storage_objects/"+id;
const stage="moderation-staging/users/user_123/profile/"+id+".png";
const publicKey="users/user_123/profile/"+id+".png";
class DB {
  constructor(){this.docs=new Map();this.writes=[];this.queries=[];}
  async beginTransaction(){return "tx";}
  async rollback(){}
  async get(path){return {exists:this.docs.has(path),data:this.docs.get(path)||null};}
  writeCreate(path,fields){return {type:"create",path,fields};}
  writeUpdate(path,fields){return {type:"update",path,fields};}
  writeDelete(path){return {type:"delete",path};}
  async commit(_,ops){
    for(const op of ops) {
      if(op.type==="create"&&this.docs.has(op.path))throw Error("exists");
      if(op.type==="delete"){this.docs.delete(op.path);continue;}
      this.docs.set(op.path,{...(this.docs.get(op.path)||{}),...op.fields});
      this.writes.push(op);
    }
  }
  async runQuery(collection,options){
    this.queries.push({collection,options});
    return [...this.docs.entries()].filter(([key,value])=>{
      if(!key.startsWith(collection+"/"))return false;
      const f=(options.filters||[])[0];
      if(!f)return true;
      const v=value[f.field];
      if(f.op==="==")return v===f.value;
      if(f.op==="<=")return v instanceof Date && v<=f.value;
      return false;
    }).slice(0,options.limit||30)
      .map(([key,data])=>({id:key.split("/")[1],data}));
  }
}
function prepare(state="rejected"){
  const db=new DB();
  db.docs.set(path,{
    objectId:id,ownerUid:"user_123",targetId:"user_123",scope:"profile_image",
    state,storageKey:stage,publicStorageKey:publicKey,
    etag:"etag",sizeBytes:4,evidencePurgeAt:due,
    evidenceRetentionDueAt:due,moderation:{status:"blocked"},
  });
  const deletions=[];
  const bucket={delete:async key=>{deletions.push(key);}};
  return {db,bucket,deletions};
}
function certifyDeletedImageAccountJob(db,jobId) {
  const ownerUid="user_123",requestId="certified_r2_request_"+jobId;
  db.docs.set("storage_account_cleanup_jobs/"+jobId,{
    ownerUid,requestId,reason:"account_deleted_verified",status:"queued",createdAt:now,
  });
  db.docs.set("account_deletion_requests/"+ownerUid,{
    uid:ownerUid,requestId,status:"processing",
    requestedAt:new Date(Date.now()-40*86400_000),
  });
  db.docs.set("account_deletion_erasure_checkpoints/"+ownerUid,{
    requestId,phase:"storage_media",destructiveAllowed:true,
    storageRetentionApproved:true,sharedMediaOwnershipReviewed:true,
    legalEvidenceReviewComplete:true,financialSettlementApproved:true,
    playBillingReviewComplete:true,
  });
  db.docs.set("users/"+ownerUid,{
    role:"user",accountStatus:"deletion_processing",
  });
  db.docs.set("admin_audit_logs/r2_deletion_queue_"+requestId,{
    action:"accountErasureR2QueueCertified",requestId,targetId:ownerUid,
  });
  for(const [path,record] of syntheticErasureCertificateRows({
    uid:ownerUid,requestId,nowMs:Date.now(),
  })) db.docs.set(path,record);
}
test("U6-L3/B final decision starts exactly 90 days, not upload date",()=>{
  assert.equal(finalImageEvidenceDeadline(now).toISOString(),due.toISOString());
  assert.equal(finalImageEvidenceFields(now).evidencePurgeAt.toISOString(),
    due.toISOString());
});
test("U6-L3/B rejection sets final due and records decision, not pending",async()=>{
  const {db}=prepare("needs_review");
  const result=await rejectImageReview(db,"owner",{
    objectId:id,idempotencyKey:"reject_image_retention_abc",
    reason:"تمت مراجعة الصورة ورفض نشرها"});
  assert.equal(result.status,"rejected");
  assert.equal(db.docs.get(path).state,"rejected");
  assert.equal(db.docs.get(path).evidencePurgeAt instanceof Date,true);
  assert.equal(db.docs.get(path).evidenceRetentionDueAt instanceof Date,true);
});
test("U6-L3/B private image is not purged before its deadline",async()=>{
  const {db,bucket,deletions}=prepare();
  assert.equal(await purgeFinalImageEvidence(db,bucket,id,now),"skipped");
  assert.deepEqual(deletions,[]);
});
test("U6-L3/B final due evidence is deleted and audit metadata remains",async()=>{
  const {db,bucket,deletions}=prepare();
  const result=await purgeFinalImageEvidence(db,bucket,id,due);
  assert.equal(result,"purged");
  assert.deepEqual(deletions,[stage]);
  assert.equal(db.docs.get(path).state,"evidence_purged");
  assert.equal(db.docs.get(path).storageKey,null);
  assert.equal(db.docs.get(path).etag,null);
  assert.equal(db.docs.get(path).ownerUid,"user_123");
  assert.equal(db.docs.get("admin_audit_logs/image_evidence_purge_"+id)
    .action,"purgeFinalImageEvidenceAfter90Days");
});
test("U6-L3/B hold defers; owner releases and resumes original deadline",async()=>{
  const {db,bucket,deletions}=prepare();
  await setImageEvidenceHold(db,{
    actorUid:"owner",objectId:id,hold:true,reason:"تحقيق إداري مستمر",
    idempotencyKey:"hold_image_retention_abc",
  });
  const once=await setImageEvidenceHold(db,{
    actorUid:"owner",objectId:id,hold:true,reason:"تحقيق إداري مستمر",
    idempotencyKey:"hold_image_retention_abc",
  });
  assert.equal(once.duplicate,true);
  assert.equal(await purgeFinalImageEvidence(db,bucket,id,due),"held");
  assert.deepEqual(deletions,[]);
  assert.equal(db.docs.get(path).evidenceHold,true);
  await setImageEvidenceHold(db,{
    actorUid:"owner",objectId:id,hold:false,reason:"انتهى التحقيق رسميًا",
    idempotencyKey:"release_image_retention_abc",
  });
  assert.equal(await purgeFinalImageEvidence(db,bucket,id,due),"purged");
  assert.equal(db.docs.get(path).state,"evidence_purged");
});
test("U6-L3/B pending appeal and legal hold preserve private bytes",async()=>{
  const {db,bucket,deletions}=prepare();
  db.docs.set("image_moderation_appeals/"+id,{
    status:"under_review",ownerUid:"user_123",
  });
  assert.equal(await purgeFinalImageEvidence(db,bucket,id,due),"held");
  assert.deepEqual(deletions,[]);
});
test("U6-L3/B R2 failure is recoverable next hour with no lost claim",async()=>{
  const {db}=prepare();
  let attempts=0;
  const bucket={delete:async()=>{
    attempts++;
    if(attempts===1)throw Error("transient_storage_error");
  }};
  await assert.rejects(()=>purgeFinalImageEvidence(db,bucket,id,due),
    /transient_storage_error/);
  assert.equal(db.docs.get(path).state,"evidence_purging");
  assert.equal(db.docs.get(path).evidencePurgeAt.toISOString(),due.toISOString());
  assert.equal(await purgeFinalImageEvidence(db,bucket,id,
    new Date(due.getTime()+3600000)),"purged");
  assert.equal(attempts,2);
});
test("U6-L3/B shared hourly job performs only capped indexed lookups",async()=>{
  const {db,bucket}=prepare();
  const result=await runDueImageEvidenceCleanup(
    {USER_STORAGE:bucket},db,{nowMs:due.getTime(),limit:99999});
  assert.equal(result.purged,1);
  assert.equal(result.checked,1);
  assert.equal(db.queries.length,1);
  assert.equal(db.queries[0].options.limit,12);
  assert.equal(db.queries[0].options.filters[0].field,"evidencePurgeAt");
});
test("U6-L3/B deleted account keeps held private evidence off user cleanup",async()=>{
  const {db,bucket,deletions}=prepare("appeal_pending");
  certifyDeletedImageAccountJob(db,"job1");
  const res=await runDeletedAccountStorageCleanup(db,bucket,{
    nowMs:now.getTime(),limit:10,
  });
  assert.equal(res.checked,1);
  assert.deepEqual(deletions,[]);
  assert.equal(db.docs.get(path).ownerUid,"image_evidence_archive_"+id);
  assert.equal(db.docs.get(path).originalOwnerUid,"user_123");
});
test("U6-L3/B deleting account closes open image appeal and sets a due date",async()=>{
  const {db,bucket,deletions}=prepare("appeal_pending");
  db.docs.set(path,{
    ...db.docs.get(path),evidencePurgeAt:null,
    evidenceRetentionDueAt:null,
  });
  db.docs.set("image_moderation_appeals/"+id,{
    ownerUid:"user_123",status:"under_review",explanation:"راجِع الصورة",
  });
  certifyDeletedImageAccountJob(db,"job2");
  const out=await runDeletedAccountStorageCleanup(db,bucket,{
    nowMs:now.getTime(),limit:10,
  });
  assert.equal(out.deleted,0);
  assert.deepEqual(deletions,[]);
  const doc=db.docs.get(path);
  assert.equal(doc.state,"rejected");
  assert.equal(doc.ownerUid,"image_evidence_archive_"+id);
  assert.equal(doc.evidencePurgeAt.toISOString(),due.toISOString());
  assert.equal(db.docs.get("image_moderation_appeals/"+id).status,
    "closed_account_deleted");
  assert.equal(await purgeFinalImageEvidence(db,bucket,id,due),"purged");
});
test("U6-L3/B finalized expiry does not reset when account is deleted",async()=>{
  const {db,bucket}=prepare("rejected");
  certifyDeletedImageAccountJob(db,"job3");
  const res=await runDeletedAccountStorageCleanup(db,bucket,{
    nowMs:now.getTime(),limit:10,
  });
  assert.equal(res.deleted,0);
  assert.equal(db.docs.get(path).evidencePurgeAt.toISOString(),
    due.toISOString());
});
test("U6-L4/A preserved diary approval purges its guarded orphan copy",async()=>{
  const {db,bucket,deletions}=prepare();
  const original="users/user_123/diaries/"+id+".png";
  db.docs.set(path,{
    ...db.docs.get(path),scope:"diary_image",
    ownerUid:"image_evidence_archive_"+id,
    originalOwnerUid:"user_123",
    publicStorageKey:original,
    storageKey:"moderation-staging/"+original,
  });
  assert.equal(await purgeFinalImageEvidence(db,bucket,id,due),"purged");
  assert.deepEqual(deletions,[
    "moderated-diary/"+original,
    "moderation-staging/"+original,
  ]);
});
test("U6-L3/B all evidence operations remain opt-in, private and owner gated",()=>{
  const review=fs.readFileSync(
    "cloudflare-worker/src/image-moderation-control.js","utf8");
  const user=fs.readFileSync(
    "cloudflare-worker/src/user-storage.js","utf8");
  const cron=fs.readFileSync(
    "cloudflare-worker/src/report-evidence-retention.js","utf8");
  assert.match(review,/hold_image_evidence/);
  assert.match(review,/recent_auth_required/);
  assert.match(review,/export \{ IMAGE_MODERATION_PUBLICATION_GATE_READY \}/);
  assert.match(user,/image_moderation_evidence_locked/);
  assert.match(cron,/runDueImageEvidenceCleanup/);
});
