import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { admitCertifiedAccountErasure, REQUIRED_ERASURE_ADMISSION_DOMAINS }
  from "../../cloudflare-worker/src/account-deletion-processing-admission.js";

const uid = "erasure_test_user_123";
const requestId = "erasure_request_123456789";
const ownerUid = "platform_owner_12345";
const nowMs = Date.parse("2026-12-01T12:00:00Z");
const requestedAtMs = Date.parse("2026-10-01T12:00:00Z");
const eligibleAtMs = requestedAtMs + 30 * 86400_000;
const requestPath = "account_deletion_requests/" + uid;
const checkpointPath = "account_deletion_erasure_checkpoints/" + uid;
const userPath = "users/" + uid;
const startAuditPath = "admin_audit_logs/erasure_processing_start_" + requestId;
const approvePath = domain =>
  "account_deletion_erasure_approvals/" + requestId + "__" + domain;
const domainAuditPath = domain =>
  "admin_audit_logs/erasure_domain_cert_" + requestId + "__" + domain;
class Db {
  constructor() {
    this.docs = new Map([
      [requestPath, {
        uid, requestId, status: "review_ready",
        requestedAt: new Date(requestedAtMs),
        eligibleAt: new Date(eligibleAtMs),
      }],
      [checkpointPath, {
        uid, requestId, phase: "preflight_blocked",
        destructiveAllowed: false,
      }],
      [userPath, {
        role: "user", accountStatus: "active", coins: 300, diamonds: 5,
        name: "Do not erase customer data",
      }],
    ]);
    for (const domain of REQUIRED_ERASURE_ADMISSION_DOMAINS) {
      this.docs.set(approvePath(domain), {
        uid, requestId, domain, decision: "approved",
        signedByUid: ownerUid,
        signedAt: new Date(nowMs - 10_000),
        expiresAt: new Date(nowMs + 86400_000),
      });
      this.docs.set(domainAuditPath(domain), {
        action: "accountErasureDomainCertified",
        actorUid: ownerUid, targetId: uid, requestId, domain,
        createdAt: new Date(nowMs - 10_000),
      });
    }
    this.reads = []; this.commits = []; this.rollbacks = 0;
  }
  async beginTransaction() { return "tx"; }
  async rollback() { this.rollbacks++; }
  async get(path, tx) {
    assert.equal(tx, "tx"); this.reads.push(path);
    return {exists:this.docs.has(path),data:this.docs.get(path) ?? null};
  }
  writeUpdate(path, data, fields) {return {type:"update",path,data,fields};}
  writeCreate(path, data) {return {type:"create",path,data};}
  async commit(tx, writes) {
    assert.equal(tx, "tx");
    const next = new Map(this.docs);
    for (const w of writes) {
      if (w.type === "create" && next.has(w.path)) throw Error("ALREADY_EXISTS");
      if (w.type === "update" && !next.has(w.path)) throw Error("NOT_FOUND");
    }
    for (const w of writes) {
      if (w.type === "create") next.set(w.path,w.data);
      else next.set(w.path,{...next.get(w.path),...w.data});
    }
    this.docs = next; this.commits.push(writes);
  }
}
const run = (db, patch={}) => admitCertifiedAccountErasure(db,{
  uid, requestId, actor:{uid:ownerUid,owner:true}, nowMs, ...patch,
});
test("six certified domains atomically admit processing but cannot authorize destruction",async()=>{
  const db=new Db();
  assert.deepEqual(await run(db), {
    ok:true,admitted:true,duplicate:false,
    phase:"processing_admitted",destructiveAllowed:false,
  });
  assert.equal(db.docs.get(requestPath).status,"processing");
  assert.equal(db.docs.get(userPath).accountStatus,"deletion_processing");
  assert.equal(db.docs.get(userPath).deletionProcessing,true);
  assert.equal(db.docs.get(userPath).coins,300);
  assert.equal(db.docs.get(userPath).diamonds,5);
  assert.equal(db.docs.get(userPath).name,"Do not erase customer data");
  assert.equal(db.docs.get(checkpointPath).destructiveAllowed,false);
  assert.equal(db.docs.get(startAuditPath).action,"accountErasureProcessingAdmitted");
  assert.equal(db.commits.length,1);
  assert.equal(db.commits[0].length,4);
  assert.deepEqual((await run(db)).duplicate,true);
  assert.equal(db.commits.length,1);
});
test("missing or forged domain certification and audit deny admission",async()=>{
  for (const domain of REQUIRED_ERASURE_ADMISSION_DOMAINS) {
    for (const mutate of [
      d=>d.docs.delete(approvePath(domain)),
      d=>d.docs.delete(domainAuditPath(domain)),
      d=>{d.docs.get(approvePath(domain)).decision="pending";},
      d=>{d.docs.get(approvePath(domain)).uid="another_user_987";},
      d=>{d.docs.get(approvePath(domain)).requestId="stale_request_98765";},
      d=>{d.docs.get(domainAuditPath(domain)).actorUid="fake_signer_1234";},
      d=>{d.docs.get(approvePath(domain)).expiresAt=new Date(nowMs-1);},
      d=>{d.docs.get(approvePath(domain)).retentionHold=true;},
      d=>{d.docs.get(approvePath(domain)).investigationHold=true;},
      d=>{d.docs.get(approvePath(domain)).reported=true;},
      d=>{d.docs.get(approvePath(domain)).appealPending=true;},
      d=>{d.docs.get(approvePath(domain)).appealStatus="under_review";},
      d=>{d.docs.get(domainAuditPath(domain)).appealStatus="open";},
      d=>{d.docs.get(domainAuditPath(domain)).investigationHold=true;},
      d=>{d.docs.get(domainAuditPath(domain)).reported=true;},
    ]) {
      const db=new Db();mutate(db);
      await assert.rejects(run(db),e=>
        e.code==="erasure_domain_certification_missing_or_invalid");
      assert.equal(db.commits.length,0);
    }
  }
});
test("moderated suspended, banned and disabled accounts may still finish lawful deletion",async()=>{
  for(const status of ["suspended","banned","disabled"]){
    const db=new Db();db.docs.get(userPath).accountStatus=status;
    const result=await run(db);
    assert.equal(result.admitted,true);
    assert.equal(db.docs.get(userPath).accountStatus,"deletion_processing");
    assert.equal(db.docs.get(checkpointPath).priorAccountStatus,status);
    assert.equal(db.docs.get(checkpointPath).destructiveAllowed,false);
    assert.equal(db.docs.get(userPath).coins,300);
  }
});
test("unknown, deleted and already-processing statuses remain blocked",async()=>{
  for(const status of ["mystery_status","deleted","deletion_processing"]){
    const db=new Db();db.docs.get(userPath).accountStatus=status;
    await assert.rejects(run(db),
      e=>e.code==="erasure_admission_state_conflict");
    assert.equal(db.commits.length,0);
  }
});

