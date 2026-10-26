// INTERNAL, UNROUTED: durable reservation for future external account-erasure
// side effects. It is NOT a permit to call R2.delete. All production deletion
// stays OFF. A separate revocation/lease-holder protocol is mandatory first.
import { accountDeletionHasActiveHold as held }
  from "./account-deletion-active-holds.js";
import { recheckErasureCertificatesInTransaction }
  from "./account-deletion-erasure-transactional-cert-gate.js";
import {REQUIRED_ERASURE_ADMISSION_DOMAINS}
  from "./account-deletion-processing-admission.js";

const clean = v => String(v ?? "").trim();
const uidOk = v => /^[A-Za-z0-9_-]{3,128}$/.test(v);
const requestOk = v => /^[A-Za-z0-9_-]{12,180}$/.test(v);
const objectOk = v => /^[A-Za-z0-9_-]{12,180}$/.test(v);
const tokenOk = v => /^[A-Za-z0-9_-]{20,180}$/.test(v);
const dateMs = v => v instanceof Date ? v.getTime()
  : typeof v?.toDate === "function" ? v.toDate().getTime()
  : typeof v === "string" ? Date.parse(v)
  : Number.isFinite(v?.seconds) ? v.seconds * 1000 : NaN;
const GRACE_MS = 30 * 86400_000;
const revocationIntentPath = (uid,requestId) =>
  "account_erasure_external_io_revocation_intents/" + uid + "__" + requestId;
const revocationIntentAuditPath = requestId =>
  "admin_audit_logs/erasure_external_io_revocation_intent_" + requestId;
const coordinationHoldPath = (uid,requestId) =>
  "account_erasure_external_io_coordination_holds/" + uid + "__" + requestId;
// Request-wide, create-only journal. Once created it can never imply that
// bucket.delete did NOT run: crashes may make the external result unknowable.
const uncertainAttemptPath = (uid,requestId) =>
  "account_erasure_external_io_uncertain_attempts/" + uid + "__" + requestId;

export class AccountErasureIoReservationError extends Error {
  constructor(code,status=409){super(code);this.code=code;this.status=status;}
}
const reject = (code,status) => {
  throw new AccountErasureIoReservationError(code,status);
};

/**
 * Reserving an object is an atomic bookkeeping operation, NOT external I/O
 * permission. One request/object has one immutable reservation; even after
 * a timeout the reservation is never recycled without separate reconciliation.
 * This prevents two concurrent workers both gaining a fresh reservation.
 *
 * No API, schedule, bucket operation, finalizer or test certificate issuer
 * imports this primitive. Approval revocation must later honor an explicit
 * durable interlock before any real external delete can be enabled.
 */
/**
 * Unrouted, NON-DESTRUCTIVE stop intent for future external I/O reservations.
 * This is NOT an effective signoff revocation or an in-flight I/O barrier:
 * any earlier reservation/operation requires separate reconciliation before
 * a revocation can be declared effective. No automatic timeout reclaims it.
 * The eventual approval-revocation writer MUST atomically coordinate with
 * this marker and all in-flight operation fencing before releasing signoffs.
 */
