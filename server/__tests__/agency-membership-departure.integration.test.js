import assert from "node:assert/strict";
import { after, test } from "node:test";
import { deleteApp, getApps, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

import {
  leaveAgencyMembership,
  removeAgencyMember,
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

async function seedAgencyWithHost({
  agencyId,
  ownerUid,
  hostUid,
  ownerPublicId,
  hostPublicId,
}) {
  await seedUser(ownerUid, ownerPublicId);
  await seedUser(hostUid, hostPublicId);
  const joinedAt = new Date("2026-09-28T18:00:00.000Z");
  const ownerMembership = {
    agencyId,
    uid: ownerUid,
    role: "owner",
    status: "active",
    joinedAt,
    updatedAt: joinedAt,
    leftAt: null,
    removedAt: null,
    cooldownUntil: null,
  };
  const hostMembership = {
    agencyId,
    uid: hostUid,
    role: "host",
    status: "active",
    joinedAt,
    updatedAt: joinedAt,
    leftAt: null,
    removedAt: null,
    cooldownUntil: null,
  };
  await Promise.all([
    adminDb.collection("agencies").doc(agencyId).set({
      agencyId,
      publicId: agencyId,
      name: "Departure Agency",
      ownerUid,
      status: "active",
      memberCount: 2,
      hostCount: 1,
      managerCount: 0,
      seniorManagerCount: 0,
    }),
    adminDb.collection("agency_memberships")
      .doc(agencyId + "__" + ownerUid).set(ownerMembership),
    adminDb.collection("agency_user_memberships")
      .doc(ownerUid).set(ownerMembership),
    adminDb.collection("agency_memberships")
      .doc(agencyId + "__" + hostUid).set(hostMembership),
    adminDb.collection("agency_user_memberships")
      .doc(hostUid).set(hostMembership),
    adminDb.collection("users").doc(ownerUid).set({
      agencyId,
      agencyRole: "owner",
      agencyJoinedAt: joinedAt,
    }, { merge: true }),
    adminDb.collection("users").doc(hostUid).set({
      agencyId,
      agencyRole: "host",
      agencyJoinedAt: joinedAt,
    }, { merge: true }),
    adminDb.collection("agency_membership_acceptance_locks").doc(hostUid).set({
      requestId: "accepted_" + hostUid,
      agencyId,
      uid: hostUid,
      status: "committed",
      membershipRole: "host",
      membershipCommittedAt: joinedAt,
    }),
  ]);
}

test("host leave is atomic idempotent and decrements counters once", async () => {
  const agencyId = "661001";
  const ownerUid = "stage04c1_leave_owner";
  const hostUid = "stage04c1_leave_host";
  await seedAgencyWithHost({
    agencyId,
    ownerUid,
    hostUid,
    ownerPublicId: "661901",
    hostPublicId: "661101",
  });

  const body = {
    agencyId,
    idempotencyKey: "stage04c1_leave_0001",
    reason: "user_leave",
  };
  const now = new Date("2026-09-28T21:00:00.000Z");
  const first = await leaveAgencyMembership(db, hostUid, body, { now });
  const duplicate = await leaveAgencyMembership(db, hostUid, body, { now });

  assert.equal(first.code, "ok");
  assert.equal(first.status, "left");
  assert.equal(duplicate.code, "duplicate");

  const eventId = hostUid + "__stage04c1_leave_0001";
  const [
    agencyMembership,
    userMembership,
    user,
    agency,
    lock,
    audit,
    userNotification,
    ownerNotification,
  ] = await Promise.all([
    adminDb.collection("agency_memberships").doc(agencyId + "__" + hostUid).get(),
    adminDb.collection("agency_user_memberships").doc(hostUid).get(),
    adminDb.collection("users").doc(hostUid).get(),
    adminDb.collection("agencies").doc(agencyId).get(),
    adminDb.collection("agency_membership_acceptance_locks").doc(hostUid).get(),
    adminDb.collection("admin_audit_logs")
      .doc("agency_membership_departure_" + eventId).get(),
    adminDb.collection("notifications")
      .doc("agency_membership_departure_" + eventId).get(),
    adminDb.collection("notifications")
      .doc("agency_membership_owner_departure_" + eventId).get(),
  ]);

  assert.equal(agencyMembership.data().status, "left");
  assert.ok(agencyMembership.data().leftAt);
  assert.equal(agencyMembership.data().cooldownUntil, null);
  assert.equal(userMembership.data().status, "left");
  assert.equal(user.data().agencyId, "");
  assert.equal(user.data().agencyRole, "");
  assert.equal(agency.data().memberCount, 1);
  assert.equal(agency.data().hostCount, 0);
  assert.equal(lock.exists, false);
  assert.equal(audit.data().action, "leaveAgencyMembership");
  assert.equal(userNotification.data().userId, hostUid);
  assert.equal(ownerNotification.data().userId, ownerUid);

  await assert.rejects(
    leaveAgencyMembership(db, hostUid, {
      agencyId,
      idempotencyKey: "stage04c1_leave_0002",
    }),
    /agency_membership_not_active/,
  );
  const unchangedAgency = await adminDb.collection("agencies").doc(agencyId).get();
  assert.equal(unchangedAgency.data().memberCount, 1);
  assert.equal(unchangedAgency.data().hostCount, 0);
});

test("agency owner can remove active host exactly once", async () => {
  const agencyId = "662001";
  const ownerUid = "stage04c1_remove_owner";
  const hostUid = "stage04c1_remove_host";
  await seedAgencyWithHost({
    agencyId,
    ownerUid,
    hostUid,
    ownerPublicId: "662901",
    hostPublicId: "662101",
  });

  const body = {
    agencyId,
    targetUid: hostUid,
    reason: "agency_decision",
    idempotencyKey: "stage04c1_remove_0001",
  };
  const first = await removeAgencyMember(db, ownerUid, body, {
    now: new Date("2026-09-28T21:05:00.000Z"),
  });
  const duplicate = await removeAgencyMember(db, ownerUid, body);

  assert.equal(first.status, "removed");
  assert.equal(duplicate.code, "duplicate");

  const [membership, userMembership, user, agency] = await Promise.all([
    adminDb.collection("agency_memberships").doc(agencyId + "__" + hostUid).get(),
    adminDb.collection("agency_user_memberships").doc(hostUid).get(),
    adminDb.collection("users").doc(hostUid).get(),
    adminDb.collection("agencies").doc(agencyId).get(),
  ]);
  assert.equal(membership.data().status, "removed");
  assert.ok(membership.data().removedAt);
  assert.equal(userMembership.data().status, "removed");
  assert.equal(user.data().agencyId, "");
  assert.equal(user.data().agencyRole, "");
  assert.equal(agency.data().memberCount, 1);
  assert.equal(agency.data().hostCount, 0);
});

test("regular outsider cannot remove agency host", async () => {
  const agencyId = "663001";
  const ownerUid = "stage04c1_forbid_owner";
  const hostUid = "stage04c1_forbid_host";
  const outsiderUid = "stage04c1_forbid_outsider";
  await seedAgencyWithHost({
    agencyId,
    ownerUid,
    hostUid,
    ownerPublicId: "663901",
    hostPublicId: "663101",
  });
  await seedUser(outsiderUid, "663102");

  await assert.rejects(
    removeAgencyMember(db, outsiderUid, {
      agencyId,
      targetUid: hostUid,
      idempotencyKey: "stage04c1_forbid_0001",
    }),
    /forbidden/,
  );

  const [membership, agency] = await Promise.all([
    adminDb.collection("agency_user_memberships").doc(hostUid).get(),
    adminDb.collection("agencies").doc(agencyId).get(),
  ]);
  assert.equal(membership.data().status, "active");
  assert.equal(agency.data().memberCount, 2);
  assert.equal(agency.data().hostCount, 1);
});

test("agency owner membership cannot leave through member departure flow", async () => {
  const agencyId = "664001";
  const ownerUid = "stage04c1_owner_guard";
  const hostUid = "stage04c1_owner_guard_host";
  await seedAgencyWithHost({
    agencyId,
    ownerUid,
    hostUid,
    ownerPublicId: "664901",
    hostPublicId: "664101",
  });

  await assert.rejects(
    leaveAgencyMembership(db, ownerUid, {
      agencyId,
      idempotencyKey: "stage04c1_owner_leave_0001",
    }),
    /agency_owner_departure_forbidden/,
  );

  const agency = await adminDb.collection("agencies").doc(agencyId).get();
  assert.equal(agency.data().memberCount, 2);
  assert.equal(agency.data().hostCount, 1);
});
