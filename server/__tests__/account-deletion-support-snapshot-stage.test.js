import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { redactDeletedSupporterPair } from "../../cloudflare-worker/src/account-deletion-support-snapshot-stage.js";

const uid = "deleted_member_123";
const other = "other_member_456";
const requestId = "account_deletion_request_123456789";
const wealthPath = `user_level_support/${other}/wealth/${uid}`;
const attractionPath = `user_level_support/${other}/attraction/${uid}`;
class Db {
  constructor() {
    this.docs = new Map([
      ["account_deletion_requests/" + uid, {
        uid, requestId, status: "processing", reviewHold: false,
      }],
      ["account_deletion_erasure_checkpoints/" + uid, {
        requestId, phase: "support_snapshots", destructiveAllowed: true,
      }],
      ["users/" + uid, { role: "user", accountStatus: "deletion_processing" }],
      [wealthPath, {
        counterpartUid: uid, displayName: "Legacy Recipient",
        publicId: "44332211", profileImageUrl: "https://private.example/1.jpg",
        points: 120, giftCount: 2,
      }],
      [attractionPath, {
        counterpartUid: uid, displayName: "Legacy Sender",
        publicId: "88776655", profileImageUrl: "https://private.example/2.jpg",
        points: 500, giftCount: 5,
      }],
    ]);
    this.commits = [];
    this.rollbacks = 0;
  }
  async beginTransaction() { return "tx"; }
  async get(path, tx) {
    assert.equal(tx, "tx");
    return { exists: this.docs.has(path), data: this.docs.get(path) ?? null };
  }
  writeUpdate(path, fields, mask) {
    return { path, fields, mask };
  }
  async commit(tx, writes) {
    assert.equal(tx, "tx");
    const changed = new Map(this.docs);
    for (const w of writes) {
      assert.ok(changed.has(w.path));
      assert.deepEqual(w.mask, ["displayName", "profileImageUrl", "publicId"]);
      changed.set(w.path, { ...changed.get(w.path), ...w.fields });
    }
    this.docs = changed;
    this.commits.push(writes);
  }
  async rollback(tx) { assert.equal(tx, "tx"); this.rollbacks++; }
}
function redact(db, extra = {}) {
  return redactDeletedSupporterPair(db, {deletedUid: uid, counterpartUid: other, requestId, ...extra});
}

test("one transaction redacts only deleted person's two historical snapshots", async () => {
  const db = new Db();
  assert.deepEqual(await redact(db), {ok:true,redacted:2,duplicate:false});
  assert.equal(db.commits.length, 1);
  assert.equal(db.commits[0].length, 2);
  for (const [path, points, giftCount] of [[wealthPath,120,2],[attractionPath,500,5]]) {
    const row = db.docs.get(path);
    assert.equal(row.displayName, "حساب محذوف");
    assert.equal(row.profileImageUrl, "");
    assert.equal(row.publicId, "");
    assert.equal(row.points, points);
    assert.equal(row.giftCount, giftCount);
    assert.equal(row.counterpartUid, uid);
  }
  assert.deepEqual(await redact(db), {ok:true,redacted:0,duplicate:true});
  assert.equal(db.commits.length, 1);
});