export async function requestAccountErasureExternalIoRevocationIntent(db, {
  uid, requestId, actor, nowMs = Date.now(),
}={}) {
  uid=clean(uid);requestId=clean(requestId);
  if (!actor?.owner || !uidOk(clean(actor?.uid))) reject("owner_required",403);
  if (!uidOk(uid) || !requestOk(requestId) ||
      !Number.isSafeInteger(nowMs) || nowMs<=0) {
    reject("invalid_external_io_revocation_intent",400);
  }
  if (typeof db?.beginTransaction!=="function" ||
      typeof db?.commit!=="function" ||
      typeof db?.writeCreate!=="function") {
    reject("external_io_transaction_adapter_missing",503);
  }
  const requestPath="account_deletion_requests/"+uid;
  const checkpointPath="account_deletion_erasure_checkpoints/"+uid;
  const intentPath=revocationIntentPath(uid,requestId);
  const auditPath=revocationIntentAuditPath(requestId);
  const tx=await db.beginTransaction();
  try {
    // Both a future holder and a stop writer read/write the SAME
    // transaction-scoped coordination and stop documents. Even when no
    // holder has been recorded, a prior legacy operation remains unknown.
    const paths=[requestPath,checkpointPath,intentPath,auditPath,
      coordinationHoldPath(uid,requestId),uncertainAttemptPath(uid,requestId)];
    const docs=typeof db.getMany==="function"
      ? await db.getMany(paths,tx)
      : await Promise.all(paths.map(p=>db.get(p,tx)));
    if (!Array.isArray(docs) || docs.length!==paths.length ||
        docs.some(d=>!d || typeof d.exists!=="boolean")) {
      reject("external_io_transaction_read_failed",503);
    }
    const [request,checkpoint,existing,audit,hold,attempt]=docs;
    if (attempt.exists && (clean(attempt.data?.uid)!==uid ||
        clean(attempt.data?.requestId)!==requestId ||
        attempt.data?.externalIoAllowed!==false ||
        attempt.data?.retryAllowed!==false ||
        attempt.data?.completionVerified!==false)) {
      reject("external_io_uncertain_attempt_malformed",503);
    }
    if (hold.exists && (clean(hold.data?.uid)!==uid ||
        clean(hold.data?.requestId)!==requestId ||
        hold.data?.externalIoAllowed!==false)) {
      reject("external_io_coordination_hold_malformed",503);
    }
    if (existing.exists || audit.exists) {
      reject("external_io_revocation_requires_reconciliation");
    }
    if (!request.exists || !checkpoint.exists ||
        clean(request.data?.uid)!==uid ||
        clean(request.data?.requestId)!==requestId ||
        clean(checkpoint.data?.uid)!==uid ||
        clean(checkpoint.data?.requestId)!==requestId ||
        clean(request.data?.status)!=="processing") {
      reject("external_io_revocation_target_mismatch");
    }
    const at=new Date(nowMs),by=clean(actor.uid);
    await db.commit(tx,[
      db.writeCreate(intentPath,{
        uid,requestId,status:"pending_reconciliation",
        revocationEffective:false,externalIoAllowed:false,
        requestedAt:at,requestedByUid:by,
        coordinationHoldObserved:hold.exists,
        uncertainAttemptObserved:attempt.exists,
      }),
      db.writeCreate(auditPath,{
        action:"accountErasureExternalIoRevocationIntent",
        targetType:"user",targetId:uid,requestId,
        actorUid:by,createdAt:at,
        revocationEffective:false,
        coordinationHoldObserved:hold.exists,
        uncertainAttemptObserved:attempt.exists,
      }),
    ]);
    return {ok:true,revocationIntentCreated:true,
      revocationEffective:false,pendingReconciliation:true,
      coordinationHoldObserved:hold.exists,
      uncertainAttemptObserved:attempt.exists,
      externalIoAllowed:false};
  } catch(error) {
    await db.rollback(tx).catch(()=>{});
    throw error;
  }
}

