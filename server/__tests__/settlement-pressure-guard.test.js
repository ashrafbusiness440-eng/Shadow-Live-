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

test("agency application submission stays bounded and query free", () => {
  const sourceText = source("../../cloudflare-worker/src/agency-application.js");
  assert.equal(sourceText.includes(".runQuery("), false);
  assert.equal(sourceText.includes(".list("), false);
  assert.equal(sourceText.includes("normalizeApplicationHostIds"), true);
  assert.equal(sourceText.includes("public_ids/"), true);
  assert.equal(sourceText.includes("agency_application_locks/"), true);
  assert.equal(sourceText.includes("agency_application_operations/"), true);
});

test("agency review queue is bounded and agency creation uses direct id registry lookups", () => {
  const sourceText = source("../../cloudflare-worker/src/agency-control.js");
  assert.equal(sourceText.includes('db.runQuery("agency_applications"'), true);
  assert.equal(sourceText.includes('Math.min(50'), true);
  assert.equal(sourceText.includes('db.get(`agency_ids/${candidate}`'), true);
  assert.equal(sourceText.includes(".list("), false);
});

test("agency rejection and manual unblock remain direct and bounded", () => {
  const sourceText = source("../../cloudflare-worker/src/agency-control.js");
  const rejectStart = sourceText.indexOf("export async function rejectAgencyApplication");
  const manualListStart = sourceText.indexOf("export async function listAgencyManualReapplyBlocks");
  const unblockStart = sourceText.indexOf("export async function allowAgencyReapply");
  const directStart = sourceText.indexOf("export async function directCreateAgency");
  const rejectSource = sourceText.slice(rejectStart, manualListStart);
  const manualListSource = sourceText.slice(manualListStart, unblockStart);
  const unblockSource = sourceText.slice(unblockStart, directStart);
  assert.equal(rejectSource.includes(".runQuery("), false);
  assert.equal(unblockSource.includes(".runQuery("), false);
  assert.equal(manualListSource.includes('db.runQuery("agency_manual_reapply_blocks"'), true);
  assert.equal(manualListSource.includes("Math.min(25"), true);
});

test("agency membership request lifecycle stays direct and bounded", () => {
  const sourceText = source("../../cloudflare-worker/src/agency-membership.js");
  assert.equal(sourceText.includes(".list("), false);
  assert.equal(sourceText.includes("Math.min(50"), true);
  assert.equal(sourceText.includes('db.runQuery("agency_membership_pending"'), true);
  assert.equal(sourceText.includes('db.runQuery("agency_membership_requests"'), true);
  assert.equal(sourceText.includes("agency_membership_acceptance_locks/"), true);
  assert.equal(sourceText.includes("agency_membership_request_keys/"), true);
});

test("agency membership commit is query free and counter updates stay atomic", () => {
  const sourceText = source("../../cloudflare-worker/src/agency-membership.js");
  const start = sourceText.indexOf("export async function commitAcceptedAgencyMembership");
  const end = sourceText.indexOf("export async function cancelAgencyMembershipRequest", start);
  const commitSource = sourceText.slice(start, end);
  assert.equal(commitSource.includes(".runQuery("), false);
  assert.equal(commitSource.includes(".list("), false);
  assert.equal(commitSource.includes('db.increment("memberCount", 1)'), true);
  assert.equal(commitSource.includes('db.increment("hostCount", 1)'), true);
  assert.equal(commitSource.includes("agency_user_memberships/"), true);
  assert.equal(commitSource.includes("agency_memberships/"), true);
});


test("agency membership departure core is direct and query free", () => {
  const sourceText = source("../../cloudflare-worker/src/agency-membership.js");
  const start = sourceText.indexOf("async function changeAgencyMembershipStatus");
  const end = sourceText.indexOf("export async function leaveAgencyMembership", start);
  const departureSource = sourceText.slice(start, end);
  assert.equal(start >= 0, true);
  assert.equal(departureSource.includes(".runQuery("), false);
  assert.equal(departureSource.includes(".list("), false);
  assert.equal(departureSource.includes('db.increment("memberCount", -1)'), true);
  assert.equal(departureSource.includes("counterFieldForRole"), true);
  assert.equal(departureSource.includes("agency_user_memberships/"), true);
  assert.equal(departureSource.includes("agency_memberships/"), true);
  assert.equal(departureSource.includes("agency_membership_acceptance_locks/"), false);
  assert.equal(departureSource.includes("acceptanceLockPath(targetUid)"), true);
});
