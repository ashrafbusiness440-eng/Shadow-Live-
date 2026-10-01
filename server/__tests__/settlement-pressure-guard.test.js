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
  const settlementIndexes = (config.indexes || []).filter(
    (index) =>
      index.collectionGroup === "game_settlement_queue" ||
      (index.fields || []).some(
        (field) =>
          field.fieldPath === "dueAtMs" ||
          field.fieldPath === "closesAtMs" ||
          field.fieldPath === "status",
      ),
  );
  assert.deepEqual(settlementIndexes, []);
  assert.equal(workflow.includes("game_settlement_queue"), false);
  assert.equal(workflow.includes("closesAtMs"), false);
});

test("agency monthly settlement reads a fixed 32-shard set with direct document lookups", () => {
  const sourceText = source("../economy/economy-control.js");
  assert.equal(sourceText.includes("const AGENCY_MONTHLY_ACCRUAL_SHARDS=32"), true);
  assert.equal(
    sourceText.includes("Array.from({length:AGENCY_MONTHLY_ACCRUAL_SHARDS}"),
    true,
  );
  const start = sourceText.indexOf("export async function settleAgencyMonth");
  const end = sourceText.indexOf("const AGENCY_SURPLUS_PAGE_MAX=25", start);
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
  assert.equal(sourceText.includes("reserveAgencyApplicationHost"), true);
  assert.equal(sourceText.includes("releaseAgencyApplicationHost"), true);
  assert.equal(sourceText.includes("system_config/agency_application"), true);
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
  const controlDetailsStart = sourceText.indexOf(
    "export async function getAgencyControlDetails",
  );
  const rejectSource = sourceText.slice(rejectStart, manualListStart);
  const manualListSource = sourceText.slice(manualListStart, unblockStart);
  const unblockSource = sourceText.slice(unblockStart, controlDetailsStart);
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


test("agency rejoin cooldown uses only direct membership documents", () => {
  const sourceText = source("../../cloudflare-worker/src/agency-membership.js");
  assert.equal(sourceText.includes("AGENCY_REJOIN_COOLDOWN_MS"), true);
  assert.equal(sourceText.includes("ensureRejoinCooldownExpired"), true);
  assert.equal(sourceText.includes('action === "leave"'), true);
  assert.equal(sourceText.includes('action === "remove"'), true);
  const respondStart = sourceText.indexOf("export async function respondAgencyMembershipRequest");
  const commitStart = sourceText.indexOf("export async function commitAcceptedAgencyMembership");
  const departureStart = sourceText.indexOf("async function changeAgencyMembershipStatus");
  const respondSource = sourceText.slice(respondStart, commitStart);
  const commitSource = sourceText.slice(commitStart, departureStart);
  assert.equal(respondSource.includes(".runQuery("), false);
  assert.equal(commitSource.includes(".runQuery("), false);
  assert.equal(respondSource.includes(".list("), false);
  assert.equal(commitSource.includes(".list("), false);
});


test("Shadow Control agency cooldown override is direct and query free", () => {
  const sourceText = source("../../cloudflare-worker/src/agency-membership.js");
  const start = sourceText.indexOf("export async function overrideAgencyRejoinCooldown");
  const end = sourceText.indexOf("export async function cancelAgencyMembershipRequest", start);
  const overrideSource = sourceText.slice(start, end);
  assert.equal(start >= 0, true);
  assert.equal(overrideSource.includes(".runQuery("), false);
  assert.equal(overrideSource.includes(".list("), false);
  assert.equal(overrideSource.includes("agency_user_memberships/"), true);
  assert.equal(overrideSource.includes("agency_memberships/"), true);
  assert.equal(overrideSource.includes("admin_audit_logs/agency_cooldown_override_"), true);
});


test("agency manager role core is direct, bounded, and query free", () => {
  const sourceText = source("../../cloudflare-worker/src/agency-membership.js");
  const start = sourceText.indexOf("export async function setAgencyManagerRole");
  const end = sourceText.indexOf("function departureFingerprint", start);
  const managerRoleSource = sourceText.slice(start, end);
  assert.equal(start >= 0, true);
  assert.equal(managerRoleSource.includes(".runQuery("), false);
  assert.equal(managerRoleSource.includes(".list("), false);
  assert.equal(managerRoleSource.includes("agency_manager_slots/"), true);
  assert.equal(managerRoleSource.includes("agency_user_memberships/"), true);
  assert.equal(managerRoleSource.includes("agency_memberships/"), true);
  assert.equal(managerRoleSource.includes("db.increment(currentCounter, -1)"), true);
  assert.equal(managerRoleSource.includes("db.increment(targetCounter, 1)"), true);
  assert.equal(managerRoleSource.includes("AGENCY_LIMITS.agencyManagers"), true);
});


test("Stage 05-B agency member surface stays bounded", () => {
  const sourceText = source("../../cloudflare-worker/src/agency-membership.js");
  const start = sourceText.indexOf("export async function listAgencyMembers");
  const end = sourceText.indexOf("export async function listAgencyMembershipPending", start);
  const listSource = sourceText.slice(start, end);
  assert.equal(start >= 0, true);
  assert.equal(listSource.includes(".list("), false);
  assert.equal(listSource.includes('Math.min(50, boundedAgencyPageSize(body.limit, 25))'), true);
  assert.equal(listSource.includes('limit,'), true);
  assert.equal(listSource.includes('db.runQuery("agency_memberships"'), true);
  assert.equal(listSource.includes('field: "agencyId"'), true);
  assert.equal(listSource.includes('field: "status"'), true);
  assert.equal(listSource.includes('rows.map((row) =>'), true);
});


test("Stage 05 closure keeps mutations query free and management reads bounded fail closed", () => {
  const sourceText = source("../../cloudflare-worker/src/agency-membership.js");

  const roleStart = sourceText.indexOf("export async function setAgencyManagerRole");
  const roleEnd = sourceText.indexOf("function departureFingerprint", roleStart);
  const roleSource = sourceText.slice(roleStart, roleEnd);
  assert.equal(roleStart >= 0, true);
  assert.equal(roleSource.includes(".runQuery("), false);
  assert.equal(roleSource.includes(".list("), false);
  assert.equal(roleSource.includes("ensureManagerCountersConsistent"), true);

  const listStart = sourceText.indexOf("export async function listAgencyMembers");
  const listEnd = sourceText.indexOf("export async function listAgencyMembershipPending", listStart);
  const listSource = sourceText.slice(listStart, listEnd);
  assert.equal(listStart >= 0, true);
  assert.equal(listSource.includes("Math.min(50, boundedAgencyPageSize(body.limit, 25))"), true);
  assert.equal(listSource.includes('db.runQuery("agency_memberships"'), true);
  assert.equal(listSource.includes("ensureManagerCountersConsistent(agency, slots)"), true);
});


test("Stage 07-A gift hot paths accrue Agency Share on shards and never mutate Agency Wallet directly", () => {
  for (const relativePath of [
    "../../cloudflare-worker/src/room-gift.js",
    "../../cloudflare-worker/src/chat-safety-actions.js",
  ]) {
    const sourceText = source(relativePath);
    assert.equal(sourceText.includes("AGENCY_MONTHLY_ACCRUAL_SHARDS = 32"), true);
    assert.equal(sourceText.includes("agencyAccrualShard(key)"), true);
    assert.equal(sourceText.includes("agency_monthly_accrual_shards/"), true);
    assert.equal(sourceText.includes("agency_wallets/"), false);
    assert.equal(sourceText.includes("agency_monthly_statements/"), false);
  }
});


test("Stage 07-B Agency Wallet settlement stays bounded and never replays Host salary", () => {
  for (const relativePath of [
    "../economy/economy-control.js",
    "../../cloudflare-worker/src/legacy-economy/economy-control.js",
  ]) {
    const sourceText = source(relativePath);
    const start = sourceText.indexOf("export async function settleAgencyMonth");
    const end = sourceText.indexOf("const AGENCY_SURPLUS_PAGE_MAX=25", start);
    const settlement = sourceText.slice(start, end);
    assert.equal(start >= 0, true);
    assert.equal(settlement.includes(".where("), false);
    assert.equal(settlement.includes(".list("), false);
    assert.equal(settlement.includes('collection("users")'), false);
    assert.equal(settlement.includes('collection("agency_wallets").doc(agencyId)'), true);
    assert.equal(settlement.includes('collection("agency_monthly_statements").doc(statementId)'), true);
    assert.equal(settlement.includes('collection("financial_ledger").doc(ledgerId)'), true);
    assert.equal(settlement.includes("AGENCY_MONTHLY_ACCRUAL_SHARDS"), true);
    assert.equal(settlement.includes('hostSalaryRepaidAtMonthEnd:false'), true);
  }
});


test("Stage 08-A defers Agency Bonus off Room and Chat gift hot paths", () => {
  for (const relativePath of [
    "../../cloudflare-worker/src/room-gift.js",
    "../../cloudflare-worker/src/chat-safety-actions.js",
  ]) {
    const sourceText = source(relativePath);
    assert.equal(sourceText.includes("resolveGiftRevenuePolicy"), true);
    assert.equal(sourceText.includes("resolveRevenuePolicy("), false);
    assert.equal(sourceText.includes("activeHostIds.length"), false);
    assert.equal(
      sourceText.includes("agencyBonusDeferredToMonthEnd"),
      true,
    );
  }
});

test("Stage 08-A active agency host marker avoids repeated monthly count writes", () => {
  const sourceText = source("../economy/mic-activity-admin.js");
  assert.equal(
    sourceText.includes("previousQualifiedDays > 0"),
    true,
  );
  assert.equal(
    sourceText.includes("FieldValue.increment(1)"),
    true,
  );
  assert.equal(
    sourceText.includes("activeHostIds: FieldValue.arrayUnion(userId)"),
    true,
  );
});


test("Stage 08-B monthly Bonus settlement stays bounded and query-free", () => {
  for (const relativePath of [
    "../economy/economy-control.js",
    "../../cloudflare-worker/src/legacy-economy/economy-control.js",
  ]) {
    const sourceText = source(relativePath);
    const start = sourceText.indexOf("export async function settleAgencyMonth");
    const end = sourceText.indexOf("const AGENCY_SURPLUS_PAGE_MAX=25", start);
    const settlement = sourceText.slice(start, end);
    assert.equal(start >= 0, true);
    assert.equal(settlement.includes("AGENCY_MONTHLY_ACCRUAL_SHARDS"), true);
    assert.equal(settlement.includes('collection("agency_policy_overrides").doc(agencyId)'), true);
    assert.equal(settlement.includes('collection("agency_support_stats")'), true);
    assert.equal(settlement.includes('collection("agency_bonus_accruals").doc(statementId)'), true);
    assert.equal(settlement.includes(".where("), false);
    assert.equal(settlement.includes(".list("), false);
    assert.equal(settlement.includes("calculateAgencyMonthlyBonus"), true);
    assert.equal(settlement.includes('hostSalaryRepaidAtMonthEnd:false'), true);
  }
});


test("Stage 08-C replay and policy snapshot stay bounded and direct", () => {
  for (const relativePath of [
    "../economy/economy-control.js",
    "../../cloudflare-worker/src/legacy-economy/economy-control.js",
  ]) {
    const sourceText = source(relativePath);
    const start = sourceText.indexOf("export async function settleAgencyMonth");
    const end = sourceText.indexOf("const AGENCY_SURPLUS_PAGE_MAX=25", start);
    const settlement = sourceText.slice(start, end);
    assert.equal(settlement.includes("tx.get(bonusAccrualRef)"), true);
    assert.equal(settlement.includes("tx.get(economyRef)"), true);
    assert.equal(settlement.includes("tx.get(overrideRef)"), true);
    assert.equal(settlement.includes(".where("), false);
    assert.equal(settlement.includes(".list("), false);
    assert.equal(settlement.includes("AGENCY_MONTHLY_ACCRUAL_SHARDS"), true);
  }
});


test("Stage 09-A surplus snapshot adds no Gift hot-path policy reads", () => {
  for (const relativePath of [
    "../../cloudflare-worker/src/room-gift.js",
    "../../cloudflare-worker/src/chat-safety-actions.js",
  ]) {
    const sourceText = source(relativePath);
    assert.equal(sourceText.includes("targetThresholdCoins"), true);
    assert.equal(sourceText.includes("surplusToShadow"), false);
    assert.equal(sourceText.includes('agency_policy_overrides/'), false);
  }
});


test("Stage 09-B surplus settlement stays bounded paginated and off Gift hot path", () => {
  for (const relativePath of [
    "../economy/economy-control.js",
    "../../cloudflare-worker/src/legacy-economy/economy-control.js",
  ]) {
    const sourceText = source(relativePath);
    const start = sourceText.indexOf("const AGENCY_SURPLUS_PAGE_MAX=25");
    const end = sourceText.indexOf("export async function handler", start);
    const settlement = sourceText.slice(start, end);
    assert.equal(start >= 0, true);
    assert.equal(settlement.includes("const AGENCY_SURPLUS_PAGE_MAX=25"), true);
    assert.equal(settlement.includes('"surplusPageKey"'), true);
    assert.equal(settlement.includes('.orderBy("surplusPageKey","asc")'), true);
    assert.equal(settlement.includes(".limit(pageSize+1)"), true);
    assert.equal(settlement.includes(".list("), false);
    assert.equal(settlement.includes('collection("agency_surplus_policy_snapshots")'), true);
    assert.equal(settlement.includes('collection("agency_surplus_settlements")'), true);
    assert.equal(settlement.includes('hostSalaryRepaidAtMonthEnd:false'), true);
    assert.equal(settlement.includes('collection("users").where'), false);
  }

  for (const relativePath of [
    "../../cloudflare-worker/src/room-gift.js",
    "../../cloudflare-worker/src/chat-safety-actions.js",
  ]) {
    const gift = source(relativePath);
    assert.equal(gift.includes("surplusPageKey"), true);
    assert.equal(gift.includes("agency_surplus_settlements/"), false);
    assert.equal(gift.includes("agency_surplus_policy_snapshots/"), false);
  }
});


test("Stage 09-C surplus replay hardening adds no extra IO or scans", () => {
  for (const relativePath of [
    "../economy/economy-control.js",
    "../../cloudflare-worker/src/legacy-economy/economy-control.js",
  ]) {
    const sourceText = source(relativePath);
    const start = sourceText.indexOf("const AGENCY_SURPLUS_PAGE_MAX=25");
    const end = sourceText.indexOf("export async function handler", start);
    const settlement = sourceText.slice(start, end);
    assert.equal(start >= 0, true);
    assert.equal(settlement.includes("validateFrozenAgencySurplusPolicy"), true);
    assert.equal(settlement.includes("calculateAgencyMonthEndSurplusFromSnapshot"), true);
    assert.equal(settlement.includes("agency_surplus_policy_snapshot_conflict"), true);
    assert.equal(settlement.includes("agency_surplus_settlement_conflict"), true);
    assert.equal(settlement.includes("agency_surplus_ledger_conflict"), true);
    assert.equal(settlement.includes(".list("), false);
    assert.equal(settlement.includes(".limit(pageSize+1)"), true);
    assert.equal(settlement.includes("AGENCY_SURPLUS_PAGE_MAX=25"), true);
  }
});


test("Stage 09-C surplus replay stays bounded and uses no extra scans", () => {
  for (const relativePath of [
    "../economy/economy-control.js",
    "../../cloudflare-worker/src/legacy-economy/economy-control.js",
  ]) {
    const sourceText = source(relativePath);
    const start = sourceText.indexOf("const AGENCY_SURPLUS_PAGE_MAX=25");
    const end = sourceText.indexOf("export async function handler", start);
    const settlement = sourceText.slice(start, end);
    assert.equal(start >= 0, true);
    assert.equal(settlement.includes("assertAgencyHostSurplusReplay"), true);
    assert.equal(settlement.includes("validateFrozenAgencySurplusPolicy"), true);
    assert.equal(settlement.includes(".list("), false);
    assert.equal(settlement.includes('collection("users").where'), false);
    assert.equal(settlement.includes(".limit(pageSize+1)"), true);
    assert.equal(settlement.includes("AGENCY_SURPLUS_PAGE_MAX=25"), true);
  }
});
