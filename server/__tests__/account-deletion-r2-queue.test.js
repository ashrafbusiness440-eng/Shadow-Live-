import assert from "node:assert/strict";
import {test} from "node:test";
import {readFileSync} from "node:fs";
import {queueAccountDeletionR2Stage} from "../../cloudflare-worker/src/account-deletion-r2-queue-stage.js";
const uid="deleted_user_test_123",requestId="request_id_verified_123456";
const rp="account_deletion_requests/"+uid,cp="account_deletion_erasure_checkpoints/"+uid,
 up="users/"+uid,job="storage_account_cleanup_jobs/"+uid,
 audit="admin_audit_logs/r2_deletion_queue_"+requestId;
class Db {
 constructor(){
  this.docs=new Map([
   [rp,{uid,requestId,status:"processing"}],
   [cp,{requestId,phase:"storage_media",destructiveAllowed:true,
     storageRetentionApproved:true,sharedMediaOwnershipReviewed:true,
     legalEvidenceReviewComplete:true,financialSettlementApproved:true,
     playBillingReviewComplete:true}],
   [up,{role:"user",accountStatus:"deletion_processing",coins:99}],
  ]);
  this.commits=[];this.rollbacks=0;
 }
 async beginTransaction(){return "tx";}
 async get(path,tx){assert.equal(tx,"tx");return {exists:this.docs.has(path),data:this.docs.get(path)??null};}
 writeCreate(path,data){return {path,data};}
 async commit(tx,writes){assert.equal(tx,"tx");
   const result=new Map(this.docs);
   for(const w of writes){if(result.has(w.path))throw Error("ALREADY_EXISTS");result.set(w.path,w.data);}
   this.docs=result;this.commits.push(writes);
 }
 async rollback(tx){assert.equal(tx,"tx");this.rollbacks++;}
}
const run=(db,extra={})=>queueAccountDeletionR2Stage(db,{uid,requestId,...extra});
test("queues one audited batch cleanup job and never deletes R2 bytes itself",async()=>{
 const db=new Db();
 assert.deepEqual(await run(db),{ok:true,queued:true,duplicate:false});
 assert.equal(db.commits.length,1);assert.equal(db.commits[0].length,2);
 assert.equal(db.docs.get(job).ownerUid,uid);
 assert.equal(db.docs.get(job).reason,"account_deleted_verified");
 assert.equal(db.docs.get(audit).action,"accountErasureR2QueueCertified");
 assert.deepEqual(await run(db),{ok:true,queued:false,duplicate:true});
 db.docs.delete(job); // existing background storage cleaner consumed the job
 assert.deepEqual(await run(db),{ok:true,queued:false,duplicate:true});
 assert.equal(db.docs.has(job),false);
 assert.equal(db.commits.length,1);
});
test("requires current request + all independent settlement, media, evidence approvals",async()=>{
 const changes=[
  d=>d.docs.get(rp).status="cancelled",
  d=>d.docs.get(rp).reviewHold=true,
  d=>d.docs.get(rp).requestId="old_request_123456",
  d=>d.docs.get(cp).phase="preflight_blocked",
  d=>d.docs.get(cp).destructiveAllowed=false,
  d=>d.docs.get(cp).storageRetentionApproved=false,
  d=>d.docs.get(cp).sharedMediaOwnershipReviewed=false,
  d=>d.docs.get(cp).legalEvidenceReviewComplete=false,
  d=>d.docs.get(cp).financialSettlementApproved=false,
  d=>d.docs.get(cp).playBillingReviewComplete=false,
  d=>d.docs.get(cp).requestId="old_request_123456",
  d=>d.docs.get(up).accountStatus="active",
  d=>d.docs.get(up).role="owner",
  d=>d.docs.get(up).retentionHold=true,
  d=>d.docs.delete(rp),
 ];
 for(const change of changes){
  const db=new Db();change(db);
  await assert.rejects(run(db),e=>e.code==="storage_queue_not_authorized");
  assert.equal(db.commits.length,0);assert.equal(db.docs.has(job),false);
 }
});
test("conflicting or unaudited job fails closed",async()=>{
 const db=new Db();
 db.docs.set(job,{ownerUid:"someone_else",requestId,reason:"account_deleted_verified"});
 await assert.rejects(run(db),e=>e.code==="storage_queue_conflict");
 db.docs.set(job,{ownerUid:uid,requestId,reason:"account_deleted_verified"});
 await assert.rejects(run(db),e=>e.code==="storage_queue_unverified_job");
 db.docs.delete(job);
 db.docs.set(audit,{targetId:"someone_else",requestId,action:"accountErasureR2QueueCertified"});
 await assert.rejects(run(db),e=>e.code==="storage_queue_audit_conflict");
 assert.equal(db.commits.length,0);
});
test("invalid targets and network failures never mark queue complete",async()=>{
 const db=new Db();
 await assert.rejects(run(db,{uid:"../../dangerous"}),e=>e.status===400);
 db.commit=async()=>{throw Error("network_failure");};
 await assert.rejects(run(db),/network_failure/);
 assert.equal(db.docs.has(job),false);
});
test("queue-stage has no R2 calls, scans or Auth deletion",()=>{
 const src=readFileSync("cloudflare-worker/src/account-deletion-r2-queue-stage.js","utf8");
 assert.doesNotMatch(src,/runQuery\(|\.list\(|\.delete\(|writeDelete\(|deleteAuthUser\(/);
 assert.match(src,/playBillingReviewComplete!==true/);
 assert.match(src,/legalEvidenceReviewComplete!==true/);
 assert.match(src,/sharedMediaOwnershipReviewed!==true/);
});