test("enforces actual 30-day grace, not merely a forged eligibleAt",async()=>{
  const mods=[
    d=>{d.docs.get(requestPath).requestedAt=new Date(nowMs-86400_000);},
    d=>{d.docs.get(requestPath).eligibleAt=new Date(nowMs+1);},
    d=>{d.docs.get(requestPath).eligibleAt=new Date(requestedAtMs+86400_000);},
    d=>{d.docs.get(requestPath).requestedAt=null;},
  ];
  for (const mod of mods) {
    const db=new Db();mod(db);
    await assert.rejects(run(db),e=>e.code==="erasure_grace_not_elapsed");
    assert.equal(db.commits.length,0);
  }
});
test("cancellation, request rotation, Owner, holds or advanced checkpoint block",async()=>{
  const mods=[
    d=>{d.docs.get(requestPath).status="cancelled";},
    d=>{d.docs.get(requestPath).requestId="changed_request_12345";},
    d=>{d.docs.get(checkpointPath).requestId="stale_request_98765";},
    d=>{d.docs.get(checkpointPath).phase="private_text";},
    d=>{d.docs.get(checkpointPath).destructiveAllowed=true;},
    d=>{d.docs.get(userPath).role="owner";},
    d=>{d.docs.get(userPath).legalHold=true;},
    d=>{d.docs.get(requestPath).reviewHold=true;},
    d=>{d.docs.get(checkpointPath).evidenceHold=true;},
    d=>{d.docs.get(requestPath).investigationHold=true;},
    d=>{d.docs.get(requestPath).reported=true;},
    d=>{d.docs.get(checkpointPath).investigationHold=true;},
    d=>{d.docs.get(checkpointPath).reported=true;},
    d=>{d.docs.get(userPath).investigationHold=true;},
    d=>{d.docs.get(userPath).reported=true;},
    d=>{d.docs.get(requestPath).appealPending=true;},
    d=>{d.docs.get(requestPath).appealStatus="Open";},
    d=>{d.docs.get(checkpointPath).appealPending=true;},
    d=>{d.docs.get(checkpointPath).appealStatus="under_review";},
    d=>{d.docs.get(userPath).appealPending=true;},
    d=>{d.docs.get(userPath).appealStatus="pending";},
    d=>{d.docs.get(userPath).authDeleted=true;},
    d=>{d.docs.set(startAuditPath,{action:"unknown"});},
  ];
  for(const mod of mods){
    const db=new Db();mod(db);
    await assert.rejects(run(db),e=>
      ["erasure_admission_blocked","erasure_admission_state_conflict"]
        .includes(e.code));
    assert.equal(db.commits.length,0);
  }
});
test("rejects forged actors and malformed identifiers before any reads",async()=>{
  for(const patch of [
    {actor:{uid:"normal_user",owner:false}},
    {actor:{uid:"../unsafe",owner:true}},
    {uid:"../bad"},
    {requestId:"../../bad"},
    {requestId:"short"},
    {nowMs:Number.NaN},
  ]){
    const db=new Db();
    await assert.rejects(run(db,patch), e =>
      [400,403].includes(e.status));
    assert.equal(db.reads.length,0);
    assert.equal(db.commits.length,0);
  }
});
test("transaction commit failure leaves the account active for safe retry",async()=>{
  const db=new Db();const commit=db.commit.bind(db);
  db.commit=async()=>{throw Error("network_failure");};
  await assert.rejects(run(db),/network_failure/);
  assert.equal(db.docs.get(requestPath).status,"review_ready");
  assert.equal(db.docs.get(userPath).accountStatus,"active");
  assert.equal(db.docs.has(startAuditPath),false);
  db.commit=commit;
  assert.equal((await run(db)).admitted,true);
});
test("no Auth deletion, stage launch, R2 or financial deletion in admission",()=>{
  const source=readFileSync(
    "cloudflare-worker/src/account-deletion-processing-admission.js","utf8");
  assert.doesNotMatch(source,
    /runQuery\(|deleteAuthUser\(|writeDelete\(|\.delete\(|setInterval\(|bucket\.delete\(/);
  assert.match(source,/destructiveAllowed: false/);
});
