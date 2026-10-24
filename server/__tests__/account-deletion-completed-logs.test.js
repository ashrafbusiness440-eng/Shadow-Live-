import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { listCompletedAccountDeletionLogs } from "../../cloudflare-worker/src/account-deletion-completed-logs.js";

test("owner log query is bounded, exposes verified receipts only and no personal data", async () => {
  const calls = [];
  const privateData = {
    uid: "privateAccountUid", email: "private@example.org",
    profileImageUrl: "https://private.example/photo.jpg",
    legalReason: "confidential report", deletedDisplayName: "Prior Name",
    evidenceUrl: "https://private.example/evidence",
  };
  const db = {
    async runQuery(path, options) {
      calls.push({ path, options });
      return [
        { id: "receipt_1", data: {
          ...privateData,
          status: "completed", erasureVerified: true,
          requestId: "account_erasure_request_20261024",
          requestedAt: new Date("2026-09-10T12:00:00Z"),
          completedAt: "2026-10-24T12:00:00Z",
          financialStatus: "settled",
          evidenceStatus: "retained_under_policy",
          executorKind: "owner",
          retentionBasis: "moderation_evidence",
          retentionExpiresAt: "2027-01-22T12:00:00Z",
          retentionCategories: ["moderation_evidence", "legal_hold", "unrecognized"],
        } },
        { id: "pending", data: {
          status: "completed", erasureVerified: false,
          requestId: "account_erasure_request_20261025",
          ...privateData,
        } },
        { id: "preflight", data: { status: "preflight_blocked", erasureVerified: true, requestId: "account_erasure_request_20261026" } },
      ];
    },
  };
  const result = await listCompletedAccountDeletionLogs(db);
  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].operationId, "account_erasure_request_20261024");
  assert.equal(result.items[0].financialStatus, "settled");
  assert.deepEqual(result.items[0].retentionCategories, ["moderation_evidence", "legal_hold"]);
  assert.equal(result.items[0].requestedAt, "2026-09-10T12:00:00.000Z");
  assert.equal(result.items[0].completedAt, "2026-10-24T12:00:00.000Z");
  assert.equal(result.items[0].retentionBasis, "moderation_evidence");
  assert.equal(result.items[0].retentionExpiresAt, "2027-01-22T12:00:00.000Z");
  for (const secret of Object.values(privateData)) {
    assert.equal(JSON.stringify(result).includes(secret), false);
  }
  assert.deepEqual(calls, [{
    path: "account_deletion_erasure_receipts",
    options: { orderBy: [{ field: "completedAt", direction: "desc" }], limit: 21 },
  }]);
});

test("receipt log never promotes incomplete or invented state", async () => {
  const db = { async runQuery() {
    return [{ data: { status: "completed", requestId: "valid_request_id_012", erasureVerified: false } }];
  } };
  assert.deepEqual((await listCompletedAccountDeletionLogs(db)).items, []);
});

test("owner-only server action and owner UI are wired without deletion controls", () => {
  const source = readFileSync("cloudflare-worker/src/admin-inbox.js", "utf8");
  const control = readFileSync("lib/main_control.dart", "utf8");
  const page = readFileSync("lib/admin/deleted_account_logs_page.dart", "utf8");
  assert.match(source, /"accountDeletionCompletedLogs"/);
  assert.match(source, /if \(!actor\.owner\) throw new AdminInboxError\("forbidden", 403\)/);
  assert.match(source, /listCompletedAccountDeletionLogs\(db\)/);
  assert.match(control, /UsersPage\(ownerMode: widget\.ownerMode\)/);
  assert.match(control, /if\(widget\.ownerMode\)/);
  assert.match(page, /AdminInboxService\.completedAccountDeletionLogs\(\)/);
  assert.doesNotMatch(page, /writeDelete|deleteAuthUser|collection\(/);
});

test("owner logs never echo arbitrary personal free-text legal reasons", async () => {
  const db = { async runQuery() {
    return [{ data: {
      status: "completed", erasureVerified: true,
      requestId: "account_erasure_request_20261029",
      completedAt: "2026-10-24T12:00:00Z",
      retentionBasis: "private identity detailed reason",
      retentionExpiresAt: "not a date",
      retentionCategories: ["private_id", "legal_hold", "private_id"],
    } }];
  } };
  const result = await listCompletedAccountDeletionLogs(db);
  assert.equal(result.items[0].retentionBasis, "not_recorded");
  assert.equal(result.items[0].retentionExpiresAt, null);
  assert.deepEqual(result.items[0].retentionCategories, ["legal_hold"]);
  assert.equal(JSON.stringify(result).includes("private identity"), false);
});
