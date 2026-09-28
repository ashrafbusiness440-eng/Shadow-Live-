import assert from "node:assert/strict";
import { after, test } from "node:test";
import { deleteApp, getApps, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

import {
  cancelAgencyMembershipRequest,
  inviteAgencyHost,
  listAgencyMembershipPending,
  listMyAgencyMembershipRequests,
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
    publicId,
    ...extra,
  });
  await adminDb.collection("public_ids").doc(publicId).set({ uid });
}

async function seedAgency(agencyId, ownerUid, ownerPublicId, name = "Test Agency") {
  await seedUser(ownerUid, ownerPublicId);
  await adminDb.collection("agencies").doc(agencyId).set({
    agencyId,
    publicId: agencyId,
    name,
    ownerUid,
    status: "active",
    memberCount: 1,
    hostCount: 0,
  });
  const membership = {
    agencyId,
    uid: ownerUid,
    role: "owner",
    status: "active",
    joinedAt: new Date(),
    updatedAt: new Date(),
  };
  await adminDb.collection("agency_user_memberships").doc(ownerUid).set(membership);
  await adminDb.collection("agency_memberships")
    .doc(agencyId + "__" + ownerUid).set(membership);
}

test("join request records user consent and appears in bounded agency queue", async () => {
  const agencyId = "641001";
  const ownerUid = "stage04a_join_owner";
  const userUid = "stage04a_join_user";
  await seedAgency(agencyId, ownerUid, "641901", "Join Agency");
  await seedUser(userUid, "641101");

  const body = {
    agencyId,
    idempotencyKey: "stage04a_join_request_0001",
  };
  const first = await requestAgencyJoin(db, userUid, body, {
    now: new Date("2026-09-28T18:00:00.000Z"),
  });

  assert.equal(first.status, "pending");
  assert.equal(first.type, "join");
  assert.equal(first.userConsent, true);
  assert.equal(first.agencyConsent, false);

  const [request, pairKey, pending, operation, notification, membership] =
    await Promise.all([
      adminDb.collection("agency_membership_requests").doc(first.requestId).get(),
      adminDb.collection("agency_membership_request_keys")
        .doc(agencyId + "__" + userUid).get(),
      adminDb.collection("agency_membership_pending")
        .doc(agencyId + "__" + userUid).get(),
      adminDb.collection("agency_membership_request_operations")
        .doc(userUid + "__" + body.idempotencyKey).get(),
      adminDb.collection("notifications")
        .doc("agency_membership_join_" + first.requestId).get(),
      adminDb.collection("agency_user_memberships").doc(userUid).get(),
    ]);

  assert.equal(request.data().userConsent, true);
  assert.equal(request.data().agencyConsent, false);
  assert.equal(pairKey.data().status, "pending");
  assert.equal(pending.data().agencyId, agencyId);
  assert.equal(operation.data().status, "completed");
  assert.equal(notification.data().userId, ownerUid);
  assert.equal(membership.exists, false);

  const queue = await listAgencyMembershipPending(db, ownerUid, {
    agencyId,
    limit: 999,
  });
  assert.ok(queue.limit <= 50);
  assert.ok(queue.requests.some((item) => item.requestId === first.requestId));

  const duplicate = await requestAgencyJoin(db, userUid, body);
  assert.equal(duplicate.code, "duplicate");
  assert.equal(duplicate.requestId, first.requestId);
});

test("agency invite records agency consent and target user can see it", async () => {
  const agencyId = "642001";
  const ownerUid = "stage04a_invite_owner";
  const userUid = "stage04a_invite_user";
  await seedAgency(agencyId, ownerUid, "642901", "Invite Agency");
  await seedUser(userUid, "642101");

  const invite = await inviteAgencyHost(db, ownerUid, {
    agencyId,
    targetPublicId: "642101",
    idempotencyKey: "stage04a_invite_request_0001",
  }, { now: new Date("2026-09-28T18:10:00.000Z") });

  assert.equal(invite.type, "invite");
  assert.equal(invite.userConsent, false);
  assert.equal(invite.agencyConsent, true);

  const notification = await adminDb.collection("notifications")
    .doc("agency_membership_invite_" + invite.requestId).get();
  assert.equal(notification.data().userId, userUid);

  const mine = await listMyAgencyMembershipRequests(db, userUid, { limit: 999 });
  assert.ok(mine.limit <= 50);
  assert.ok(mine.requests.some((item) => item.requestId === invite.requestId));
});

