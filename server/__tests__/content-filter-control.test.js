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
    async runQuery(path, { limit } = {}) {
      return Array.from(data.entries())
        .filter(([key]) => key.startsWith(path + "/"))
        .slice(0, limit || 30)
        .map(([key, value]) => ({ id: key.split("/").pop(), data: value }));
    },
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

test("admin reads only bounded flagged metadata and can review a stored item", async () => {
  const db = fakeDb();
  db.data.set("content_filter_flags/item_01", {
    actorUid: "u1", surface: "private_chat", referenceId: "msg_01",
    conversationId: "conversation_01", ruleIds: ["rule_abc123"],
    status: "pending", createdAt: new Date("2026-10-13T15:00:00Z"),
  });
  const env = { ROOM_REALTIME: {
    idFromName(name) { assert.ok(name.startsWith("!")); return name; },
    get() { return {
      async fetch(url) {
        assert.equal(url, "https://internal/filter/flags");
        return Response.json({ ok: true, items: [{
          id: "room_5", actorUid: "room_sender", roomId: "r1",
          referenceId: "msg_room", ruleIds: ["rule_abc123"],
          sequence: 5, status: "pending", createdAtMs: 1720000000000,
        }] });
      },
    }; },
  }};
  const list = await contentFilterControlInternals.listFlags(db, env);
  assert.equal(list.roomUnavailable, false);
  assert.equal(list.items.length, 2);
  assert.equal(list.items[0].id, "saved_item_01");
  assert.equal(list.items[0].surface, "private_chat");
  assert.equal(list.items[0].hasSensitiveEvidence,false);
  const result = await contentFilterControlInternals.reviewFlag(db, env,
    "owner_01", {
      flagId: "saved_item_01", reason: "تمت المراجعة من الإدارة",
      idempotencyKey: "filter_review_item_01",
    });
  assert.equal(result.ok, true);
  assert.equal(db.data.get("content_filter_flags/item_01").status, "reviewed");
  assert.ok(db.data.has("admin_audit_logs/content_filter_flag_filter_review_item_01"));
  const duplicate = await contentFilterControlInternals.reviewFlag(db, env,
    "owner_01", {
      flagId: "saved_item_01", reason: "تمت المراجعة من الإدارة",
      idempotencyKey: "filter_review_item_01",
    });
  assert.equal(duplicate.code, "duplicate");
});

test("flag history reports partial availability without inventing room results", async () => {
  const db = fakeDb();
  const result = await contentFilterControlInternals.listFlags(db, {});
  assert.equal(result.roomUnavailable, true);
  assert.deepEqual(result.items, []);
});
