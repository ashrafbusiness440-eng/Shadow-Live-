import assert from "node:assert/strict";
import { after, test } from "node:test";
import { deleteApp, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

import {
  PUBLIC_HOST_PAGE_MAX,
  loadPublicAgencyPage,
} from "../../cloudflare-worker/src/agency-public.js";
import { cloudflareFirestoreAdapter } from "./helpers/cloudflare-firestore-adapter.js";

const app = initializeApp(
  { projectId: "shadow-live-economy-test" },
  "agency-stage10a-" + Date.now(),
);
const adminDb = getFirestore(app);
const db = cloudflareFirestoreAdapter(adminDb);

after(async () => {
  await deleteApp(app);
});

function user(uid, publicId, displayName) {
  return {
    uid,
    publicId,
    displayName,
    profileImageUrl: "https://example.invalid/" + uid + ".webp",
    role: "user",
    accountStatus: "active",
  };
}

test("10-A public agency page paginates active Hosts only", async () => {
  const agencyId = "731204";
  const ownerUid = "stage10a_owner";
  const hostUids = Array.from(
    { length: 27 },
    (_, index) => "stage10a_host_" + String(index).padStart(2, "0"),
  );
  const managerUid = "stage10a_manager";
  const inactiveHostUid = "stage10a_inactive";

  const writes = [
    adminDb.collection("agencies").doc(agencyId).set({
      agencyId,
      publicId: agencyId,
      name: "Stage 10 Agency",
      country: "AE",
      ownerUid,
      status: "active",
      memberCount: 30,
      hostCount: hostUids.length,
      managerCount: 1,
      seniorManagerCount: 0,
    }),
    adminDb.collection("users").doc(ownerUid).set(
      user(ownerUid, "900001", "Agency Owner"),
    ),
    adminDb.collection("users").doc(managerUid).set(
      user(managerUid, "900002", "Manager"),
    ),
    adminDb.collection("users").doc(inactiveHostUid).set(
      user(inactiveHostUid, "900003", "Inactive Host"),
    ),
    adminDb.collection("agency_memberships").doc(
      agencyId + "__" + ownerUid,
    ).set({
      agencyId,
      uid: ownerUid,
      role: "owner",
      status: "active",
      joinedAt: new Date("2026-09-01T00:00:00.000Z"),
    }),
    adminDb.collection("agency_memberships").doc(
      agencyId + "__" + managerUid,
    ).set({
      agencyId,
      uid: managerUid,
      role: "manager",
      status: "active",
      joinedAt: new Date("2026-09-02T00:00:00.000Z"),
    }),
    adminDb.collection("agency_memberships").doc(
      agencyId + "__" + inactiveHostUid,
    ).set({
      agencyId,
      uid: inactiveHostUid,
      role: "host",
      status: "removed",
      joinedAt: new Date("2026-09-03T00:00:00.000Z"),
    }),
  ];
  for (let index = 0; index < hostUids.length; index += 1) {
    const uid = hostUids[index];
    writes.push(
      adminDb.collection("users").doc(uid).set(
        user(uid, String(910000 + index), "Host " + index),
      ),
    );
    writes.push(
      adminDb.collection("agency_memberships").doc(
        agencyId + "__" + uid,
      ).set({
        agencyId,
        uid,
        role: "host",
        status: "active",
        joinedAt: new Date("2026-09-10T00:00:00.000Z"),
      }),
    );
  }
  await Promise.all(writes);

  const collected = [];
  let cursor = null;
  let pages = 0;
  while (pages < 10) {
    const result = await loadPublicAgencyPage(db, {
      agencyId,
      cursor,
      limit: 7,
    });
    pages += 1;
    assert.equal(result.agency.name, "Stage 10 Agency");
    assert.equal(result.owner.uid, ownerUid);
    assert.ok(result.hosts.length <= 7);
    collected.push(...result.hosts.map((entry) => entry.uid));
    if (!result.page.hasMore) break;
    cursor = result.page.nextCursor;
    assert.ok(cursor);
  }

  assert.ok(pages > 1);
  assert.deepEqual([...new Set(collected)].sort(), [...hostUids].sort());
  assert.equal(collected.includes(managerUid), false);
  assert.equal(collected.includes(inactiveHostUid), false);
  assert.equal(new Set(collected).size, collected.length);
});

test("10-A pressure contract caps the query at 25 and performs no writes", async () => {
  const agencyId = "731205";
  const ownerUid = "pressure_owner";
  const calls = { gets: [], queries: [], writes: 0 };
  const rows = Array.from(
    { length: PUBLIC_HOST_PAGE_MAX + 1 },
    (_, index) => {
      const uid = "pressure_host_" + String(index).padStart(2, "0");
      return {
        id: agencyId + "__" + uid,
        data: {
          agencyId,
          uid,
          role: "host",
          status: "active",
          joinedAt: null,
        },
      };
    },
  );

  const fakeDb = {
    async get(path) {
      calls.gets.push(path);
      if (path === "agencies/" + agencyId) {
        return {
          exists: true,
          data: {
            agencyId,
            publicId: agencyId,
            name: "Pressure Agency",
            ownerUid,
            status: "active",
            memberCount: 26,
            hostCount: 25,
          },
        };
      }
      if (path === "users/" + ownerUid) {
        return {
          exists: true,
          data: user(ownerUid, "920001", "Pressure Owner"),
        };
      }
      const uid = path.replace("users/", "");
      return { exists: true, data: user(uid, "920000", uid) };
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

  const result = await loadPublicAgencyPage(fakeDb, {
    agencyId,
    limit: 999,
  });

  assert.equal(result.hosts.length, PUBLIC_HOST_PAGE_MAX);
  assert.equal(result.page.hasMore, true);
  assert.equal(calls.queries.length, 1);
  assert.equal(calls.queries[0].collectionPath, "agency_memberships");
  assert.equal(calls.queries[0].options.limit, PUBLIC_HOST_PAGE_MAX + 1);
  assert.deepEqual(calls.queries[0].options.orderBy, [
    { field: "__name__", direction: "asc" },
  ]);
  assert.equal(
    calls.queries[0].options.filters.every(
      (filter) => filter.field === "__name__" && filter.referencePath,
    ),
    true,
  );
  assert.equal(calls.writes, 0);
  assert.equal(
    calls.gets.filter((path) => path.startsWith("users/")).length,
    PUBLIC_HOST_PAGE_MAX + 1,
  );
});

test("10-A non-active agency fails closed before the members query", async () => {
  const fakeDb = {
    async get(path) {
      assert.equal(path, "agencies/731206");
      return {
        exists: true,
        data: {
          agencyId: "731206",
          status: "suspended",
          ownerUid: "owner",
        },
      };
    },
    async runQuery() {
      throw new Error("query_should_not_run");
    },
  };

  await assert.rejects(
    () => loadPublicAgencyPage(fakeDb, { agencyId: "731206" }),
    (error) => error && error.message === "agency_unavailable",
  );
});