export async function reserveAccountErasureExternalIo(db, {
  uid, requestId, objectId, actor, token, nowMs = Date.now(),
}={}) {
  uid=clean(uid);requestId=clean(requestId);objectId=clean(objectId);
  token=clean(token);
  if (!actor?.owner || !uidOk(clean(actor?.uid))) reject("owner_required",403);
  if (!uidOk(uid) || !requestOk(requestId) || !objectOk(objectId) ||
      !tokenOk(token) || !Number.isSafeInteger(nowMs) || nowMs <= 0) {
    reject("invalid_external_io_reservation",400);
  }
  if (typeof db?.beginTransaction !== "function" ||
      typeof db?.commit !== "function" ||
      typeof db?.writeCreate !== "function") {
    reject("external_io_transaction_adapter_missing",503);
  }
  const path = "account_erasure_external_io_reservations/" + uid + "__" + objectId;
  const tx = await db.beginTransaction();
  try {
    // Eight bounded exact reads in ONE Firestore transaction-scoped batchGet
    // (instead of parallel REST GETs contending for the same transaction).
    // Test adapters without getMany retain the identical transaction-scoped
    // exact-read fallback. All writes still use this same transaction.
    const basePaths=[
      "account_deletion_requests/"+uid,
      "account_deletion_erasure_checkpoints/"+uid,
      "users/"+uid,
      path,
      "storage_objects/"+objectId,
      "admin_audit_logs/erasure_processing_start_"+requestId,
      revocationIntentPath(uid,requestId),
      // Request-wide holder blocks ALL further object reservations,
      // including reservations for a different media object.
      coordinationHoldPath(uid,requestId),
    ];
    const base=typeof db.getMany==="function"
      ? await db.getMany(basePaths,tx)
      : await Promise.all(basePaths.map(p=>db.get(p,tx)));
    if (!Array.isArray(base) || base.length!==basePaths.length ||
        base.some(record => !record || typeof record.exists!=="boolean")) {
      // An absent/malformed revocation-intent slot must NEVER look like
      // "no stop requested". The complete transaction result is required.
      reject("external_io_transaction_read_failed",503);
    }
    const [request,checkpoint,user,existing,storageObject,admission,
      revocationIntent,coordinationHold]=base;
    // A pending stop OR a claimed request-wide hold always blocks NEW
    // reservations. Both paths are transactional reads and conflict with
    // concurrent create-only stop/hold commits by independent workers.
    // The hold is NOT a bucket-delete permit or an expiry-reclaimable lease.
    if (revocationIntent.exists) reject("external_io_revocation_intent_pending");
    if (coordinationHold.exists) reject("external_io_coordination_requires_reconciliation");
    if (existing.exists) reject("external_io_reservation_requires_reconciliation");
    if (!request.exists || !checkpoint.exists || !user.exists ||
        !storageObject.exists || !admission.exists ||
        clean(admission.data?.action)!=="accountErasureProcessingAdmitted" ||
        clean(admission.data?.targetId)!==uid ||
        clean(admission.data?.requestId)!==requestId ||
        !Array.isArray(admission.data?.certifiedDomains) ||
        admission.data.certifiedDomains.length!==
          REQUIRED_ERASURE_ADMISSION_DOMAINS.length ||
        !REQUIRED_ERASURE_ADMISSION_DOMAINS.every(domain=>
          admission.data.certifiedDomains.includes(domain)) ||
        clean(request.data?.uid)!==uid ||
        clean(request.data?.requestId)!==requestId ||
        clean(checkpoint.data?.uid)!==uid ||
        clean(checkpoint.data?.requestId)!==requestId ||
        clean(request.data?.status)!=="processing" ||
        clean(checkpoint.data?.phase)!=="storage_media" ||
        checkpoint.data?.destructiveAllowed!==true ||
        checkpoint.data?.storageRetentionApproved!==true ||
        checkpoint.data?.sharedMediaOwnershipReviewed!==true ||
        checkpoint.data?.legalEvidenceReviewComplete!==true ||
        checkpoint.data?.financialSettlementApproved!==true ||
        checkpoint.data?.playBillingReviewComplete!==true ||
        clean(user.data?.accountStatus)!=="deletion_processing" ||
        clean(user.data?.role)==="owner" ||
        clean(storageObject.data?.ownerUid)!==uid ||
        held(request.data) || held(checkpoint.data) ||
        held(user.data) || held(storageObject.data)) {
      reject("external_io_reservation_not_authorized");
    }
    const requestedAtMs=dateMs(request.data?.requestedAt);
    const eligibleAtMs=dateMs(request.data?.eligibleAt);
    if (!Number.isSafeInteger(requestedAtMs) ||
        !Number.isSafeInteger(eligibleAtMs) ||
        eligibleAtMs < requestedAtMs + GRACE_MS ||
        nowMs < eligibleAtMs || nowMs < requestedAtMs + GRACE_MS) {
      reject("external_io_reservation_grace_not_elapsed");
    }
    // The twelve signoffs must be read in this same transaction as creating
    // the unique reservation. A stale approval cannot authorize the record.
    await recheckErasureCertificatesInTransaction(db,tx,{
      uid,requestId,requestedAtMs,nowMs,
    });
    await db.commit(tx,[db.writeCreate(path,{
      uid,requestId,objectId,operationToken:token,
      state:"reserved_requires_external_interlock",
      // The separate R2 worker MUST NOT interpret this record as a permit.
      externalIoAllowed:false,completionVerified:false,
      reservedAt:new Date(nowMs),
      reservedByUid:clean(actor.uid),
    })]);
    return {ok:true,reserved:true,externalIoAllowed:false,
      completionVerified:false,requiresReconciliation:true};
  } catch (error) {
    await db.rollback(tx).catch(()=>{});
    throw error;
  }
}


