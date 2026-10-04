import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { randomUUID, webcrypto } from "node:crypto";
import test from "node:test";

if (!globalThis.crypto) {
  globalThis.crypto = webcrypto;
}
if (typeof globalThis.crypto.randomUUID !== "function") {
  globalThis.crypto.randomUUID = randomUUID;
}

import { relationshipCoreTestHooks } from "../../cloudflare-worker/src/relationships.js";

const {
  normalizeTypes,
  pairKey,
  slotPath,
  sendRequest,
  respondRequest,
  endRelationship,
  validateSubmittedTypes,
} = relationshipCoreTestHooks;

class FakeDb {
  constructor(seed = {}) {
    this.docs = new Map(
      Object.entries(seed).map(([path, data]) => [path, structuredClone(data)]),
    );
  }

  async beginTransaction() {
    return "tx";
  }

  async rollback() {}

  async get(path) {
    if (!this.docs.has(path)) return { exists: false, data: null };
    return { exists: true, data: structuredClone(this.docs.get(path)) };
  }

  writeCreate(path, fields) {
    return { kind: "create", path, fields: structuredClone(fields) };
  }

  writeUpdate(path, fields) {
    return { kind: "update", path, fields: structuredClone(fields) };
  }

  writeDelete(path) {
    return { kind: "delete", path };
  }

  async commit(_transaction, writes) {
    for (const write of writes) {
      if (write.kind === "create") {
        if (this.docs.has(write.path)) {
          const error = new Error("ALREADY_EXISTS");
          error.status = 409;
          throw error;
        }
        this.docs.set(write.path, structuredClone(write.fields));
      } else if (write.kind === "update") {
        const current = this.docs.get(write.path) || {};
        this.docs.set(write.path, {
          ...structuredClone(current),
          ...structuredClone(write.fields),
        });
      } else if (write.kind === "delete") {
        this.docs.delete(write.path);
      }
    }
  }
}

function seedUsers(...uids) {
  return Object.fromEntries(
    uids.map((uid) => [
      `users/${uid}`,
      { displayName: uid.toUpperCase(), publicId: uid + "_id" },
    ]),
  );
}

function operationKey(label) {
  return ("relationship_" + label + "_00000000000000000000").slice(0, 60);
}

test("launch relationship types are stable, bounded, and extensible", () => {
  const defaults = normalizeTypes(null);
  assert.deepEqual(
    defaults.map((item) => item.key),
    ["cp", "bff", "brother", "sister", "close_friend"],
  );

  const many = normalizeTypes({
    types: Array.from({ length: 30 }, (_, index) => ({
      key: "type_" + index,
      labelAr: "نوع " + index,
      enabled: true,
      order: index,
    })),
  });
  assert.equal(many.length, 20);
  assert.equal(new Set(many.map((item) => item.key)).size, 20);
});

test("pair keys are symmetric and slots are isolated by type", () => {
  assert.equal(pairKey("user_a", "user_b", "cp"), pairKey("user_b", "user_a", "cp"));
  assert.notEqual(slotPath("user_a", "cp"), slotPath("user_a", "bff"));
});

test("send request is idempotent and pending pair lock prevents cross-send duplicates", async () => {
  const db = new FakeDb(seedUsers("user_a", "user_b"));
  const first = await sendRequest(db, "user_a", {
    targetUserId: "user_b",
    relationshipType: "cp",
    idempotencyKey: operationKey("send_a"),
  });
  assert.equal(first.ok, true);
  assert.equal(first.status, "pending");

  const duplicate = await sendRequest(db, "user_a", {
    targetUserId: "user_b",
    relationshipType: "cp",
    idempotencyKey: operationKey("send_a"),
  });
  assert.equal(duplicate.code, "duplicate");
  assert.equal(duplicate.requestId, first.requestId);

  await assert.rejects(
    () =>
      sendRequest(db, "user_b", {
        targetUserId: "user_a",
        relationshipType: "cp",
        idempotencyKey: operationKey("cross_send"),
      }),
    /relationship_request_already_pending/,
  );
});

test("block prevents relationship request", async () => {
  const db = new FakeDb({
    ...seedUsers("user_a", "user_b"),
    "user_blocks/user_a/items/user_b": {
      blockerUid: "user_a",
      blockedUid: "user_b",
    },
  });

  await assert.rejects(
    () =>
      sendRequest(db, "user_a", {
        targetUserId: "user_b",
        relationshipType: "cp",
        idempotencyKey: operationKey("blocked"),
      }),
    /blocked/,
  );
});

