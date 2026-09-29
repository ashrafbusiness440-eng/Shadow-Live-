import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
  loadAgencyOwnerPerformance,
  loadAgencyOwnerStatement,
} from "../../cloudflare-worker/src/agency-owner.js";

function snapshot(data = null) {
  return data == null
    ? { exists: false, data: null }
    : { exists: true, data };
}

function fakeDbForOwner({
  uid = "stage12b_owner",
  agencyId = "812002",
  statement = null,
} = {}) {
  const calls = { gets: [], queries: 0, writes: 0 };
  const records = new Map([
    [
      "agency_user_memberships/" + uid,
      {
        agencyId,
        uid,
        role: "owner",
        status: "active",
      },
    ],
    [
      "agencies/" + agencyId,
      {
        agencyId,
        ownerUid: uid,
        name: "Stage 12-B Agency",
        status: "active",
      },
    ],
    [
      "agency_support_stats/" + agencyId + "/monthly/2026-09",
      {
        supportCoins: 1000000,
        hostEarningCoins: 570000,
        agencyEarningCoins: 60000,
        platformShareCoins: 370000,
        giftCount: 25,
        activeHostCount: 10,
      },
    ],
    [
      "agency_wallets/" + agencyId,
      {
        diamonds: 42,
        remainderCoins: 3500,
        lifetimeDiamonds: 90,
      },
    ],
    [
      "system_config/gift_economy",
      {
        enabled: true,
        coinsPerDiamond: 10000,
        agencyPerformanceBonusBps: 200,
        agencyBonusActiveHosts: 10,
      },
    ],
    [
      "agency_policy_overrides/" + agencyId,
      {
        agencyId,
        agencyPerformanceBonusBps: 150,
        agencyBonusActiveHosts: 8,
      },
    ],
  ]);
  if (statement) {
    records.set(
      "agency_monthly_statements/" + agencyId + "__2026-08",
      statement,
    );
  }

  return {
    calls,
    db: {
      async get(path) {
        calls.gets.push(path);
        return snapshot(records.get(path));
      },
      async runQuery() {
        calls.queries += 1;
        throw new Error("unexpected_query");
      },
      async commit() {
        calls.writes += 1;
        throw new Error("unexpected_write");
      },
    },
  };
}

test("12-B owner performance uses exactly six direct reads and no query/write", async () => {
  const { db, calls } = fakeDbForOwner();
  const result = await loadAgencyOwnerPerformance(
    db,
    "stage12b_owner",
    new Date("2026-09-29T18:30:00.000Z"),
  );

  assert.equal(result.ok, true);
  assert.equal(result.agencyId, "812002");
  assert.equal(result.current.month, "2026-09");
  assert.equal(result.current.supportCoins, 1000000);
  assert.equal(result.current.agencyBaseShareCoins, 60000);
  assert.equal(result.current.activeHostCount, 10);
  assert.equal(result.current.bonus.eligible, true);
  assert.equal(result.current.bonus.requiredActiveHosts, 8);
  assert.equal(result.current.bonus.bps, 150);
  assert.equal(result.current.bonus.estimatedCoins, 15000);
  assert.equal(result.current.wallet.diamonds, 42);
  assert.equal(result.current.wallet.remainderCoins, 3500);
  assert.equal(result.policy.source, "agency_override");

  assert.deepEqual(calls.gets, [
    "agency_user_memberships/stage12b_owner",
    "agencies/812002",
    "agency_support_stats/812002/monthly/2026-09",
    "agency_wallets/812002",
    "system_config/gift_economy",
    "agency_policy_overrides/812002",
  ]);
  assert.equal(calls.queries, 0);
  assert.equal(calls.writes, 0);
});

test("12-B closed-month statement is lazy and uses three direct reads only", async () => {
  const { db, calls } = fakeDbForOwner({
    statement: {
      agencyId: "812002",
      month: "2026-08",
      status: "settled",
      supportCoins: 2000000,
      agencyBaseShareCoins: 120000,
      agencyBonusCoins: 40000,
      agencyPayableCoins: 160000,
      agencyDiamonds: 16,
      agencyRemainderCoins: 3500,
      agencyActiveHostCount: 12,
      agencyRequiredActiveHosts: 10,
      agencyBonusEligible: true,
      agencyBonusBps: 200,
      giftCount: 80,
    },
  });

  const result = await loadAgencyOwnerStatement(
    db,
    "stage12b_owner",
    "2026-08",
    new Date("2026-09-29T18:30:00.000Z"),
  );

  assert.equal(result.ok, true);
  assert.equal(result.settled, true);
  assert.equal(result.statement.agencyPayableCoins, 160000);
  assert.equal(result.statement.agencyDiamonds, 16);
  assert.deepEqual(calls.gets, [
    "agency_user_memberships/stage12b_owner",
    "agencies/812002",
    "agency_monthly_statements/812002__2026-08",
  ]);
  assert.equal(calls.queries, 0);
  assert.equal(calls.writes, 0);
});

test("12-B owner finance read model denies non-owner membership", async () => {
  const calls = { gets: [], queries: 0, writes: 0 };
  const db = {
    async get(path) {
      calls.gets.push(path);
      if (path === "agency_user_memberships/stage12b_manager") {
        return snapshot({
          agencyId: "812002",
          uid: "stage12b_manager",
          role: "manager",
          status: "active",
        });
      }
      throw new Error("unexpected_get:" + path);
    },
    async runQuery() {
      calls.queries += 1;
      throw new Error("unexpected_query");
    },
    async commit() {
      calls.writes += 1;
      throw new Error("unexpected_write");
    },
  };

  await assert.rejects(
    loadAgencyOwnerPerformance(
      db,
      "stage12b_manager",
      new Date("2026-09-29T18:30:00.000Z"),
    ),
    /agency_owner_required/,
  );
  assert.deepEqual(calls.gets, [
    "agency_user_memberships/stage12b_manager",
  ]);
  assert.equal(calls.queries, 0);
  assert.equal(calls.writes, 0);
});

test("12-B statement rejects current month before finance reads", async () => {
  const { db, calls } = fakeDbForOwner();
  await assert.rejects(
    loadAgencyOwnerStatement(
      db,
      "stage12b_owner",
      "2026-09",
      new Date("2026-09-29T18:30:00.000Z"),
    ),
    /agency_month_not_closed/,
  );
  assert.equal(calls.gets.length, 0);
});


test("12-B Flutter owner dashboard remains pressure-safe and lazy for statements", () => {
  const page = readFileSync(
    new URL("../../lib/features/agency/screens/owner_agency_dashboard_page.dart", import.meta.url),
    "utf8",
  );
  const service = readFileSync(
    new URL("../../lib/features/agency/services/owner_agency_service.dart", import.meta.url),
    "utf8",
  );

  assert.equal(page.includes("owner-agency-performance-card"), true);
  assert.equal(page.includes("owner-agency-load-statement"), true);
  assert.equal(page.includes("Future.microtask(_loadPerformance)"), true);
  assert.equal(page.includes("_loadPreviousStatement"), true);
  assert.equal(page.includes("Timer.periodic"), false);
  assert.equal(page.includes(".snapshots()"), false);
  assert.equal(page.includes("StreamBuilder"), false);
  assert.equal(page.includes("FirebaseFirestore"), false);
  assert.equal(service.includes("/agency-owner"), true);
  assert.equal(service.includes("'action': 'performance'"), true);
  assert.equal(service.includes("'action': 'statement'"), true);
});
