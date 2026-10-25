import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import {
  runCertifiedInternalAccountErasurePage as run,
  ACCOUNT_ERASURE_INTERNAL_STEPS, MAX_INTERNAL_ERASURE_PHASE_ITEMS,
} from "../../cloudflare-worker/src/account-deletion-internal-phase-runner.js";
import { REQUIRED_ERASURE_ADMISSION_DOMAINS as domains }
  from "../../cloudflare-worker/src/account-deletion-processing-admission.js";

const uid="stage_runner_user_123";
const other="stage_runner_other_456";
const owner="owner_stage_runner_123";
const requestId="stage_runner_request_123456";
const conversationId="conversation_runner_123456";
const nowMs=Date.parse("2026-12-25T12:00:00Z");
const requestedAtMs=nowMs-50*86400_000;
const reqPath="account_deletion_requests/"+uid;
const cpPath="account_deletion_erasure_checkpoints/"+uid;
const userPath="users/"+uid;
const auditPath="admin_audit_logs/erasure_processing_start_"+requestId;
const certPath=domain=>"account_deletion_erasure_approvals/"+requestId+"__"+domain;
const certAudit=domain=>"admin_audit_logs/erasure_domain_cert_"+requestId+"__"+domain;
const stagePhase={
  notifications:"notifications",push_devices:"push_devices",
  diary_likes:"diary_interactions",diary_views:"diary_interactions",
  private_text:"private_text",
};

class Db {
  constructor(step="notifications") {
    this.docs=new Map([
      [reqPath,{uid,requestId,status:"processing",
        requestedAt:new Date(requestedAtMs),
        eligibleAt:new Date(requestedAtMs+30*86400_000)}],
      [cpPath,{uid,requestId,phase:stagePhase[step],
        destructiveAllowed:true,notificationRetentionCleared:true,
        legalEvidenceReviewComplete:true,financialSettlementApproved:true,
        diaryInteractionRetentionCleared:true,historicalDiaryCountersReviewed:true,
        privateMessageRetentionCleared:true}],
      [userPath,{role:"user",accountStatus:"deletion_processing",
        coins:800,diamonds:12}],
      [auditPath,{action:"accountErasureProcessingAdmitted",targetId:uid,
        requestId,certifiedDomains:[...domains]}],
      ["conversations/"+conversationId,{participants:[uid,other]}],
    ]);
    for(const domain of domains) {
      this.docs.set(certPath(domain),{uid,requestId,domain,
        decision:"approved",signedByUid:owner,
        signedAt:new Date(nowMs-10000),expiresAt:new Date(nowMs+86400_000)});
      this.docs.set(certAudit(domain),{
        action:"accountErasureDomainCertified",actorUid:owner,
        targetId:uid,requestId,domain,createdAt:new Date(nowMs-10000)});
    }
    this.getCalls=[];this.queries=[];this.commits=0;
  }
  async get(path) {
    this.getCalls.push(path);
    return {exists:this.docs.has(path),data:this.docs.get(path)||null};
  }
  async runQuery(collection,options) {
    this.queries.push({collection,options});
    return [];
  }
  async beginTransaction() {return "tx";}
  async rollback() {}
  async commit() {this.commits++;throw Error("unexpected_write");}
}
const opts=(step,extra={})=>({
  uid,requestId,actor:{uid:owner,owner:true},step,nowMs,
  ...(step==="private_text"?{conversationId}:{}),...extra,
});

test("four transaction-guarded bounded stages can be invoked only with all six approvals",async()=>{
  assert.deepEqual(ACCOUNT_ERASURE_INTERNAL_STEPS,Object.keys(stagePhase));
  for(const step of ACCOUNT_ERASURE_INTERNAL_STEPS.filter(s=>s!=="private_text")) {
    const db=new Db(step);
    const result=await run(db,opts(step));
    assert.deepEqual({
      checked:result.checked,erased:result.erased,
      duplicate:result.duplicate,stageCompleted:result.stageCompleted,
      completionVerified:result.completionVerified,
      accountErased:result.accountErased,firebaseAuthDeleted:result.firebaseAuthDeleted,
    },{checked:0,erased:0,duplicate:0,stageCompleted:false,
      completionVerified:false,accountErased:false,firebaseAuthDeleted:false});
    assert.equal(db.queries.length,1);
    assert.equal(db.getCalls.filter(x=>x.startsWith(
      "account_deletion_erasure_approvals/")).length,6);
    assert.equal(db.commits,0);
    assert.equal(db.docs.get(userPath).coins,800);
    assert.equal(db.docs.get(userPath).diamonds,12);
  }
});

test("production-blocked checkpoints never read certificates or run any erasure stage",async()=>{
  const db=new Db();db.docs.get(cpPath).destructiveAllowed=false;
  await assert.rejects(run(db,opts("notifications")),
    e=>e.code==="internal_erasure_stage_blocked");
  assert.equal(db.getCalls.length,4);
  assert.equal(db.queries.length,0);
  assert.equal(db.commits,0);
});

