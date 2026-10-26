import assert from "node:assert/strict";
import test from "node:test";
import {
  issueAccountErasureExternalIoReviewerGrant as issue,
  revokeAccountErasureExternalIoReviewerGrant as revoke,
} from "../../cloudflare-worker/src/account-deletion-external-io-reviewer-grants.js";

const uid="erasure_grant_subject_123456";
const requestId="erasure_grant_request_123456";
const objectId="erasure_grant_object_123456";
const ownerUid="erasure_grant_owner_123456";
const reviewerUid="erasure_grant_reviewer_123456";
const nowMs=Date.parse("2026-10-26T05:00:00Z");
const cPath="account_erasure_external_io_reconciliation_cases/"+uid+"__"+requestId;
const sPath="account_erasure_external_io_revocation_intents/"+uid+"__"+requestId;
const gPath="account_erasure_external_io_reviewer_grants/"+
  uid+"__"+requestId+"__"+reviewerUid;
const aPath="admin_audit_logs/erasure_external_io_reviewer_grant_"+
  requestId+"__"+reviewerUid;
const revokeAudit="admin_audit_logs/erasure_external_io_reviewer_grant_revoked_"+
  requestId+"__"+reviewerUid;

class Db {
  constructor(){
    this.docs=new Map([
      [cPath,{uid,requestId,objectId,
        createdByUid:"different_case_creator_123456",
        status:"awaiting_independent_evidence_review",
        ownerStopObserved:true,externalIoAllowed:false,retryAllowed:false,
        completionVerified:false,revocationEffective:false}],
      [sPath,{uid,requestId,status:"pending_reconciliation",
        requestedByUid:ownerUid,externalIoAllowed:false,
        revocationEffective:false}],
      ["account_deletion_requests/"+uid,{uid,requestId,status:"processing"}],
      ["account_deletion_erasure_checkpoints/"+uid,{uid,requestId}],
      ["users/"+ownerUid,{uid:ownerUid,role:"owner",
        accountStatus:"active",authDeleted:false}],
      ["users/"+reviewerUid,{uid:reviewerUid,role:"admin",
        adminEnabled:true,accountStatus:"active",authDeleted:false,
        capabilities:["reviewAccountErasureR2Evidence"]}],
    ]);
    this.reads=[];this.writes=[];this.rollbackCount=0;
  }
  async beginTransaction(){return "grant_tx";}
  async get(path,tx){assert.equal(tx,"grant_tx");
    this.reads.push(path);return {exists:this.docs.has(path),
      data:this.docs.get(path)||null};}
  async getMany(paths,tx){assert.equal(tx,"grant_tx");
    this.reads.push(...paths);
    return paths.map(p=>({exists:this.docs.has(p),data:this.docs.get(p)||null}));}
  writeCreate(path,data){return {op:"create",path,data};}
  writeUpdate(path,data,mask){return {op:"update",path,data,mask};}
  async commit(tx,writes){assert.equal(tx,"grant_tx");
    for(const w of writes){
      if(w.op==="create"&&this.docs.has(w.path))
        throw Error("duplicate_firestore_document");
      if(w.op==="update"&&!this.docs.has(w.path))
        throw Error("missing_firestore_document");
    }
    for(const w of writes){
      this.writes.push(w.path);
      this.docs.set(w.path,w.op==="create"?w.data:
        {...this.docs.get(w.path),...w.data});
    }
  }
  async rollback(){this.rollbackCount++;}
}
const params=(extra={})=>({
  uid,requestId,objectId,reviewerUid,
  actor:{uid:ownerUid,owner:true},
  nowMs,...extra,
});
test("Owner issues exact immutable grant + audit only; no deletion permission",async()=>{
  const db=new Db();
  const result=await issue(db,params());
  assert.deepEqual(result,{
    ok:true,grantIssued:true,reviewerUid,
    expiresAtMs:nowMs+3600_000,externalIoAllowed:false,retryAllowed:false,
    completionVerified:false,revocationEffective:false,
  });
  assert.equal(db.writes.length,2);
  assert.deepEqual(db.writes,[gPath,aPath]);
  assert.equal(new Set(db.reads).size,9);
  assert.equal(db.docs.get(gPath).scope,"account_erasure_r2_reconciliation");
  assert.equal(db.docs.get(gPath).grantedByUid,ownerUid);
  assert.equal(db.docs.get(aPath).action,
    "accountErasureExternalIoReviewerGrantRecorded");
  assert.equal(db.docs.get(sPath).revocationEffective,false);
  assert.equal(db.docs.get(cPath).completionVerified,false);
  await assert.rejects(issue(db,params()),
    e=>e.code==="erasure_reviewer_grant_already_issued_or_revoked");
  assert.equal(db.writes.length,2);
});
test("grant issuance fails closed on Owner/session/target/reviewer/case defects",async()=>{
  const defects=[
    [db=>db.docs.get("users/"+ownerUid).role="admin",{}],
    [db=>db.docs.get("users/"+ownerUid).accountStatus="deleted",{}],
    [db=>db.docs.get("users/"+reviewerUid).adminEnabled=false,{}],
    [db=>db.docs.get("users/"+reviewerUid).capabilities=[],{}],
    [db=>db.docs.get("users/"+reviewerUid).accountStatus="banned",{}],
    [db=>db.docs.get(cPath).completionVerified=true,{}],
    [db=>db.docs.delete(sPath),{}],
    [db=>db.docs.get(sPath).revocationEffective=true,{}],
    [db=>db.docs.get(cPath).createdByUid=reviewerUid,{}],
    [db=>db.docs.get(sPath).requestedByUid=reviewerUid,{}],
    [db=>{}, {actor:{uid:ownerUid,owner:false}}],
    [db=>{}, {reviewerUid:ownerUid}],
    [db=>{}, {objectId:"../tamper"}],
    [db=>{}, {requestId:"other_request_123456"}],
  ];
  for(const [breakIt,change] of defects){
    const db=new Db();breakIt(db);
    await assert.rejects(issue(db,params(change)));
    assert.equal(db.writes.length,0);
    assert.equal(db.docs.has(gPath),false);
    assert.equal(db.docs.has(aPath),false);
  }
});
test("emergency reviewer revoke creates permanent tombstone without R2 effects",async()=>{
  const db=new Db();
  await issue(db,params());
  // The reviewer can lose admin access or grant can expire. This MUST
  // never block a properly authenticated Owner from revoking the grant.
  db.docs.get("users/"+reviewerUid).adminEnabled=false;
  const result=await revoke(db,params({nowMs:nowMs+7200_000}));
  assert.deepEqual(result,{
    ok:true,grantRevoked:true,reviewerUid,
    retryAllowed:false,externalIoAllowed:false,
    completionVerified:false,revocationEffective:false,
  });
  assert.equal(db.docs.get(gPath).status,"revoked");
  assert.equal(db.docs.get(gPath).revoked,true);
  assert.equal(db.docs.get(revokeAudit).actorUid,ownerUid);
  assert.equal(db.docs.get(revokeAudit).completionVerified,false);
  const size=db.writes.length;
  await assert.rejects(revoke(db,params()),
    e=>e.code==="erasure_reviewer_grant_revocation_conflict");
  // Even an unauthorized mutation of the mutable grant cannot
  // re-issue the one-case grant when the tombstone exists.
  db.docs.get(gPath).status="active";
  db.docs.get(gPath).revoked=false;
  await assert.rejects(issue(db,params()),
    e=>e.code==="erasure_reviewer_grant_already_issued_or_revoked");
  assert.equal(db.writes.length,size);
  assert.equal(db.docs.get(cPath).externalIoAllowed,false);
});
test("revoke rejects unauthenticated Owner, substituted object, malformed grant",async()=>{
  for(const damage of [
    (db)=>db.docs.get("users/"+ownerUid).role="admin",
    (db)=>db.docs.get(gPath).objectId="mismatched_object_123456",
    (db)=>db.docs.get(aPath).actorUid="impostor_123456",
    (db)=>db.docs.get(gPath).revoked=true,
    (db)=>db.docs.get(sPath).status="resolved",
  ]){
    const db=new Db();await issue(db,params());damage(db);
    await assert.rejects(revoke(db,params()));
    assert.equal(db.docs.has(revokeAudit),false);
    assert.equal(db.docs.get(cPath).completionVerified,false);
  }
});
test("incomplete transactional reads are not treated as no existing grant",async()=>{
  const db=new Db();
  db.getMany=async paths=>paths.slice(0,-1).map(path=>({
    exists:db.docs.has(path),data:db.docs.get(path)||null,
  }));
  await assert.rejects(issue(db,params()),
    e=>e.code==="erasure_reviewer_grant_snapshot_incomplete");
  assert.equal(db.docs.has(gPath),false);
});
test("Owner route reuses verified Firebase token, current profile and recent auth",async()=>{
  const {readFileSync}=await import("node:fs");
  const src=readFileSync("cloudflare-worker/src/admin-inbox.js","utf8");
  assert.match(src,/verifyFirebaseIdToken\(request, env/);
  assert.match(src,/loadActor\(db, decoded\)/);
  assert.match(src,/age > 600/);
  assert.match(src,/accountErasureR2ReviewerGrant/);
  assert.match(src,/accountErasureR2ReviewerRevoke/);
});

test("independent review HTTP action requires live admin capability and recent Firebase auth",async()=>{
  const {readFileSync}=await import("node:fs");
  const source=readFileSync("cloudflare-worker/src/admin-inbox.js","utf8");
  const start=source.indexOf('if (action === "accountErasureR2IndependentReview")');
  const end=source.indexOf("// Reuse the existing admin inbox route;",start);
  assert.ok(start>0 && end>start);
  const section=source.slice(start,end);
  assert.match(section,/actor\.owner/);
  assert.match(section,/actor\.adminEnabled/);
  assert.match(section,/actor\.capabilities\.has\("reviewAccountErasureR2Evidence"\)/);
  assert.match(section,/age > 600/);
  assert.match(section,/recordAccountErasureExternalIoIndependentReview\(db/);
  assert.match(section,/actor: \{uid: actor\.uid, evidenceReviewer: true\}/);
  assert.doesNotMatch(section,/body\.actor|body\.evidenceReviewer|body\.owner/);
});

test("Owner emergency R2 stop route is freshly authenticated and never destructive",async()=>{
  const {readFileSync}=await import("node:fs");
  const source=readFileSync("cloudflare-worker/src/admin-inbox.js","utf8");
  const start=source.indexOf('if (["accountDeletionCompletedLogs"');
  const stop=source.indexOf('if (action === "accountErasureR2EmergencyStop")',start);
  const closure=source.indexOf('if (action === "accountDeletionClosureReadiness")',stop);
  assert.ok(start>=0&&stop>start&&closure>stop);
  const segment=source.slice(start,closure);
  assert.match(segment,/if \(!actor\.owner\)/);
  assert.match(segment,/throw new AdminInboxError\("recent_auth_required", 401\)/);
  assert.match(segment,/requestAccountErasureExternalIoRevocationIntent\(db/);
  assert.match(segment,/uid: targetUid/);
  assert.match(segment,/requestId: body\.requestId/);
  assert.match(segment,/actor,/);
  assert.doesNotMatch(segment,/body\.owner|body\.actor|body\.destructiveAllowed/);
  const helper=readFileSync(
    "cloudflare-worker/src/account-deletion-external-io-reservation.js","utf8");
  const stopStart=helper.indexOf(
    "export async function requestAccountErasureExternalIoRevocationIntent");
  const stopEnd=helper.indexOf(
    "export async function reserveAccountErasureExternalIo",stopStart);
  assert.ok(stopEnd>stopStart);
  const code=helper.slice(stopStart,stopEnd);
  assert.match(code,/revocationEffective:false/);
  assert.match(code,/externalIoAllowed:false/);
  assert.match(code,/pendingReconciliation:true/);
  assert.doesNotMatch(code,/bucket\.delete\(|deleteAuthUser\(|writeDelete\(/);
});

test("Owner-only reconciliation opener binds two persisted probe IDs under fresh auth",async()=>{
  const {readFileSync}=await import("node:fs");
  const source=readFileSync("cloudflare-worker/src/admin-inbox.js","utf8");
  const start=source.indexOf('if (["accountDeletionCompletedLogs"');
  const handler=source.indexOf('if (action === "accountErasureR2OpenReconciliation")',start);
  const end=source.indexOf('if (action === "accountErasureR2ReviewerGrant"',handler);
  assert.ok(start>=0&&handler>start&&end>handler);
  const section=source.slice(start,end);
  assert.match(section,/if \(!actor\.owner\)/);
  assert.match(section,/throw new AdminInboxError\("recent_auth_required", 401\)/);
  assert.match(section,/openAccountErasureExternalIoReconciliationCase\(db/);
  for(const field of ["requestId","objectId","token","firstProbeId","secondProbeId"]){
    assert.ok(section.includes(field+": body."+field),"checked field "+field);
  }
  assert.match(section,/uid: targetUid/);
  assert.match(section,/actor,/);
  assert.doesNotMatch(section,/body\.actor|body\.owner|body\.destructiveAllowed/);
  assert.doesNotMatch(section,/bucket\.delete\(|writeDelete\(|deleteAuthUser\(/);
});
test("reconciliation opener cannot certify R2 deletion or remove a stop",async()=>{
  const {readFileSync}=await import("node:fs");
  const source=readFileSync(
    "cloudflare-worker/src/account-deletion-external-io-reconciliation.js",
    "utf8");
  const start=source.indexOf(
    "export async function openAccountErasureExternalIoReconciliationCase");
  assert.ok(start>0);
  const section=source.slice(start);
  assert.match(section,/firstProbeId===secondProbeId/);
  assert.match(section,/stop\.data\?\.revocationEffective!==false/);
  assert.match(section,/journal\.data\?\.retryAllowed!==false/);
  assert.match(section,/classif/);
  assert.match(section,/await db\.commit\(tx,\[/);
  assert.match(section,/db\.writeCreate\(casePath/);
  assert.match(section,/db\.writeCreate\(auditPath/);
  assert.match(section,/completionVerified:false/);
  assert.match(section,/retryAllowed:false/);
  assert.match(section,/externalIoAllowed:false/);
  assert.doesNotMatch(section,/bucket\.delete\(|writeDelete\(|deleteAuthUser\(|writeUpdate\(stopPath/);
});

test("Owner domain withdrawal route requires recent auth, exact account/domain, and no bucket I/O",async()=>{
  const {readFileSync}=await import("node:fs");
  const source=readFileSync("cloudflare-worker/src/admin-inbox.js","utf8");
  const ownerStart=source.indexOf('if (["accountDeletionCompletedLogs"');
  const handler=source.indexOf('if (action === "accountErasureR2WithdrawDomain")',ownerStart);
  const grantStart=source.indexOf('if (action === "accountErasureR2ReviewerGrant"',handler);
  assert.ok(ownerStart>=0&&handler>ownerStart&&grantStart>handler);
  const segment=source.slice(ownerStart,grantStart);
  assert.match(segment,/if \(!actor\.owner\)/);
  assert.match(segment,/throw new AdminInboxError\("recent_auth_required", 401\)/);
  assert.match(segment,/withdrawAccountErasureDomainWithExternalIoStop\(db/);
  assert.match(segment,/uid: targetUid/);
  assert.match(segment,/requestId: body\.requestId/);
  assert.match(segment,/domain: body\.domain/);
  assert.match(segment,/actor,/);
  assert.doesNotMatch(segment,/body\.owner|body\.actor|body\.destructiveAllowed/);
  assert.doesNotMatch(segment,/bucket\.delete\(|deleteAuthUser\(/);
});
test("certification withdrawal remains an immutable stop, never an erasure authorization",async()=>{
  const {readFileSync}=await import("node:fs");
  const code=readFileSync(
    "cloudflare-worker/src/account-deletion-domain-withdrawal-interlock.js",
    "utf8");
  assert.match(code,/REQUIRED_ERASURE_ADMISSION_DOMAINS\.includes\(domain\)/);
  assert.match(code,/db\.writeUpdate\(approvalPath/);
  assert.match(code,/db\.writeCreate\(withdrawalPath/);
  assert.match(code,/db\.writeCreate\(stopPath/);
  assert.match(code,/db\.writeCreate\(stopAuditPath/);
  assert.match(code,/revocationEffective:false/);
  assert.match(code,/retryAllowed:false/);
  assert.match(code,/externalIoAllowed:false/);
  assert.match(code,/externalIoOutcome:"requires_reconciliation"/);
  assert.doesNotMatch(code,/bucket\.delete\(|deleteAuthUser\(|writeDelete\(/);
});
