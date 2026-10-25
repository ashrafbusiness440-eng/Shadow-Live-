// INTERNAL / UNROUTED. A single independent, immutable evidence assessment
// for an already opened R2 unknown-outcome case. Not a proof of an R2 delete,
// not a release of the Owner stop, and never an Auth / completion receipt.
// A future endpoint MUST independently authenticate delegated reviewer rights.
const clean = value => String(value ?? "").trim();
const uidOk = value => /^[A-Za-z0-9_-]{3,128}$/.test(clean(value));
const requestOk = value => /^[A-Za-z0-9_-]{12,180}$/.test(clean(value));
const tokenOk = value => /^[A-Za-z0-9_-]{20,180}$/.test(clean(value));
const permittedAssessments = Object.freeze([
  "insufficient_provider_evidence",
  "external_history_discrepancy",
  "provider_evidence_submitted_unverified",
]);
const fail = (code,status=409) => {
  const e=new Error(code);e.code=code;e.status=status;throw e;
};
const rowOk=row=>row&&typeof row.exists==="boolean";
const path=(collection,uid,requestId)=>
  collection+"/"+uid+"__"+requestId;

/**
 * Attach one independent review to an existing non-destructive case.
 * The digest is merely a locator/fingerprint for evidence held in a
 * separately access-controlled vault. No evidence bytes, R2 object keys,
 * free text, direct provider URLs or credentials are stored by this writer.
 *
 * A distinct, server-authorized evidenceReviewer must differ from the
 * case creator, Owner stop requester and both HEAD observers. The review
 * is immutable and records one of three deliberately UNRESOLVED outcomes.
 * Even the "provider evidence submitted" state is NOT external proof:
 * the reader cannot infer authenticity, object generation or deletion.
 * R2 retry, completion and stop revocation always remain prohibited.
 */
