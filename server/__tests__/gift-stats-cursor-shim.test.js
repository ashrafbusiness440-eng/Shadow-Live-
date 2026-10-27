import { test } from "node:test";
import assert from "node:assert/strict";
import {
  LegacyQuery, LegacyDocumentSnapshot,
} from "../../cloudflare-worker/src/legacy-firebase-admin-shim.js";

test("Firestore legacy query carries complete stable cursor across pages", async () => {
  const calls = [];
  const store = {
    client: {
      async runQuery(path, options) {
        calls.push({ path, options });
        return calls.length === 1 ? [
          { path: "gift_transactions/entry_b", data: { createdAt: "2026-10-27T14:00:00.000Z" } },
          { path: "gift_transactions/entry_a", data: { createdAt: "2026-10-27T14:00:00.000Z" } },
        ] : [];
      },
    },
  };
  const q = new LegacyQuery(store, "gift_transactions")
    .orderBy("createdAt", "desc").orderBy("__name__", "desc")
    .limit(31);
  const first = await q.get();
  assert.equal(first.docs.length, 2);
  assert.equal(first.docs[1].data().createdAt.toMillis(), Date.parse("2026-10-27T14:00:00Z"));
  await q.startAfter(first.docs[1]).get();
  assert.equal(calls.length, 2);
  assert.deepEqual(calls[1].options.orderBy, [
    { field: "createdAt", direction: "desc" },
    { field: "__name__", direction: "desc" },
  ]);
  assert.equal(calls[1].options.limit, 31);
  assert.equal(calls[1].options.startAfter[0].value.toISOString(), "2026-10-27T14:00:00.000Z");
  assert.deepEqual(calls[1].options.startAfter[1], {
    referencePath: "gift_transactions/entry_a",
  });
  assert.deepEqual(calls[0].options.startAfter, []);
});

test("legacy cursors cannot target missing/unrelated records", () => {
  const store = { client: { runQuery: async () => [] } };
  const other = { client: { runQuery: async () => [] } };
  const q = new LegacyQuery(store, "gift_transactions").orderBy("createdAt", "desc");
  assert.throws(() => q.startAfter(null), /invalid_query_cursor/);
  assert.throws(() => q.startAfter(new LegacyDocumentSnapshot({
    path: "gift_transactions/x", id: "x", _store: other,
  }, { exists: true, data: { createdAt: "2026-10-27T14:00:00.000Z" } })), /invalid_query_cursor/);
  assert.throws(() => q.startAfter(new LegacyDocumentSnapshot({
    path: "gift_transactions/x", id: "x", _store: store,
  }, { exists: true, data: {} })), /invalid_query_cursor/);
});
