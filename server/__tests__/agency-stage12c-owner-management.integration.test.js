import assert from "node:assert/strict";
import { after, test } from "node:test";
import { readFileSync } from "node:fs";
import { deleteApp, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

import {
  removeAgencyMember,
  respondAgencyLeaveRequest,
} from "../../cloudflare-worker/src/agency-membership.js";
import { cloudflareFirestoreAdapter } from "./helpers/cloudflare-firestore-adapter.js";

const app = initializeApp(
  { projectId: "shadow-live-economy-test" },
  "agency-stage12c-" + Date.now(),
);
const adminDb = getFirestore(app);
const db = cloudflareFirestoreAdapter(adminDb);

after(async () => {
  await deleteApp(app);
});

async function seedAgencyMember({
  agencyId,
  ownerUid,
  memberUid,
  role = "host",
}) {
  const joinedAt = new Date("2026-09-29T18:00:00.000Z");
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
  const memberMembership = {
    ...ownerMembership,
    uid: memberUid,
    role,
  };
  const managerUids = role === "manager" ? [memberUid] : [];
  const seniorManagerUid = role === "senior_manager" ? memberUid : null;

  await Promise.all([
    adminDb.collection("agencies").doc(agencyId).set({
      agencyId,
      publicId: agencyId,
      name: "Stage 12-C Agency",
      ownerUid,
      status: "active",
      memberCount: 2,
      hostCount: role === "host" ? 1 : 0,
      managerCount: role === "manager" ? 1 : 0,
      seniorManagerCount: role === "senior_manager" ? 1 : 0,
    }),
    adminDb.collection("agency_manager_slots").doc(agencyId).set({
      agencyId,
      seniorManagerUid,
      managerUids,
      updatedAt: joinedAt,
    }),
    adminDb.collection("users").doc(ownerUid).set({
      accountStatus: "active",
      publicId: "912001",
      agencyId,
      agencyRole: "owner",
    }),
    adminDb.collection("users").doc(memberUid).set({
      accountStatus: "active",
      publicId: "912002",
      agencyId,
      agencyRole: role,
    }),
    adminDb.collection("agency_user_memberships").doc(ownerUid).set(ownerMembership),
    adminDb.collection("agency_memberships")
      .doc(agencyId + "__" + ownerUid).set(ownerMembership),
    adminDb.collection("agency_user_memberships").doc(memberUid).set(memberMembership),
    adminDb.collection("agency_memberships")
      .doc(agencyId + "__" + memberUid).set(memberMembership),
    adminDb.collection("agency_membership_acceptance_locks").doc(memberUid).set({
      requestId: "accepted_" + memberUid,
      agencyId,
      uid: memberUid,
      status: "committed",
      membershipRole: role,
      membershipCommittedAt: joinedAt,
    }),
  ]);
}

async function seedLeaveRequest({ agencyId, memberUid, requestId }) {
  const now = new Date("2026-09-29T18:10:00.000Z");
  const request = {
    requestId,
    agencyId,
    uid: memberUid,
    userPublicId: "912002",
    type: "leave",
    targetRole: "host",
    status: "pending",
    initiatorSide: "user",
    userConsent: true,
    agencyConsent: false,
    actorUid: memberUid,
    createdAt: now,
    updatedAt: now,
  };
  await Promise.all([
    adminDb.collection("agency_membership_requests").doc(requestId).set(request),
    adminDb.collection("agency_membership_request_keys")
      .doc(agencyId + "__" + memberUid).set({
        requestId,
        agencyId,
        uid: memberUid,
        type: "leave",
        status: "pending",
        createdAt: now,
        updatedAt: now,
      }),
    adminDb.collection("agency_membership_pending")
      .doc(agencyId + "__" + memberUid).set(request),
  ]);
}

test("12-C Owner accepts leave request atomically and exactly once", async () => {
  const agencyId = "812301";
  const ownerUid = "stage12c_accept_owner";
  const memberUid = "stage12c_accept_host";
  const requestId = memberUid + "__stage12c_leave_0001";
  await seedAgencyMember({ agencyId, ownerUid, memberUid });
  await seedLeaveRequest({ agencyId, memberUid, requestId });

  const body = {
    requestId,
    decision: "accept",
    idempotencyKey: "stage12c_leave_accept_0001",
  };
  const now = new Date("2026-09-29T19:00:00.000Z");
  const first = await respondAgencyLeaveRequest(db, ownerUid, body, { now });
  const duplicate = await respondAgencyLeaveRequest(db, ownerUid, body, { now });

  assert.equal(first.ok, true);
  assert.equal(first.status, "accepted");
  assert.equal(first.departureStatus, "left");
  assert.equal(duplicate.code, "duplicate");

  const [request, membership, agencyMembership, user, agency, pending, pair, lock] =
    await Promise.all([
      adminDb.collection("agency_membership_requests").doc(requestId).get(),
      adminDb.collection("agency_user_memberships").doc(memberUid).get(),
      adminDb.collection("agency_memberships")
        .doc(agencyId + "__" + memberUid).get(),
      adminDb.collection("users").doc(memberUid).get(),
      adminDb.collection("agencies").doc(agencyId).get(),
      adminDb.collection("agency_membership_pending")
        .doc(agencyId + "__" + memberUid).get(),
      adminDb.collection("agency_membership_request_keys")
        .doc(agencyId + "__" + memberUid).get(),
      adminDb.collection("agency_membership_acceptance_locks").doc(memberUid).get(),
    ]);

  assert.equal(request.data().status, "accepted");
  assert.equal(request.data().agencyConsent, true);
  assert.equal(membership.data().status, "left");
  assert.equal(agencyMembership.data().status, "left");
  assert.equal(user.data().agencyId, "");
  assert.equal(user.data().agencyRole, "");
  assert.equal(agency.data().memberCount, 1);
  assert.equal(agency.data().hostCount, 0);
  assert.equal(pending.exists, false);
  assert.equal(pair.exists, false);
  assert.equal(lock.exists, false);
  assert.equal(
    membership.data().cooldownUntil.toDate().toISOString(),
    "2026-10-06T19:00:00.000Z",
  );
});

test("12-C Owner rejects leave request without changing membership", async () => {
  const agencyId = "812302";
  const ownerUid = "stage12c_reject_owner";
  const memberUid = "stage12c_reject_host";
  const requestId = memberUid + "__stage12c_leave_0002";
  await seedAgencyMember({ agencyId, ownerUid, memberUid });
  await seedLeaveRequest({ agencyId, memberUid, requestId });

  const result = await respondAgencyLeaveRequest(
    db,
    ownerUid,
    {
      requestId,
      decision: "reject",
      reason: "stay_required",
      idempotencyKey: "stage12c_leave_reject_0001",
    },
    { now: new Date("2026-09-29T19:05:00.000Z") },
  );

  assert.equal(result.status, "rejected");
  const [request, membership, agency, pending] = await Promise.all([
    adminDb.collection("agency_membership_requests").doc(requestId).get(),
    adminDb.collection("agency_user_memberships").doc(memberUid).get(),
    adminDb.collection("agencies").doc(agencyId).get(),
    adminDb.collection("agency_membership_pending")
      .doc(agencyId + "__" + memberUid).get(),
  ]);
  assert.equal(request.data().status, "rejected");
  assert.equal(membership.data().status, "active");
  assert.equal(agency.data().memberCount, 2);
  assert.equal(agency.data().hostCount, 1);
  assert.equal(pending.exists, false);
});

test("12-C requester cannot review own leave request", async () => {
  const agencyId = "812303";
  const ownerUid = "stage12c_guard_owner";
  const memberUid = "stage12c_guard_host";
  const requestId = memberUid + "__stage12c_leave_0003";
  await seedAgencyMember({ agencyId, ownerUid, memberUid });
  await seedLeaveRequest({ agencyId, memberUid, requestId });

  await assert.rejects(
    respondAgencyLeaveRequest(db, memberUid, {
      requestId,
      decision: "accept",
      idempotencyKey: "stage12c_leave_guard_0001",
    }),
    /cannot_review_own_request/,
  );
  const membership = await adminDb.collection("agency_user_memberships")
    .doc(memberUid).get();
  assert.equal(membership.data().status, "active");
});

test("12-C removing Manager clears Manager slot with counters", async () => {
  const agencyId = "812304";
  const ownerUid = "stage12c_remove_owner";
  const managerUid = "stage12c_remove_manager";
  await seedAgencyMember({
    agencyId,
    ownerUid,
    memberUid: managerUid,
    role: "manager",
  });

  const result = await removeAgencyMember(
    db,
    ownerUid,
    {
      agencyId,
      targetUid: managerUid,
      reason: "owner_management",
      idempotencyKey: "stage12c_remove_manager_0001",
    },
    { now: new Date("2026-09-29T19:10:00.000Z") },
  );

  assert.equal(result.status, "removed");
  const [agency, slots, membership] = await Promise.all([
    adminDb.collection("agencies").doc(agencyId).get(),
    adminDb.collection("agency_manager_slots").doc(agencyId).get(),
    adminDb.collection("agency_user_memberships").doc(managerUid).get(),
  ]);
  assert.equal(agency.data().memberCount, 1);
  assert.equal(agency.data().managerCount, 0);
  assert.deepEqual(slots.data().managerUids, []);
  assert.equal(slots.data().seniorManagerUid, null);
  assert.equal(membership.data().status, "removed");
});

test("12-C management UI is lazy bounded and listener-free", () => {
  const page = readFileSync(
    new URL("../../lib/features/agency/screens/owner_agency_dashboard_page.dart", import.meta.url),
    "utf8",
  );
  const service = readFileSync(
    new URL("../../lib/features/agency/services/owner_agency_service.dart", import.meta.url),
    "utf8",
  );
  const membership = readFileSync(
    new URL("../../cloudflare-worker/src/agency-membership.js", import.meta.url),
    "utf8",
  );

  assert.equal(page.includes("owner-agency-management-lazy"), true);
  assert.equal(page.includes("owner-agency-management-load"), true);
  assert.equal(page.includes("Future.microtask(_loadManagement)"), false);
  assert.equal(page.includes("Timer.periodic"), false);
  assert.equal(page.includes(".snapshots()"), false);
  assert.equal(page.includes("StreamBuilder"), false);
  assert.equal(page.includes("FirebaseFirestore"), false);

  assert.equal(service.includes("'action': 'listAgencyMembers'"), true);
  assert.equal(service.includes("'action': 'listAgencyPending'"), true);
  assert.equal(service.includes("'limit': 25"), true);
  assert.equal(service.includes("'action': 'respondLeave'"), true);
  assert.equal(service.includes("'action': 'setManagerRole'"), true);
  assert.equal(service.includes("'action': 'remove'"), true);

  const start = membership.indexOf(
    "export async function respondAgencyLeaveRequest",
  );
  const end = membership.indexOf(
    "export async function respondAgencyMembershipRequest",
    start,
  );
  const source = membership.slice(start, end);
  assert.equal(source.includes(".runQuery("), false);
  assert.equal(source.includes(".list("), false);
});
