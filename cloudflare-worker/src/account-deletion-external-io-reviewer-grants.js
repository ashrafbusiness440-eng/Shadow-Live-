// Owner-only, non-destructive grant administration for a stopped R2
// account-erasure reconciliation case. No R2/Account/Auth deletion and no
// automatic claim that the external provider completed an operation.
// Public routing, where enabled, MUST bind actor to a verified Firebase ID
// token, current Owner profile and recent authentication before this call.
const clean=value=>String(value??"").trim();
const uidOk=x=>/^[A-Za-z0-9_-]{3,128}$/.test(clean(x));
const idOk=x=>/^[A-Za-z0-9_-]{12,180}$/.test(clean(x));
const MAX_GRANT_MS=60*60_000;
export class AccountErasureReviewerGrantError extends Error {
  constructor(code,status=409){super(code);this.code=code;this.status=status;}
}
const err=(code,status=409)=>{throw new AccountErasureReviewerGrantError(code,status);};
const paths=(uid,requestId,reviewerUid)=>({
  caseDoc:"account_erasure_external_io_reconciliation_cases/"+uid+"__"+requestId,
  stop:"account_erasure_external_io_revocation_intents/"+uid+"__"+requestId,
  request:"account_deletion_requests/"+uid,
  checkpoint:"account_deletion_erasure_checkpoints/"+uid,
  owner:"users/",
  grant:"account_erasure_external_io_reviewer_grants/"+
    uid+"__"+requestId+"__"+reviewerUid,
  audit:"admin_audit_logs/erasure_external_io_reviewer_grant_"+
    requestId+"__"+reviewerUid,
  revokeAudit:"admin_audit_logs/erasure_external_io_reviewer_grant_revoked_"+
    requestId+"__"+reviewerUid,
});
const valid=(row)=>row&&typeof row.exists==="boolean";
const readExact=async(db,keys,tx)=>{
  const docs=typeof db.getMany==="function"
    ?await db.getMany(keys,tx)
    :await Promise.all(keys.map(key=>db.get(key,tx)));
  if(!Array.isArray(docs)||docs.length!==keys.length||
     docs.some(row=>!valid(row)))err("erasure_reviewer_grant_snapshot_incomplete",503);
  return docs;
};
const requireOwner=(actor,nowMs)=>{
  if(actor?.owner!==true||!uidOk(actor.uid))
    err("owner_required",403);
  if(!Number.isSafeInteger(nowMs)||nowMs<=0)
    err("invalid_reviewer_grant_time",400);
};
const requireAdapter=db=>{
  if(typeof db?.beginTransaction!=="function"||
     typeof db?.get!=="function"||
     typeof db?.commit!=="function"||
     typeof db?.rollback!=="function"||
     typeof db?.writeCreate!=="function"||
     typeof db?.writeUpdate!=="function")
    err("reviewer_grant_transaction_adapter_missing",503);
};
const requireCurrentOwner=(row,actor)=>{
  if(!row.exists||clean(row.data?.uid)!==clean(actor.uid)||
     clean(row.data?.role)!=="owner"||
     clean(row.data?.accountStatus)!=="active"||
     row.data?.authDeleted===true)
    err("owner_privileges_changed",403);
};
const requireStoppedCase=(caseDoc,stop,request,checkpoint,uid,requestId,objectId)=>{
  const c=caseDoc.data||{},s=stop.data||{};
  if(!caseDoc.exists||!stop.exists||!request.exists||
     !checkpoint.exists||clean(c.uid)!==uid||
     clean(c.requestId)!==requestId||clean(c.objectId)!==objectId||
     clean(c.status)!=="awaiting_independent_evidence_review"||
     c.ownerStopObserved!==true||
     c.externalIoAllowed!==false||c.retryAllowed!==false||
     c.completionVerified!==false||c.revocationEffective!==false||
     clean(s.uid)!==uid||clean(s.requestId)!==requestId||
     clean(s.status)!=="pending_reconciliation"||
     s.externalIoAllowed!==false||s.revocationEffective!==false||
     clean(request.data?.uid)!==uid||
     clean(request.data?.requestId)!==requestId||
     clean(checkpoint.data?.uid)!==uid||
     clean(checkpoint.data?.requestId)!==requestId)
    err("erasure_reviewer_grant_case_not_ready");
};
const validate=(uid,requestId,objectId,reviewerUid)=>{
  if(!uidOk(uid)||!idOk(requestId)||!idOk(objectId)||
     !uidOk(reviewerUid))err("invalid_erasure_reviewer_grant_target",400);
};
/**
 * Grant a single reviewer one case-specific, expiring review privilege.
 * Requires server-authenticated Owner caller and a pre-existing safe case.
 * The reviewer also MUST retain a separate current admin capability when
 * actually reviewing. No duplicate/renewal of this grant ID is allowed.
 */
