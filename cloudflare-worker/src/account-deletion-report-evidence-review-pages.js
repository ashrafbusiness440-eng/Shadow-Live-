import { accountDeletionHasActiveHold as holds } from "./account-deletion-active-holds.js";
// INTERNAL only: scoped review of report retention obligations. No report
// deletion, evidence retrieval, R2, cron, Auth changes or clearance issuer.
// Existing report-evidence-retention.js owns the 90-day cleanup lifecycle.
const clean=v=>String(v??"").trim();
const uidOk=v=>/^[A-Za-z0-9_-]{3,128}$/.test(clean(v));
const reqOk=v=>/^[A-Za-z0-9_-]{12,180}$/.test(clean(v));
const reportIdOk=v=>/^[A-Za-z0-9_-]{1,512}$/.test(clean(v));
const finalStatuses=new Set(["rejected","actioned","closed","reviewed"]);
export const MAX_REPORT_EVIDENCE_REVIEW_PAGE=5;
export const REPORT_EVIDENCE_REVIEW_SCOPES=Object.freeze({
  reporter: Object.freeze({field:"reporterUid"}),
  target: Object.freeze({field:"targetUid"}),
  legacy_reporter: Object.freeze({field:"reporterId"}),
  legacy_target: Object.freeze({field:"targetUserId"}),
});
export class AccountReportEvidenceReviewError extends Error {
  constructor(code,status=409){
    super(code);this.code=code;this.status=status;
  }
}
const reject=(code,status)=>{
  throw new AccountReportEvidenceReviewError(code,status);
};
const dateMs=value=>{
  if(value instanceof Date)return value.getTime();
  if(typeof value?.toDate==="function")return value.toDate().getTime();
  if(typeof value==="string"&&value.trim())return Date.parse(value);
  return NaN;
};

/**
 * Review one of the FOUR indexed report references for the current user.
 * No report content, screenshots, reasons, counterpart IDs, PII or proof
 * of expiry is returned. A due timestamp is NOT erasure authorization.
 */
export async function inspectAccountReportEvidencePage(db,{
  uid,requestId,actor,scope,cursor=null,limit=MAX_REPORT_EVIDENCE_REVIEW_PAGE,
  nowMs=Date.now(),
}={}){
  uid=clean(uid);requestId=clean(requestId);
  if(!actor?.owner||!uidOk(actor.uid))reject("owner_required",403);
  if(!uidOk(uid)||!reqOk(requestId)||
     !Object.hasOwn(REPORT_EVIDENCE_REVIEW_SCOPES,scope)||
     !Number.isSafeInteger(limit)||limit<1||
     limit>MAX_REPORT_EVIDENCE_REVIEW_PAGE||
     !Number.isSafeInteger(nowMs)||nowMs<=0||
     (cursor!==null&&(typeof cursor!=="string"||!reportIdOk(cursor)))){
    reject("invalid_report_evidence_review_target",400);
  }
  const [req,checkpoint,user]=await Promise.all([
    db.get("account_deletion_requests/"+uid),
    db.get("account_deletion_erasure_checkpoints/"+uid),
    db.get("users/"+uid),
  ]);
  if(!req.exists||!checkpoint.exists||!user.exists||
     clean(req.data?.uid)!==uid||
     clean(req.data?.requestId)!==requestId||
     clean(checkpoint.data?.uid)!==uid||
     clean(checkpoint.data?.requestId)!==requestId||
     !["review_ready","processing"].includes(clean(req.data?.status))||
     clean(user.data?.role)==="owner"||user.data?.authDeleted===true||
     holds(req.data)||holds(checkpoint.data)||holds(user.data)){
    reject("report_evidence_review_blocked");
  }
  const field=REPORT_EVIDENCE_REVIEW_SCOPES[scope].field;
  const rows=await db.runQuery("reports",{
    filters:[{field,op:"==",value:uid}],
    orderBy:[{field:"__name__",direction:"asc"}],
    startAfter:cursor?[{referencePath:"reports/"+cursor}]:[],
    limit:limit+1,
  });
  if(!Array.isArray(rows)||rows.length>limit+1||
     rows.some(row=>!reportIdOk(row?.id)||!row?.data)||
     new Set(rows.map(row=>row.id)).size!==rows.length){
    reject("report_evidence_invalid_page",503);
  }
  const selected=rows.slice(0,limit);
  for(const row of selected){
    if(clean(row.data[field])!==uid){
      reject("report_evidence_index_mismatch");
    }
  }
  // Exact cross-read only for diary mirrors, no broad reports/evidence scan.
  const mirrors=await Promise.all(selected.map(row=>
    ["diary","diary_comment"].includes(clean(row.data.targetType))
      ? db.get("diary_reports/"+row.id)
      : Promise.resolve({exists:false,data:null})));
  const items=selected.map((row,i)=>{
    const d=row.data,mirror=mirrors[i],deadline=dateMs(d.evidencePurgeAt);
    const hasDeadline=Number.isFinite(deadline);
    const currentHold=holds(d)|| (mirror.exists&&holds(mirror.data));
    const settledStatus=finalStatuses.has(clean(d.status));
    // The retention writer does NOT start 90d from report creation.
    // Due/elapsed timestamps and final status must be independently reviewed.
    return {
      evidencePresent:d.evidence!==undefined && d.evidence!==null,
      linkedDiaryReportPresent:mirror.exists,
      holdOrAppealPresent:Boolean(currentHold),
      finalReportStatus:settledStatus,
      explicitPurgeDeadlinePresent:hasDeadline,
      purgeDeadlinePassed:hasDeadline&&deadline<=nowMs,
      retentionReviewRequired:true,
      deletionAuthorized:false,
    };
  });
  return {
    ok:true,scope,checked:selected.length,items,
    hasMore:rows.length>limit,
    // INTERNAL cursor only; a routed API must encrypt/bind it.
    nextCursor:rows.length>limit&&selected.length
      ? selected[selected.length-1].id : null,
    exhaustive:false,retentionCertified:false,
    evidenceErased:false,erasureAllowed:false,
    completionVerified:false,
  };
}