test("stale, held, forged or unadmitted stages block before querying or approvals",async()=>{
  const mutations=[
    d=>d.docs.get(reqPath).status="review_ready",
    d=>d.docs.get(reqPath).requestId="replacement_req_123456",
    d=>d.docs.get(cpPath).requestId="replacement_req_123456",
    d=>d.docs.get(cpPath).phase="private_text",
    d=>d.docs.get(reqPath).appealPending=true,
    d=>d.docs.get(cpPath).appealStatus="Under_Review",
    d=>d.docs.get(userPath).investigationHold=true,
    d=>d.docs.get(userPath).role="owner",
    d=>d.docs.get(userPath).accountStatus="active",
    d=>d.docs.get(userPath).authDeleted=true,
    d=>d.docs.delete(auditPath),
    d=>d.docs.get(auditPath).certifiedDomains=["financial_settlement"],
    d=>d.docs.get(auditPath).targetId=other,
    d=>d.docs.get(reqPath).eligibleAt=new Date(nowMs+1),
    d=>d.docs.get(reqPath).requestedAt=new Date(nowMs-86400_000),
  ];
  for(const mutate of mutations) {
    const db=new Db();mutate(db);
    await assert.rejects(run(db,opts("notifications")));
    assert.equal(db.queries.length,0);
    assert.equal(db.commits,0);
    assert.equal(db.getCalls.length,4);
  }
});

test("revoked, held, stale or mismatched independent certificates deny page execution",async()=>{
  for(const domain of domains) {
    for(const patch of [
      d=>d.docs.delete(certPath(domain)),
      d=>d.docs.delete(certAudit(domain)),
      d=>d.docs.get(certPath(domain)).decision="revoked",
      d=>d.docs.get(certPath(domain)).expiresAt=new Date(nowMs-1),
      d=>d.docs.get(certPath(domain)).appealStatus="open",
      d=>d.docs.get(certAudit(domain)).investigationHold=true,
      d=>d.docs.get(certAudit(domain)).actorUid="fake_owner_123",
    ]) {
      const db=new Db();patch(db);
      await assert.rejects(run(db,opts("notifications")),
        e=>e.code==="internal_erasure_certification_invalid");
      assert.equal(db.queries.length,0);
      assert.equal(db.commits,0);
      assert.equal(db.docs.get(userPath).coins,800);
    }
  }
});

test("malformed input and unknown phase are rejected before even one Firestore read",async()=>{
  const patches=[
    {actor:{owner:false,uid:owner}},
    {actor:{owner:true,uid:"../unsafe"}},
    {uid:"../../unsafe"},{requestId:"bad"},
    {step:"storage_media"},{step:"firebase_auth"},
    {limit:0},{limit:MAX_INTERNAL_ERASURE_PHASE_ITEMS+1},
    {limit:"5"},{nowMs:NaN},
    {conversationId:"../../unsafe"},
    {cursor:"missing_cursor_123456"},
  ];
  for(const patch of patches) {
    const db=new Db();
    await assert.rejects(run(db,opts("notifications",patch)),
      e=>[400,403].includes(e.status));
    assert.equal(db.getCalls.length,0);
    assert.equal(db.queries.length,0);
  }
  const db=new Db("private_text");
  await assert.rejects(run(db,opts("private_text",{conversationId:"../unsafe"})),
    e=>e.code==="invalid_internal_erasure_step");
  assert.equal(db.getCalls.length,0);
});