test("agency accepts join request and commits membership atomically", async () => {
  const agencyId = "643001";
  const ownerUid = "stage04a_accept_join_owner";
  const userUid = "stage04a_accept_join_user";
  await seedAgency(agencyId, ownerUid, "643901");
  await seedUser(userUid, "643101");

  const join = await requestAgencyJoin(db, userUid, {
    agencyId,
    idempotencyKey: "stage04a_accept_join_submit_0001",
  });

  const accepted = await respondAgencyMembershipRequest(db, ownerUid, {
    requestId: join.requestId,
    decision: "accept",
    idempotencyKey: "stage04a_accept_join_response_0001",
  }, { now: new Date("2026-09-28T18:20:00.000Z") });

  assert.equal(accepted.status, "accepted");
  assert.equal(accepted.userConsent, true);
  assert.equal(accepted.agencyConsent, true);

  const [request, acceptanceLock, pending, membership, agencyMembership, user, agency] =
    await Promise.all([
      adminDb.collection("agency_membership_requests").doc(join.requestId).get(),
      adminDb.collection("agency_membership_acceptance_locks").doc(userUid).get(),
      adminDb.collection("agency_membership_pending")
        .doc(agencyId + "__" + userUid).get(),
      adminDb.collection("agency_user_memberships").doc(userUid).get(),
      adminDb.collection("agency_memberships")
        .doc(agencyId + "__" + userUid).get(),
      adminDb.collection("users").doc(userUid).get(),
      adminDb.collection("agencies").doc(agencyId).get(),
    ]);
  assert.equal(request.data().status, "accepted");
  assert.equal(request.data().membershipRole, "host");
  assert.ok(request.data().membershipCommittedAt);
  assert.equal(acceptanceLock.data().requestId, join.requestId);
  assert.equal(acceptanceLock.data().status, "committed");
  assert.equal(pending.exists, false);
  assert.equal(membership.data().role, "host");
  assert.equal(membership.data().status, "active");
  assert.equal(agencyMembership.data().role, "host");
  assert.equal(user.data().agencyId, agencyId);
  assert.equal(user.data().agencyRole, "host");
  assert.equal(agency.data().memberCount, 2);
  assert.equal(agency.data().hostCount, 1);
});

test("user accepts agency invite and commits membership", async () => {
  const agencyId = "644001";
  const ownerUid = "stage04a_accept_invite_owner";
  const userUid = "stage04a_accept_invite_user";
  await seedAgency(agencyId, ownerUid, "644901");
  await seedUser(userUid, "644101");

  const invite = await inviteAgencyHost(db, ownerUid, {
    agencyId,
    targetPublicId: "644101",
    idempotencyKey: "stage04a_accept_invite_submit_0001",
  });

  const accepted = await respondAgencyMembershipRequest(db, userUid, {
    requestId: invite.requestId,
    decision: "accept",
    idempotencyKey: "stage04a_accept_invite_response_0001",
  });

  assert.equal(accepted.status, "accepted");
  assert.equal(accepted.userConsent, true);
  assert.equal(accepted.agencyConsent, true);
  const [lock, membership, agency] = await Promise.all([
    adminDb.collection("agency_membership_acceptance_locks").doc(userUid).get(),
    adminDb.collection("agency_user_memberships").doc(userUid).get(),
    adminDb.collection("agencies").doc(agencyId).get(),
  ]);
  assert.equal(lock.data().agencyId, agencyId);
  assert.equal(lock.data().status, "committed");
  assert.equal(membership.data().role, "host");
  assert.equal(agency.data().memberCount, 2);
  assert.equal(agency.data().hostCount, 1);
});

test("acceptance lock prevents accepting two different agencies", async () => {
  const userUid = "stage04a_double_accept_user";
  await seedUser(userUid, "645101");
  await seedAgency("645001", "stage04a_double_owner_a", "645901", "Agency A");
  await seedAgency("645002", "stage04a_double_owner_b", "645902", "Agency B");

  const first = await inviteAgencyHost(db, "stage04a_double_owner_a", {
    agencyId: "645001",
    targetPublicId: "645101",
    idempotencyKey: "stage04a_double_invite_a_0001",
  });
  const second = await inviteAgencyHost(db, "stage04a_double_owner_b", {
    agencyId: "645002",
    targetPublicId: "645101",
    idempotencyKey: "stage04a_double_invite_b_0001",
  });

  await respondAgencyMembershipRequest(db, userUid, {
    requestId: first.requestId,
    decision: "accept",
    idempotencyKey: "stage04a_double_accept_a_0001",
  });

  await assert.rejects(
    respondAgencyMembershipRequest(db, userUid, {
      requestId: second.requestId,
      decision: "accept",
      idempotencyKey: "stage04a_double_accept_b_0001",
    }),
    /user_already_in_agency|membership_acceptance_conflict/,
  );
});