export async function issueAccountErasureExternalIoReviewerGrant(db,{
  uid,requestId,objectId,reviewerUid,actor,nowMs=Date.now(),
}={}){
  uid=clean(uid);requestId=clean(requestId);
  objectId=clean(objectId);reviewerUid=clean(reviewerUid);
  requireOwner(actor,nowMs);validate(uid,requestId,objectId,reviewerUid);
  if(reviewerUid===clean(actor.uid))
    err("independent_reviewer_required",403);
  requireAdapter(db);
  const p=paths(uid,requestId,reviewerUid);
  const keys=[p.caseDoc,p.stop,p.request,p.checkpoint,
    p.owner+actor.uid,p.owner+reviewerUid,p.grant,p.audit,p.revokeAudit];
  const tx=await db.beginTransaction();
  try{
    const [caseDoc,stop,request,checkpoint,owner,reviewer,
      oldGrant,oldAudit,oldRevocation]=await readExact(db,keys,tx);
    requireCurrentOwner(owner,actor);
    requireStoppedCase(caseDoc,stop,request,checkpoint,uid,requestId,objectId);
    if(oldGrant.exists||oldAudit.exists||oldRevocation.exists)
      err("erasure_reviewer_grant_already_issued_or_revoked");
    if(clean(caseDoc.data?.createdByUid)===reviewerUid||
       clean(stop.data?.requestedByUid)===reviewerUid||
       !reviewer.exists||
       clean(reviewer.data?.uid)!==reviewerUid||
       reviewer.data?.adminEnabled!==true||
       clean(reviewer.data?.accountStatus)!=="active"||
       reviewer.data?.authDeleted===true||
       !Array.isArray(reviewer.data?.capabilities)||
       !reviewer.data.capabilities.includes("reviewAccountErasureR2Evidence"))
      err("reviewer_not_independent_or_authorized",403);
    const issuedAt=new Date(nowMs);
    const expiresAt=new Date(nowMs+MAX_GRANT_MS);
    await db.commit(tx,[
      db.writeCreate(p.grant,{
        uid,requestId,objectId,reviewerUid,
        grantedByUid:clean(actor.uid),
        scope:"account_erasure_r2_reconciliation",
        status:"active",revoked:false,
        grantedAt:issuedAt,expiresAt,
        externalIoAllowed:false,retryAllowed:false,
        completionVerified:false,revocationEffective:false,
      }),
      db.writeCreate(p.audit,{
        action:"accountErasureExternalIoReviewerGrantRecorded",
        targetType:"user",targetId:uid,requestId,objectId,
        reviewerUid,actorUid:clean(actor.uid),createdAt:issuedAt,
        expiresAt,externalIoAllowed:false,completionVerified:false,
      }),
    ]);
    return {ok:true,grantIssued:true,
      reviewerUid,expiresAtMs:expiresAt.getTime(),
      externalIoAllowed:false,retryAllowed:false,
      completionVerified:false,revocationEffective:false};
  }catch(error){
    await db.rollback(tx).catch(()=>{});
    throw error;
  }
}
/**
 * Emergency revocation: create an immutable tombstone and update mutable
 * grant within one Firestore transaction. Never release a stopped attempt.
 * Does not need current reviewer capability or an unexpired grant.
 */
export async function revokeAccountErasureExternalIoReviewerGrant(db,{
  uid,requestId,objectId,reviewerUid,actor,nowMs=Date.now(),
}={}){
  uid=clean(uid);requestId=clean(requestId);
  objectId=clean(objectId);reviewerUid=clean(reviewerUid);
  requireOwner(actor,nowMs);validate(uid,requestId,objectId,reviewerUid);
  requireAdapter(db);
  const p=paths(uid,requestId,reviewerUid);
  const keys=[p.caseDoc,p.stop,p.request,p.checkpoint,
    p.owner+actor.uid,p.grant,p.audit,p.revokeAudit];
  const tx=await db.beginTransaction();
  try{
    const [caseDoc,stop,request,checkpoint,owner,grant,audit,revokeAudit]
      =await readExact(db,keys,tx);
    requireCurrentOwner(owner,actor);
    requireStoppedCase(caseDoc,stop,request,checkpoint,uid,requestId,objectId);
    if(!grant.exists||!audit.exists||revokeAudit.exists||
       clean(grant.data?.uid)!==uid||
       clean(grant.data?.requestId)!==requestId||
       clean(grant.data?.objectId)!==objectId||
       clean(grant.data?.reviewerUid)!==reviewerUid||
       clean(grant.data?.status)!=="active"||
       grant.data?.revoked!==false||
       clean(audit.data?.action)!==
         "accountErasureExternalIoReviewerGrantRecorded"||
       clean(audit.data?.targetId)!==uid||
       clean(audit.data?.requestId)!==requestId||
       clean(audit.data?.objectId)!==objectId||
       clean(audit.data?.reviewerUid)!==reviewerUid||
       clean(audit.data?.actorUid)!==clean(grant.data?.grantedByUid))
      err("erasure_reviewer_grant_revocation_conflict");
    const now=new Date(nowMs);
    await db.commit(tx,[
      db.writeUpdate(p.grant,{
        status:"revoked",revoked:true,revokedAt:now,
        revokedByUid:clean(actor.uid),
      },["status","revoked","revokedAt","revokedByUid"]),
      db.writeCreate(p.revokeAudit,{
        action:"accountErasureExternalIoReviewerGrantRevoked",
        targetType:"user",targetId:uid,requestId,objectId,reviewerUid,
        actorUid:clean(actor.uid),createdAt:now,
        retryAllowed:false,externalIoAllowed:false,
        completionVerified:false,revocationEffective:false,
      }),
    ]);
    return {ok:true,grantRevoked:true,reviewerUid,
      retryAllowed:false,externalIoAllowed:false,
      completionVerified:false,revocationEffective:false};
  }catch(error){
    await db.rollback(tx).catch(()=>{});
    throw error;
  }
}
