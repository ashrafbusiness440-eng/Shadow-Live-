import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  AccountDeletionReviewControlError,
  inspectAccountDeletionForOwner,
  setAccountDeletionReviewHold,
} from "../../cloudflare-worker/src/account-deletion-review-control.js";
import { ownAccountDeletion } from "../../cloudflare-worker/src/account-deletion.js";

const nowMs = Date.parse("2026-11-24T08:00:00.000Z");
const uid = "ordinaryUser_01";
const requestId = "request-id-abcdef123456";
const auditId = "audit-event-123456789";
const ownerUid = "platformOwner_01";
const reqPath = "account_deletion_requests/" + uid;
const profilePath = "users/" + uid;
const inboxPath = "admin_inbox_items/account_deletion_review__" + uid;

class Db {
  constructor(initial = {}) {
    this.docs = new Map(Object.entries(initial));
    this.reads = [];
    this.writes = [];
    this.rollbacks = 0;
  }
  async get(path) {
    this.reads.push(path);
    return { exists: this.docs.has(path), data: this.docs.get(path) || null };
  }
  async beginTransaction() { return "tx"; }
  async rollback() { this.rollbacks++; }
  writeCreate(path, data) { return { type: "create", path, data }; }
  writeUpdate(path, data, fields) { return { type: "update", path, data, fields }; }
  writeDelete(path) { return { type: "delete", path }; }
  async commit(tx, writes) {
    assert.equal(tx, "tx");
    for (const write of writes) {
      if (write.type === "create" && this.docs.has(write.path)) {
        throw Error("ALREADY_EXISTS");
      }
    }
    for (const write of writes) {
      this.writes.push(write);
      if (write.type === "delete") this.docs.delete(write.path);
      else if (write.type === "create") this.docs.set(write.path, write.data);
      else this.docs.set(write.path, {
        ...(this.docs.get(write.path) || {}), ...write.data,
      });
    }
  }
}

function dbForUser(opts = {}) {
  return new Db({
    [reqPath]: {
      uid, requestId, status: opts.status || "review_ready",
      eligibleAt: new Date(nowMs - 1000),
      reviewHold: false,
      retentionReviewRequired: true,
    },
    [profilePath]: {
      role: opts.role || "user",
      accountStatus: "active",
      coins: 500,
      diamonds: 2,
      nickname: "do not expose this",
      ...opts.user,
    },
    ...opts.extra,
  });
}

test("owner summary contains only bounded risk flags and direct reads", async () => {
  const db = dbForUser({
    user: { legalHold: true },
    extra: {
      ["agency_user_memberships/" + uid]: {
        status: "active", agencyId: "agencyPrivate",
      },
    },
  });
  const result = await inspectAccountDeletionForOwner(db, uid, { nowMs });
  assert.equal(result.ok, true);
  assert.equal(result.requestId, requestId);
  assert.equal(result.signals.balanceDetected, true);
  assert.equal(result.signals.legalHold, true);
  assert.equal(result.signals.agencyMembershipPresent, true);
  assert.equal(result.signals.ledgersAndReportsNotVerified, true);
  assert.equal(result.signals.privateMessagesNotVerified, true);
  assert.equal(JSON.stringify(result).includes("do not expose this"), false);
  assert.equal(JSON.stringify(result).includes("agencyPrivate"), false);
  assert.deepEqual(db.reads.sort(), [
    "account_deletion_requests/" + uid,
    "agency_user_memberships/" + uid,
    "users/" + uid,
  ].sort());
  assert.equal(db.writes.length, 0);
});

test("only review-ready, due, current request can be assessed", async () => {
  const db = dbForUser({status:"cancelled"});
  await assert.rejects(() => inspectAccountDeletionForOwner(db, uid, {nowMs}),
    /review_no_longer_available/);
  db.docs.get(reqPath).status = "review_ready";
  db.docs.get(reqPath).eligibleAt = new Date(nowMs + 1000);
  await assert.rejects(() => inspectAccountDeletionForOwner(db, uid, {nowMs}),
    /review_not_due/);
  db.docs.get(reqPath).eligibleAt = new Date(nowMs - 1000);
  db.docs.get(reqPath).uid = "someoneElse";
  await assert.rejects(() => inspectAccountDeletionForOwner(db, uid, {nowMs}),
    /deletion_request_not_found/);
});

