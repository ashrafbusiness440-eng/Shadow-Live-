// Queue-only verified-stage adapter for existing bounded R2 account cleanup.
import { recheckErasureCertificatesInTransaction }
  from "./account-deletion-erasure-transactional-cert-gate.js";
// Not exposed as HTTP or cron. Existing worker owns the actual R2 operations.
// The production erasure checkpoint is always blocked, so this stage is inert.
const clean=v=>String(v??"").trim();
const validUid=v=>/^[A-Za-z0-9_-]{3,128}$/.test(clean(v));
const validRequestId=v=>/^[A-Za-z0-9_-]{12,180}$/.test(clean(v));
const held=d=>[
  d?.legalHold,d?.retentionHold,d?.deletionHold,d?.reviewHold,
  d?.evidenceHold,d?.investigationHold,d?.reported,d?.appealPending,
].some(v=>v===true) ||
  ["pending","open","under_review"].includes(
    clean(d?.appealStatus).toLowerCase());
export class AccountStorageQueueError extends Error{
  constructor(code,status=409){super(code);this.code=code;this.status=status;}
}
export async function queueAccountDeletionR2Stage(db,{
  uid,requestId,now=new Date(),
}={}){
  uid=clean(uid);requestId=clean(requestId);
  if(!validUid(uid)||!validRequestId(requestId)||
     !(now instanceof Date)||!Number.isFinite(now.getTime())){
    throw new AccountStorageQueueError("invalid_storage_queue_target",400);
  }
  const requestPath="account_deletion_requests/"+uid;
  const checkpointPath="account_deletion_erasure_checkpoints/"+uid;
  const jobPath="storage_account_cleanup_jobs/"+uid;
  const auditPath="admin_audit_logs/r2_deletion_queue_"+requestId;
  const tx=await db.beginTransaction();
  try{
    const [request,checkpoint,user,existing,audit]=await Promise.all([
      db.get(requestPath,tx),db.get(checkpointPath,tx),
      db.get("users/"+uid,tx),db.get(jobPath,tx),db.get(auditPath,tx),
    ]);
    if(!request.exists||!checkpoint.exists||!user.exists||
       clean(request.data?.uid)!==uid||
       clean(request.data?.requestId)!==requestId||
       clean(checkpoint.data?.requestId)!==requestId||
       clean(request.data?.status)!=="processing"||
       clean(checkpoint.data?.phase)!=="storage_media"||
       checkpoint.data?.destructiveAllowed!==true||
       checkpoint.data?.storageRetentionApproved!==true||
       checkpoint.data?.sharedMediaOwnershipReviewed!==true||
       checkpoint.data?.legalEvidenceReviewComplete!==true||
       checkpoint.data?.financialSettlementApproved!==true||
       checkpoint.data?.playBillingReviewComplete!==true||
       clean(user.data?.accountStatus)!=="deletion_processing"||
       clean(user.data?.role)==="owner"||
       held(request.data)||held(checkpoint.data)||held(user.data)){
      throw new AccountStorageQueueError("storage_queue_not_authorized");
    }
    if(existing.exists &&
       (clean(existing.data?.ownerUid)!==uid||
        clean(existing.data?.requestId)!==requestId||
        clean(existing.data?.reason)!=="account_deleted_verified")){
      throw new AccountStorageQueueError("storage_queue_conflict");
    }
    if(audit.exists &&
       (clean(audit.data?.targetId)!==uid||
        clean(audit.data?.requestId)!==requestId||
        clean(audit.data?.action)!=="accountErasureR2QueueCertified")){
      throw new AccountStorageQueueError("storage_queue_audit_conflict");
    }
    if(existing.exists||audit.exists){
      // A processed queue job may already be gone; the immutable certificate
      // stops accidental second enqueue and duplicate R2 deletion on retry.
      if(existing.exists && !audit.exists){
        throw new AccountStorageQueueError("storage_queue_unverified_job");
      }
      await db.rollback(tx);
      return {ok:true,queued:false,duplicate:true};
    }
    // The same Firestore transaction must observe all six current approvals
    // before the R2 cleanup job can be queued. Revocation/appeal conflicts
    // stop this enqueue; the real object deletion remains a separate gate.
    await recheckErasureCertificatesInTransaction(db, tx, {
      uid, requestId, requestedAt: request.data?.requestedAt,
      nowMs: now.getTime(),
    });
    await db.commit(tx,[
      db.writeCreate(jobPath,{
        ownerUid:uid,requestId,reason:"account_deleted_verified",
        status:"queued",createdAt:now,
      }),
      db.writeCreate(auditPath,{
        action:"accountErasureR2QueueCertified",requestId,
        targetType:"user",targetId:uid,createdAt:now,
      }),
    ]);
    return {ok:true,queued:true,duplicate:false};
  }catch(error){
    await db.rollback(tx).catch(()=>{});
    throw error;
  }
}
