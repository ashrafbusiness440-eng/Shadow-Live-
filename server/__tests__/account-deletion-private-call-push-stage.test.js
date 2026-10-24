import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { eraseDeletedPrivateCallPushToken } from "../../cloudflare-worker/src/account-deletion-private-call-push-stage.js";

const uid = "deletedUser_321";
const otherUid = "otherUser_456";
const requestId = "request_1234567890";
const token = "test-token-012345678901234567890123456789";
const hash = createHash("sha256").update(token).digest("hex");
const paths = {
  request: `account_deletion_requests/${uid}`,
  checkpoint: `account_deletion_erasure_checkpoints/${uid}`,
  user: `users/${uid}`,
  device: `private_call_push_devices/${uid}/tokens/${hash}`,
  owner: `private_call_push_token_owners/${hash}`,
  other: `private_call_push_devices/${otherUid}/tokens/${hash}`,
};
class Db {
  constructor() {
    this.docs = new Map([
      [paths.request, { uid, requestId, status: "processing" }],
      [paths.checkpoint, { requestId, phase: "push_devices",
        destructiveAllowed: true, notificationRetentionCleared: true,
        legalEvidenceReviewComplete: true }],
      [paths.user, { role: "user", accountStatus: "deletion_processing" }],
      [paths.device, { token, platform: "android" }],
      [paths.owner, { uid }],
      [paths.other, { token, platform: "android" }],
    ]);
    this.reads = []; this.commits = []; this.rollbacks = 0;
  }
  async beginTransaction() { return "tx"; }
  async get(path, tx) {
    assert.equal(tx, "tx"); this.reads.push(path);
    return { exists: this.docs.has(path), data: this.docs.get(path) ?? null };
  }
  writeDelete(path) { return { path, type: "delete" }; }
  async commit(tx, writes) {
    assert.equal(tx, "tx");
    const next = new Map(this.docs);
    for (const w of writes) next.delete(w.path);
    this.docs = next; this.commits.push(writes);
  }
  async rollback(tx) { assert.equal(tx, "tx"); this.rollbacks++; }
}
const run = (db, patch = {}) => eraseDeletedPrivateCallPushToken(db, {
  uid, requestId, tokenHash: hash, ...patch,
});
test("removes only deleted user's token and binding; retry is idempotent", async () => {
  const db = new Db();
  assert.deepEqual(await run(db), { ok: true, removed: 2, duplicate: false });
  assert.equal(db.docs.has(paths.device), false);
  assert.equal(db.docs.has(paths.owner), false);
  assert.equal(db.docs.has(paths.other), true);
  assert.deepEqual(await run(db), { ok: true, removed: 0, duplicate: true });
  assert.equal(db.commits.length, 1);
  assert.equal(db.reads.length, 10);
});
test("reassigned token owner survives deletion of stale previous account row", async () => {
  const db = new Db();
  db.docs.get(paths.owner).uid = otherUid;
  assert.deepEqual(await run(db), { ok: true, removed: 1, duplicate: false });
  assert.equal(db.docs.get(paths.owner).uid, otherUid);
  assert.equal(db.docs.has(paths.other), true);
  assert.equal(db.docs.has(paths.device), false);
});
test("stale request, cancellation, holds, owner and missing approvals block all writes", async () => {
  const mutate = [
    d => { d.docs.get(paths.request).requestId = "old_request_1234567"; },
    d => { d.docs.get(paths.request).status = "cancelled"; },
    d => { d.docs.get(paths.request).reviewHold = true; },
    d => { d.docs.get(paths.checkpoint).phase = "preflight_blocked"; },
    d => { d.docs.get(paths.checkpoint).destructiveAllowed = false; },
    d => { d.docs.get(paths.checkpoint).notificationRetentionCleared = false; },
    d => { d.docs.get(paths.checkpoint).legalEvidenceReviewComplete = false; },
    d => { d.docs.get(paths.checkpoint).retentionHold = true; },
    d => { d.docs.get(paths.user).role = "owner"; },
    d => { d.docs.get(paths.user).accountStatus = "active"; },
    d => { d.docs.get(paths.device).evidenceHold = true; },
    d => { d.docs.get(paths.owner).legalHold = true; },
    d => { d.docs.delete(paths.request); },
  ];
  for (const mod of mutate) {
    const db = new Db(); mod(db);
    await assert.rejects(run(db), e => e.code === "push_erasure_not_authorized");
    assert.equal(db.commits.length, 0);
    assert.equal(db.docs.has(paths.device), true);
  }
});
test("malformed target rejected before transaction or reads", async () => {
  const db = new Db();
  for (const patch of [{ uid: "../unsafe" }, { tokenHash: "../unsafe" },
    { requestId: "too-short" }, { tokenHash: "AB".repeat(32) }]) {
    await assert.rejects(run(db, patch), e => e.status === 400);
  }
  assert.equal(db.reads.length, 0);
});
test("corrupted token and invalid ownership block instead of deleting", async () => {
  for (const mod of [
    d => { d.docs.get(paths.device).token = "invalid-token"; },
    d => { d.docs.get(paths.device).token = "other-token-012345678901234567890123456"; },
    d => { d.docs.get(paths.owner).uid = "../bad"; },
  ]) {
    const db = new Db(); mod(db);
    await assert.rejects(run(db), /push_(token|owner)_integrity_conflict/);
    assert.equal(db.commits.length, 0);
  }
});
test("commit network failure leaves tokens intact for safe retry", async () => {
  const db = new Db();
  const oldCommit = db.commit.bind(db);
  db.commit = async () => { throw Error("temporary_network_failure"); };
  await assert.rejects(run(db), /temporary_network_failure/);
  assert.equal(db.docs.has(paths.device), true);
  db.commit = oldCommit;
  assert.equal((await run(db)).removed, 2);
});
test("one-token stage never scans, calls Auth/FCM or leaks raw token in response", () => {
  const source = readFileSync(
    "cloudflare-worker/src/account-deletion-private-call-push-stage.js", "utf8");
  assert.doesNotMatch(source, /runQuery\(|fetch\(|deleteAuthUser\(|setInterval\(/);
  assert.match(source, /destructiveAllowed !== true/);
});