test("dispatcher has no production route, scheduling, Auth delete or R2 operations",()=>{
  const src=readFileSync(
    "cloudflare-worker/src/account-deletion-internal-phase-runner.js","utf8");
  const route=readFileSync("cloudflare-worker/src/admin-inbox.js","utf8");
  assert.doesNotMatch(route,/account-deletion-internal-phase-runner/);
  assert.doesNotMatch(src,
    /deleteAuthUser\(|bucket\.delete\(|setInterval\(|setTimeout\(|db\.writeUpdate\(|db\.writeDelete\(|db\.commit\(/);
  assert.match(src,/c\.destructiveAllowed !== true/);
  assert.match(src,/completionVerified: false/);
});

import {
  recheckErasureCertificatesInTransaction as recheckTransaction,
} from "../../cloudflare-worker/src/account-deletion-erasure-transactional-cert-gate.js";

test("transaction certificate guard reuses all six approvals in the supplied tx, without writes",async()=>{
  const db=new Db();
  const tx="certificate_tx_123";
  const originalGet=db.get.bind(db);
  const checked=[];
  db.get=async(path,actualTx)=>{
    assert.equal(actualTx,tx);
    checked.push(path);
    return originalGet(path);
  };
  const result=await recheckTransaction(db,tx,{
    uid,requestId,requestedAtMs,nowMs,
  });
  assert.deepEqual(result,{
    validAtTransactionRead:true,validatedDomains:6,
    destructiveAllowed:false,completionVerified:false,
  });
  assert.equal(checked.length,18);
  assert.equal(db.queries.length,0);
  assert.equal(db.commits,0);
});

test("transaction certificate guard rejects missing tx before reading",async()=>{
  const db=new Db();
  await assert.rejects(
    recheckTransaction(db,null,{uid,requestId,requestedAtMs,nowMs}),
    e=>e.code==="erasure_transactional_certification_blocked");
  assert.equal(db.getCalls.length,0);
});

test("transaction certificate guard rejects each revoked domain and late appeal",async()=>{
  for (const domain of domains) {
    for (const mutation of [
      d=>d.docs.get(certPath(domain)).decision="revoked",
      d=>d.docs.get(certPath(domain)).appealPending=true,
      d=>d.docs.delete(certAudit(domain)),
    ]) {
      const db=new Db();
      mutation(db);
      await assert.rejects(recheckTransaction(db,"tx",{
        uid,requestId,requestedAtMs,nowMs,
      }),e=>e.code==="erasure_transactional_certification_blocked");
      assert.equal(db.commits,0);
      assert.equal(db.queries.length,0);
    }
  }
});

test("transaction certification helper stays unexposed and does not write or delete",()=>{
  const src=readFileSync(
    "cloudflare-worker/src/account-deletion-erasure-transactional-cert-gate.js","utf8");
  const route=readFileSync("cloudflare-worker/src/admin-inbox.js","utf8");
  assert.doesNotMatch(route,/account-deletion-erasure-transactional-cert-gate/);
  for (const write of ["db.commit(", "db.writeDelete(", "bucket.delete(", "deleteAuthUser("]) {
    assert.equal(src.includes(write), false);
  }
  assert.match(src,/destructiveAllowed: false/);
});

test("production-style bounded batchGet reads all signoffs in the exact write transaction",async()=>{
  const db=new Db();
  const calls=[];
  db.getMany=async(paths,transaction)=>{
    calls.push({paths,transaction});
    return paths.map(path=>({
      exists:db.docs.has(path),data:db.docs.get(path)||null,
    }));
  };
  const result=await recheckTransaction(db,"tx",{
    uid,requestId,requestedAt:new Date(requestedAtMs),nowMs,
  });
  assert.equal(result.validatedDomains,6);
  assert.equal(calls.length,1);
  assert.equal(calls[0].transaction,"tx");
  assert.equal(calls[0].paths.length,18);
  assert.equal(new Set(calls[0].paths).size,18);
  assert.equal(db.getCalls.length,0);
  assert.equal(db.commits,0);
});

test("bounded batchGet missing audit fails closed and never falls back to unlocked reads",async()=>{
  const db=new Db();
  const missing=certAudit("retention_policy");
  db.getMany=async(paths,transaction)=>{
    assert.equal(transaction,"tx");
    return paths.map(path=>({
      exists:path!==missing && db.docs.has(path),
      data:path===missing?null:db.docs.get(path)||null,
    }));
  };
  await assert.rejects(recheckTransaction(db,"tx",{
    uid,requestId,requestedAtMs,nowMs,
  }),e=>e.code==="erasure_transactional_certification_blocked");
  assert.equal(db.getCalls.length,0);
  assert.equal(db.commits,0);
});

test("even fully certified processing state cannot dispatch unguarded private text",async()=>{
  const db=new Db("private_text");
  await assert.rejects(run(db,opts("private_text")),
    e=>e.code==="private_text_erasure_transaction_guard_missing");
  assert.equal(db.getCalls.length,0);
  assert.equal(db.queries.length,0);
  assert.equal(db.commits,0);
  assert.equal(db.docs.get("conversations/"+conversationId).participants[1],other);
  assert.equal(db.docs.get(userPath).diamonds,12);
});

test("immutable withdrawal tombstone blocks all six stage signoffs even if approved field is restored",async()=>{
  for(const domain of domains){
    const db=new Db();
    const path="admin_audit_logs/erasure_domain_withdrawal_"+
      requestId+"__"+domain;
    db.docs.set(path,{action:"accountErasureDomainWithdrawnWithExternalIoStop",
      targetId:uid,requestId,domain,createdAt:new Date(nowMs)});
    // The original certificate and its original certification audit remain
    // valid/approved: only a durable withdrawal tombstone denies mutation.
    assert.equal(db.docs.get(certPath(domain)).decision,"approved");
    await assert.rejects(recheckTransaction(db,"tx",{
      uid,requestId,requestedAtMs,nowMs,
    }),e=>e.code==="erasure_transactional_certification_blocked");
    assert.equal(db.commits,0);
  }
});
test("missing tombstone batchGet slot never masquerades as no withdrawal",async()=>{
  const db=new Db();
  db.getMany=async(paths,tx)=>paths.map((p,i)=>
    i===2?null:{exists:db.docs.has(p),data:db.docs.get(p)||null});
  await assert.rejects(recheckTransaction(db,"tx",{
    uid,requestId,requestedAtMs,nowMs,
  }),e=>e.code==="erasure_transactional_certification_blocked");
  assert.equal(db.commits,0);
});
