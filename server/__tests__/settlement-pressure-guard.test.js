import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function source(path) {
  return readFileSync(new URL(path, import.meta.url), "utf8");
}

test("room rocket hot-document telemetry stays attached to every successful gift", () => {
  const roomGift = source("../../cloudflare-worker/src/room-gift.js");
  assert.equal(roomGift.includes('kind: "hot_document"'), true);
  assert.equal(roomGift.includes('primary: "room_rocket_state"'), true);
  assert.equal(roomGift.includes('action: "room_gift_commit"'), true);
  assert.equal(roomGift.includes("reads: 1"), true);
  assert.equal(roomGift.includes("writes: 1"), true);
  assert.equal(roomGift.includes("_transactionAttempts"), true);
});

test("Cloudflare settlement sweep queries only due pending operations oldest-first", () => {
  const runtime = source("../../cloudflare-worker/src/legacy-games/game-runtime.js");
  assert.equal(
    runtime.includes('.where("status","==","pending")\n      .where("closesAtMs","<=",nowMs)'),
    true,
  );
  assert.equal(runtime.includes('.orderBy("closesAtMs","asc")'), true);
  assert.equal(runtime.includes("Math.min(25,Number(limit||25))"), true);
});

test("Firebase scheduled settlement worker is no longer deployable", () => {
  const index = source("../../functions/src/index.ts");
  const settlement = source("../../functions/src/game_settlement.ts");
  assert.equal(index.includes("gameSettlementWorker"), false);
  assert.equal(settlement.includes("onSchedule"), false);
  assert.equal(settlement.includes("gameSettlementWorker"), false);
});

test("Firestore source of truth declares the due-settlement composite index", () => {
  const config = JSON.parse(source("../../firestore.indexes.json"));
  const found = config.indexes.find(
    (index) =>
      index.collectionGroup === "game_operations" &&
      index.queryScope === "COLLECTION" &&
      JSON.stringify(index.fields) === JSON.stringify([
        { fieldPath: "status", order: "ASCENDING" },
        { fieldPath: "closesAtMs", order: "ASCENDING" },
      ]),
  );
  assert.ok(found);
});
