import assert from "node:assert/strict";
import { after, test } from "node:test";
import { deleteApp, getApps, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

import {
  commitAcceptedAgencyMembership,
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

async function seedAgency(agencyId, ownerUid, ownerPublicId, name = "Commit Agency") {
  await seedUser(ownerUid, ownerPublicId);
  await adminDb.collection("agencies").doc(agencyId).set({
    agencyId,
    publicId: agencyId,
    name,
    ownerUid,
    status: "active",
    memberCount: 1,
    hostCount: 0,
    managerCount: 0,
    seniorManagerCount: 0,
  });
  const ownerMembership = {
    agencyId,
    uid: ownerUid,
    role: "owner",
    status: "active",
    joinedAt: new Date(),
    updatedAt: new Date(),
    leftAt: null,
    removedAt: null,
    cooldownUntil: null,
  };
  await Promise.all([
    adminDb.collection("agency_memberships")
      .doc(agencyId + "__" + ownerUid).set(ownerMembership),
    adminDb.collection("agency_user_memberships")
      .doc(ownerUid).set(ownerMembership),
    adminDb.collection("users").doc(ownerUid).set({
      agencyId,
      agencyRole: "owner",
    }, { merge: true }),
  ]);
}

test("accepted join commits both membership indexes user link counts audit and notifications", async () => {
  const agencyId = "651001";
  const ownerUid = "stage04b_owner";
  const userUid = "stage04b_user";
  await seedAgency(agencyId, ownerUid, "651901");
  await seedUser(userUid, "651101");

  const join = await requestAgencyJoin(db, userUid, {
    agencyId,
    idempotencyKey: "stage04b_join_submit_0001",
  }, { now: new Date("2026-09-28T20:00:00.000Z") });

  const result = await respondAgencyMembershipRequest(db, ownerUid, {
    requestId: join.requestId,
    decision: "accept",
    idempotencyKey: "stage04b_join_accept_0001",
  }, { now: new Date("2026-09-28T20:01:00.000Z") });

  assert.equal(result.membershipCommitted, true);
  assert.equal(result.membershipRole, "host");

  const [
    membership,
    userMembership,
    user,
    agency,
    request,
    acceptanceLock,
    pairKey,
    pending,
    audit,
    userNotification,
    ownerNotification,
  ] = await Promise.all([
    adminDb.collection("agency_memberships").doc(agencyId + "__" + userUid).get(),
    adminDb.collection("agency_user_memberships").doc(userUid).get(),
    adminDb.collection("users").doc(userUid).get(),
    adminDb.collection("agencies").doc(agencyId).get(),
    adminDb.collection("agency_membership_requests").doc(join.requestId).get(),
    adminDb.collection("agency_membership_acceptance_locks").doc(userUid).get(),
    adminDb.collection("agency_membership_request_keys").doc(agencyId + "__" + userUid).get(),
    adminDb.collection("agency_membership_pending").doc(agencyId + "__" + userUid).get(),
    adminDb.collection("admin_audit_logs").doc("agency_membership_commit_" + join.requestId).get(),
    adminDb.collection("notifications").doc("agency_membership_response_" + join.requestId).get(),
    adminDb.collection("notifications").doc("agency_membership_committed_" + join.requestId).get(),
  ]);

  assert.equal(membership.data().role, "host");
  assert.equal(membership.data().status, "active");
  assert.equal(userMembership.data().agencyId, agencyId);
  assert.equal(userMembership.data().role, "host");
  assert.equal(user.data().agencyId, agencyId);
  assert.equal(user.data().agencyRole, "host");
  assert.ok(user.data().agencyJoinedAt);
  assert.equal(agency.data().memberCount, 2);
  assert.equal(agency.data().hostCount, 1);
  assert.equal(request.data().status, "accepted");
  assert.equal(request.data().membershipRole, "host");
  assert.ok(request.data().membershipCommittedAt);
  assert.equal(acceptanceLock.data().status, "committed");
  assert.equal(pairKey.exists, false);
  assert.equal(pending.exists, false);
  assert.equal(audit.data().action, "commitAgencyMembership");
  assert.equal(userNotification.data().userId, userUid);
  assert.equal(userNotification.data().type, "agency_membership_request_accepted");
  assert.equal(ownerNotification.data().userId, ownerUid);
  assert.equal(ownerNotification.data().type, "agency_membership_committed");
});

test("same acceptance idempotency key never increments agency counts twice", async () => {
  const agencyId = "652001";
  const ownerUid = "stage04b_idempotent_owner";
  const userUid = "stage04b_idempotent_user";
  await seedAgency(agencyId, ownerUid, "652901");
  await seedUser(userUid, "652101");

  const join = await requestAgencyJoin(db, userUid, {
    agencyId,
    idempotencyKey: "stage04b_idempotent_submit_0001",
  });
  const body = {
    requestId: join.requestId,
    decision: "accept",
    idempotencyKey: "stage04b_idempotent_accept_0001",
  };

  const first = await respondAgencyMembershipRequest(db, ownerUid, body);
  const duplicate = await respondAgencyMembershipRequest(db, ownerUid, body);
  assert.equal(first.code, "ok");
  assert.equal(duplicate.code, "duplicate");

  const agency = await adminDb.collection("agencies").doc(agencyId).get();
  assert.equal(agency.data().memberCount, 2);
  assert.equal(agency.data().hostCount, 1);
});

test("agency suspension after request blocks commit and leaves user unlinked", async () => {
  const agencyId = "653001";
  const ownerUid = "stage04b_suspend_owner";
  const userUid = "stage04b_suspend_user";
  await seedAgency(agencyId, ownerUid, "653901");
  await seedUser(userUid, "653101");

  const join = await requestAgencyJoin(db, userUid, {
    agencyId,
    idempotencyKey: "stage04b_suspend_submit_0001",
  });
  await adminDb.collection("agencies").doc(agencyId).set(
    { status: "suspended" },
    { merge: true },
  );

  await assert.rejects(
    respondAgencyMembershipRequest(db, ownerUid, {
      requestId: join.requestId,
      decision: "accept",
      idempotencyKey: "stage04b_suspend_accept_0001",
    }),
    /agency_not_accepting_members/,
  );

  const [membership, user, agency] = await Promise.all([
    adminDb.collection("agency_user_memberships").doc(userUid).get(),
    adminDb.collection("users").doc(userUid).get(),
    adminDb.collection("agencies").doc(agencyId).get(),
  ]);
  assert.equal(membership.exists, false);
  assert.equal(user.data().agencyId, "");
  assert.equal(agency.data().memberCount, 1);
  assert.equal(agency.data().hostCount, 0);
});

test("existing user membership blocks commit without changing target agency counts", async () => {
  const agencyId = "654001";
  const ownerUid = "stage04b_conflict_owner";
  const userUid = "stage04b_conflict_user";
  await seedAgency(agencyId, ownerUid, "654901");
  await seedUser(userUid, "654101");

  const join = await requestAgencyJoin(db, userUid, {
    agencyId,
    idempotencyKey: "stage04b_conflict_submit_0001",
  });

  await adminDb.collection("agency_user_memberships").doc(userUid).set({
    agencyId: "699998",
    uid: userUid,
    role: "host",
    status: "active",
    joinedAt: new Date(),
    updatedAt: new Date(),
  });
  await adminDb.collection("users").doc(userUid).set({
    agencyId: "699998",
    agencyRole: "host",
  }, { merge: true });

  await assert.rejects(
    respondAgencyMembershipRequest(db, ownerUid, {
      requestId: join.requestId,
      decision: "accept",
      idempotencyKey: "stage04b_conflict_accept_0001",
    }),
    /user_already_in_agency/,
  );

  const agency = await adminDb.collection("agencies").doc(agencyId).get();
  assert.equal(agency.data().memberCount, 1);
  assert.equal(agency.data().hostCount, 0);
});

test("recovery commit finalizes a pre-04B accepted request exactly once", async () => {
  const agencyId = "655001";
  const ownerUid = "stage04b_recovery_owner";
  const userUid = "stage04b_recovery_user";
  const requestId = "stage04b_legacy_accepted_request";
  await seedAgency(agencyId, ownerUid, "655901");
  await seedUser(userUid, "655101");

  await Promise.all([
    adminDb.collection("agency_membership_requests").doc(requestId).set({
      requestId,
      agencyId,
      uid: userUid,
      type: "join",
      targetRole: "host",
      status: "accepted",
      actorUid: userUid,
      userConsent: true,
      agencyConsent: true,
      acceptedAt: new Date("2026-09-28T19:00:00.000Z"),
      createdAt: new Date("2026-09-28T18:00:00.000Z"),
      updatedAt: new Date("2026-09-28T19:00:00.000Z"),
    }),
    adminDb.collection("agency_membership_acceptance_locks").doc(userUid).set({
      requestId,
      agencyId,
      uid: userUid,
      status: "accepted",
      createdAt: new Date("2026-09-28T19:00:00.000Z"),
      updatedAt: new Date("2026-09-28T19:00:00.000Z"),
    }),
    adminDb.collection("agency_membership_request_keys")
      .doc(agencyId + "__" + userUid).set({
        requestId,
        agencyId,
        uid: userUid,
        status: "accepted",
      }),
  ]);

  const first = await commitAcceptedAgencyMembership(
    db,
    userUid,
    {
      requestId,
      idempotencyKey: "stage04b_recovery_commit_0001",
    },
    { now: new Date("2026-09-28T20:30:00.000Z") },
  );
  assert.equal(first.code, "ok");
  assert.equal(first.membershipCommitted, true);

  const duplicate = await commitAcceptedAgencyMembership(
    db,
    userUid,
    {
      requestId,
      idempotencyKey: "stage04b_recovery_commit_0001",
    },
  );
  assert.equal(duplicate.code, "duplicate");

  const differentKey = await commitAcceptedAgencyMembership(
    db,
    userUid,
    {
      requestId,
      idempotencyKey: "stage04b_recovery_commit_0002",
    },
  );
  assert.equal(differentKey.code, "already_committed");

  const [agency, membership, lock, pairKey, notification] = await Promise.all([
    adminDb.collection("agencies").doc(agencyId).get(),
    adminDb.collection("agency_user_memberships").doc(userUid).get(),
    adminDb.collection("agency_membership_acceptance_locks").doc(userUid).get(),
    adminDb.collection("agency_membership_request_keys")
      .doc(agencyId + "__" + userUid).get(),
    adminDb.collection("notifications")
      .doc("agency_membership_active_" + requestId).get(),
  ]);
  assert.equal(agency.data().memberCount, 2);
  assert.equal(agency.data().hostCount, 1);
  assert.equal(membership.data().role, "host");
  assert.equal(lock.data().status, "committed");
  assert.equal(pairKey.exists, false);
  assert.equal(notification.data().userId, userUid);
});

test("only target user or agency management can recovery-commit an accepted request", async () => {
  const agencyId = "656001";
  const ownerUid = "stage04b_permission_owner";
  const userUid = "stage04b_permission_user";
  const outsiderUid = "stage04b_permission_outsider";
  const requestId = "stage04b_permission_request";
  await seedAgency(agencyId, ownerUid, "656901");
  await seedUser(userUid, "656101");
  await seedUser(outsiderUid, "656102");

  await Promise.all([
    adminDb.collection("agency_membership_requests").doc(requestId).set({
      requestId,
      agencyId,
      uid: userUid,
      type: "invite",
      targetRole: "host",
      status: "accepted",
      actorUid: ownerUid,
      userConsent: true,
      agencyConsent: true,
      acceptedAt: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
    }),
    adminDb.collection("agency_membership_acceptance_locks").doc(userUid).set({
      requestId,
      agencyId,
      uid: userUid,
      status: "accepted",
    }),
  ]);

  await assert.rejects(
    commitAcceptedAgencyMembership(db, outsiderUid, {
      requestId,
      idempotencyKey: "stage04b_permission_commit_0001",
    }),
    /forbidden/,
  );

  const agency = await adminDb.collection("agencies").doc(agencyId).get();
  assert.equal(agency.data().memberCount, 1);
  assert.equal(agency.data().hostCount, 0);
});
