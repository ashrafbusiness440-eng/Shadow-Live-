import assert from "node:assert/strict";
import { after, test } from "node:test";
import { deleteApp, getApps, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

import {
  listAgencyMembers,
  setAgencyManagerRole,
} from "../../cloudflare-worker/src/agency-membership.js";
import { cloudflareFirestoreAdapter } from "./helpers/cloudflare-firestore-adapter.js";

const app = getApps()[0] || initializeApp({ projectId: "shadow-live-economy-test" });
const adminDb = getFirestore(app);
const db = cloudflareFirestoreAdapter(adminDb);

after(async () => { await deleteApp(app); });

async function seedUser(uid, publicId, extra = {}) {
  await adminDb.collection("users").doc(uid).set({
    role: "user",
    adminEnabled: false,
    capabilities: [],
    accountStatus: "active",
    agencyId: "",
    agencyRole: "",
    publicId,
    ...extra,
  });
}

function membershipDoc(agencyId, uid, role, now) {
  return {
    schemaVersion: 1,
    agencyId,
    uid,
    role,
    status: "active",
    joinedAt: now,
    updatedAt: now,
    leftAt: null,
    removedAt: null,
    cooldownUntil: null,
  };
}

async function seedAgencyWithHosts({
  agencyId,
  ownerUid,
  ownerPublicId,
  hosts,
}) {
  const now = new Date("2026-09-28T21:00:00.000Z");
  await seedUser(ownerUid, ownerPublicId, {
    agencyId,
    agencyRole: "owner",
    agencyJoinedAt: now,
  });
  const ownerMembership = membershipDoc(agencyId, ownerUid, "owner", now);

  await Promise.all([
    adminDb.collection("agencies").doc(agencyId).set({
      schemaVersion: 1,
      agencyId,
      publicId: agencyId,
      name: "Stage05C " + agencyId,
      ownerUid,
      status: "active",
      memberCount: 1 + hosts.length,
      hostCount: hosts.length,
      managerCount: 0,
      seniorManagerCount: 0,
      updatedAt: now,
    }),
    adminDb.collection("agency_memberships")
      .doc(agencyId + "__" + ownerUid).set(ownerMembership),
    adminDb.collection("agency_user_memberships")
      .doc(ownerUid).set(ownerMembership),
    adminDb.collection("agency_manager_slots").doc(agencyId).set({
      schemaVersion: 1,
      agencyId,
      seniorManagerUid: null,
      managerUids: [],
      updatedAt: now,
    }),
  ]);

  for (const [index, host] of hosts.entries()) {
    const joinedAt = new Date(now.getTime() + 1000 + index);
    await seedUser(host.uid, host.publicId, {
      agencyId,
      agencyRole: "host",
      agencyJoinedAt: joinedAt,
      displayName: host.name || host.uid,
    });
    const membership = membershipDoc(
      agencyId,
      host.uid,
      "host",
      joinedAt,
    );
    await Promise.all([
      adminDb.collection("agency_memberships")
        .doc(agencyId + "__" + host.uid).set(membership),
      adminDb.collection("agency_user_memberships")
        .doc(host.uid).set(membership),
    ]);
  }
}

test("Stage 05 closure preserves lifecycle, replay recovery, slots, counters, and surface", async () => {
  const agencyId = "751001";
  const ownerUid = "stage05c_owner_lifecycle";
  const managerUid = "stage05c_manager_lifecycle";
  const seniorUid = "stage05c_senior_lifecycle";
  const hostUid = "stage05c_host_lifecycle";
  await seedAgencyWithHosts({
    agencyId,
    ownerUid,
    ownerPublicId: "751901",
    hosts: [
      { uid: managerUid, publicId: "751101", name: "Manager Candidate" },
      { uid: seniorUid, publicId: "751102", name: "Senior Candidate" },
      { uid: hostUid, publicId: "751103", name: "Remaining Host" },
    ],
  });

  const managerBody = {
    agencyId,
    targetUid: managerUid,
    targetRole: "manager",
    idempotencyKey: "stage05c_lifecycle_manager_001",
  };
  const first = await setAgencyManagerRole(db, ownerUid, managerBody, {
    now: new Date("2026-09-28T21:10:00.000Z"),
  });
  const replay = await setAgencyManagerRole(db, ownerUid, managerBody, {
    now: new Date("2026-09-28T21:11:00.000Z"),
  });
  assert.equal(first.code, "ok");
  assert.equal(replay.code, "duplicate");

  await setAgencyManagerRole(db, ownerUid, {
    agencyId,
    targetUid: seniorUid,
    targetRole: "senior_manager",
    idempotencyKey: "stage05c_lifecycle_senior_001",
  }, {
    now: new Date("2026-09-28T21:12:00.000Z"),
  });

  let surface = await listAgencyMembers(db, ownerUid, {
    agencyId,
    limit: 999,
  });
  assert.equal(surface.limit, 50);
  assert.equal(surface.members.length, 4);
  assert.deepEqual(
    surface.members.map((member) => member.role),
    ["owner", "senior_manager", "manager", "host"],
  );
  assert.equal(surface.agency.memberCount, 4);
  assert.equal(surface.agency.hostCount, 1);
  assert.equal(surface.agency.managerCount, 1);
  assert.equal(surface.agency.seniorManagerCount, 1);
  assert.deepEqual(surface.managerSlots.managerUids, [managerUid]);
  assert.equal(surface.managerSlots.seniorManagerUid, seniorUid);

  await setAgencyManagerRole(db, ownerUid, {
    agencyId,
    targetUid: managerUid,
    targetRole: "host",
    idempotencyKey: "stage05c_lifecycle_demote_001",
  }, {
    now: new Date("2026-09-28T21:13:00.000Z"),
  });
  await setAgencyManagerRole(db, ownerUid, {
    agencyId,
    targetUid: hostUid,
    targetRole: "manager",
    idempotencyKey: "stage05c_lifecycle_replace_001",
  }, {
    now: new Date("2026-09-28T21:14:00.000Z"),
  });

  surface = await listAgencyMembers(db, ownerUid, {
    agencyId,
    limit: 25,
  });
  assert.equal(surface.agency.memberCount, 4);
  assert.equal(surface.agency.hostCount, 1);
  assert.equal(surface.agency.managerCount, 1);
  assert.equal(surface.agency.seniorManagerCount, 1);
  assert.deepEqual(surface.managerSlots.managerUids, [hostUid]);
  assert.equal(surface.managerSlots.seniorManagerUid, seniorUid);

  const [oldManager, newManager, senior] = await Promise.all([
    adminDb.collection("users").doc(managerUid).get(),
    adminDb.collection("users").doc(hostUid).get(),
    adminDb.collection("users").doc(seniorUid).get(),
  ]);
  assert.equal(oldManager.data().agencyRole, "host");
  assert.equal(newManager.data().agencyRole, "manager");
  assert.equal(senior.data().agencyRole, "senior_manager");
});

test("Stage 05 concurrent senior promotions serialize to exactly one winner", async () => {
  const agencyId = "752001";
  const ownerUid = "stage05c_owner_race";
  const leftUid = "stage05c_race_left";
  const rightUid = "stage05c_race_right";
  await seedAgencyWithHosts({
    agencyId,
    ownerUid,
    ownerPublicId: "752901",
    hosts: [
      { uid: leftUid, publicId: "752101" },
      { uid: rightUid, publicId: "752102" },
    ],
  });

  const results = await Promise.allSettled([
    setAgencyManagerRole(db, ownerUid, {
      agencyId,
      targetUid: leftUid,
      targetRole: "senior_manager",
      idempotencyKey: "stage05c_race_senior_left_001",
    }),
    setAgencyManagerRole(db, ownerUid, {
      agencyId,
      targetUid: rightUid,
      targetRole: "senior_manager",
      idempotencyKey: "stage05c_race_senior_right_001",
    }),
  ]);

  const fulfilled = results.filter((result) => result.status === "fulfilled");
  const rejected = results.filter((result) => result.status === "rejected");
  assert.equal(fulfilled.length, 1);
  assert.equal(rejected.length, 1);
  assert.match(
    String(rejected[0].reason?.message || rejected[0].reason),
    /agency_senior_manager_slot_full/,
  );

  const [agencySnap, slotsSnap, leftUser, rightUser] = await Promise.all([
    adminDb.collection("agencies").doc(agencyId).get(),
    adminDb.collection("agency_manager_slots").doc(agencyId).get(),
    adminDb.collection("users").doc(leftUid).get(),
    adminDb.collection("users").doc(rightUid).get(),
  ]);
  const winner = slotsSnap.data().seniorManagerUid;
  assert.equal([leftUid, rightUid].includes(winner), true);
  assert.equal(agencySnap.data().memberCount, 3);
  assert.equal(agencySnap.data().hostCount, 1);
  assert.equal(agencySnap.data().managerCount, 0);
  assert.equal(agencySnap.data().seniorManagerCount, 1);

  const roles = [leftUser.data().agencyRole, rightUser.data().agencyRole].sort();
  assert.deepEqual(roles, ["host", "senior_manager"].sort());

  const surface = await listAgencyMembers(db, ownerUid, {
    agencyId,
    limit: 25,
  });
  assert.equal(surface.agency.seniorManagerCount, 1);
  assert.equal(surface.managerSlots.seniorManagerUid, winner);
});

test("Stage 05 idempotency fingerprint rejects key reuse for a different role", async () => {
  const agencyId = "753001";
  const ownerUid = "stage05c_owner_idempotency";
  const hostUid = "stage05c_host_idempotency";
  await seedAgencyWithHosts({
    agencyId,
    ownerUid,
    ownerPublicId: "753901",
    hosts: [{ uid: hostUid, publicId: "753101" }],
  });

  const key = "stage05c_idempotency_conflict_001";
  await setAgencyManagerRole(db, ownerUid, {
    agencyId,
    targetUid: hostUid,
    targetRole: "manager",
    idempotencyKey: key,
  });

  await assert.rejects(
    setAgencyManagerRole(db, ownerUid, {
      agencyId,
      targetUid: hostUid,
      targetRole: "senior_manager",
      idempotencyKey: key,
    }),
    /idempotency_conflict/,
  );

  const [agencySnap, slotsSnap, userSnap] = await Promise.all([
    adminDb.collection("agencies").doc(agencyId).get(),
    adminDb.collection("agency_manager_slots").doc(agencyId).get(),
    adminDb.collection("users").doc(hostUid).get(),
  ]);
  assert.equal(agencySnap.data().hostCount, 0);
  assert.equal(agencySnap.data().managerCount, 1);
  assert.equal(agencySnap.data().seniorManagerCount, 0);
  assert.deepEqual(slotsSnap.data().managerUids, [hostUid]);
  assert.equal(slotsSnap.data().seniorManagerUid, null);
  assert.equal(userSnap.data().agencyRole, "manager");
});

test("Stage 05 management surface fails closed on counter drift and recovers after repair", async () => {
  const agencyId = "754001";
  const ownerUid = "stage05c_owner_recovery";
  const hostUid = "stage05c_host_recovery";
  await seedAgencyWithHosts({
    agencyId,
    ownerUid,
    ownerPublicId: "754901",
    hosts: [{ uid: hostUid, publicId: "754101" }],
  });

  await adminDb.collection("agencies").doc(agencyId).set({
    hostCount: 0,
    managerCount: 1,
  }, { merge: true });

  await assert.rejects(
    listAgencyMembers(db, ownerUid, { agencyId, limit: 25 }),
    /agency_counter_conflict/,
  );
  await assert.rejects(
    setAgencyManagerRole(db, ownerUid, {
      agencyId,
      targetUid: hostUid,
      targetRole: "manager",
      idempotencyKey: "stage05c_drift_blocked_001",
    }),
    /agency_counter_conflict/,
  );

  await adminDb.collection("agencies").doc(agencyId).set({
    hostCount: 1,
    managerCount: 0,
  }, { merge: true });

  const recovered = await listAgencyMembers(db, ownerUid, {
    agencyId,
    limit: 25,
  });
  assert.equal(recovered.members.length, 2);
  assert.equal(recovered.agency.hostCount, 1);
  assert.equal(recovered.agency.managerCount, 0);

  await setAgencyManagerRole(db, ownerUid, {
    agencyId,
    targetUid: hostUid,
    targetRole: "manager",
    idempotencyKey: "stage05c_recovered_promote_001",
  });
  const finalSurface = await listAgencyMembers(db, ownerUid, {
    agencyId,
    limit: 25,
  });
  assert.equal(finalSurface.agency.hostCount, 0);
  assert.equal(finalSurface.agency.managerCount, 1);
  assert.deepEqual(finalSurface.managerSlots.managerUids, [hostUid]);
});
