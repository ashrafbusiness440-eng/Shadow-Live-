import assert from "node:assert/strict";
import fs from "node:fs";
import { after, test } from "node:test";
import { deleteApp, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

import {
  PUBLIC_ARCHIVE_MONTHS_MAX,
  PUBLIC_RANKING_MAX,
  loadPublicAgencyArchive,
  loadPublicAgencyRanking,
} from "../../cloudflare-worker/src/agency-public.js";
import { agencyPublicRankingKey } from "../../cloudflare-worker/src/agency-policy.js";
import { cloudflareFirestoreAdapter } from "./helpers/cloudflare-firestore-adapter.js";

const app = initializeApp(
  { projectId: "shadow-live-economy-test" },
  "agency-stage10b-" + Date.now(),
);
const adminDb = getFirestore(app);
const db = cloudflareFirestoreAdapter(adminDb);
const now = new Date("2026-09-29T12:00:00.000Z");

after(async () => {
  await deleteApp(app);
});

function user(uid, publicId, displayName) {
  return {
    uid,
    publicId,
    displayName,
    profileImageUrl: "https://example.invalid/" + uid + ".webp",
  };
}

test("10-B Top 10 ranks by public supportCoins, not Host financial share", async () => {
  const agencyId = "741201";
  const hostA = "rank_host_a";
  const hostB = "rank_host_b";
  const hostC = "rank_host_c";

  await Promise.all([
    adminDb.collection("agencies").doc(agencyId).set({
      agencyId,
      publicId: agencyId,
      name: "Ranking Agency",
      ownerUid: "rank_owner",
      status: "active",
    }),
    adminDb.collection("users").doc(hostA).set(
      user(hostA, "810001", "Host A"),
    ),
    adminDb.collection("users").doc(hostB).set(
      user(hostB, "810002", "Host B"),
    ),
    adminDb.collection("users").doc(hostC).set(
      user(hostC, "810003", "Host C"),
    ),
    adminDb.collection("agency_host_monthly")
      .doc(agencyId + "__2026-09__" + hostA)
      .set({
        agencyId,
        month: "2026-09",
        hostUid: hostA,
        publicRankingKey: agencyPublicRankingKey({
          agencyId,
          month: "2026-09",
          hostUid: hostA,
          supportCoins: 300000,
        }),
        supportCoins: 300000,
        hostShareCoins: 1,
        targetId: "private_target",
      }),
    adminDb.collection("agency_host_monthly")
      .doc(agencyId + "__2026-09__" + hostB)
      .set({
        agencyId,
        month: "2026-09",
        hostUid: hostB,
        publicRankingKey: agencyPublicRankingKey({
          agencyId,
          month: "2026-09",
          hostUid: hostB,
          supportCoins: 100000,
        }),
        supportCoins: 100000,
        hostShareCoins: 999999999,
        targetId: "private_target",
      }),
    adminDb.collection("agency_host_monthly")
      .doc(agencyId + "__2026-09__" + hostC)
      .set({
        agencyId,
        month: "2026-09",
        hostUid: hostC,
        publicRankingKey: agencyPublicRankingKey({
          agencyId,
          month: "2026-09",
          hostUid: hostC,
          supportCoins: 200000,
        }),
        supportCoins: 200000,
        hostShareCoins: 888888888,
        targetId: "private_target",
      }),
  ]);

  const result = await loadPublicAgencyRanking(
    db,
    { agencyId },
    now,
  );

  assert.equal(result.month, "2026-09");
  assert.equal(result.currentMonth, "2026-09");
  assert.deepEqual(
    result.top10.map((entry) => entry.uid),
    [hostA, hostC, hostB],
  );
  assert.deepEqual(
    result.top10.map((entry) => entry.rank),
    [1, 2, 3],
  );
  assert.deepEqual(
    result.top10.map((entry) => entry.supportCoins),
    [300000, 200000, 100000],
  );
  for (const entry of result.top10) {
    assert.equal("hostShareCoins" in entry, false);
    assert.equal("targetId" in entry, false);
    assert.equal("salaryPaidDiamonds" in entry, false);
  }
});

test("10-B Monthly Archive reads only the six closed activity months directly", async () => {
  const agencyId = "741202";
  await Promise.all([
    adminDb.collection("agencies").doc(agencyId).set({
      agencyId,
      publicId: agencyId,
      name: "Archive Agency",
      ownerUid: "archive_owner",
      status: "active",
    }),
    adminDb.collection("agency_support_stats").doc(agencyId)
      .collection("monthly").doc("2026-08").set({ supportCoins: 1 }),
    adminDb.collection("agency_support_stats").doc(agencyId)
      .collection("monthly").doc("2026-06").set({ supportCoins: 1 }),
    adminDb.collection("agency_support_stats").doc(agencyId)
      .collection("monthly").doc("2026-01").set({ supportCoins: 1 }),
  ]);

  const result = await loadPublicAgencyArchive(
    db,
    { agencyId },
    now,
  );

  assert.equal(result.currentMonth, "2026-09");
  assert.equal(result.maxMonths, 6);
  assert.deepEqual(result.months, ["2026-08", "2026-06"]);
  assert.equal(result.months.includes("2026-01"), false);
});

test("10-B pressure contract keeps ranking query at 10 and profile reads at max 4 concurrent", async () => {
  const agencyId = "741203";
  const calls = {
    gets: [],
    queries: [],
    writes: 0,
    activeUserGets: 0,
    maxActiveUserGets: 0,
  };
  const rows = Array.from({ length: PUBLIC_RANKING_MAX }, (_, index) => ({
    id: agencyId + "__2026-09__host_" + index,
    data: {
      agencyId,
      month: "2026-09",
      hostUid: "host_" + index,
      publicRankingKey: agencyPublicRankingKey({
        agencyId,
        month: "2026-09",
        hostUid: "host_" + index,
        supportCoins: 1000000 - index,
      }),
      supportCoins: 1000000 - index,
      hostShareCoins: 999999999,
    },
  }));

  const fakeDb = {
    async get(path) {
      calls.gets.push(path);
      if (path === "agencies/" + agencyId) {
        return {
          exists: true,
          data: {
            agencyId,
            ownerUid: "owner",
            status: "active",
          },
        };
      }
      if (path.startsWith("users/")) {
        calls.activeUserGets += 1;
        calls.maxActiveUserGets = Math.max(
          calls.maxActiveUserGets,
          calls.activeUserGets,
        );
        await new Promise((resolve) => setTimeout(resolve, 1));
        calls.activeUserGets -= 1;
        const uid = path.replace("users/", "");
        return {
          exists: true,
          data: user(uid, "820000", uid),
        };
      }
      throw new Error("unexpected_get_" + path);
    },
    async runQuery(collectionPath, options) {
      calls.queries.push({ collectionPath, options });
      return rows;
    },
    async commit() {
      calls.writes += 1;
      throw new Error("unexpected_write");
    },
  };

  const result = await loadPublicAgencyRanking(
    fakeDb,
    { agencyId, month: "2026-09" },
    now,
  );

  assert.equal(result.top10.length, PUBLIC_RANKING_MAX);
  assert.equal(calls.queries.length, 1);
  assert.equal(calls.queries[0].collectionPath, "agency_host_monthly");
  assert.equal(calls.queries[0].options.limit, PUBLIC_RANKING_MAX);
  const prefix = agencyId + "__2026-09__";
  assert.deepEqual(calls.queries[0].options.filters, [
    {
      field: "publicRankingKey",
      op: ">=",
      value: prefix,
    },
    {
      field: "publicRankingKey",
      op: "<",
      value: prefix + "\uf8ff",
    },
  ]);
  assert.deepEqual(calls.queries[0].options.orderBy, [
    { field: "publicRankingKey", direction: "asc" },
  ]);
  assert.ok(calls.maxActiveUserGets <= 4);
  assert.equal(calls.writes, 0);
});

test("10-B archive pressure contract is six direct reads with max 3 concurrent and no query", async () => {
  const agencyId = "741204";
  const calls = {
    gets: [],
    queries: 0,
    writes: 0,
    activeArchiveGets: 0,
    maxActiveArchiveGets: 0,
  };

  const fakeDb = {
    async get(path) {
      calls.gets.push(path);
      if (path === "agencies/" + agencyId) {
        return {
          exists: true,
          data: {
            agencyId,
            ownerUid: "owner",
            status: "active",
          },
        };
      }
      if (path.startsWith("agency_support_stats/")) {
        calls.activeArchiveGets += 1;
        calls.maxActiveArchiveGets = Math.max(
          calls.maxActiveArchiveGets,
          calls.activeArchiveGets,
        );
        await new Promise((resolve) => setTimeout(resolve, 1));
        calls.activeArchiveGets -= 1;
        return {
          exists: path.endsWith("/2026-08"),
          data: {},
        };
      }
      throw new Error("unexpected_get_" + path);
    },
    async runQuery() {
      calls.queries += 1;
      throw new Error("archive_query_forbidden");
    },
    async commit() {
      calls.writes += 1;
      throw new Error("unexpected_write");
    },
  };

  const result = await loadPublicAgencyArchive(
    fakeDb,
    { agencyId },
    now,
  );

  assert.deepEqual(result.months, ["2026-08"]);
  assert.equal(
    calls.gets.filter(
      (path) => path.startsWith("agency_support_stats/"),
    ).length,
    PUBLIC_ARCHIVE_MONTHS_MAX,
  );
  assert.ok(calls.maxActiveArchiveGets <= 3);
  assert.equal(calls.queries, 0);
  assert.equal(calls.writes, 0);
});

test("10-B rejects ranking months outside current plus six-month archive window before query", async () => {
  const agencyId = "741205";
  let queries = 0;
  const fakeDb = {
    async get(path) {
      assert.equal(path, "agencies/" + agencyId);
      return {
        exists: true,
        data: {
          agencyId,
          ownerUid: "owner",
          status: "active",
        },
      };
    },
    async runQuery() {
      queries += 1;
      return [];
    },
  };

  await assert.rejects(
    () => loadPublicAgencyRanking(
      fakeDb,
      { agencyId, month: "2026-01" },
      now,
    ),
    (error) => error && error.message === "agency_ranking_month_out_of_range",
  );
  assert.equal(queries, 0);
});

test("10-B ranking is single-field indexless and adds no Gift write operation", () => {
  const config = JSON.parse(
    fs.readFileSync("firestore.indexes.json", "utf8"),
  );
  assert.deepEqual(config.indexes || [], []);

  const high = agencyPublicRankingKey({
    agencyId: "741299",
    month: "2026-09",
    hostUid: "host_high",
    supportCoins: 900000,
  });
  const low = agencyPublicRankingKey({
    agencyId: "741299",
    month: "2026-09",
    hostUid: "host_low",
    supportCoins: 100000,
  });
  assert.ok(high < low, "higher support must sort first lexicographically");

  for (const path of [
    "cloudflare-worker/src/room-gift.js",
    "cloudflare-worker/src/chat-safety-actions.js",
  ]) {
    const source = fs.readFileSync(path, "utf8");
    assert.equal(source.includes("publicRankingKey: agencyPublicRankingKey({"), true);
    assert.equal(
      (source.match(/agency_host_monthly\//g) || []).length,
      1,
      "ranking must reuse the existing agency_host_monthly write",
    );
    assert.equal(source.includes("agency_public_rankings/"), false);
  }
});
