import assert from "node:assert/strict";
import { after, test } from "node:test";
import { deleteApp, getApps, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

import {
  getMyAgencyJoinEligibility,
  overrideAgencyRejoinCooldown,
  requestAgencyCooldownException,
  requestAgencyJoin,
  respondAgencyMembershipRequest,
} from "../../cloudflare-worker/src/agency-membership.js";
import {
  listAgencyCooldownExceptionRequests,
  reviewAgencyCooldownException,
} from "../../cloudflare-worker/src/agency-control.js";
import { cloudflareFirestoreAdapter } from "./helpers/cloudflare-firestore-adapter.js";

const app = getApps()[0] || initializeApp({ projectId: "shadow-live-economy-test" });
const adminDb = getFirestore(app);
const db = cloudflareFirestoreAdapter(adminDb);

after(async () => { await deleteApp(app); });

async function seedUser(uid, extra = {}) {
  await adminDb.collection("users").doc(uid).set({
    role: "user",
    adminEnabled: false,
    capabilities: [],
    accountStatus: "active",
    agencyId: "",
    agencyRole: "",
    ...extra,
  });
}

async function seedAgency(agencyId, ownerUid) {
  await seedUser(ownerUid, { publicId: agencyId.slice(0, 5) + "9" });
  await adminDb.collection("agencies").doc(agencyId).set({
    schemaVersion: 1,
    agencyId,
    publicId: agencyId,
    name: "Override Agency " + agencyId,
    ownerUid,
    status: "active",
    memberCount: 1,
    hostCount: 0,
    managerCount: 0,
    seniorManagerCount: 0,
    updatedAt: new Date(),
  });
  const ownerMembership = {
    schemaVersion: 1,
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

async function seedHistoricalMembership(uid, agencyId, cooldownUntil) {
  await seedUser(uid, { publicId: "681101" });
  const historical = {
    schemaVersion: 1,
    agencyId,
    uid,
    role: "host",
    status: "left",
    joinedAt: new Date("2026-09-20T00:00:00.000Z"),
    updatedAt: new Date("2026-09-28T22:00:00.000Z"),
    leftAt: new Date("2026-09-28T22:00:00.000Z"),
    removedAt: null,
    cooldownUntil,
  };
  await Promise.all([
    adminDb.collection("agency_memberships")
      .doc(agencyId + "__" + uid).set(historical),
    adminDb.collection("agency_user_memberships").doc(uid).set(historical),
  ]);
}

test("platform owner can override active rejoin cooldown exactly once with audit", async () => {
  const oldAgencyId = "681001";
  const newAgencyId = "681002";
  const targetUid = "stage04c3_target";
  const platformOwnerUid = "stage04c3_platform_owner";
  const newOwnerUid = "stage04c3_new_owner";
  const now = new Date("2026-09-29T00:00:00.000Z");
  await seedAgency(oldAgencyId, "stage04c3_old_owner");
  await seedAgency(newAgencyId, newOwnerUid);
  await seedUser(platformOwnerUid, {
    role: "owner",
    adminEnabled: true,
    capabilities: [],
    publicId: "681999",
  });
  await seedHistoricalMembership(
    targetUid,
    oldAgencyId,
    new Date("2026-10-05T22:00:00.000Z"),
  );

  const body = {
    targetUid,
    reason: "approved_support_exception",
    idempotencyKey: "stage04c3_override_0001",
  };
  const first = await overrideAgencyRejoinCooldown(
    db,
    platformOwnerUid,
    body,
    { now },
  );
  const duplicate = await overrideAgencyRejoinCooldown(
    db,
    platformOwnerUid,
    body,
    { now },
  );

  assert.equal(first.overrideApplied, true);
  assert.equal(first.previousCooldownUntil, "2026-10-05T22:00:00.000Z");
  assert.equal(duplicate.code, "duplicate");

  const eventId = platformOwnerUid + "__stage04c3_override_0001";
  const [pointer, history, audit, notification] = await Promise.all([
    adminDb.collection("agency_user_memberships").doc(targetUid).get(),
    adminDb.collection("agency_memberships").doc(oldAgencyId + "__" + targetUid).get(),
    adminDb.collection("admin_audit_logs")
      .doc("agency_cooldown_override_" + eventId).get(),
    adminDb.collection("notifications")
      .doc("agency_cooldown_override_" + eventId).get(),
  ]);
  assert.equal(pointer.data().cooldownUntil.toDate().toISOString(), now.toISOString());
  assert.equal(history.data().cooldownUntil.toDate().toISOString(), now.toISOString());
  assert.equal(audit.data().action, "overrideAgencyRejoinCooldown");
  assert.equal(audit.data().after.reason, "approved_support_exception");
  assert.equal(notification.data().userId, targetUid);

  const join = await requestAgencyJoin(db, targetUid, {
    agencyId: newAgencyId,
    idempotencyKey: "stage04c3_join_0001",
  }, { now: new Date("2026-09-29T00:01:00.000Z") });
  const accepted = await respondAgencyMembershipRequest(db, newOwnerUid, {
    requestId: join.requestId,
    decision: "accept",
    idempotencyKey: "stage04c3_accept_0001",
  }, { now: new Date("2026-09-29T00:02:00.000Z") });

  assert.equal(accepted.membershipCommitted, true);
  const activePointer = await adminDb.collection("agency_user_memberships")
    .doc(targetUid).get();
  assert.equal(activePointer.data().agencyId, newAgencyId);
  assert.equal(activePointer.data().status, "active");
});

test("user requests 7-day exception and Shadow Owner approves it through review queue", async () => {
  const agencyId = "681011";
  const targetUid = "stage04c3_exception_target";
  const platformOwnerUid = "stage04c3_exception_owner";
  const now = new Date("2026-09-29T02:00:00.000Z");
  await seedAgency(agencyId, "stage04c3_exception_old_owner");
  await seedUser(platformOwnerUid, {
    role: "owner",
    adminEnabled: true,
    publicId: "681998",
  });
  await seedHistoricalMembership(
    targetUid,
    agencyId,
    new Date("2026-10-05T22:00:00.000Z"),
  );

  const before = await getMyAgencyJoinEligibility(db, targetUid, {
    nowMs: now.getTime(),
  });
  assert.equal(before.canRequestJoin, false);
  assert.equal(before.cooldown.active, true);
  assert.equal(before.cooldown.exceptionRequest, null);

  const request = await requestAgencyCooldownException(
    db,
    targetUid,
    {
      reason: "احتاج الانضمام إلى وكالة جديدة",
      idempotencyKey: "stage04c3_exception_request_0001",
    },
    { now },
  );
  assert.equal(request.status, "pending");

  const pending = await listAgencyCooldownExceptionRequests(db, 25);
  assert.equal(
    pending.some((item) => item.uid === targetUid),
    true,
  );

  const eligibility = await getMyAgencyJoinEligibility(db, targetUid, {
    nowMs: now.getTime(),
  });
  assert.equal(eligibility.cooldown.exceptionRequest.status, "pending");

  const reviewed = await reviewAgencyCooldownException(
    db,
    platformOwnerUid,
    {
      requestId: targetUid,
      decision: "accept",
      idempotencyKey: "stage04c3_exception_accept_0001",
    },
    { now: new Date("2026-09-29T02:05:00.000Z") },
  );
  assert.equal(reviewed.status, "accepted");

  const [pointer, requestDoc, notification] = await Promise.all([
    adminDb.collection("agency_user_memberships").doc(targetUid).get(),
    adminDb.collection("agency_cooldown_exception_requests").doc(targetUid).get(),
    adminDb.collection("notifications")
      .doc(
        "agency_cooldown_override_" +
          platformOwnerUid +
          "__stage04c3_exception_accept_0001",
      )
      .get(),
  ]);
  assert.equal(
    pointer.data().cooldownUntil.toDate().toISOString(),
    "2026-09-29T02:05:00.000Z",
  );
  assert.equal(requestDoc.data().status, "accepted");
  assert.equal(notification.data().mandatory, true);

  const after = await getMyAgencyJoinEligibility(db, targetUid, {
    nowMs: new Date("2026-09-29T02:05:00.000Z").getTime(),
  });
  assert.equal(after.cooldown.active, false);
  assert.equal(after.canRequestJoin, true);
});

test("Shadow Control rejects cooldown exception without lifting wait", async () => {
  const agencyId = "681012";
  const targetUid = "stage04c3_exception_reject_target";
  const platformOwnerUid = "stage04c3_exception_reject_owner";
  const cooldownUntil = new Date("2026-10-05T22:00:00.000Z");
  await seedAgency(agencyId, "stage04c3_exception_reject_old_owner");
  await seedUser(platformOwnerUid, {
    role: "owner",
    adminEnabled: true,
    publicId: "681997",
  });
  await seedHistoricalMembership(targetUid, agencyId, cooldownUntil);

  await requestAgencyCooldownException(
    db,
    targetUid,
    {
      reason: "طلب استثناء للاختبار",
      idempotencyKey: "stage04c3_exception_reject_req",
    },
    { now: new Date("2026-09-29T03:00:00.000Z") },
  );
  const reviewed = await reviewAgencyCooldownException(
    db,
    platformOwnerUid,
    {
      requestId: targetUid,
      decision: "reject",
      reason: "الطلب غير مؤهل للاستثناء",
      idempotencyKey: "stage04c3_exception_reject_review",
    },
    { now: new Date("2026-09-29T03:05:00.000Z") },
  );
  assert.equal(reviewed.status, "rejected");

  const [pointer, requestDoc, notification] = await Promise.all([
    adminDb.collection("agency_user_memberships").doc(targetUid).get(),
    adminDb.collection("agency_cooldown_exception_requests").doc(targetUid).get(),
    adminDb.collection("notifications")
      .doc("agency_cooldown_exception_rejected_" + targetUid).get(),
  ]);
  assert.equal(
    pointer.data().cooldownUntil.toDate().toISOString(),
    cooldownUntil.toISOString(),
  );
  assert.equal(requestDoc.data().status, "rejected");
  assert.equal(notification.data().mandatory, true);
});

test("delegated admin with manageAgencyMemberships can override cooldown", async () => {
  const agencyId = "682001";
  const targetUid = "stage04c3_delegated_target";
  const adminUid = "stage04c3_delegated_admin";
  await seedAgency(agencyId, "stage04c3_delegated_old_owner");
  await seedUser(adminUid, {
    role: "admin",
    adminEnabled: true,
    capabilities: ["manageAgencyMemberships"],
    publicId: "682999",
  });
  await seedHistoricalMembership(
    targetUid,
    agencyId,
    new Date("2026-10-05T22:00:00.000Z"),
  );

  const result = await overrideAgencyRejoinCooldown(db, adminUid, {
    targetUid,
    reason: "delegated_admin_exception",
    idempotencyKey: "stage04c3_delegated_0001",
  }, { now: new Date("2026-09-29T01:00:00.000Z") });

  assert.equal(result.overrideApplied, true);
});

test("regular user and disabled admin cannot override cooldown", async () => {
  const agencyId = "683001";
  const targetUid = "stage04c3_forbid_target";
  const regularUid = "stage04c3_regular";
  const disabledAdminUid = "stage04c3_disabled_admin";
  await seedAgency(agencyId, "stage04c3_forbid_old_owner");
  await seedUser(regularUid, { publicId: "683997" });
  await seedUser(disabledAdminUid, {
    role: "admin",
    adminEnabled: false,
    capabilities: ["manageAgencyMemberships"],
    publicId: "683998",
  });
  await seedHistoricalMembership(
    targetUid,
    agencyId,
    new Date("2026-10-05T22:00:00.000Z"),
  );

  for (const [actorUid, key] of [
    [regularUid, "stage04c3_forbid_regular"],
    [disabledAdminUid, "stage04c3_forbid_disabled"],
  ]) {
    await assert.rejects(
      overrideAgencyRejoinCooldown(db, actorUid, {
        targetUid,
        reason: "not_allowed",
        idempotencyKey: key,
      }, { now: new Date("2026-09-29T01:00:00.000Z") }),
      /forbidden/,
    );
  }

  const pointer = await adminDb.collection("agency_user_memberships")
    .doc(targetUid).get();
  assert.equal(
    pointer.data().cooldownUntil.toDate().toISOString(),
    "2026-10-05T22:00:00.000Z",
  );
});

test("override requires an active historical cooldown and a reason", async () => {
  const agencyId = "684001";
  const targetUid = "stage04c3_reason_target";
  const ownerUid = "stage04c3_reason_owner";
  await seedAgency(agencyId, "stage04c3_reason_old_owner");
  await seedUser(ownerUid, {
    role: "owner",
    adminEnabled: true,
    publicId: "684999",
  });
  await seedHistoricalMembership(
    targetUid,
    agencyId,
    new Date("2026-10-05T22:00:00.000Z"),
  );

  await assert.rejects(
    overrideAgencyRejoinCooldown(db, ownerUid, {
      targetUid,
      reason: "",
      idempotencyKey: "stage04c3_reason_0001",
    }),
    /cooldown_override_reason_required/,
  );

  await adminDb.collection("agency_user_memberships").doc(targetUid).set({
    cooldownUntil: new Date("2026-09-28T00:00:00.000Z"),
  }, { merge: true });
  await adminDb.collection("agency_memberships").doc(agencyId + "__" + targetUid).set({
    cooldownUntil: new Date("2026-09-28T00:00:00.000Z"),
  }, { merge: true });

  await assert.rejects(
    overrideAgencyRejoinCooldown(db, ownerUid, {
      targetUid,
      reason: "late_exception",
      idempotencyKey: "stage04c3_expired_0001",
    }, { now: new Date("2026-09-29T01:00:00.000Z") }),
    /agency_rejoin_cooldown_not_active/,
  );
});
