import assert from "node:assert/strict";
import { after, test } from "node:test";
import { readFileSync } from "node:fs";
import { deleteApp, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

import {
  PUBLIC_AGENCY_SEARCH_MAX,
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

async function seed(id, name, country, status = "active") {
  await adminDb.collection("agencies").doc(id).set({
    agencyId: id,
    publicId: id,
    name,
    country,
    status,
    memberCount: 3,
    hostCount: 2,
  });
}

test("15-A Agency ID search is one direct read and hides inactive agencies", async () => {
  await seed("815001", "Shadow One", "UAE");
  await seed("815002", "Shadow Closed", "UAE", "closed");
  const active = await searchPublicAgencies(db, { query: "815001" });
  const closed = await searchPublicAgencies(db, { query: "815002" });
  assert.equal(active.results.length, 1);
  assert.equal(active.results[0].agencyId, "815001");
  assert.deepEqual(closed.results, []);
});

test("15-A name and country searches are bounded and cursor-paginated", async () => {
  await Promise.all([
    seed("815011", "Alpha Agency", "Syria"),
    seed("815012", "Alpha Club", "Syria"),
    seed("815013", "Alpha Closed", "Syria", "suspended"),
    seed("815014", "Beta Agency", "UAE"),
  ]);
  const first = await searchPublicAgencies(db, {
    mode: "name",
    query: "Alpha",
    limit: 1,
  });
  assert.equal(first.results.length, 1);
  assert.equal(first.page.hasMore, true);
  assert.ok(first.page.nextCursor);
  const second = await searchPublicAgencies(db, {
    mode: "name",
    query: "Alpha",
    limit: 1,
    cursor: first.page.nextCursor,
  });
  assert.equal(second.results.length, 1);
  assert.notEqual(second.results[0].agencyId, first.results[0].agencyId);

  const country = await searchPublicAgencies(db, {
    mode: "country",
    query: "Syria",
    limit: PUBLIC_AGENCY_SEARCH_MAX,
  });
  assert.deepEqual(
    country.results.map((row) => row.agencyId).sort(),
    ["815011", "815012"],
  );
});

test("15-A pressure guard keeps search bounded and isolated from Gift/Room", () => {
  const source = readFileSync(
    new URL("../../cloudflare-worker/src/agency-public.js", import.meta.url),
    "utf8",
  );
  const start = source.indexOf("export async function searchPublicAgencies");
  const end = source.indexOf("export async function loadPublicAgencyPage");
  const segment = source.slice(start, end);
  assert.ok(start >= 0 && end > start);
  assert.equal(segment.includes("const fetchLimit = Math.min(81"), true);
  assert.equal(segment.includes("PUBLIC_AGENCY_SEARCH_MAX"), true);
  assert.equal(segment.includes("while ("), false);
  assert.equal(segment.includes("notifications/"), false);
  assert.equal(segment.includes("gift"), false);
  assert.equal(segment.includes("room"), false);
});