/**
 * Internal-only fail-closed coordination prototype for a FUTURE R2 worker.
 * It does NOT grant an external I/O permit and can NEVER be auto-reclaimed
 * by clock expiry. Only an independently audited reconciliation protocol
 * could later resolve this immutable, request-wide hold. No caller may
 * interpret its existence as authorizing bucket.delete.
 *
 * The Owner stop writer and this holder both transactionally READ the
 * request-specific stop + hold documents; the holder CREATEs the latter
 * only after checking the identical prior reserved-object token, current
 * signoffs and request/asset state. A concurrent stop must win or conflict.
 * This hold alone does NOT settle revocation of any older external work.
 */
export async function recordAccountErasureExternalIoCoordinationHold(db,{
  uid,requestId,objectId,token,actor,nowMs=Date.now(),
}={}) {
  uid=clean(uid);requestId=clean(requestId);objectId=clean(objectId);
  token=clean(token);
  if (!actor?.owner || !uidOk(clean(actor?.uid)))reject("owner_required",403);
  if (!uidOk(uid) || !requestOk(requestId) || !objectOk(objectId) ||
      !tokenOk(token) || !Number.isSafeInteger(nowMs) || nowMs<=0) {
    reject("invalid_external_io_coordination_hold",400);
  }
  if (typeof db?.beginTransaction!=="function" ||
      typeof db?.commit!=="function" ||
      typeof db?.writeCreate!=="function") {
    reject("external_io_transaction_adapter_missing",503);
  }
  const holdPath=coordinationHoldPath(uid,requestId);
  const tx=await db.beginTransaction();
  try {
    const paths=[
      "account_deletion_requests/"+uid,
      "account_deletion_erasure_checkpoints/"+uid,
      "users/"+uid,
      "storage_objects/"+objectId,
      "account_erasure_external_io_reservations/"+uid+"__"+objectId,
      revocationIntentPath(uid,requestId),
      holdPath,
      "admin_audit_logs/erasure_processing_start_"+requestId,
    ];
    const docs=typeof db.getMany==="function"
      ? await db.getMany(paths,tx)
      : await Promise.all(paths.map(p=>db.get(p,tx)));
    if (!Array.isArray(docs) || docs.length!==paths.length ||
        docs.some(d=>!d || typeof d.exists!=="boolean")) {
      reject("external_io_transaction_read_failed",503);
    }
    const [request,checkpoint,user,object,reservation,stop,hold,admission]=docs;
    if (stop.exists)reject("external_io_revocation_intent_pending");
    if (hold.exists)reject("external_io_coordination_requires_reconciliation");
    if (!request.exists || !checkpoint.exists || !user.exists ||
        !object.exists || !reservation.exists || !admission.exists ||
        clean(request.data?.uid)!==uid ||
        clean(request.data?.requestId)!==requestId ||
        clean(request.data?.status)!=="processing" ||
        clean(checkpoint.data?.uid)!==uid ||
        clean(checkpoint.data?.requestId)!==requestId ||
        clean(checkpoint.data?.phase)!=="storage_media" ||
        checkpoint.data?.destructiveAllowed!==true ||
        checkpoint.data?.storageRetentionApproved!==true ||
        checkpoint.data?.sharedMediaOwnershipReviewed!==true ||
        checkpoint.data?.legalEvidenceReviewComplete!==true ||
        checkpoint.data?.financialSettlementApproved!==true ||
        checkpoint.data?.playBillingReviewComplete!==true ||
        clean(user.data?.accountStatus)!=="deletion_processing" ||
        clean(user.data?.role)==="owner" ||
        clean(object.data?.ownerUid)!==uid ||
        clean(reservation.data?.uid)!==uid ||
        clean(reservation.data?.requestId)!==requestId ||
        clean(reservation.data?.objectId)!==objectId ||
        clean(reservation.data?.operationToken)!==token ||
        clean(reservation.data?.state)!=="reserved_requires_external_interlock" ||
        reservation.data?.externalIoAllowed!==false ||
        reservation.data?.completionVerified!==false ||
        clean(admission.data?.action)!=="accountErasureProcessingAdmitted" ||
        clean(admission.data?.targetId)!==uid ||
        clean(admission.data?.requestId)!==requestId ||
        !Array.isArray(admission.data?.certifiedDomains) ||
        admission.data.certifiedDomains.length!==REQUIRED_ERASURE_ADMISSION_DOMAINS.length ||
        !REQUIRED_ERASURE_ADMISSION_DOMAINS.every(d=>
          admission.data.certifiedDomains.includes(d)) ||
        held(request.data) || held(checkpoint.data) ||
        held(user.data) || held(object.data)) {
      reject("external_io_coordination_not_authorized");
    }
    const requestedAtMs=dateMs(request.data?.requestedAt);
    const eligibleAtMs=dateMs(request.data?.eligibleAt);
    if (!Number.isSafeInteger(requestedAtMs) ||
        !Number.isSafeInteger(eligibleAtMs) ||
        eligibleAtMs<requestedAtMs+GRACE_MS ||
        nowMs<eligibleAtMs || nowMs<requestedAtMs+GRACE_MS) {
      reject("external_io_coordination_grace_not_elapsed");
    }
    await recheckErasureCertificatesInTransaction(db,tx,{
      uid,requestId,requestedAtMs,nowMs,
    });
    // Non-permissive, create-only and NOT an actual external operation.
    // Crash/timeout never causes this to become available for automatic retry.
    await db.commit(tx,[db.writeCreate(holdPath,{
      uid,requestId,objectId,operationToken:token,
      state:"claimed_requires_external_interlock",
      externalIoAllowed:false,revocationEffective:false,
      completionVerified:false,
      createdAt:new Date(nowMs),createdByUid:clean(actor.uid),
    })]);
    return {ok:true,holdRecorded:true,externalIoAllowed:false,
      revocationEffective:false,pendingReconciliation:true};
  }catch(error){
    await db.rollback(tx).catch(()=>{});
    throw error;
  }
}


