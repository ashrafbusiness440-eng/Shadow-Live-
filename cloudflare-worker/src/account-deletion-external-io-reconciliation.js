// INTERNAL, UNROUTED: bounded, non-destructive R2 unknown-outcome case.
// This prepares exact, immutable evidence for HUMAN reconciliation; it NEVER
// certifies a past bucket.delete, releases a stop or authorizes a retry.
// Production erasure and account Auth deletion stay OFF.
const clean = v => String(v ?? "").trim();
const uidOk = v => /^[A-Za-z0-9_-]{3,128}$/.test(clean(v));
const idOk = v => /^[A-Za-z0-9_-]{12,180}$/.test(clean(v));
const tokenOk = v => /^[A-Za-z0-9_-]{20,180}$/.test(clean(v));
const ms = v => v instanceof Date ? v.getTime()
  : typeof v?.toDate === "function" ? v.toDate().getTime()
  : typeof v === "string" ? Date.parse(v)
  : Number.isFinite(v?.seconds) ? v.seconds * 1000 : NaN;
const journalPath = (uid,requestId) =>
  "account_erasure_external_io_uncertain_attempts/" + uid + "__" + requestId;
const holdPath = (uid,requestId) =>
  "account_erasure_external_io_coordination_holds/" + uid + "__" + requestId;
const stopPath = (uid,requestId) =>
  "account_erasure_external_io_revocation_intents/" + uid + "__" + requestId;
const probePath = (uid,requestId,probeId) =>
  "account_erasure_external_io_probe_observations/" +
  uid + "__" + requestId + "__" + probeId;
export class AccountErasureExternalIoReconciliationError extends Error {
  constructor(code,status=409){
    super(code);this.code=code;this.status=status;
  }
}
const fail=(code,status=409)=>{
  throw new AccountErasureExternalIoReconciliationError(code,status);
};

/**
 * Build ONE immutable manually actionable case from two *independently
 * recorded* R2 HEAD observations AFTER an Owner stop intent. Both reads must
 * identify the same pinned key, request, operation token, hold, reservation
 * and an unchanged metadata pointer (when still present). Neither a present
 * nor an absent HEAD establishes historical deletion, so this never marks
 * completion, makes revocation effective, or permits a replay.
 *
 * The two observations must be in chronological order; they are not new
 * bucket calls. Revoked/expired signoffs MUST NOT prevent the owner from
 * initiating safe post-interruption evidence review. No page query, polling,
 * API route, or R2 binding. Exactly thirteen document reads in one
 * Firestore transaction; immutable case + audit created in the same commit.
 */
