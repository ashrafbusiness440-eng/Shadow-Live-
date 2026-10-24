import assert from "node:assert/strict";
import test from "node:test";
import {
  checkErasureStartEligibility,
  recordErasurePreflightCheckpoint,
} from "../../cloudflare-worker/src/account-deletion-erasure-checkpoint.js";

const nowMs = Date.parse("2026-11-25T00:00:00Z");
const uid = "testUser_123";
const requestId = "request-id-1234567890";
const req = () => ({
  uid, requestId, status: "review_ready",
  eligibleAt: new Date(nowMs - 1000), reviewHold: false,
});
class MockDb {
  constructor() {
    this.docs = new Map([
      ["users/" + uid, { accountStatus: "active", coins: 30, diamonds: 5 }],
      ["account_deletion_requests/" + uid, req()],
    ]);
    this.writes = [];
  }
  async beginTransaction() { return "tx"; }
  async rollback() {}
  async get(path) { return { exists: this.docs.has(path), data: this.docs.get(path) }; }
  writeCreate(path, data) { return { kind: "create", path, data }; }
  writeUpdate(path, data) { return { kind: "update", path, data }; }
  async commit(_tx, writes) {
    for (const w of writes) {
      if (w.kind === "create" && this.docs.has(w.path)) throw Error("ALREADY_EXISTS");
    }
    for (const w of writes) {
      this.writes.push(w);
      this.docs.set(w.path, { ...(this.docs.get(w.path) || {}), ...w.data });
    }
  }
}
const start = (db, opts = {}) => recordErasurePreflightCheckpoint(db, {
  uid, requestId, actorUid: "testOwner_999", nowMs, ...opts,
});
test("records a fail-closed checkpoint without deleting accounts or money", async () => {
  const db = new MockDb();
  const result = await start(db);
  assert.equal(result.phase, "preflight_blocked");
  assert.equal(result.destructiveAllowed, false);
  assert.equal(db.writes.length, 2);
  assert.equal(db.docs.get("users/" + uid).coins, 30);
  assert.equal(db.docs.get("users/" + uid).diamonds, 5);
  assert.equal(db.docs.get("account_deletion_requests/" + uid).status, "review_ready");
  assert.equal(db.docs.get("account_deletion_erasure_checkpoints/" + uid).phase, "preflight_blocked");
  assert.equal(db.writes.some(w => w.kind === "delete"), false);
  assert.equal((await start(db)).duplicate, true);
  assert.equal(db.writes.length, 2);
});
test("rejects cancelled, held, stale or future requests", async () => {
  for (const mutate of [
    d => { d.docs.get("account_deletion_requests/" + uid).status = "cancelled"; },
    d => { d.docs.get("account_deletion_requests/" + uid).reviewHold = true; },
    d => { d.docs.get("account_deletion_requests/" + uid).requestId = "new-request-id-987654321"; },
    d => { d.docs.get("account_deletion_requests/" + uid).eligibleAt = new Date(nowMs + 1); },
    d => { d.docs.get("users/" + uid).legalHold = true; },
    d => { d.docs.get("users/" + uid).authDeleted = true; },
  ]) {
    const db = new MockDb();
    mutate(db);
    await assert.rejects(start(db));
    assert.equal(db.writes.length, 0);
  }
});
test("requires valid actor and refuses contradictory checkpoint", async () => {
  const db = new MockDb();
  await assert.rejects(start(db, { actorUid: "../invalid" }), /owner_required/);
  db.docs.set("account_deletion_erasure_checkpoints/" + uid,
    { requestId, phase: "completed", destructiveAllowed: true });
  await assert.rejects(start(db), /checkpoint_conflict/);
  assert.equal(db.writes.length, 0);
});
test("eligibility cannot itself certify financial or content erasure", () => {
  const result = checkErasureStartEligibility({
    uid, requestId, request: { exists: true, data: req() },
    user: { exists: true, data: { coins: 10 } }, nowMs,
  });
  assert.equal(result.destructiveAllowed, false);
  assert.equal(result.phase, "preflight_blocked");
});
