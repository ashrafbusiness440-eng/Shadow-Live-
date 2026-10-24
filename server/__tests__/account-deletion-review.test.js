import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import test from "node:test";
import {
  queueEligibleAccountDeletionReview,
  runDueAccountDeletionReviews,
  ACCOUNT_DELETION_REVIEW_LIMIT,
} from "../../cloudflare-worker/src/account-deletion-review.js";
import {
  ownAccountDeletion,
  ACCOUNT_DELETION_GRACE_MS,
} from "../../cloudflare-worker/src/account-deletion.js";

const nowMs = Date.parse("2026-11-24T08:00:00Z");
const uid = "ordinaryUser_1";
const requestId = "abcdefabcdefabcd12345678";

function requestRecord({ status = "pending", eligible = nowMs - 1000,
  target = uid, id = requestId } = {}) {
  return {
    uid: target, requestId: id, status,
    requestedAt: new Date(eligible - ACCOUNT_DELETION_GRACE_MS),
    eligibleAt: new Date(eligible),
    retentionReviewRequired: true,
  };
}
class Db {
  constructor(seed = {}) {
    this.docs = new Map(Object.entries(seed));
    this.queryCalls = [];
    this.writes = [];
    this.onQuery = null;
  }
  async beginTransaction() { return "tx"; }
  async rollback() {}
  async get(path) {
    return { exists: this.docs.has(path),
      data: this.docs.get(path) || null };
  }
  writeCreate(path, data) { return { kind: "create", path, data }; }
  writeUpdate(path, data, fields = null) {
    return { kind: "update", path, data, fields };
  }
  writeDelete(path) { return { kind: "delete", path }; }
  async commit(tx, writes) {
    if (tx !== "tx") throw Error("invalid_tx");
    for (const w of writes) {
      if (w.kind === "create" && this.docs.has(w.path)) {
        throw Error("ALREADY_EXISTS");
      }
    }
    for (const w of writes) {
      this.writes.push(w);
      if (w.kind === "delete") this.docs.delete(w.path);
      else this.docs.set(w.path,
        w.kind === "create" ? w.data :
        { ...(this.docs.get(w.path) || {}), ...w.data });
    }
  }
  async runQuery(collection, opts) {
    assert.equal(collection, "account_deletion_requests");
    assert.deepEqual(opts.filters.map(f => [f.field, f.op]),
      [["status", "=="], ["eligibleAt", "<="]]);
    assert.ok(opts.limit <= ACCOUNT_DELETION_REVIEW_LIMIT);
    this.queryCalls.push(opts);
    const rows = [...this.docs.entries()]
      .filter(([p, d]) => p.startsWith(collection + "/") &&
        p.split("/").length === 2 &&
        d.status === "pending" &&
        d.eligibleAt.getTime() <= opts.filters[1].value.getTime())
      .sort(([p, a], [q, b]) =>
        a.eligibleAt.getTime() - b.eligibleAt.getTime() ||
        p.localeCompare(q))
      .slice(0, opts.limit)
      .map(([p, data]) => ({ id: p.split("/")[1], data }));
    if (this.onQuery) this.onQuery();
    return rows;
  }
}

const own = (status = "active") => new Db({
  ["users/" + uid]: {
    accountStatus: status, role: "user",
    coins: 2500, diamonds: 5, displayName: "Should stay unchanged",
  },
  ["account_deletion_requests/" + uid]: requestRecord(),
});

test("30-day due requests enter review_ready with owner inbox and audit; no deletions", async () => {
  const db = own();
  const result = await runDueAccountDeletionReviews(db, {
    nowMs, limit: 6,
  });
  assert.deepEqual(result, { checked: 1, queued: 1, skipped: 0, failed: 0 });
  assert.equal(db.docs.get("account_deletion_requests/" + uid).status, "review_ready");
  assert.equal(db.docs.get("account_deletion_requests/" + uid).retentionReviewRequired, true);
  assert.equal(db.docs.get("users/" + uid).accountStatus, "active");
  assert.equal(db.docs.get("users/" + uid).coins, 2500);
  assert.equal(db.docs.get("users/" + uid).displayName, "Should stay unchanged");
  assert.ok(db.docs.has("admin_inbox_items/account_deletion_review__" + uid));
  assert.ok(db.docs.has("admin_audit_logs/account_deletion_review_due_" + requestId));
  assert.equal(db.writes.length, 3);
  assert.ok(db.writes.every(w => w.kind !== "delete"));
  assert.equal((await runDueAccountDeletionReviews(db, { nowMs })).queued, 0);
  assert.equal(db.writes.length, 3);
});

test("user retains right to cancel a review-ready request and clear inbox", async () => {
  const db = own();
  await queueEligibleAccountDeletionReview(db, uid, {nowMs});
  const user = {
    sub: uid,
    auth_time: Math.floor(nowMs / 1000),
    firebase: { sign_in_provider: "google.com" },
  };
  const status = await ownAccountDeletion(db, user, {action: "status"},
    { nowMs });
  assert.equal(status.status, "review_ready");
  assert.equal(status.cancellationAvailable, true);
  const result = await ownAccountDeletion(db, user, {action: "cancel"},
    {nowMs, idFactory: () => "cancel-example"});
  assert.equal(result.status, "cancelled");
  assert.equal(result.cancellationAvailable, false);
  assert.equal(db.docs.has("admin_inbox_items/account_deletion_review__" + uid), false);
  assert.equal(db.docs.get("users/" + uid).coins, 2500);
  assert.equal((await runDueAccountDeletionReviews(db, {nowMs})).queued, 0);
  const next = await ownAccountDeletion(db, user, {action: "request"},
    {nowMs, idFactory: () => "new-request-123456"});
  assert.equal(next.status, "pending");
  assert.equal(Date.parse(next.eligibleAt), nowMs + ACCOUNT_DELETION_GRACE_MS);
});