/**
 * INTERNAL ONLY: create a conservative, irreversible "unknown outcome"
 * journal BEFORE any future external I/O. Creating the journal NEVER gives
 * permission to call bucket.delete. A crash at ANY point must NOT recycle
 * this attempt or infer success/failure from absent acknowledgments.
 *
 * Two workers cannot create two journals, and Owner stop and journal writer
 * read the same intent/attempt paths within their respective transactions.
 * A stop arriving AFTER the journal is only a pending stop, never an
 * effective revocation of a possibly started external operation.
 *
 * No scheduler, API, R2 binding or finalizer invokes this function.
 */
export async function recordAccountErasureExternalIoUncertainAttempt(db,{
  uid,requestId,objectId,token,actor,nowMs=Date.now(),
}={}){
  uid=clean(uid);requestId=clean(requestId);objectId=clean(objectId);
  token=clean(token);
  if(!actor?.owner || !uidOk(clean(actor?.uid)))reject("owner_required",403);
  if(!uidOk(uid)||!requestOk(requestId)||!objectOk(objectId)||
     !tokenOk(token)||!Number.isSafeInteger(nowMs)||nowMs<=0) {
    reject("invalid_external_io_uncertain_attempt",400);
  }
  if(typeof db?.beginTransaction!=="function"||
     typeof db?.commit!=="function"||
     typeof db?.writeCreate!=="function"){
    reject("external_io_transaction_adapter_missing",503);
  }
  const journalPath=uncertainAttemptPath(uid,requestId);
  const tx=await db.beginTransaction();
  try{
    const paths=[
      "account_deletion_requests/"+uid,
      "account_deletion_erasure_checkpoints/"+uid,
      "users/"+uid,
      "storage_objects/"+objectId,
      "account_erasure_external_io_reservations/"+uid+"__"+objectId,
      coordinationHoldPath(uid,requestId),
      revocationIntentPath(uid,requestId),
      journalPath,
      "admin_audit_logs/erasure_processing_start_"+requestId,
    ];
    const rows=typeof db.getMany==="function"
      ? await db.getMany(paths,tx)
      : await Promise.all(paths.map(path=>db.get(path,tx)));
    if(!Array.isArray(rows)||rows.length!==paths.length||
       rows.some(row=>!row||typeof row.exists!=="boolean")){
      reject("external_io_transaction_read_failed",503);
    }
    const [request,checkpoint,user,object,reservation,hold,stop,prior,admission]=rows;
    if(stop.exists)reject("external_io_revocation_intent_pending");
    if(prior.exists)reject("external_io_uncertain_attempt_requires_reconciliation");
    if(!request.exists||!checkpoint.exists||!user.exists||
       !object.exists||!reservation.exists||!hold.exists||!admission.exists||
       clean(request.data?.uid)!==uid||
       clean(request.data?.requestId)!==requestId||
       clean(request.data?.status)!=="processing"||
       clean(checkpoint.data?.uid)!==uid||
       clean(checkpoint.data?.requestId)!==requestId||
       clean(checkpoint.data?.phase)!=="storage_media"||
       checkpoint.data?.destructiveAllowed!==true||
       checkpoint.data?.storageRetentionApproved!==true||
       checkpoint.data?.sharedMediaOwnershipReviewed!==true||
       checkpoint.data?.legalEvidenceReviewComplete!==true||
       checkpoint.data?.financialSettlementApproved!==true||
       checkpoint.data?.playBillingReviewComplete!==true||
       clean(user.data?.accountStatus)!=="deletion_processing"||
       clean(user.data?.role)==="owner"||
       user.data?.authDeleted===true||
       clean(object.data?.ownerUid)!==uid||
       !clean(object.data?.storageKey)||
       clean(object.data?.storageKey).length>1024||
       clean(reservation.data?.uid)!==uid||
       clean(reservation.data?.requestId)!==requestId||
       clean(reservation.data?.objectId)!==objectId||
       clean(reservation.data?.operationToken)!==token||
       clean(reservation.data?.state)!=="reserved_requires_external_interlock"||
       reservation.data?.externalIoAllowed!==false||
       reservation.data?.completionVerified!==false||
       clean(hold.data?.uid)!==uid||
       clean(hold.data?.requestId)!==requestId||
       clean(hold.data?.objectId)!==objectId||
       clean(hold.data?.operationToken)!==token||
       clean(hold.data?.state)!=="claimed_requires_external_interlock"||
       hold.data?.externalIoAllowed!==false||
       hold.data?.revocationEffective!==false||
       hold.data?.completionVerified!==false||
       clean(admission.data?.action)!=="accountErasureProcessingAdmitted"||
       clean(admission.data?.targetId)!==uid||
       clean(admission.data?.requestId)!==requestId||
       !Array.isArray(admission.data?.certifiedDomains)||
       admission.data.certifiedDomains.length!==REQUIRED_ERASURE_ADMISSION_DOMAINS.length||
       !REQUIRED_ERASURE_ADMISSION_DOMAINS.every(d=>
         admission.data.certifiedDomains.includes(d))||
       held(request.data)||held(checkpoint.data)||
       held(user.data)||held(object.data)||held(admission.data)){
      reject("external_io_uncertain_attempt_not_authorized");
    }
    const requestedAtMs=dateMs(request.data?.requestedAt);
    const eligibleAtMs=dateMs(request.data?.eligibleAt);
    if(!Number.isSafeInteger(requestedAtMs)||
       !Number.isSafeInteger(eligibleAtMs)||
       requestedAtMs<=0||eligibleAtMs<requestedAtMs+GRACE_MS||
       nowMs<eligibleAtMs||nowMs<requestedAtMs+GRACE_MS){
      reject("external_io_uncertain_attempt_grace_not_elapsed");
    }
    await recheckErasureCertificatesInTransaction(db,tx,{
      uid,requestId,requestedAtMs,nowMs,
    });
    await db.commit(tx,[db.writeCreate(journalPath,{
      uid,requestId,objectId,operationToken:token,
      // Pin the exact candidate R2 key BEFORE an ambiguous outcome. It must
      // remain knowable even if Firestore storage metadata later disappears.
      storageKey:clean(object.data.storageKey),
      state:"outcome_unknown_requires_reconciliation",
      // An attempted/uncertain operation MUST never be retried just
      // because the worker did not record a success acknowledgement.
      retryAllowed:false,externalIoAllowed:false,
      completionVerified:false,revocationEffective:false,
      createdAt:new Date(nowMs),createdByUid:clean(actor.uid),
    })]);
    return {ok:true,uncertainAttemptRecorded:true,
      outcomeUnknown:true,retryAllowed:false,externalIoAllowed:false,
      completionVerified:false,pendingReconciliation:true};
  }catch(error){
    await db.rollback(tx).catch(()=>{});
    throw error;
  }
}