export async function recordAccountErasureExternalIoIndependentReview(db,{
  uid,requestId,objectId,token,assessment,evidenceDigestSha256,actor,
  nowMs=Date.now(),
}={}){
  uid=clean(uid);requestId=clean(requestId);objectId=clean(objectId);
  token=clean(token);assessment=clean(assessment);
  const reviewer=clean(actor?.uid);
  if(!actor?.evidenceReviewer||!uidOk(reviewer))
    fail("independent_evidence_reviewer_required",403);
  if(!uidOk(uid)||!requestOk(requestId)||!requestOk(objectId)||
    !tokenOk(token)||!permittedAssessments.includes(assessment)||
    !/^[0-9a-f]{64}$/.test(evidenceDigestSha256??"")||
    !Number.isSafeInteger(nowMs)||nowMs<=0){
    fail("invalid_independent_external_io_review",400);
  }
  if(typeof db?.beginTransaction!=="function"||
    typeof db?.commit!=="function"||
    typeof db?.rollback!=="function"||
    typeof db?.writeCreate!=="function"||
    typeof db?.get!=="function"){
    fail("independent_external_io_review_adapter_missing",503);
  }
  const casePath=path("account_erasure_external_io_reconciliation_cases",
    uid,requestId);
  const reviewPath=path("account_erasure_external_io_independent_reviews",
    uid,requestId);
  const caseAuditPath="admin_audit_logs/erasure_external_io_reconciliation_case_"+
    requestId;
  const reviewAuditPath="admin_audit_logs/erasure_external_io_independent_review_"+
    requestId;
  const paths=[
    casePath,caseAuditPath,
    path("account_erasure_external_io_revocation_intents",uid,requestId),
    "admin_audit_logs/erasure_external_io_revocation_intent_"+requestId,
    path("account_erasure_external_io_uncertain_attempts",uid,requestId),
    path("account_erasure_external_io_coordination_holds",uid,requestId),
    "account_erasure_external_io_reservations/"+uid+"__"+objectId,
    "account_deletion_requests/"+uid,
    "account_deletion_erasure_checkpoints/"+uid,
    reviewPath,reviewAuditPath,
  ];
  const tx=await db.beginTransaction();
  try{
    const rows=typeof db.getMany==="function"
      ?await db.getMany(paths,tx)
      :await Promise.all(paths.map(p=>db.get(p,tx)));
    if(!Array.isArray(rows)||rows.length!==paths.length||
      rows.some(row=>!rowOk(row))){
      fail("independent_external_io_review_snapshot_incomplete",503);
    }
    const [caseDoc,caseAudit,stop,stopAudit,journal,hold,reservation,
      request,checkpoint,previousReview,previousAudit]=rows;
    if(previousReview.exists||previousAudit.exists)
      fail("independent_external_io_review_already_recorded");
    const c=caseDoc.data||{},s=stop.data||{},j=journal.data||{};
    const h=hold.data||{},r=reservation.data||{};
    if(!caseDoc.exists||!caseAudit.exists||!stop.exists||
      !stopAudit.exists||!journal.exists||!hold.exists||
      !reservation.exists||!request.exists||!checkpoint.exists||
      clean(c.uid)!==uid||clean(c.requestId)!==requestId||
      clean(c.objectId)!==objectId||clean(c.operationToken)!==token||
      clean(c.status)!=="awaiting_independent_evidence_review"||
      !["absence_does_not_prove_historical_deletion",
        "object_present_requires_non_destructive_resolution"].includes(
          clean(c.classification))||
      c.ownerStopObserved!==true||
      c.requiresHumanReview!==true||
      c.requiresProviderOrIndependentEvidence!==true||
      c.noAutomaticR2Retry!==true||
      c.retryAllowed!==false||c.externalIoAllowed!==false||
      c.completionVerified!==false||c.revocationEffective!==false||
      !Array.isArray(c.observationIds)||c.observationIds.length!==2||
      !requestOk(c.observationIds[0])||
      !requestOk(c.observationIds[1])||
      c.observationIds[0]===c.observationIds[1]||
      !uidOk(c.createdByUid)||c.createdByUid===reviewer||
      clean(caseAudit.data?.action)!==
        "accountErasureExternalIoReconciliationCaseOpened"||
      clean(caseAudit.data?.requestId)!==requestId||
      clean(caseAudit.data?.targetId)!==uid||
      caseAudit.data?.completionVerified!==false||
      clean(s.uid)!==uid||clean(s.requestId)!==requestId||
      clean(s.status)!=="pending_reconciliation"||
      !uidOk(s.requestedByUid)||s.requestedByUid===reviewer||
      s.externalIoAllowed!==false||s.revocationEffective!==false||
      clean(stopAudit.data?.action)!==
        "accountErasureExternalIoRevocationIntent"||
      clean(stopAudit.data?.requestId)!==requestId||
      clean(stopAudit.data?.targetId)!==uid||
      stopAudit.data?.revocationEffective!==false||
      clean(j.uid)!==uid||clean(j.requestId)!==requestId||
      clean(j.objectId)!==objectId||clean(j.operationToken)!==token||
      clean(j.state)!=="outcome_unknown_requires_reconciliation"||
      !clean(j.storageKey)||clean(j.storageKey)!==clean(c.storageKey)||
      j.externalIoAllowed!==false||j.retryAllowed!==false||
      j.completionVerified!==false||
      clean(h.uid)!==uid||clean(h.requestId)!==requestId||
      clean(h.objectId)!==objectId||clean(h.operationToken)!==token||
      h.externalIoAllowed!==false||h.completionVerified!==false||
      clean(r.uid)!==uid||clean(r.requestId)!==requestId||
      clean(r.objectId)!==objectId||clean(r.operationToken)!==token||
      r.externalIoAllowed!==false||r.completionVerified!==false||
      clean(request.data?.uid)!==uid||
      clean(request.data?.requestId)!==requestId||
      clean(checkpoint.data?.uid)!==uid||
      clean(checkpoint.data?.requestId)!==requestId){
      fail("independent_external_io_review_identity_or_fence_mismatch");
    }
    // Re-read BOTH observations transactionally: an edited case cannot
    // silently substitute the evidence or let its original observer review.
    const probePaths=c.observationIds.map(id=>
      "account_erasure_external_io_probe_observations/"+
      uid+"__"+requestId+"__"+id);
    const probes=typeof db.getMany==="function"
      ?await db.getMany(probePaths,tx)
      :await Promise.all(probePaths.map(p=>db.get(p,tx)));
    if(!Array.isArray(probes)||probes.length!==2||
       probes.some(row=>!rowOk(row)||!row.exists))
      fail("independent_external_io_review_probe_snapshot_invalid",503);
    for(let i=0;i<2;i++){
      const o=probes[i].data||{};
      if(clean(o.uid)!==uid||clean(o.requestId)!==requestId||
        clean(o.objectId)!==objectId||
        clean(o.operationToken)!==token||
        clean(o.probeId)!==c.observationIds[i]||
        clean(o.storageKey)!==clean(c.storageKey)||
        clean(o.state)!==
          "point_in_time_observation_requires_reconciliation"||
        !uidOk(o.observedByUid)||o.observedByUid===reviewer||
        o.stopObservedAtCommit!==true||
        o.externalIoAllowed!==false||o.retryAllowed!==false||
        o.completionVerified!==false||o.revocationEffective!==false){
        fail("independent_external_io_review_probe_identity_mismatch");
      }
    }
    const at=new Date(nowMs);
    const note={
      uid,requestId,objectId,operationToken:token,
      status:"independent_review_recorded_still_unresolved",
      assessment,claimedEvidenceDigestSha256:evidenceDigestSha256,
      evidenceAuthenticityVerified:false,
      reviewerUid:reviewer,reviewedAt:at,
      originalCaseClassification:clean(c.classification),
      providerHistoryVerified:false,requiresIndependentProviderEvidence:true,
      independentReviewRecorded:true,
      canCertifyErasure:false,
      retryAllowed:false,externalIoAllowed:false,
      completionVerified:false,revocationEffective:false,
    };
    await db.commit(tx,[
      db.writeCreate(reviewPath,note),
      db.writeCreate(reviewAuditPath,{
        action:"accountErasureExternalIoIndependentAssessmentRecorded",
        targetType:"user",targetId:uid,requestId,objectId,
        actorUid:reviewer,createdAt:at,assessment,
        claimedEvidenceDigestSha256:evidenceDigestSha256,
        completionVerified:false,revocationEffective:false,
      }),
    ]);
    return {ok:true,reviewRecorded:true,assessment,
      stillUnresolved:true,externalIoAllowed:false,retryAllowed:false,
      completionVerified:false,revocationEffective:false};
  }catch(error){
    await db.rollback(tx).catch(()=>{});
    throw error;
  }
}