test("accept creates one active slot per user/type and allows another type", async () => {
  const db = new FakeDb(seedUsers("user_a", "user_b", "user_c"));
  const request = await sendRequest(db, "user_a", {
    targetUserId: "user_b",
    relationshipType: "cp",
    idempotencyKey: operationKey("send_cp"),
  });

  const accepted = await respondRequest(db, "user_b", {
    requestId: request.requestId,
    decision: "accept",
    idempotencyKey: operationKey("accept_cp"),
  });
  assert.equal(accepted.status, "accepted");
  assert.ok(accepted.relationshipId);
  assert.equal(db.docs.get(slotPath("user_a", "cp")).partnerUid, "user_b");
  assert.equal(db.docs.get(slotPath("user_b", "cp")).partnerUid, "user_a");

  await assert.rejects(
    () =>
      sendRequest(db, "user_a", {
        targetUserId: "user_c",
        relationshipType: "cp",
        idempotencyKey: operationKey("occupied_cp"),
      }),
    /relationship_slot_occupied/,
  );

  const bff = await sendRequest(db, "user_a", {
    targetUserId: "user_c",
    relationshipType: "bff",
    idempotencyKey: operationKey("send_bff"),
  });
  assert.equal(bff.status, "pending");
});

test("ending an active relationship releases both slots for reuse", async () => {
  const db = new FakeDb(seedUsers("user_a", "user_b", "user_c"));
  const request = await sendRequest(db, "user_a", {
    targetUserId: "user_b",
    relationshipType: "cp",
    idempotencyKey: operationKey("send_end"),
  });
  const accepted = await respondRequest(db, "user_b", {
    requestId: request.requestId,
    decision: "accept",
    idempotencyKey: operationKey("accept_end"),
  });

  const ended = await endRelationship(db, "user_a", {
    relationshipId: accepted.relationshipId,
    idempotencyKey: operationKey("end_cp"),
  });
  assert.equal(ended.status, "ended");
  assert.equal(db.docs.has(slotPath("user_a", "cp")), false);
  assert.equal(db.docs.has(slotPath("user_b", "cp")), false);

  const next = await sendRequest(db, "user_a", {
    targetUserId: "user_c",
    relationshipType: "cp",
    idempotencyKey: operationKey("reuse_cp"),
  });
  assert.equal(next.status, "pending");
});

test("relationship core stays bounded and avoids query/list scans", () => {
  const source = readFileSync(
    new URL("../../cloudflare-worker/src/relationships.js", import.meta.url),
    "utf8",
  );
  const rules = readFileSync(
    new URL("../../firestore.rules", import.meta.url),
    "utf8",
  );

  assert.equal(source.includes(".runQuery("), false);
  assert.equal(source.includes(".list("), false);
  assert.equal(source.includes("MAX_TYPES = 20"), true);
  assert.equal(source.includes("relationship_slots/"), true);
  assert.equal(source.includes("relationship_pending/"), true);
  assert.equal(source.includes("relationship_active_pairs/"), true);
  assert.equal(source.includes("user_blocks/"), true);

  for (const collection of [
    "relationship_requests",
    "relationships",
    "relationship_slots",
    "relationship_pending",
    "relationship_active_pairs",
    "relationship_operations",
    "relationship_audit_logs",
  ]) {
    assert.equal(rules.includes(`match /${collection}/{`), true, collection);
  }
});


test("relationship type submissions are strict and bounded", () => {
  const valid = validateSubmittedTypes([
    { key: "cp", labelAr: "CP", enabled: true, order: 10, assetKey: "" },
    { key: "bff", labelAr: "BFF", enabled: true, order: 20, assetKey: "" },
  ]);
  assert.deepEqual(valid.map((item) => item.key), ["cp", "bff"]);

  assert.throws(
    () => validateSubmittedTypes([
      { key: "cp", labelAr: "CP", enabled: true, order: 10 },
      { key: "cp", labelAr: "Duplicate", enabled: true, order: 20 },
    ]),
    /invalid_relationship_types/,
  );

  assert.throws(
    () => validateSubmittedTypes(
      Array.from({ length: 21 }, (_, index) => ({
        key: "type_" + index,
        labelAr: "نوع " + index,
        enabled: true,
        order: index,
      })),
    ),
    /invalid_relationship_types/,
  );
});

test("relationship UI and control avoid polling and direct relationship Firestore IO", () => {
  const service = readFileSync(
    new URL("../../lib/features/relationships/services/relationship_service.dart", import.meta.url),
    "utf8",
  );
  const page = readFileSync(
    new URL("../../lib/features/relationships/screens/relationships_page.dart", import.meta.url),
    "utf8",
  );
  const control = readFileSync(
    new URL("../../lib/admin/control_relationship_types_page.dart", import.meta.url),
    "utf8",
  );

  for (const source of [service, page, control]) {
    assert.equal(source.includes("Timer.periodic"), false);
    assert.equal(source.includes(".snapshots()"), false);
  }
  assert.equal(service.includes("relationship_slots"), false);
  assert.equal(service.includes("relationship_requests"), false);
  assert.equal(control.includes("'setTypes'"), true);
  assert.equal(control.includes("'types'"), true);
  assert.equal(control.includes("لا يمكن حذف نوع موجود"), true);
});


test("relationships API route is wired in Worker dispatch", () => {
  const source = readFileSync(
    new URL("../../cloudflare-worker/src/index.js", import.meta.url),
    "utf8",
  );
  assert.equal(source.includes('url.pathname === "/api/relationships"'), true);
  assert.equal(source.includes('return relationships(request, env);'), true);
  assert.equal(source.includes('action: "relationships"'), true);
});