test("due gate requires exact time and does not allow forged UID", async () => {
  const db = own();
  db.docs.get("account_deletion_requests/" + uid).eligibleAt =
    new Date(nowMs + 1);
  const noRows = await runDueAccountDeletionReviews(db, {nowMs});
  assert.equal(noRows.checked, 0);
  assert.equal(db.writes.length, 0);
  db.docs.get("account_deletion_requests/" + uid).eligibleAt =
    new Date(nowMs);
  db.docs.get("account_deletion_requests/" + uid).uid = "forged_other_account";
  const result = await runDueAccountDeletionReviews(db, {nowMs});
  assert.deepEqual(result, {checked:1,queued:0,skipped:1,failed:0});
  assert.equal(db.writes.length, 0);
});

test("a cancelled request racing with the due scan must not be queued", async () => {
  const db = own();
  db.onQuery = () => {
    db.docs.get("account_deletion_requests/" + uid).status = "cancelled";
  };
  const result = await runDueAccountDeletionReviews(db, {nowMs});
  assert.equal(result.queued, 0);
  assert.equal(result.skipped, 1);
  assert.equal(db.writes.length, 0);
});

test("bounded batch and hold flags are review hints, never automatic erasure", async () => {
  const db = own();
  db.docs.get("users/" + uid).legalHold = true;
  for (let n = 0; n < 10; n++) {
    const userUid = "anotherUser_" + n;
    db.docs.set("users/" + userUid, {role:"user", accountStatus:"active"});
    db.docs.set("account_deletion_requests/" + userUid,
      requestRecord({target:userUid,id:"other-request-id-1234-" + n,
        eligible: nowMs - 120000 + n}));
  }
  const first = await runDueAccountDeletionReviews(db, {nowMs,limit:99});
  assert.equal(first.checked, ACCOUNT_DELETION_REVIEW_LIMIT);
  assert.equal(first.queued, ACCOUNT_DELETION_REVIEW_LIMIT);
  assert.ok(first.checked <= 6);
  assert.equal(db.queryCalls[0].limit, 6);
  const second = await runDueAccountDeletionReviews(db, {nowMs});
  assert.equal(second.queued, 5);
  const hint = await queueEligibleAccountDeletionReview(db, uid,{nowMs});
  assert.equal(hint.queued, false);
  assert.equal(db.docs.get("account_deletion_requests/" + uid).reviewReason,
    "hold_review_required");
});

test("nonexistent, deleted or invalid source users never become reviewed", async () => {
  const db = own();
  db.docs.delete("users/" + uid);
  assert.equal((await queueEligibleAccountDeletionReview(db,uid,{nowMs})).queued,false);
  db.docs.set("users/" + uid,{accountStatus:"deleted",authDeleted:true});
  assert.equal((await queueEligibleAccountDeletionReview(db,uid,{nowMs})).queued,false);
  assert.equal((await queueEligibleAccountDeletionReview(db,"../user",{nowMs})).queued,false);
  assert.equal(db.writes.length, 0);
});

test("source guard: cron is explicitly opted-in, owner inbox only and composite index exists", () => {
  const worker = readFileSync("cloudflare-worker/src/index.js","utf8");
  const inbox = readFileSync("cloudflare-worker/src/admin-inbox.js","utf8");
  const review = readFileSync("cloudflare-worker/src/account-deletion-review.js","utf8");
  const publicPage = readFileSync("web/account-deletion.html","utf8");
  const adminPage = readFileSync("lib/admin/admin_notifications_page.dart","utf8");
  const indexes = JSON.parse(readFileSync("firestore.indexes.json","utf8"));
  assert.match(worker,/ACCOUNT_DELETION_REVIEW_READY === "true"/);
  assert.match(worker,/runDueAccountDeletionReviews/);
  assert.match(inbox,/case "account_deletion_review":\s*return actor.owner;/);
  assert.match(adminPage,/item.route == 'account_deletion_review'/);
  assert.match(publicPage,/state.status === "review_ready"/);
  assert.match(review,/limit: budget/);
  assert.doesNotMatch(review,/deleteAuthUser\(|USER_STORAGE\.delete\(|setInterval\(/);
  assert.ok(indexes.indexes.some(i =>
    i.collectionGroup === "account_deletion_requests" &&
    i.fields[0].fieldPath === "status" &&
    i.fields[1].fieldPath === "eligibleAt"));
});

test("external deletion portal inline module remains syntactically valid", () => {
  const html = readFileSync("web/account-deletion.html", "utf8");
  const match = html.match(/<script type="module">([\s\S]*?)<\/script>/);
  assert.ok(match, "external authenticated page should include module script");
  const check = spawnSync(process.execPath, ["--input-type=module", "--check"], {
    input: match[1], encoding: "utf8",
  });
  assert.equal(check.status, 0, check.stderr || "invalid module syntax");
});
