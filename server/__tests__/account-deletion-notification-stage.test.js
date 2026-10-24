import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { eraseDeletedAccountNotification } from "../../cloudflare-worker/src/account-deletion-notification-stage.js";
const uid = "delete_user_234";
const requestId = "delete_request_123456789";
const noticeId = "report_result_safe_123456789";
const noticePath = "notifications/" + noticeId;
const reqPath = "account_deletion_requests/" + uid;
const cpPath = "account_deletion_erasure_checkpoints/" + uid;
const userPath = "users/" + uid;
const otherPath = "notifications/diary_comment_other_user";
class Db {
  constructor() {
    this.docs = new Map([
      [reqPath, {uid, requestId, status: "processing"}],
      [cpPath, {requestId, phase: "notifications", destructiveAllowed: true,
        notificationRetentionCleared: true, legalEvidenceReviewComplete: true,
        financialSettlementApproved: true}],
      [userPath, {role: "user", accountStatus: "deletion_processing"}],
      [noticePath, {userId: uid, type: "report_status", body: "test"}],
      [otherPath, {userId: "other_user_444", type: "diary_comment"}],
    ]);
    this.commits = []; this.reads = [];
  }
  async beginTransaction() { return "tx"; }
  async get(path, tx) {
    assert.equal(tx, "tx"); this.reads.push(path);
    return {exists:this.docs.has(path), data:this.docs.get(path) ?? null};
  }
  writeDelete(path) { return {type:"delete",path}; }
  async commit(_tx, writes) {
    const updated = new Map(this.docs);
    writes.forEach(w => updated.delete(w.path));
    this.docs = updated; this.commits.push(writes);
  }
  async rollback() {}
}
const run = (db, overrides={}) => eraseDeletedAccountNotification(db, {
  uid, requestId, notificationId:noticeId, ...overrides,
});
test("erases one owned notification; never the other recipient's notification", async()=>{
  const db=new Db();
  assert.deepEqual(await run(db), {ok:true,deleted:true,duplicate:false});
  assert.equal(db.docs.has(noticePath),false);
  assert.equal(db.docs.has(otherPath),true);
  assert.deepEqual(await run(db), {ok:true,deleted:false,duplicate:true});
  assert.equal(db.commits.length,1);
});
test("request status, approvals, legal/report holds and Owner block",async()=>{
  const mods=[
    d=>d.docs.get(reqPath).status="cancelled",
    d=>d.docs.get(reqPath).requestId="stale_request_12345678",
    d=>d.docs.get(reqPath).reviewHold=true,
    d=>d.docs.get(cpPath).requestId="stale_request_12345678",
    d=>d.docs.get(cpPath).phase="preflight_blocked",
    d=>d.docs.get(cpPath).destructiveAllowed=false,
    d=>d.docs.get(cpPath).notificationRetentionCleared=false,
    d=>d.docs.get(cpPath).legalEvidenceReviewComplete=false,
    d=>d.docs.get(cpPath).financialSettlementApproved=false,
    d=>d.docs.get(cpPath).retentionHold=true,
    d=>d.docs.get(userPath).role="owner",
    d=>d.docs.get(userPath).accountStatus="active",
    d=>d.docs.get(noticePath).evidenceHold=true,
    d=>d.docs.delete(reqPath),
  ];
  for(const mod of mods){const db=new Db();mod(db);
    await assert.rejects(run(db),e=>e.code==="notification_erasure_not_authorized");
    assert.equal(db.commits.length,0);
  }
});
test("mismatched recipient rejects accidental deletion of counterparty notice",async()=>{
  const db=new Db();db.docs.get(noticePath).userId="other_user_444";
  await assert.rejects(run(db),e=>e.code==="notification_recipient_mismatch");
  assert.equal(db.docs.has(noticePath),true);
  assert.equal(db.commits.length,0);
});
test("invalid identifiers stop before any Firestore reads",async()=>{
  const db=new Db();
  for(const args of [
    {uid:"../../no"}, {requestId:"../bad"},
    {notificationId:"../../unsafe"},{notificationId:"x"},
  ]) await assert.rejects(run(db,args),e=>e.status===400);
  assert.equal(db.reads.length,0);
});
test("network commit failure is not marked completed and retry succeeds",async()=>{
  const db=new Db();const commit=db.commit.bind(db);
  db.commit=async()=>{throw Error("network_unavailable");};
  await assert.rejects(run(db),/network_unavailable/);
  assert.equal(db.docs.has(noticePath),true);
  db.commit=commit;
  assert.equal((await run(db)).deleted,true);
});
test("code never performs global scans, Auth removal or unrelated ledger writes",()=>{
  const s=readFileSync("cloudflare-worker/src/account-deletion-notification-stage.js","utf8");
  assert.doesNotMatch(s,/runQuery\(|deleteAuthUser\(|setInterval\(/);
  assert.match(s,/notificationRetentionCleared !== true/);
});