test("hold records reason and audit but does not touch account or assets", async () => {
  const db = dbForUser();
  const outcome = await setAccountDeletionReviewHold(db, {
    actorUid: ownerUid, targetUid: uid, requestId,
    action: "accountDeletionHold",
    reason: "تسوية سجل مالي قيد التدقيق",
    nowMs, idFactory: () => auditId,
  });
  assert.deepEqual(outcome, {
    ok: true, status: "review_ready", reviewHold: true,
  });
  const request = db.docs.get(reqPath);
  assert.equal(request.status, "review_ready");
  assert.equal(request.reviewHold, true);
  assert.equal(request.reviewHoldReason, "تسوية سجل مالي قيد التدقيق");
  assert.equal(db.docs.get(profilePath).coins, 500);
  assert.equal(db.docs.get(profilePath).nickname, "do not expose this");
  assert.equal(db.writes.length, 3);
  assert.equal(db.writes.filter(x => x.type === "delete").length, 0);
  assert.equal(db.docs.get(inboxPath).meta.reviewHold, true);
  assert.equal(db.docs.get("admin_audit_logs/account_deletion_review_" + auditId)
    .actorUid, ownerUid);
  const state = await inspectAccountDeletionForOwner(db, uid, {nowMs});
  assert.equal(state.reviewHold, true);
});

test("idempotent hold, audited release, no duplicate destructive action", async () => {
  const db = dbForUser();
  const args = {
    actorUid: ownerUid, targetUid: uid, requestId,
    action: "accountDeletionHold", reason: "حجز مراجعة بسبب بلاغ مفتوح",
    nowMs, idFactory: () => auditId,
  };
  await setAccountDeletionReviewHold(db,args);
  const firstCount = db.writes.length;
  const replay = await setAccountDeletionReviewHold(db,args);
  assert.equal(replay.duplicate, true);
  assert.equal(db.writes.length, firstCount);
  const released = await setAccountDeletionReviewHold(db, {
    ...args, action: "accountDeletionReleaseHold",
    reason: "تم رفع الحجز الإداري",
    idFactory: () => "audit-event-release-123456",
  });
  assert.equal(released.reviewHold, false);
  assert.equal(db.docs.get(reqPath).reviewHoldReason, "");
  assert.equal(db.docs.get(reqPath).status, "review_ready");
  assert.equal(db.docs.get(profilePath).coins, 500);
  const uidClaim = {
    sub: uid, auth_time: Math.floor(nowMs/1000),
    firebase: { sign_in_provider: "google.com" },
  };
  const cancelled = await ownAccountDeletion(db,uidClaim,{action:"cancel"},
    {nowMs,idFactory:()=> "cancel-review-request-1234"});
  assert.equal(cancelled.status, "cancelled");
  assert.equal(db.docs.has(inboxPath), false);
});

test("stale or forbidden review actions are rejected without writes", async () => {
  const db = dbForUser();
  const base = {
    actorUid: ownerUid, targetUid: uid, requestId,
    action: "accountDeletionHold", reason: "ما زالت المراجعة المالية معلقة",
    nowMs, idFactory: () => auditId,
  };
  for (const input of [
    {...base, targetUid: "other/uid"},
    {...base, requestId: "stale-request-id-123456"},
    {...base, reason: "few"},
    {...base, action: "eraseAccount"},
  ]) {
    await assert.rejects(() => setAccountDeletionReviewHold(db,input),
      AccountDeletionReviewControlError);
  }
  assert.equal(db.writes.length, 0);
  db.docs.get(reqPath).status = "cancelled";
  await assert.rejects(() => setAccountDeletionReviewHold(db,base),
    /review_no_longer_available/);
  assert.equal(db.writes.length, 0);
  db.docs.get(reqPath).status = "review_ready";
  db.docs.get(profilePath).role = "owner";
  await assert.rejects(() => setAccountDeletionReviewHold(db,base),
    /owner_protected/);
  assert.equal(db.writes.length, 0);
});

test("existing admin inbox owns the endpoint; review is owner-only and recent-auth gated", () => {
  const server = readFileSync("cloudflare-worker/src/admin-inbox.js", "utf8");
  const module = readFileSync("cloudflare-worker/src/account-deletion-review-control.js","utf8");
  const screen = readFileSync("lib/admin/account_deletion_owner_review_page.dart","utf8");
  const host = readFileSync("lib/admin/admin_notifications_page.dart","utf8");
  assert.match(server, /if \(!actor.owner\) throw new AdminInboxError\("forbidden", 403\)/);
  assert.match(server, /age < -60 \|\| age > 600/);
  assert.match(server, /inspectAccountDeletionForOwner/);
  assert.match(server, /setAccountDeletionReviewHold/);
  assert.match(host, /request: AdminInboxService.accountDeletionReview/);
  assert.match(screen, /accountDeletionReleaseHold/);
  assert.match(screen, /accountDeletionHold/);
  assert.doesNotMatch(module,
    /USER_STORAGE\.delete\(|deleteAuthUser\(|writeDelete\(|setInterval\(/);
  assert.doesNotMatch(screen, /eraseAccount|deleteAuthUser/);
});
