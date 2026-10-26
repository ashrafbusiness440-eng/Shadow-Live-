// INTERNAL, UNROUTED. Atomic withdrawal of one previously signed erasure
// approval AND a request-wide stop for new R2 dispatches. This is the writer
// side of the fixture execution fence. Not an approval issuer, endpoint or
// authorization to delete R2. Production deletion remains disabled.
import {REQUIRED_ERASURE_ADMISSION_DOMAINS}
  from "./account-deletion-processing-admission.js";

const clean=value=>String(value??"").trim();
const uidOk=value=>/^[A-Za-z0-9_-]{3,128}$/.test(clean(value));
const requestOk=value=>/^[A-Za-z0-9_-]{12,180}$/.test(clean(value));
const path=(collection,uid,requestId)=>
  collection+"/"+uid+"__"+requestId;
export class AccountErasureDomainWithdrawalError extends Error {
  constructor(code,status=409){
    super(code);this.code=code;this.status=status;
  }
}
const reject=(code,status=409)=>{
  throw new AccountErasureDomainWithdrawalError(code,status);
};
export async function withdrawAccountErasureDomainWithExternalIoStop(db,{
  uid,requestId,domain,actor,nowMs=Date.now(),
}={}){
  uid=clean(uid);requestId=clean(requestId);domain=clean(domain);
  if(!actor?.owner||!uidOk(actor?.uid))reject("owner_required",403);
  if(!uidOk(uid)||!requestOk(requestId)||
      !REQUIRED_ERASURE_ADMISSION_DOMAINS.includes(domain)||
      !Number.isSafeInteger(nowMs)||nowMs<=0){
    reject("invalid_erasure_domain_withdrawal",400);
  }
  if(typeof db?.beginTransaction!=="function"||
      typeof db?.get!=="function"||
      typeof db?.commit!=="function"||
      typeof db?.rollback!=="function"||
      typeof db?.writeCreate!=="function"||
      typeof db?.writeUpdate!=="function"){
    reject("withdrawal_transaction_adapter_missing",503);
  }
  const stopPath=path("account_erasure_external_io_revocation_intents",
    uid,requestId);
  const stopAuditPath="admin_audit_logs/erasure_external_io_revocation_intent_"+
    requestId;
  const approvalPath="account_deletion_erasure_approvals/"+
    requestId+"__"+domain;
  const certAuditPath="admin_audit_logs/erasure_domain_cert_"+
    requestId+"__"+domain;
  const withdrawalPath="admin_audit_logs/erasure_domain_withdrawal_"+
    requestId+"__"+domain;
  const paths=[
    "account_deletion_requests/"+uid,
    "account_deletion_erasure_checkpoints/"+uid,
    "users/"+uid,
    approvalPath,certAuditPath,stopPath,stopAuditPath,withdrawalPath,
    path("account_erasure_external_io_coordination_holds",uid,requestId),
    path("account_erasure_external_io_uncertain_attempts",uid,requestId),
    path("account_erasure_external_io_fixture_dispatches",uid,requestId),
  ];
  const tx=await db.beginTransaction();
  try{
    const rows=typeof db.getMany==="function"
      ?await db.getMany(paths,tx)
      :await Promise.all(paths.map(p=>db.get(p,tx)));
    if(!Array.isArray(rows)||rows.length!==paths.length||
        rows.some(row=>!row||typeof row.exists!=="boolean")){
      reject("withdrawal_transaction_read_incomplete",503);
    }
    const [request,checkpoint,user,approval,certAudit,stop,stopAudit,
      priorWithdrawal,hold,attempt,dispatch]=rows;
    // Emergency withdrawal is allowed even if a legal hold or expired
    // certificate exists; these conditions must NOT block a safety stop.
    if(!request.exists||!checkpoint.exists||!user.exists||
        !approval.exists||!certAudit.exists||
        clean(request.data?.uid)!==uid||
        clean(request.data?.requestId)!==requestId||
        clean(checkpoint.data?.uid)!==uid||
        clean(checkpoint.data?.requestId)!==requestId||
        clean(approval.data?.uid)!==uid||
        clean(approval.data?.requestId)!==requestId||
        clean(approval.data?.domain)!==domain||
        clean(approval.data?.decision)!=="approved"||
        clean(certAudit.data?.action)!=="accountErasureDomainCertified"||
        clean(certAudit.data?.requestId)!==requestId||
        clean(certAudit.data?.targetId)!==uid||
        clean(certAudit.data?.domain)!==domain||
        priorWithdrawal.exists){
      reject("erasure_domain_withdrawal_invalid_state");
    }
    if(stop.exists!==stopAudit.exists||
      (stop.exists&&(
        clean(stop.data?.uid)!==uid||
        clean(stop.data?.requestId)!==requestId||
        stop.data?.revocationEffective!==false||
        stop.data?.externalIoAllowed!==false||
        clean(stopAudit.data?.action)!==
          "accountErasureExternalIoRevocationIntent"||
        clean(stopAudit.data?.targetId)!==uid||
        clean(stopAudit.data?.requestId)!==requestId))){
      reject("erasure_domain_withdrawal_stop_conflict");
    }
    for(const [row,kind] of [
      [hold,"hold"],[attempt,"attempt"],[dispatch,"dispatch"],
    ]){
      if(row.exists&&(clean(row.data?.uid)!==uid||
        clean(row.data?.requestId)!==requestId)){
        reject("erasure_domain_withdrawal_"+kind+"_identity_mismatch");
      }
    }
    const pendingExternalIo=hold.exists||attempt.exists||dispatch.exists;
    const at=new Date(nowMs),by=clean(actor.uid);
    const writes=[
      db.writeUpdate(approvalPath,{
        decision:"revoked",withdrawnAt:at,withdrawnByUid:by,
        // This only revokes a signoff for NEW operations. It does not
        // retroactively cancel external calls that may have started.
      },["decision","withdrawnAt","withdrawnByUid"]),
      db.writeCreate(withdrawalPath,{
        action:"accountErasureDomainWithdrawnWithExternalIoStop",
        actorUid:by,targetType:"user",targetId:uid,
        requestId,domain,createdAt:at,
        approvalRevokedForNewDispatch:true,
        revocationEffective:false,
        externalIoOutcome:"requires_reconciliation",
        priorStopObserved:stop.exists,
        existingExternalIoObserved:pendingExternalIo,
      }),
    ];
    if(!stop.exists){
      writes.push(db.writeCreate(stopPath,{
        uid,requestId,status:"pending_reconciliation",
        requestedAt:at,requestedByUid:by,
        revocationEffective:false,externalIoAllowed:false,
        coordinationHoldObserved:hold.exists,
        uncertainAttemptObserved:attempt.exists,
        fixtureDispatchObserved:dispatch.exists,
      }));
      writes.push(db.writeCreate(stopAuditPath,{
        action:"accountErasureExternalIoRevocationIntent",
        targetType:"user",targetId:uid,requestId,actorUid:by,
        createdAt:at,revocationEffective:false,
        coordinationHoldObserved:hold.exists,
        uncertainAttemptObserved:attempt.exists,
        fixtureDispatchObserved:dispatch.exists,
      }));
    }
    // Firestore sees one atomic unit. The external executor checks the
    // stop document and all six approvals in its own dispatch transaction.
    // Whichever transaction commits first establishes the only honest
    // ordering. Neither branch claims cancellation of an in-flight call.
    await db.commit(tx,writes);
    return {ok:true,domainApprovalRevoked:true,
      stopCreated:!stop.exists,
      revocationEffective:false,pendingReconciliation:true,
      retryAllowed:false,externalIoAllowed:false,
      existingExternalIoObserved:pendingExternalIo};
  }catch(error){
    await db.rollback(tx).catch(()=>{});
    throw error;
  }
}
