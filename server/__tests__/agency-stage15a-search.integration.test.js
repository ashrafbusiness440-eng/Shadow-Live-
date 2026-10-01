import assert from "node:assert/strict";
import { after, test } from "node:test";
import { readFileSync } from "node:fs";
import { deleteApp, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

import {
  PUBLIC_AGENCY_DISCOVERY_WINDOW,
  PUBLIC_AGENCY_SEARCH_MAX,
  browsePublicAgencies,
  searchPublicAgencies,
} from "../../cloudflare-worker/src/agency-public.js";
import { cloudflareFirestoreAdapter } from "./helpers/cloudflare-firestore-adapter.js";

const app = initializeApp(
  { projectId: "shadow-live-economy-test" },
  "agency-stage15a-" + Date.now(),
);
const adminDb = getFirestore(app);
const db = cloudflareFirestoreAdapter(adminDb);

after(async () => deleteApp(app));

async function seed(
  id,
  name,
  country,
  status = "active",
  { topValue = 0, memberCount = 3, hostCount = 2 } = {},
) {
  await adminDb.collection("agencies").doc(id).set({
    agencyId: id,
    publicId: id,
    name,
    country,
    status,
    memberCount,
    hostCount,
    publicTopValue: topValue,
    logoUrl: "https://example.invalid/" + id + ".webp",
  });
}

test("15-A Agency ID search stays direct and hides inactive agencies", async () => {
  await seed("815001", "Shadow One", "UAE");
  await seed("815002", "Shadow Closed", "UAE", "closed");
  const active = await searchPublicAgencies(db, { query: "815001" });
  const closed = await searchPublicAgencies(db, { query: "815002" });
  assert.equal(active.results.length, 1);
  assert.equal(active.results[0].agencyId, "815001");
  assert.equal(active.results[0].logoUrl.includes("815001"), true);
  assert.deepEqual(closed.results, []);
});

test("15-A name search supports substring, case, spaces and Arabic normalization", async () => {
  await Promise.all([
    seed("815011", "Stage15A Alpha Agency", "Stage15A-Syria"),
    seed("815012", "stage15a alpha CLUB", "Stage15A-Syria"),
    seed("815013", "Stage15A Alpha Closed", "Stage15A-Syria", "suspended"),
    seed("815014", "وكالة أكاديمية شادو", "الباشان"),
  ]);

  const substring = await searchPublicAgencies(db, {
    mode: "name",
    query: " 15A   ALPHA ",
    limit: PUBLIC_AGENCY_SEARCH_MAX,
  });
  assert.deepEqual(
    substring.results.map((row) => row.agencyId).sort(),
    ["815011", "815012"],
  );

  const arabic = await searchPublicAgencies(db, {
    mode: "name",
    query: "اكاديمية",
    limit: PUBLIC_AGENCY_SEARCH_MAX,
  });
  assert.deepEqual(
    arabic.results.map((row) => row.agencyId),
    ["815014"],
  );
});

test("15-A country search and browse preserve Top Agencies ordering with bounded load more", async () => {
  await Promise.all([
    seed("815021", "Top A", "Stage15A-Top", "active", {
      topValue: 900,
      memberCount: 5,
    }),
    seed("815022", "Top B", "Stage15A-Top", "active", {
      topValue: 900,
      memberCount: 9,
    }),
    seed("815023", "Top C", "Stage15A-Top", "active", {
      topValue: 500,
      memberCount: 99,
    }),
  ]);

  const country = await searchPublicAgencies(db, {
    mode: "country",
    query: "Stage15A-Top",
    limit: 2,
  });
  assert.deepEqual(
    country.results.map((row) => row.agencyId),
    ["815022", "815021"],
  );
  assert.deepEqual(
    country.results.map((row) => row.rank),
    [1, 2],
  );
  assert.equal(country.page.hasMore, true);

  const next = await searchPublicAgencies(db, {
    mode: "country",
    query: "Stage15A-Top",
    limit: 2,
    cursor: country.page.nextCursor,
  });
  assert.deepEqual(
    next.results.map((row) => row.agencyId),
    ["815023"],
  );

  const browse = await browsePublicAgencies(db, { limit: 1 });
  assert.equal(browse.results.length, 1);
  assert.ok(browse.page.limit <= PUBLIC_AGENCY_SEARCH_MAX);
});

test("15-A pressure guard keeps discovery bounded and isolated from Gift/Room", () => {
  const source = readFileSync(
    new URL("../../cloudflare-worker/src/agency-public.js", import.meta.url),
    "utf8",
  );
  assert.equal(
    source.includes("limit: PUBLIC_AGENCY_DISCOVERY_WINDOW + 1"),
    true,
  );
  assert.ok(PUBLIC_AGENCY_DISCOVERY_WINDOW <= 100);
  assert.equal(source.includes("while ("), false);
  const start = source.indexOf("async function discoveryRows");
  const end = source.indexOf("function previousAgencyMonths");
  const segment = source.slice(start, end);
  assert.ok(start >= 0 && end > start);
  assert.equal(segment.includes("notifications/"), false);
  assert.equal(segment.includes("gift"), false);
  assert.equal(segment.includes("room"), false);
});
