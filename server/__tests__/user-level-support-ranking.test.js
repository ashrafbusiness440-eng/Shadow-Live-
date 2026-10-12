import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile } from "node:fs/promises";

import {
  userLevelSupportAggregateWrites,
  loadUserLevelSupportPage,
  userLevelSupportInternals,
} from "../../cloudflare-worker/src/user-level-support.js";

function fakeDb() {
  return {
    increment(fieldPath, amount) {
      return { fieldPath, amount };
    },
    writeUpdate(path, fields, mask, transforms) {
      return { path, fields, mask, transforms };
    },
  };
}

test("support aggregates split paid wealth from nominal attraction", () => {
  const writes = userLevelSupportAggregateWrites(fakeDb(), {
    senderUid: "sender_1",
    receiverUid: "receiver_1",
    sender: { displayName: "Sender" },
    receiver: { displayName: "Receiver" },
    wealthPoints: 0,
    attractionPoints: 1000,
    giftCount: 2,
  });
  assert.equal(writes.length, 1);
  assert.equal(writes[0].path, "user_level_support/receiver_1/attraction/sender_1");
  assert.equal(writes[0].transforms[0].fieldPath, "points");
  assert.equal(writes[0].transforms[0].amount, 1000);
});

test("support pagination stays bounded to 20 per page and 100 total", () => {
  assert.equal(userLevelSupportInternals.MAX_PAGE_SIZE, 20);
  assert.equal(userLevelSupportInternals.MAX_RESULTS, 100);
});

test("gift paths update pair aggregates inside the existing gift transaction", async () => {
  const room = await readFile(
    new URL("../../cloudflare-worker/src/room-gift.js", import.meta.url),
    "utf8",
  );
  const direct = await readFile(
    new URL("../../cloudflare-worker/src/chat-safety-actions.js", import.meta.url),
    "utf8",
  );
  assert.equal(room.includes("userLevelSupportAggregateWrites(db, {"), true);
  assert.equal(direct.includes("userLevelSupportAggregateWrites(db, {"), true);
  assert.equal(room.includes("wealthPoints: paidRecipientCost"), true);
  assert.equal(
    direct.includes("attractionPoints: levelPointAwards.attractionPoints"),
    true,
  );
});

test("user-level support endpoint applies mysterious identity server-side", async () => {
  const support = await readFile(
    new URL("../../cloudflare-worker/src/user-level-support.js", import.meta.url),
    "utf8",
  );
  assert.equal(support.includes("applyMysteriousIdentityPresentation("), true);
  assert.equal(support.includes("db.getMany("), true);
  assert.equal(support.includes("Promise.all("), false);
  assert.equal(support.includes("MAX_PAGE_SIZE = 20"), true);
  assert.equal(support.includes("MAX_RESULTS = 100"), true);
});


test("firestore helper exposes one bounded batchGet for support enrichment", async () => {
  const { readFile } = await import("node:fs/promises");
  const source = await readFile(
    new URL("../../cloudflare-worker/src/firestore.js", import.meta.url),
    "utf8",
  );
  assert.equal(source.includes("async getMany(paths"), true);
  assert.equal(source.includes("documents:batchGet"), true);
  assert.equal(source.includes('readMode: "batch"'), true);
  assert.equal(source.includes("requested.length > 100"), true);
});


test("support pages use built-in descending index with stable tie pagination", async () => {
  const calls = [];
  const enrichmentBatches = [];
  const rows = Array.from({ length: 21 }, (_, index) => {
    const counterpartUid = "support_" + String(21 - index).padStart(2, "0");
    return {
      id: counterpartUid,
      data: { counterpartUid, points: 100, giftCount: 1 },
    };
  });
  const db = {
    async runQuery(path, options) {
      calls.push({ path, options });
      return calls.length === 1 ? rows : [rows[20]];
    },
    async getMany(paths) {
      enrichmentBatches.push(paths);
      return paths.map(() => ({ exists: false, data: null }));
    },
  };
  const first = await loadUserLevelSupportPage(db, "target_1", "wealth");
  assert.equal(first.items.length, 20);
  assert.equal(first.nextCursor, "20.100.support_02");
  assert.equal(first.items[0].rank, 1);
  assert.equal(first.items[19].rank, 20);
  assert.deepEqual(calls[0].options.orderBy, [
    { field: "points", direction: "desc" },
    { field: "__name__", direction: "desc" },
  ]);
  assert.equal(calls[0].path, "user_level_support/target_1/wealth");
  assert.equal(calls[0].options.limit, 21);
  assert.deepEqual(calls[0].options.startAfter, []);
  assert.equal(enrichmentBatches[0].length, 20);

  const second = await loadUserLevelSupportPage(
    db,
    "target_1",
    "wealth",
    { cursor: first.nextCursor },
  );
  assert.equal(second.items.length, 1);
  assert.equal(second.items[0].rank, 21);
  assert.equal(second.nextCursor, null);
  assert.deepEqual(calls[1].options.startAfter, [
    100,
    { referencePath: "user_level_support/target_1/wealth/support_02" },
  ]);
  assert.equal(enrichmentBatches[1].length, 1);
});

test("attraction support reuses the same bounded indexed query", async () => {
  const calls = [];
  const db = {
    async runQuery(path, options) {
      calls.push({ path, options });
      return [];
    },
    async getMany(paths) {
      assert.deepEqual(paths, []);
      return [];
    },
  };
  const page = await loadUserLevelSupportPage(db, "target_2", "attraction");
  assert.equal(page.items.length, 0);
  assert.equal(page.nextCursor, null);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].path, "user_level_support/target_2/attraction");
  assert.equal(calls[0].options.limit, 21);
  assert.equal(calls[0].options.orderBy[1].direction, "desc");
});
