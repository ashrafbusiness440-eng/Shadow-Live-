import assert from "node:assert/strict";
import {after,test} from "node:test";
import {randomUUID} from "node:crypto";
import {deleteApp,getApps,initializeApp} from "firebase-admin/app";
import {getFirestore} from "firebase-admin/firestore";
import {cloudflareFirestoreAdapter} from "./helpers/cloudflare-firestore-adapter.js";
import {queueAccountDeletionR2Stage} from "../../cloudflare-worker/src/account-deletion-r2-queue-stage.js";
import { seedEmulatorErasureCertificates }
  from "./helpers/account-erasure-synthetic-certificates.js";

const app=getApps()[0]||initializeApp({projectId:"shadow-live-economy-test"});
const db=getFirestore(app), workerDb=cloudflareFirestoreAdapter(db);
after(async()=>{await deleteApp(app);});
test("emulator: one certified cleanup job despite concurrent retries and consumed queue",async()=>{
 const suffix=randomUUID().replaceAll("-","").slice(0,18);
 const uid="erase_storage_"+suffix,requestId="erase_request_"+suffix;
 const nowMs=Date.now();
 const request=db.doc("account_deletion_requests/"+uid);
 const checkpoint=db.doc("account_deletion_erasure_checkpoints/"+uid);
 const user=db.doc("users/"+uid);
 const job=db.doc("storage_account_cleanup_jobs/"+uid);
 const audit=db.doc("admin_audit_logs/r2_deletion_queue_"+requestId);
 const certificates=await seedEmulatorErasureCertificates(db,{
   uid,requestId,nowMs,
 });
 await Promise.all([
  request.set({uid,requestId,status:"processing",
    requestedAt:new Date(nowMs-40*86400_000)}),
  checkpoint.set({requestId,phase:"storage_media",destructiveAllowed:true,
    storageRetentionApproved:true,sharedMediaOwnershipReviewed:true,
    legalEvidenceReviewComplete:true,financialSettlementApproved:true,
    playBillingReviewComplete:true}),
  user.set({role:"user",accountStatus:"deletion_processing",coins:50}),
 ]);
 const args={uid,requestId};
 try {
  const outcomes=await Promise.all([
    queueAccountDeletionR2Stage(workerDb,args),
    queueAccountDeletionR2Stage(workerDb,args),
  ]);
  assert.deepEqual(outcomes.map(x=>x.queued).sort(),[false,true]);
  assert.equal((await job.get()).data().requestId,requestId);
  assert.equal((await audit.get()).data().targetId,uid);
  // A late certificate revocation must NOT return duplicate success.
  const playCert=db.doc("account_deletion_erasure_approvals/"+requestId+"__play_billing");
  await playCert.update({decision:"revoked"});
  await assert.rejects(queueAccountDeletionR2Stage(workerDb,args),
    e=>e.code==="erasure_transactional_certification_blocked");
  assert.equal((await job.get()).exists,true);
  await playCert.update({decision:"approved"});
  await job.delete();
  assert.deepEqual(await queueAccountDeletionR2Stage(workerDb,args),
    {ok:true,queued:false,duplicate:true});
  assert.equal((await job.get()).exists,false);
  await request.update({reviewHold:true});
  await assert.rejects(queueAccountDeletionR2Stage(workerDb,args),
    e=>e.code==="storage_queue_not_authorized");
  await request.update({reviewHold:false,investigationHold:true});
  await assert.rejects(queueAccountDeletionR2Stage(workerDb,args),
    e=>e.code==="storage_queue_not_authorized");
  await request.update({investigationHold:false,reported:true});
  await assert.rejects(queueAccountDeletionR2Stage(workerDb,args),
    e=>e.code==="storage_queue_not_authorized");
  await request.update({reported:false});
  await checkpoint.update({evidenceHold:true});
  await assert.rejects(queueAccountDeletionR2Stage(workerDb,args),
    e=>e.code==="storage_queue_not_authorized");
  await checkpoint.update({evidenceHold:false});
  await user.update({appealStatus:"under_review"});
  await assert.rejects(queueAccountDeletionR2Stage(workerDb,args),
    e=>e.code==="storage_queue_not_authorized");
  assert.equal((await job.get()).exists,false);
  assert.equal((await user.get()).data().coins,50);
 } finally {
  await Promise.all([request,checkpoint,user,job,audit,...certificates]
    .map(ref=>ref.delete()));
 }
});