/**
 * INTERNAL, UNROUTED, READ-ONLY R2 evidence collection for an ambiguous
 * external outcome. bucket.head is the ONLY storage operation. A present or
 * absent key is a point-in-time observation, NOT proof that the original
 * bucket.delete succeeded/failed or that no unrelated writer intervened.
 *
 * The immutable attempt records the key before any eventual R2 work. Read
 * it in a closed transaction, perform ONE read-only head outside Firestore,
 * then recheck the complete exact identity in a new write transaction.
 * A concurrent stop is permitted: it remains pending and the observation
 * must NEVER release it, set externalIoAllowed or certify completion.
 * No auto retry, polling, production route or destructive operation.
 */
export async function recordAccountErasureExternalIoReadOnlyProbe(db,bucket,{
  uid,requestId,objectId,token,probeId,actor,nowMs=Date.now(),
}={}){
  uid=clean(uid);requestId=clean(requestId);objectId=clean(objectId);
  token=clean(token);probeId=clean(probeId);
  if(!actor?.owner||!uidOk(clean(actor?.uid)))reject("owner_required",403);
  if(!uidOk(uid)||!requestOk(requestId)||!objectOk(objectId)||
     !tokenOk(token)||!requestOk(probeId)||
     !Number.isSafeInteger(nowMs)||nowMs<=0){
    reject("invalid_external_io_probe",400);
  }
  if(typeof bucket?.head!=="function"||
     typeof db?.beginTransaction!=="function"||
     typeof db?.rollback!=="function"||
     typeof db?.commit!=="function"||
     typeof db?.writeCreate!=="function"){
    reject("external_io_read_only_probe_adapter_missing",503);
  }
  const journalPath=uncertainAttemptPath(uid,requestId);
  const observationPath="account_erasure_external_io_probe_observations/"+
    uid+"__"+requestId+"__"+probeId;
  const paths=[
    journalPath,
    coordinationHoldPath(uid,requestId),
    "account_erasure_external_io_reservations/"+uid+"__"+objectId,
    "storage_objects/"+objectId,
    "account_deletion_requests/"+uid,
    "account_deletion_erasure_checkpoints/"+uid,
    revocationIntentPath(uid,requestId),
    observationPath,
  ];
  const read=async(tx)=>{
    const rows=typeof db.getMany==="function"
      ? await db.getMany(paths,tx)
      : await Promise.all(paths.map(path=>db.get(path,tx)));
    if(!Array.isArray(rows)||rows.length!==paths.length||
       rows.some(row=>!row||typeof row.exists!=="boolean")){
      reject("external_io_probe_transaction_read_failed",503);
    }
    const [journal,hold,reservation,object,request,checkpoint,stop,existing]=rows;
    if(existing.exists)reject("external_io_probe_already_recorded");
    const key=clean(journal.data?.storageKey);
    if(!journal.exists||!hold.exists||!reservation.exists||
       !request.exists||!checkpoint.exists||
       clean(journal.data?.uid)!==uid||
       clean(journal.data?.requestId)!==requestId||
       clean(journal.data?.objectId)!==objectId||
       clean(journal.data?.operationToken)!==token||
       clean(journal.data?.state)!=="outcome_unknown_requires_reconciliation"||
       journal.data?.retryAllowed!==false||
       journal.data?.externalIoAllowed!==false||
       journal.data?.completionVerified!==false||
       !key||key.length>1024||
       clean(hold.data?.uid)!==uid||
       clean(hold.data?.requestId)!==requestId||
       clean(hold.data?.objectId)!==objectId||
       clean(hold.data?.operationToken)!==token||
       clean(hold.data?.state)!=="claimed_requires_external_interlock"||
       hold.data?.externalIoAllowed!==false||
       hold.data?.completionVerified!==false||
       clean(reservation.data?.uid)!==uid||
       clean(reservation.data?.requestId)!==requestId||
       clean(reservation.data?.objectId)!==objectId||
       clean(reservation.data?.operationToken)!==token||
       reservation.data?.externalIoAllowed!==false||
       reservation.data?.completionVerified!==false||
       clean(request.data?.uid)!==uid||
       clean(request.data?.requestId)!==requestId||
       clean(checkpoint.data?.uid)!==uid||
       clean(checkpoint.data?.requestId)!==requestId||
       (object.exists&&(
         clean(object.data?.ownerUid)!==uid||
         clean(object.data?.storageKey)!==key))||
       (stop.exists&&(
         clean(stop.data?.uid)!==uid||
         clean(stop.data?.requestId)!==requestId||
         stop.data?.revocationEffective!==false))){
      reject("external_io_probe_identity_mismatch");
    }
    return {key,objectExists:object.exists,stopObserved:stop.exists};
  };
  let original;
  const inspectionTx=await db.beginTransaction();
  try {
    original=await read(inspectionTx);
  } finally {
    await db.rollback(inspectionTx).catch(()=>{});
  }
  let head;
  try{
    head=await bucket.head(original.key);
  }catch{
    // A timeout/error says NOTHING about existence or delete outcome.
    // Preserve the unknown journal and leave no false success observation.
    reject("external_io_read_only_probe_failed",503);
  }
  if(head===undefined||!(head===null||
      (typeof head==="object"&&!Array.isArray(head)))){
    reject("external_io_read_only_probe_invalid_response",503);
  }
  const presence=head===null?"absent_at_probe":"present_at_probe";
  const tx=await db.beginTransaction();
  try{
    const latest=await read(tx);
    if(latest.key!==original.key||
       latest.objectExists!==original.objectExists){
      reject("external_io_probe_identity_changed");
    }
    // An Owner stop that arrived during the head call is captured on the
    // committed audit. We STILL do not mark that stop effective.
    const size=Number(head?.size);
    const etag=clean(head?.etag).slice(0,256);
    await db.commit(tx,[db.writeCreate(observationPath,{
      uid,requestId,objectId,operationToken:token,probeId,
      storageKey:original.key,
      state:"point_in_time_observation_requires_reconciliation",
      presenceAtProbe:presence,
      objectMetadataExistsAtProbe:latest.objectExists,
      stopObservedAtCommit:latest.stopObserved,
      observedSizeBytes:head&&Number.isSafeInteger(size)&&size>=0?size:null,
      observedEtag:head?etag:"",
      observedAt:new Date(nowMs),observedByUid:clean(actor.uid),
      // Neither branch resolves historical side effects or authorizes retry.
      retryAllowed:false,externalIoAllowed:false,
      completionVerified:false,revocationEffective:false,
    })]);
    return {ok:true,observationRecorded:true,presenceAtProbe:presence,
      stopObservedAtCommit:latest.stopObserved,
      retryAllowed:false,externalIoAllowed:false,
      completionVerified:false,pendingReconciliation:true};
  }catch(error){
    await db.rollback(tx).catch(()=>{});
    throw error;
  }
}