export async function openAccountErasureExternalIoReconciliationCase(db,{
  uid,requestId,objectId,token,firstProbeId,secondProbeId,actor,
  nowMs=Date.now(),
}={}){
  uid=clean(uid);requestId=clean(requestId);objectId=clean(objectId);
  token=clean(token);firstProbeId=clean(firstProbeId);
  secondProbeId=clean(secondProbeId);
  if(!actor?.owner||!uidOk(actor?.uid))fail("owner_required",403);
  if(!uidOk(uid)||!idOk(requestId)||!idOk(objectId)||
    !tokenOk(token)||!idOk(firstProbeId)||!idOk(secondProbeId)||
    firstProbeId===secondProbeId||!Number.isSafeInteger(nowMs)||nowMs<=0){
    fail("invalid_external_io_reconciliation_case",400);
  }
  if(typeof db?.beginTransaction!=="function"||
    typeof db?.rollback!=="function"||
    typeof db?.commit!=="function"||
    typeof db?.writeCreate!=="function"){
    fail("external_io_reconciliation_adapter_missing",503);
  }
  const casePath="account_erasure_external_io_reconciliation_cases/"+
    uid+"__"+requestId;
  const auditPath="admin_audit_logs/erasure_external_io_reconciliation_case_"+
    requestId;
  const paths=[
    journalPath(uid,requestId),
    holdPath(uid,requestId),
    "account_erasure_external_io_reservations/"+uid+"__"+objectId,
    stopPath(uid,requestId),
    "admin_audit_logs/erasure_external_io_revocation_intent_"+requestId,
    "account_deletion_requests/"+uid,
    "account_deletion_erasure_checkpoints/"+uid,
    "storage_objects/"+objectId,
    probePath(uid,requestId,firstProbeId),
    probePath(uid,requestId,secondProbeId),
    casePath,auditPath,
    "account_erasure_external_io_fixture_dispatches/"+uid+"__"+requestId,
  ];
  const tx=await db.beginTransaction();
  try{
    const rows=typeof db.getMany==="function"
      ?await db.getMany(paths,tx)
      :await Promise.all(paths.map(p=>db.get(p,tx)));
    if(!Array.isArray(rows)||rows.length!==paths.length||
      rows.some(row=>!row||typeof row.exists!=="boolean")){
      fail("external_io_reconciliation_snapshot_incomplete",503);
    }
    const [journal,hold,reservation,stop,stopAudit,request,checkpoint,
      object,first,second,priorCase,priorAudit,dispatch]=rows;
    if(priorCase.exists||priorAudit.exists)
      fail("external_io_reconciliation_case_already_open");
    const key=clean(journal.data?.storageKey);
    if(!journal.exists||!hold.exists||!reservation.exists||!stop.exists||
      !stopAudit.exists||!request.exists||!checkpoint.exists||
      !first.exists||!second.exists||
      !key||key.length>1024||
      clean(journal.data?.uid)!==uid||
      clean(journal.data?.requestId)!==requestId||
      clean(journal.data?.objectId)!==objectId||
      clean(journal.data?.operationToken)!==token||
      clean(journal.data?.state)!=="outcome_unknown_requires_reconciliation"||
      journal.data?.retryAllowed!==false||
      journal.data?.externalIoAllowed!==false||
      journal.data?.completionVerified!==false||
      clean(hold.data?.uid)!==uid||
      clean(hold.data?.requestId)!==requestId||
      clean(hold.data?.objectId)!==objectId||
      clean(hold.data?.operationToken)!==token||
      clean(hold.data?.state)!=="claimed_requires_external_interlock"||
      hold.data?.externalIoAllowed!==false||
      hold.data?.revocationEffective!==false||
      hold.data?.completionVerified!==false||
      clean(reservation.data?.uid)!==uid||
      clean(reservation.data?.requestId)!==requestId||
      clean(reservation.data?.objectId)!==objectId||
      clean(reservation.data?.operationToken)!==token||
      reservation.data?.externalIoAllowed!==false||
      reservation.data?.completionVerified!==false||
      clean(stop.data?.uid)!==uid||
      clean(stop.data?.requestId)!==requestId||
      clean(stop.data?.status)!=="pending_reconciliation"||
      stop.data?.revocationEffective!==false||
      stop.data?.externalIoAllowed!==false||
      clean(stopAudit.data?.action)!==
        "accountErasureExternalIoRevocationIntent"||
      clean(stopAudit.data?.targetId)!==uid||
      clean(stopAudit.data?.requestId)!==requestId||
      stopAudit.data?.revocationEffective!==false||
      clean(request.data?.uid)!==uid||
      clean(request.data?.requestId)!==requestId||
      clean(checkpoint.data?.uid)!==uid||
      clean(checkpoint.data?.requestId)!==requestId||
      (object.exists&&(
        clean(object.data?.ownerUid)!==uid||
        clean(object.data?.storageKey)!==key))||
      (dispatch.exists&&(
        clean(dispatch.data?.uid)!==uid||
        clean(dispatch.data?.requestId)!==requestId||
        clean(dispatch.data?.objectId)!==objectId||
        clean(dispatch.data?.operationToken)!==token||
        clean(dispatch.data?.storageKey)!==key||
        dispatch.data?.completionVerified!==false||
        dispatch.data?.productionExternalIoAllowed!==false))){
      fail("external_io_reconciliation_identity_or_fence_mismatch");
    }
    const stopAt=ms(stop.data?.requestedAt);
    const observations=[
      {row:first,probeId:firstProbeId},
      {row:second,probeId:secondProbeId},
    ].map(({row,probeId})=>{
      const d=row.data||{};
      const at=ms(d.observedAt);
      if(clean(d.uid)!==uid||clean(d.requestId)!==requestId||
        clean(d.objectId)!==objectId||
        clean(d.operationToken)!==token||
        clean(d.probeId)!==probeId||
        clean(d.storageKey)!==key||
        clean(d.state)!==
          "point_in_time_observation_requires_reconciliation"||
        !["present_at_probe","absent_at_probe"].includes(
          clean(d.presenceAtProbe))||
        !uidOk(d.observedByUid)||
        d.stopObservedAtCommit!==true||
        d.retryAllowed!==false||
        d.externalIoAllowed!==false||
        d.completionVerified!==false||
        d.revocationEffective!==false||
        !Number.isSafeInteger(at)||at<stopAt||at>nowMs){
        fail("external_io_reconciliation_observation_invalid");
      }
      return {probeId,observedAt:new Date(at),
        presenceAtProbe:clean(d.presenceAtProbe),
        observedEtag:clean(d.observedEtag).slice(0,256),
        observedSizeBytes:
          Number.isSafeInteger(d.observedSizeBytes)&&
          d.observedSizeBytes>=0?d.observedSizeBytes:null};
    });
    if(!Number.isSafeInteger(stopAt)||stopAt<=0||
      ms(observations[1].observedAt)<=ms(observations[0].observedAt)){
      fail("external_io_reconciliation_probe_order_invalid");
    }
    const classification=
      observations[1].presenceAtProbe==="present_at_probe"
        ?"object_present_requires_non_destructive_resolution"
        :"absence_does_not_prove_historical_deletion";
    const at=new Date(nowMs),by=clean(actor.uid);
    await db.commit(tx,[
      db.writeCreate(casePath,{
        uid,requestId,objectId,operationToken:token,storageKey:key,
        status:"awaiting_independent_evidence_review",
        classification,
        observationIds:[firstProbeId,secondProbeId],
        observations,
        objectMetadataStillExists:object.exists,
        fixtureDispatchObserved:dispatch.exists,
        ownerStopObserved:true,
        requiresProviderOrIndependentEvidence:true,
        requiresHumanReview:true,
        noAutomaticR2Retry:true,
        retryAllowed:false,externalIoAllowed:false,
        completionVerified:false,revocationEffective:false,
        createdAt:at,createdByUid:by,
      }),
      db.writeCreate(auditPath,{
        action:"accountErasureExternalIoReconciliationCaseOpened",
        targetType:"user",targetId:uid,requestId,objectId,
        operationToken:token,
        actorUid:by,createdAt:at,
        classification,
        evidenceProbeIds:[firstProbeId,secondProbeId],
        completionVerified:false,revocationEffective:false,
      }),
    ]);
    return {ok:true,caseOpened:true,classification,
      pendingIndependentReview:true,requiresProviderEvidence:true,
      retryAllowed:false,externalIoAllowed:false,
      completionVerified:false,revocationEffective:false};
  }catch(error){
    await db.rollback(tx).catch(()=>{});
    throw error;
  }
}