test("reject and cancel release pair and pending request keys", async () => {
  const agencyId = "646001";
  const ownerUid = "stage04a_resolve_owner";
  const rejectUid = "stage04a_reject_user";
  const cancelUid = "stage04a_cancel_user";
  await seedAgency(agencyId, ownerUid, "646901");
  await seedUser(rejectUid, "646101");
  await seedUser(cancelUid, "646102");

  const invite = await inviteAgencyHost(db, ownerUid, {
    agencyId,
    targetPublicId: "646101",
    idempotencyKey: "stage04a_reject_invite_0001",
  });
  const rejected = await respondAgencyMembershipRequest(db, rejectUid, {
    requestId: invite.requestId,
    decision: "reject",
    reason: "لا أريد الانضمام",
    idempotencyKey: "stage04a_reject_response_0001",
  });
  assert.equal(rejected.status, "rejected");
  assert.equal(
    (await adminDb.collection("agency_membership_request_keys")
      .doc(agencyId + "__" + rejectUid).get()).exists,
    false,
  );

  const join = await requestAgencyJoin(db, cancelUid, {
    agencyId,
    idempotencyKey: "stage04a_cancel_join_0001",
  });
  const cancelled = await cancelAgencyMembershipRequest(db, cancelUid, {
    requestId: join.requestId,
    reason: "تراجعت عن الطلب",
    idempotencyKey: "stage04a_cancel_response_0001",
  });
  assert.equal(cancelled.status, "cancelled");
  assert.equal(
    (await adminDb.collection("agency_membership_pending")
      .doc(agencyId + "__" + cancelUid).get()).exists,
    false,
  );
});

test("regular host cannot invite or review membership requests", async () => {
  const agencyId = "647001";
  const ownerUid = "stage04a_permission_owner";
  const hostUid = "stage04a_permission_host";
  const targetUid = "stage04a_permission_target";
  await seedAgency(agencyId, ownerUid, "647901");
  await seedUser(hostUid, "647102");
  await seedUser(targetUid, "647103");
  const hostMembership = {
    agencyId,
    uid: hostUid,
    role: "host",
    status: "active",
    joinedAt: new Date(),
    updatedAt: new Date(),
  };
  await adminDb.collection("agency_user_memberships").doc(hostUid).set(hostMembership);
  await adminDb.collection("agency_memberships")
    .doc(agencyId + "__" + hostUid).set(hostMembership);

  await assert.rejects(
    inviteAgencyHost(db, hostUid, {
      agencyId,
      targetPublicId: "647103",
      idempotencyKey: "stage04a_forbidden_invite_0001",
    }),
    /forbidden/,
  );

  const join = await requestAgencyJoin(db, targetUid, {
    agencyId,
    idempotencyKey: "stage04a_forbidden_join_0001",
  });
  await assert.rejects(
    respondAgencyMembershipRequest(db, hostUid, {
      requestId: join.requestId,
      decision: "accept",
      idempotencyKey: "stage04a_forbidden_review_0001",
    }),
    /forbidden/,
  );
});

test("suspended agency blocks new join and invite requests", async () => {
  const agencyId = "648001";
  const ownerUid = "stage04a_suspended_owner";
  const userUid = "stage04a_suspended_user";
  await seedAgency(agencyId, ownerUid, "648901");
  await seedUser(userUid, "648101");
  await adminDb.collection("agencies").doc(agencyId).set(
    { status: "suspended" },
    { merge: true },
  );

  await assert.rejects(
    requestAgencyJoin(db, userUid, {
      agencyId,
      idempotencyKey: "stage04a_suspended_join_0001",
    }),
    /agency_not_accepting_members/,
  );
  await assert.rejects(
    inviteAgencyHost(db, ownerUid, {
      agencyId,
      targetPublicId: "648101",
      idempotencyKey: "stage04a_suspended_invite_0001",
    }),
    /agency_not_accepting_members/,
  );
});
