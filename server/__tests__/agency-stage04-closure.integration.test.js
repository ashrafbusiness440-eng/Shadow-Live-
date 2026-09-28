import assert from "node:assert/strict";
import { after, test } from "node:test";
import { deleteApp, getApps, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

import {
  inviteAgencyHost,
  leaveAgencyMembership,
  overrideAgencyRejoinCooldown,
  removeAgencyMember,
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

async function seedAgency(agencyId, ownerUid, ownerPublicId) {
  await seedUser(ownerUid, ownerPublicId);
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
      name: "Stage04 Closure " + agencyId,
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

test("Stage 04 full lifecycle closes without double membership or double counters", async () => {
  const firstAgencyId = "691001";
  const secondAgencyId = "691002";
  const staleAgencyId = "691003";
  const firstOwnerUid = "stage04closure_owner_a";
  const secondOwnerUid = "stage04closure_owner_b";
  const staleOwnerUid = "stage04closure_owner_c";
  const userUid = "stage04closure_user";
  const platformOwnerUid = "stage04closure_platform_owner";

  await seedAgency(firstAgencyId, firstOwnerUid, "691901");
  await seedAgency(secondAgencyId, secondOwnerUid, "691902");
  await seedAgency(staleAgencyId, staleOwnerUid, "691903");
  await seedUser(userUid, "691101");
  await seedUser(platformOwnerUid, "691999", {
    role: "owner",
    adminEnabled: true,
  });

  // 04-A: multiple pending requests/invites are allowed across agencies.
  const staleInvite = await inviteAgencyHost(db, staleOwnerUid, {
    agencyId: staleAgencyId,
    targetPublicId: "691101",
    idempotencyKey: "stage04closure_stale_invite",
  }, { now: new Date("2026-09-28T18:00:00.000Z") });

  const firstJoin = await requestAgencyJoin(db, userUid, {
    agencyId: firstAgencyId,
    idempotencyKey: "stage04closure_first_join",
  }, { now: new Date("2026-09-28T18:01:00.000Z") });

  // 04-B: approval atomically activates one membership and increments once.
  const firstAcceptBody = {
    requestId: firstJoin.requestId,
    decision: "accept",
    idempotencyKey: "stage04closure_first_accept",
  };
  const firstAccept = await respondAgencyMembershipRequest(
    db,
    firstOwnerUid,
    firstAcceptBody,
    { now: new Date("2026-09-28T18:02:00.000Z") },
  );
  const duplicateFirstAccept = await respondAgencyMembershipRequest(
    db,
    firstOwnerUid,
    firstAcceptBody,
    { now: new Date("2026-09-28T18:02:30.000Z") },
  );
  assert.equal(firstAccept.membershipCommitted, true);
  assert.equal(duplicateFirstAccept.code, "duplicate");

  let [firstAgency, pointer] = await Promise.all([
    adminDb.collection("agencies").doc(firstAgencyId).get(),
    adminDb.collection("agency_user_memberships").doc(userUid).get(),
  ]);
  assert.equal(firstAgency.data().memberCount, 2);
  assert.equal(firstAgency.data().hostCount, 1);
  assert.equal(pointer.data().agencyId, firstAgencyId);
  assert.equal(pointer.data().status, "active");

  // A user already in another agency can still reject a stale invite for cleanup.
  const staleReject = await respondAgencyMembershipRequest(db, userUid, {
    requestId: staleInvite.requestId,
    decision: "reject",
    idempotencyKey: "stage04closure_stale_reject",
    reason: "cleanup_after_join",
  }, { now: new Date("2026-09-28T18:03:00.000Z") });
  assert.equal(staleReject.status, "rejected");

  // 04-C1/C2: leave is idempotent, decrements once, and starts exact 7-day wait.
  const leaveBody = {
    agencyId: firstAgencyId,
    idempotencyKey: "stage04closure_leave_user",
  };
  const leave = await leaveAgencyMembership(
    db,
    userUid,
    leaveBody,
    { now: new Date("2026-09-28T18:04:00.000Z") },
  );
  const duplicateLeave = await leaveAgencyMembership(
    db,
    userUid,
    leaveBody,
    { now: new Date("2026-09-28T18:04:30.000Z") },
  );
  assert.equal(leave.status, "left");
  assert.equal(duplicateLeave.code, "duplicate");
  assert.equal(
    new Date(leave.cooldownUntil).toISOString(),
    "2026-10-05T18:04:00.000Z",
  );

  firstAgency = await adminDb.collection("agencies").doc(firstAgencyId).get();
  pointer = await adminDb.collection("agency_user_memberships").doc(userUid).get();
  assert.equal(firstAgency.data().memberCount, 1);
  assert.equal(firstAgency.data().hostCount, 0);
  assert.equal(pointer.data().status, "left");

  const secondJoin = await requestAgencyJoin(db, userUid, {
    agencyId: secondAgencyId,
    idempotencyKey: "stage04closure_second_join",
  }, { now: new Date("2026-09-28T18:05:00.000Z") });

  await assert.rejects(
    respondAgencyMembershipRequest(db, secondOwnerUid, {
      requestId: secondJoin.requestId,
      decision: "accept",
      idempotencyKey: "stage04closure_second_accept",
    }, { now: new Date("2026-09-29T18:05:00.000Z") }),
    /agency_rejoin_cooldown/,
  );

  let secondAgency = await adminDb.collection("agencies").doc(secondAgencyId).get();
  assert.equal(secondAgency.data().memberCount, 1);
  assert.equal(secondAgency.data().hostCount, 0);

  // 04-C3: Shadow Control exception is audited/idempotent and unlocks acceptance.
  const overrideBody = {
    targetUid: userUid,
    reason: "stage04_closure_authorized_exception",
    idempotencyKey: "stage04closure_override_wait",
  };
  const override = await overrideAgencyRejoinCooldown(
    db,
    platformOwnerUid,
    overrideBody,
    { now: new Date("2026-09-29T18:06:00.000Z") },
  );
  const duplicateOverride = await overrideAgencyRejoinCooldown(
    db,
    platformOwnerUid,
    overrideBody,
    { now: new Date("2026-09-29T18:06:30.000Z") },
  );
  assert.equal(override.overrideApplied, true);
  assert.equal(duplicateOverride.code, "duplicate");

  const secondAccept = await respondAgencyMembershipRequest(db, secondOwnerUid, {
    requestId: secondJoin.requestId,
    decision: "accept",
    idempotencyKey: "stage04closure_second_accept",
  }, { now: new Date("2026-09-29T18:07:00.000Z") });
  assert.equal(secondAccept.membershipCommitted, true);

  const [activePointer, oldHistory, secondHistory] = await Promise.all([
    adminDb.collection("agency_user_memberships").doc(userUid).get(),
    adminDb.collection("agency_memberships")
      .doc(firstAgencyId + "__" + userUid).get(),
    adminDb.collection("agency_memberships")
      .doc(secondAgencyId + "__" + userUid).get(),
  ]);
  assert.equal(activePointer.data().agencyId, secondAgencyId);
  assert.equal(activePointer.data().status, "active");
  assert.equal(oldHistory.data().status, "left");
  assert.equal(secondHistory.data().status, "active");

  secondAgency = await adminDb.collection("agencies").doc(secondAgencyId).get();
  assert.equal(secondAgency.data().memberCount, 2);
  assert.equal(secondAgency.data().hostCount, 1);

  // 04-C1/C2 removal path: agency owner can remove once; cooldown starts again.
  const removeBody = {
    agencyId: secondAgencyId,
    targetUid: userUid,
    reason: "stage04_closure_remove",
    idempotencyKey: "stage04closure_remove_user",
  };
  const removed = await removeAgencyMember(
    db,
    secondOwnerUid,
    removeBody,
    { now: new Date("2026-09-29T18:08:00.000Z") },
  );
  const duplicateRemove = await removeAgencyMember(
    db,
    secondOwnerUid,
    removeBody,
    { now: new Date("2026-09-29T18:08:30.000Z") },
  );
  assert.equal(removed.status, "removed");
  assert.equal(duplicateRemove.code, "duplicate");
  assert.equal(
    new Date(removed.cooldownUntil).toISOString(),
    "2026-10-06T18:08:00.000Z",
  );

  const [finalPointer, finalAgency, finalUser, overrideAudit] = await Promise.all([
    adminDb.collection("agency_user_memberships").doc(userUid).get(),
    adminDb.collection("agencies").doc(secondAgencyId).get(),
    adminDb.collection("users").doc(userUid).get(),
    adminDb.collection("admin_audit_logs")
      .doc(
        "agency_cooldown_override_" +
        platformOwnerUid +
        "__stage04closure_override_wait",
      ).get(),
  ]);
  assert.equal(finalPointer.data().status, "removed");
  assert.equal(finalAgency.data().memberCount, 1);
  assert.equal(finalAgency.data().hostCount, 0);
  assert.equal(finalUser.data().agencyId, "");
  assert.equal(finalUser.data().agencyRole, "");
  assert.equal(overrideAudit.data().action, "overrideAgencyRejoinCooldown");

  // No cross-agency double-active state survives the lifecycle.
  const firstHistory = await adminDb.collection("agency_memberships")
    .doc(firstAgencyId + "__" + userUid).get();
  const secondFinalHistory = await adminDb.collection("agency_memberships")
    .doc(secondAgencyId + "__" + userUid).get();
  assert.equal(firstHistory.data().status, "left");
  assert.equal(secondFinalHistory.data().status, "removed");
});
