import assert from "node:assert/strict";
import test from "node:test";
import {
  contentFilterControlInternals,
} from "../../cloudflare-worker/src/content-filter-control.js";

function fakeDb() {
  const data = new Map();
  const writes = [];
  const db = {
    data, writes,
    async beginTransaction() { return "fake_tx"; },
    async rollback() {},
    async get(path) {
      return {
        exists: data.has(path),
        data: data.get(path) || null,
      };
    },
    writeCreate(path, fields) { return { kind: "create", path, fields }; },
    writeUpdate(path, fields) { return { kind: "update", path, fields }; },
    async commit(tx, operations) {
      for (const operation of operations) {
        if (operation.kind === "create" && data.has(operation.path))
          throw Error("duplicate_transaction_write");
        const old = data.get(operation.path) || {};
        data.set(operation.path, { ...old, ...operation.fields });
        writes.push(operation);
      }
    },
  };
  return db;
}

const config = (enabled) => ({
  enabled,
  surfaces: {
    private_chat: true, room_chat: true,
    diary_post: true, diary_comment: true,
  },
  rules: [],
});

test("content filter save is versioned, idempotent and audit-logged", async () => {
  const db = fakeDb();
  const body = {
    idempotencyKey: "filter_op_unique_0001",
    reason: "تجربة إعدادات الفلتر",
    expectedVersion: 0,
    config: config(false),
  };
  const first = await contentFilterControlInternals.savePolicy(
    db, "owner_user", body,
  );
  assert.equal(first.ok, true);
  assert.equal(first.config.version, 1);
  assert.equal(first.config.enabled, false);
  assert.equal(db.data.get("system_config/content_filter")?.version, 1);
  assert.ok(db.data.has("admin_audit_logs/content_filter_filter_op_unique_0001"));
  const second = await contentFilterControlInternals.savePolicy(
    db, "owner_user", body,
  );
  assert.equal(second.code, "duplicate");
  assert.equal(db.writes.length, 3);
  await assert.rejects(
    () => contentFilterControlInternals.savePolicy(db, "owner_user", {
      ...body,
      idempotencyKey: "filter_op_unique_0002",
    }),
    /filter_conflict/,
  );
});

test("invalid or duplicated words do not write settings", async () => {
  const db = fakeDb();
  const base = {
    idempotencyKey: "filter_op_unique_0003",
    reason: "مراجعة الكلمات",
    expectedVersion: 0,
  };
  await assert.rejects(
    () => contentFilterControlInternals.savePolicy(db, "owner_user", {
      ...base,
      config: { ...config(true), rules: [{ pattern: "bad", action: "mask" }] },
    }),
    /invalid_filter_config/,
  );
  assert.equal(db.data.size, 0);
});

test("room coordinator remains the only room filter data source", async () => {
  const { readFileSync } = await import("node:fs");
  const room = readFileSync(
    new URL("../../cloudflare-worker/src/room-realtime-object.js", import.meta.url),
    "utf8",
  );
  assert.equal(room.includes("firestoreClient"), false);
  assert.equal(room.includes("Firebase"), false);
  assert.equal(room.includes('"/filter/snapshot"'), true);
  assert.equal(room.includes('"/filter/update"'), true);
  assert.equal(room.includes('await this.#contentFilterPolicy()'), true);
});