test("requires same current request, certified checkpoint, and processing user", async () => {
  const modifications = [
    db => db.docs.get("account_deletion_requests/" + uid).status = "review_ready",
    db => db.docs.get("account_deletion_requests/" + uid).reviewHold = true,
    db => db.docs.get("account_deletion_requests/" + uid).appealPending = true,
    db => db.docs.get("account_deletion_erasure_checkpoints/" + uid).appealStatus = "Under_Review",
    db => db.docs.get("users/" + uid).appealPending = true,
    db => db.docs.get("account_deletion_requests/" + uid).requestId = "old_request_id_999",
    db => db.docs.get("account_deletion_erasure_checkpoints/" + uid).destructiveAllowed = false,
    db => db.docs.get("account_deletion_erasure_checkpoints/" + uid).phase = "preflight_blocked",
    db => db.docs.get("account_deletion_erasure_checkpoints/" + uid).evidenceHold = true,
    db => db.docs.get("account_deletion_erasure_checkpoints/" + uid).investigationHold = true,
    db => db.docs.get("account_deletion_erasure_checkpoints/" + uid).requestId = "old_request_id_999",
    db => db.docs.get("users/" + uid).accountStatus = "active",
    db => db.docs.get("users/" + uid).legalHold = true,
    db => db.docs.get("users/" + uid).role = "owner",
    db => db.docs.delete("account_deletion_requests/" + uid),
  ];
  for (const mutate of modifications) {
    const db = new Db();
    mutate(db);
    await assert.rejects(redact(db), e => e.code === "support_erasure_not_authorized");
    assert.equal(db.commits.length, 0);
    assert.equal(db.docs.get(wealthPath).displayName, "Legacy Recipient");
  }
});

test("historical wealth or attraction with protected evidence never gets redacted", async () => {
  for (const [path,flag] of [
    [wealthPath,"legalHold"],[attractionPath,"retentionHold"],
    [wealthPath,"evidenceHold"],[attractionPath,"investigationHold"],
    [wealthPath,"appealPending"],
  ]) {
    const db = new Db();
    db.docs.get(path)[flag] = true;
    await assert.rejects(redact(db),
      error => error.code === "support_snapshot_retention_hold");
    assert.equal(db.commits.length,0);
    assert.equal(db.docs.get(wealthPath).displayName,"Legacy Recipient");
    assert.equal(db.docs.get(attractionPath).displayName,"Legacy Sender");
  }
});

test("new appeal on retained counterpart support snapshot blocks redaction",async()=>{
  for(const path of [wealthPath,attractionPath]){
    const db=new Db();
    db.docs.get(path).appealStatus="Open";
    await assert.rejects(redact(db),
      e=>e.code==="support_snapshot_retention_hold");
    assert.equal(db.commits.length,0);
    assert.equal(db.docs.get(wealthPath).displayName,"Legacy Recipient");
  }
});
test("old or corrupt counterpart records fail closed without partial redaction", async () => {
  const db = new Db();
  db.docs.get(attractionPath).counterpartUid = "different_user";
  await assert.rejects(redact(db), e => e.code === "support_erasure_pair_conflict");
  assert.equal(db.commits.length, 0);
  assert.equal(db.docs.get(wealthPath).displayName, "Legacy Recipient");
});

test("missing historical pair is an idempotent no-op; unrelated support untouched", async () => {
  const db = new Db();
  db.docs.delete(attractionPath);
  db.docs.delete(wealthPath);
  db.docs.set(`user_level_support/${other}/attraction/someone_else`,
    { displayName: "Active Member", points: 999 });
  assert.deepEqual(await redact(db), {ok:true,redacted:0,duplicate:true});
  assert.equal(db.docs.get(`user_level_support/${other}/attraction/someone_else`).displayName, "Active Member");
  assert.equal(db.commits.length, 0);
});

test("malformed targets and network failures never report a successful scrub", async () => {
  const db = new Db();
  await assert.rejects(redact(db, {counterpartUid:"../bad"}), e => e.code === "invalid_support_erasure_target");
  assert.equal(db.commits.length, 0);
  db.commit = async () => { throw Error("network_failure"); };
  await assert.rejects(redact(db), /network_failure/);
  assert.equal(db.docs.get(wealthPath).displayName, "Legacy Recipient");
});

test("this stage has no endpoint, loop over all users or financial mutation", () => {
  const s = readFileSync("cloudflare-worker/src/account-deletion-support-snapshot-stage.js", "utf8");
  assert.doesNotMatch(s, /runQuery\(|writeDelete\(|\.list\(/);
  assert.doesNotMatch(s, /points:|giftCount:|coins:|diamonds:/);
  assert.match(s, /destructiveAllowed !== true/);
  assert.match(s, /deletion_processing/);
});
