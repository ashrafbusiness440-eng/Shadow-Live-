import assert from "node:assert/strict";
import { after, test } from "node:test";
import { deleteApp, getApps, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

import {
  AGENCY_REJOIN_COOLDOWN_MS,
  leaveAgencyMembership,
  requestAgencyJoin,
  respondAgencyMembershipRequest,
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
  await adminDb.collection("public_ids").doc(publicId).set({ uid });
}

async function seedAgency(agencyId, ownerUid, publicId) {
  await seedUser(ownerUid, publicId);
  const joinedAt = new Date("2026-09-20T00:00:00.000Z");
  const ownerMembership = {
    schemaVersion: 1,
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
  await Promise.all([
    adminDb.collection("agencies").doc(agencyId).set({
      schemaVersion: 1,
      agencyId,
      publicId: agencyId,
      name: "Cooldown Agency " + agencyId,
      ownerUid,
      status: "active",
      memberCount: 1,
      hostCount: 0,
      managerCount: 0,
      seniorManagerCount: 0,
      updatedAt: joinedAt,
    }),
    adminDb.collection("agency_memberships")
      .doc(agencyId + "__" + ownerUid).set(ownerMembership),
    adminDb.collection("agency_user_memberships")
      .doc(ownerUid).set(ownerMembership),
    adminDb.collection("users").doc(ownerUid).set({
      agencyId,
      agencyRole: "owner",
      agencyJoinedAt: joinedAt,
    }, { merge: true }),
  ]);
}

async function addHost(agencyId, hostUid, publicId) {
  await seedUser(hostUid, publicId);
  const joinedAt = new Date("2026-09-21T00:00:00.000Z");
  const membership = {
    schemaVersion: 1,
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
    adminDb.collection("agency_memberships")
      .doc(agencyId + "__" + hostUid).set(membership),
    adminDb.collection("agency_user_memberships")
      .doc(hostUid).set(membership),
    adminDb.collection("users").doc(hostUid).set({
      agencyId,
      agencyRole: "host",
      agencyJoinedAt: joinedAt,
    }, { merge: true }),
    adminDb.collection("agencies").doc(agencyId).set({
      memberCount: 2,
      hostCount: 1,
    }, { merge: true }),
    adminDb.collection("agency_membership_acceptance_locks").doc(hostUid).set({
      requestId: "active_" + hostUid,
      agencyId,
      uid: hostUid,
      status: "committed",
      membershipRole: "host",
      membershipCommittedAt: joinedAt,
    }),
  ]);
}

test("leave starts exact seven day cooldown and acceptance before expiry is blocked", async () => {
  assert.equal(AGENCY_REJOIN_COOLDOWN_MS, 7 * 24 * 60 * 60 * 1000);

  const oldAgencyId = "671001";
  const newAgencyId = "671002";
  const oldOwner = "stage04c2_old_owner";
  const newOwner = "stage04c2_new_owner";
  const hostUid = "stage04c2_host";
  await seedAgency(oldAgencyId, oldOwner, "671901");
  await seedAgency(newAgencyId, newOwner, "671902");
  await addHost(oldAgencyId, hostUid, "671101");

  const leftAt = new Date("2026-09-28T22:00:00.000Z");
  const leave = await leaveAgencyMembership(db, hostUid, {
    agencyId: oldAgencyId,
    idempotencyKey: "stage04c2_leave_0001",
  }, { now: leftAt });

  assert.equal(
    new Date(leave.cooldownUntil).toISOString(),
    "2026-10-05T22:00:00.000Z",
  );

  const join = await requestAgencyJoin(db, hostUid, {
    agencyId: newAgencyId,
    idempotencyKey: "stage04c2_join_new_0001",
  }, { now: new Date("2026-09-29T00:00:00.000Z") });

  await assert.rejects(
    respondAgencyMembershipRequest(db, newOwner, {
      requestId: join.requestId,
      decision: "accept",
      idempotencyKey: "stage04c2_accept_new_0001",
    }, { now: new Date("2026-10-05T21:59:59.000Z") }),
    (error) => {
      assert.equal(error.message, "agency_rejoin_cooldown");
      assert.equal(error.status, 409);
      assert.equal(
        error.details.cooldownUntil,
        "2026-10-05T22:00:00.000Z",
      );
      return true;
    },
  );

  const [requestBefore, newAgencyBefore, lastMembership] = await Promise.all([
    adminDb.collection("agency_membership_requests").doc(join.requestId).get(),
    adminDb.collection("agencies").doc(newAgencyId).get(),
    adminDb.collection("agency_user_memberships").doc(hostUid).get(),
  ]);
  assert.equal(requestBefore.data().status, "pending");
  assert.equal(newAgencyBefore.data().memberCount, 1);
  assert.equal(newAgencyBefore.data().hostCount, 0);
  assert.equal(lastMembership.data().status, "left");
  assert.equal(lastMembership.data().agencyId, oldAgencyId);

  const accepted = await respondAgencyMembershipRequest(db, newOwner, {
    requestId: join.requestId,
    decision: "accept",
    idempotencyKey: "stage04c2_accept_new_0001",
  }, { now: new Date("2026-10-05T22:00:00.000Z") });

  assert.equal(accepted.membershipCommitted, true);

  const [
    userMembership,
    newAgencyMembership,
    oldAgencyMembership,
    user,
    newAgency,
  ] = await Promise.all([
    adminDb.collection("agency_user_memberships").doc(hostUid).get(),
    adminDb.collection("agency_memberships").doc(newAgencyId + "__" + hostUid).get(),
    adminDb.collection("agency_memberships").doc(oldAgencyId + "__" + hostUid).get(),
    adminDb.collection("users").doc(hostUid).get(),
    adminDb.collection("agencies").doc(newAgencyId).get(),
  ]);

  assert.equal(userMembership.data().agencyId, newAgencyId);
  assert.equal(userMembership.data().status, "active");
  assert.equal(userMembership.data().cooldownUntil, null);
  assert.equal(newAgencyMembership.data().status, "active");
  assert.equal(oldAgencyMembership.data().status, "left");
  assert.equal(
    oldAgencyMembership.data().cooldownUntil.toDate().toISOString(),
    "2026-10-05T22:00:00.000Z",
  );
  assert.equal(user.data().agencyId, newAgencyId);
  assert.equal(newAgency.data().memberCount, 2);
  assert.equal(newAgency.data().hostCount, 1);
});

test("same agency can be rejoined at cooldown boundary without duplicate history row", async () => {
  const agencyId = "672001";
  const ownerUid = "stage04c2_same_owner";
  const hostUid = "stage04c2_same_host";
  await seedAgency(agencyId, ownerUid, "672901");
  await addHost(agencyId, hostUid, "672101");

  await leaveAgencyMembership(db, hostUid, {
    agencyId,
    idempotencyKey: "stage04c2_same_leave_0001",
  }, { now: new Date("2026-09-28T23:00:00.000Z") });

  const join = await requestAgencyJoin(db, hostUid, {
    agencyId,
    idempotencyKey: "stage04c2_same_join_0001",
  }, { now: new Date("2026-09-29T00:00:00.000Z") });

  await adminDb.collection("agency_host_monthly")
    .doc(agencyId + "__2026-10__" + hostUid)
    .set({
      agencyId,
      month: "2026-10",
      hostUid,
      supportCoins: 345000,
    });

  const accepted = await respondAgencyMembershipRequest(db, ownerUid, {
    requestId: join.requestId,
    decision: "accept",
    idempotencyKey: "stage04c2_same_accept_0001",
  }, { now: new Date("2026-10-05T23:00:00.000Z") });

  assert.equal(accepted.membershipCommitted, true);

  const [membership, agency, user] = await Promise.all([
    adminDb.collection("agency_memberships").doc(agencyId + "__" + hostUid).get(),
    adminDb.collection("agencies").doc(agencyId).get(),
    adminDb.collection("users").doc(hostUid).get(),
  ]);
  assert.equal(membership.data().status, "active");
  assert.equal(membership.data().leftAt, null);
  assert.equal(membership.data().removedAt, null);
  assert.equal(membership.data().cooldownUntil, null);
  assert.equal(agency.data().memberCount, 2);
  assert.equal(agency.data().hostCount, 1);
  assert.equal(user.data().agencyPublicSupportAgencyId, agencyId);
  assert.equal(user.data().agencyPublicSupportMonth, "2026-10");
  assert.equal(user.data().agencyPublicSupportCoins, 345000);
});
