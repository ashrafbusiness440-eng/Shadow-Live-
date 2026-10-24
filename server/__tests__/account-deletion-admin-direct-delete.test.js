import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { mutateAccount } from "../../cloudflare-worker/src/manage-user-account.js";

const request = {
  accountAction: "deleteAccount",
  targetUid: "member_account_123",
  reason: "Account deletion requested",
  idempotencyKey: "legacy_delete_op_123456",
};

function fakeDb(role, enabled) {
  const calls = [];
  return {
    calls,
    async get(path) {
      calls.push(["get", path]);
      if (path === "users/owner_account_123") {
        return { exists: true, data: { role, adminEnabled: enabled, accountStatus: "active" } };
      }
      throw Error("unexpected_target_read:" + path);
    },
    beginTransaction() { throw Error("unsafe_transaction_started"); },
    commit() { throw Error("unsafe_commit"); },
    writeCreate() { throw Error("unsafe_create"); },
    writeUpdate() { throw Error("unsafe_update"); },
  };
}

test("Owner's legacy direct-delete request is rejected before any target access or mutation", async () => {
  const db = fakeDb("owner", true);
  await assert.rejects(
    mutateAccount(db, {}, { sub: "owner_account_123", iat: 9999999999 }, request),
    error => error.code === "account_deletion_lifecycle_required" &&
      error.status === 409,
  );
  assert.deepEqual(db.calls, [["get", "users/owner_account_123"]]);
});

test("Non-owner cannot bypass legacy-delete guard", async () => {
  const db = fakeDb("admin", true);
  await assert.rejects(
    mutateAccount(db, {}, { sub: "owner_account_123", iat: 9999999999 }, request),
    error => error.code === "forbidden" && error.status === 403,
  );
  assert.deepEqual(db.calls, [["get", "users/owner_account_123"]]);
});

test("no legacy Auth-first delete and no misleading direct-delete UI remain", () => {
  const worker = readFileSync("cloudflare-worker/src/manage-user-account.js", "utf8");
  const control = readFileSync("lib/main_control.dart", "utf8");
  assert.doesNotMatch(worker, /await deleteAuthUser\(/);
  assert.doesNotMatch(worker, /identityRequest\(env, "delete"/);
  assert.match(worker, /account_deletion_lifecycle_required/);
  assert.doesNotMatch(control, /_execute\(context,'deleteAccount'/);
  assert.match(control, /الحذف النهائي ضمن المراجعة فقط/);
});
