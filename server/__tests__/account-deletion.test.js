import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import {
  ACCOUNT_DELETION_GRACE_MS,
  ownAccountDeletion,
} from "../../cloudflare-worker/src/account-deletion.js";

const time = Date.parse("2026-10-24T08:00:00.000Z");
const uid = "person1";
const actor = (asUid = uid, authOffsetSeconds = 0, provider = "google.com") => ({
  sub: asUid,
  auth_time: Math.floor(time / 1000) - authOffsetSeconds,
  firebase: { sign_in_provider: provider },
});

class Db {
  constructor(seed = {}) {
    this.docs = new Map(Object.entries(seed));
    this.calls = [];
  }
  async beginTransaction() {
    this.calls.push(["begin"]);
    return "test_tx";
  }
  async rollback(_tx) {
    this.calls.push(["rollback"]);
  }
  async get(path) {
    this.calls.push(["get", path]);
    return {
      exists: this.docs.has(path),
      data: this.docs.get(path) || null,
    };
  }
  writeCreate(path, data) {
    return { action: "create", path, data };
  }
  writeUpdate(path, data, fields) {
    return { action: "update", path, data, fields };
  }
  async commit(tx, writes) {
    assert.equal(tx, "test_tx");
    // Apply the entire batch only after checking all create preconditions.
    for (const w of writes) {
      if (w.action === "create" && this.docs.has(w.path)) {
        throw Error("ALREADY_EXISTS");
      }
    }
    for (const w of writes) {
      this.calls.push(["write", w.path]);
      const before = this.docs.get(w.path) || {};
      this.docs.set(w.path, w.action === "create"
        ? w.data : { ...before, ...w.data });
    }
  }
}

let id = 0;
const opts = () => ({ nowMs: time, idFactory: () => "test-id-" + (++id) });
const dbWithUser = (accountStatus = "active") => new Db({
  ["users/" + uid]: { role: "user", accountStatus, coins: 1000 },
});

test("account request creates 30-day self-only pending record and audit", async () => {
  const db = dbWithUser();
  const state = await ownAccountDeletion(db, actor(), {
    action: "request", targetUid: "someone_else",
    eligibleAt: "2026-10-24T09:00:00Z", removeBalance: true,
  }, opts());
  assert.equal(state.status, "pending");
  assert.equal(state.cancellationAvailable, true);
  assert.equal(Date.parse(state.eligibleAt) - Date.parse(state.requestedAt),
    ACCOUNT_DELETION_GRACE_MS);
  assert.equal(db.docs.get("users/" + uid).coins, 1000);
  assert.equal(db.docs.get("account_deletion_requests/" + uid).uid, uid);
  assert.equal(db.docs.has("account_deletion_requests/someone_else"), false);
  assert.equal(db.calls.filter(x => x[0] === "write").length, 2);
  assert.ok([...db.docs.keys()].some(x =>
    x.startsWith("admin_audit_logs/self_delete_request_")));
});

test("double submit is idempotent and cancel is safe and auditable", async () => {
  const db = dbWithUser();
  const first = await ownAccountDeletion(db, actor(),
    { action: "request" }, opts());
  const before = db.calls.filter(x => x[0] === "write").length;
  const again = await ownAccountDeletion(db, actor(),
    { action: "request" }, opts());
  assert.deepEqual([again.status, again.eligibleAt, again.duplicate],
    ["pending", first.eligibleAt, true]);
  assert.equal(db.calls.filter(x => x[0] === "write").length, before);

  const cancelled = await ownAccountDeletion(db, actor(),
    { action: "cancel" }, opts());
  assert.equal(cancelled.status, "cancelled");
  assert.equal(cancelled.cancellationAvailable, false);
  assert.equal(db.docs.get("account_deletion_requests/" + uid).status, "cancelled");
  const third = await ownAccountDeletion(db, actor(),
    { action: "cancel" }, opts());
  assert.equal(third.duplicate, true);
  const restarted = await ownAccountDeletion(db, actor(),
    { action: "request" }, { nowMs: time + 2000,
      idFactory: () => "restart-id" });
  assert.equal(restarted.status, "pending");
  assert.equal(Date.parse(restarted.eligibleAt),
    time + 2000 + ACCOUNT_DELETION_GRACE_MS);
});

test("status is scoped to signed-in owner and never exposes wallet or profile", async () => {
  const db = dbWithUser();
  assert.equal((await ownAccountDeletion(db, actor(),
    { action: "status" })).status, "none");
  await ownAccountDeletion(db, actor(), { action: "request" }, opts());
  const state = await ownAccountDeletion(db, actor(), { action: "status" });
  assert.deepEqual(Object.keys(state).sort(),
    ["cancellationAvailable", "eligibleAt", "ok",
      "requestedAt", "status"].sort());
  await assert.rejects(() => ownAccountDeletion(db, actor("stranger"),
    { action: "status" }), /account_not_available/);
});

test("recent auth, account identity and state are always enforced", async () => {
  const db = dbWithUser();
  await assert.rejects(() => ownAccountDeletion(db, actor(uid, 601),
    { action: "request" }, opts()), /recent_auth_required/);
  await assert.rejects(() => ownAccountDeletion(db, actor(uid, 0, "anonymous"),
    { action: "request" }, opts()), /registered_account_required/);
  await assert.rejects(() => ownAccountDeletion(db, actor(),
    { action: "invalid_action" }, opts()), /invalid_action/);
  await assert.rejects(() => ownAccountDeletion(db,
    { sub: "other/../../uid", auth_time: time / 1000 },
    { action: "request" }, opts()), /unauthorized/);
  assert.equal(db.docs.size, 1);
  await ownAccountDeletion(db, actor(), { action: "request" }, opts());
  await assert.rejects(() => ownAccountDeletion(db, actor(uid, 601),
    { action: "cancel" }, opts()), /recent_auth_required/);
});

test("sanctioned accounts can request erasure; completed jobs cannot be restarted", async () => {
  const db = dbWithUser("banned");
  assert.equal((await ownAccountDeletion(db, actor(),
    { action: "request" }, opts())).status, "pending");
  const record = db.docs.get("account_deletion_requests/" + uid);
  record.status = "processing";
  await assert.rejects(() => ownAccountDeletion(db, actor(),
    { action: "cancel" }, opts()), /deletion_not_cancellable/);
  record.status = "completed";
  await assert.rejects(() => ownAccountDeletion(db, actor(),
    { action: "request" }, opts()), /deletion_not_available/);
});

test("source and router do not trigger destructive cleanup prematurely", () => {
  const index = fs.readFileSync("cloudflare-worker/src/index.js", "utf8");
  const server = fs.readFileSync("cloudflare-worker/src/account-deletion.js", "utf8");
  const screen = fs.readFileSync(
    "lib/screens/settings/account_deletion_request_screen.dart", "utf8");
  const settings = fs.readFileSync(
    "lib/screens/settings/settings_screen.dart", "utf8");
  assert.match(index, /url.pathname === "\/api\/account-deletion"/);
  assert.match(server, /checkUserState: false/);
  assert.match(server, /ACCOUNT_DELETION_GRACE_MS/);
  assert.match(server, /retentionReviewRequired: true/);
  assert.doesNotMatch(server, /deleteAuthUser\(/);
  assert.doesNotMatch(server, /USER_STORAGE\.delete\(/);
  assert.match(settings, /const AccountDeletionRequestScreen\(\)/);
  assert.match(screen, /_change\\('request'\\)/);
  assert.match(screen, /_change\\('cancel'\\)/);
  assert.match(screen, /_service.send\\(action\\)/);
  assert.doesNotMatch(server, /setInterval\(/);
});
