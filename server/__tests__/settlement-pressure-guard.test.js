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

test("Cloudflare settlement sweep uses a bounded single-field due queue", () => {
  const runtime = source("../../cloudflare-worker/src/legacy-games/game-runtime.js");
  assert.equal(runtime.includes('collection("game_settlement_queue")'), true);
  assert.equal(runtime.includes('.where("dueAtMs","<=",nowMs)'), true);
  assert.equal(runtime.includes('.orderBy("dueAtMs","asc")'), true);
  assert.equal(runtime.includes("Math.min(25,Number(limit||25))"), true);
  assert.equal(runtime.includes("tx.create(settlementQueueRef"), true);
  assert.equal(runtime.includes("tx.delete(settlementQueueRef)"), true);
  assert.equal(runtime.includes('.where("status","==","pending")\n      .where("closesAtMs","<=",nowMs)'), false);
});

test("Firebase scheduled settlement worker is no longer deployable", () => {
  const index = source("../../functions/src/index.ts");
  const settlement = source("../../functions/src/game_settlement.ts");
  assert.equal(index.includes("gameSettlementWorker"), false);
  assert.equal(settlement.includes("onSchedule"), false);
  assert.equal(settlement.includes("gameSettlementWorker"), false);
});

test("settlement queue needs no custom composite Firestore index", () => {
  const config = JSON.parse(source("../../firestore.indexes.json"));
  const workflow = source("../../.github/workflows/deploy-firestore-rules.yml");
  assert.deepEqual(config.indexes, []);
  assert.equal(workflow.includes("/collectionGroups/"), false);
  assert.equal(workflow.includes("index create failed"), false);
});

test("agency monthly settlement reads a fixed 32-shard set with direct document lookups", () => {
  const sourceText = source("../economy/economy-control.js");
  assert.equal(sourceText.includes("const AGENCY_MONTHLY_ACCRUAL_SHARDS=32"), true);
  assert.equal(
    sourceText.includes("Array.from({length:AGENCY_MONTHLY_ACCRUAL_SHARDS}"),
    true,
  );
  const start = sourceText.indexOf("export async function settleAgencyMonth");
  const end = sourceText.indexOf("export async function handler", start);
  const settlement = sourceText.slice(start, end);
  assert.equal(settlement.includes(".where("), false);
  assert.equal(sourceText.includes('collection("agency_monthly_accrual_shards")'), true);
  assert.equal(settlement.includes("tx.get(settlementRef)"), true);
  assert.equal(settlement.includes("tx.get(ledgerRef)"), true);
});
