import assert from "node:assert/strict";
import { after, test } from "node:test";
import { deleteApp, getApps, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

import {
  getAgencyApplicationStatus,
  submitAgencyApplication,
} from "../../cloudflare-worker/src/agency-application.js";
import {
  allowAgencyReapply,
  listAgencyManualReapplyBlocks,
  reapplyAllowedAtForMode,
  rejectAgencyApplication,
} from "../../cloudflare-worker/src/agency-control.js";
import { cloudflareFirestoreAdapter } from "./helpers/cloudflare-firestore-adapter.js";

const app = getApps()[0] || initializeApp({ projectId: "shadow-live-economy-test" });
const adminDb = getFirestore(app);
const db = cloudflareFirestoreAdapter(adminDb);

after(async () => { await deleteApp(app); });

async function seedUser(uid, publicId = null, extra = {}) {
  await adminDb.collection("users").doc(uid).set({
    role: "user",
    adminEnabled: false,
    capabilities: [],
    accountStatus: "active",
    agencyId: "",
    publicId: publicId || "",
    ...extra,
  });
  if (publicId) {
    await adminDb.collection("public_ids").doc(publicId).set({ uid });
  }
}

async function seedApplication(prefix, ownerPublicId, hostIds) {
  const ownerUid = prefix + "_owner";
  await seedUser(ownerUid, ownerPublicId);
  const hostUids = [];
  for (let i = 0; i < hostIds.length; i += 1) {
    const uid = prefix + "_host_" + (i + 1);
    hostUids.push(uid);
    await seedUser(uid, hostIds[i]);
  }
  const result = await submitAgencyApplication(db, ownerUid, {
    name: "Agency " + prefix,
    country: "UAE",
    hostIds,
    idempotencyKey: prefix + "_submit_key_0001",
  }, { now: new Date("2026-09-28T15:00:00.000Z") });
  return {
    ownerUid,
    hostUids,
    applicationId: result.applicationId,
    hostIds,
  };
}

test("reapply modes calculate exact server-side deadlines", () => {
  const now = new Date("2026-09-28T16:00:00.000Z");
  assert.equal(
    reapplyAllowedAtForMode("immediate", now).toISOString(),
    "2026-09-28T16:00:00.000Z",
  );
  assert.equal(
    reapplyAllowedAtForMode("24h", now).toISOString(),
    "2026-09-29T16:00:00.000Z",
  );
  assert.equal(
    reapplyAllowedAtForMode("3d", now).toISOString(),
    "2026-10-01T16:00:00.000Z",
  );
  assert.equal(
    reapplyAllowedAtForMode("7d", now).toISOString(),
    "2026-10-05T16:00:00.000Z",
  );
  assert.equal(
    reapplyAllowedAtForMode("30d", now).toISOString(),
    "2026-10-28T16:00:00.000Z",
  );
  assert.equal(reapplyAllowedAtForMode("manual", now), null);
  assert.throws(
    () => reapplyAllowedAtForMode("2d", now),
    /invalid_agency_reapply_mode/,
  );
});

test("24h rejection records reason deadline audit notification and releases host locks", async () => {
  const seeded = await seedApplication(
    "stage03c_24h",
    "331901",
    ["331001","331002","331003","331004","331005"],
  );
  const rejectedAt = new Date("2026-09-28T16:00:00.000Z");
  const result = await rejectAgencyApplication(
    db,
    "reviewer_stage03c",
    {
      applicationId: seeded.applicationId,
      rejectionReason: "بيانات الوكالة تحتاج مراجعة",
      reapplyMode: "24h",
      idempotencyKey: "stage03c_reject_24h_0001",
    },
    { now: rejectedAt },
  );

  assert.equal(result.ok, true);
  assert.equal(result.status, "rejected");
  assert.equal(result.reapplyMode, "24h");
  assert.equal(
    result.reapplyAllowedAt.toISOString(),
    "2026-09-29T16:00:00.000Z",
  );

  const [
    application,
    applicantLock,
    operation,
    audit,
    notification,
    ...hostLocks
  ] = await Promise.all([
    adminDb.collection("agency_applications").doc(seeded.applicationId).get(),
    adminDb.collection("agency_application_locks").doc(seeded.ownerUid).get(),
    adminDb.collection("agency_review_operations")
      .doc("reviewer_stage03c__stage03c_reject_24h_0001").get(),
    adminDb.collection("admin_audit_logs")
      .doc("agency_application_reject_" + seeded.applicationId).get(),
    adminDb.collection("notifications")
      .doc("agency_application_rejected_" + seeded.applicationId).get(),
    ...seeded.hostUids.map((uid) =>
      adminDb.collection("agency_application_locks").doc(uid).get()
    ),
  ]);

  assert.equal(application.data().status, "rejected");
  assert.equal(application.data().rejectedBy, "reviewer_stage03c");
  assert.equal(application.data().rejectionReason, "بيانات الوكالة تحتاج مراجعة");
  assert.equal(application.data().reapplyMode, "24h");
  assert.equal(applicantLock.data().status, "rejected");
  assert.equal(applicantLock.data().reapplyMode, "24h");
  assert.equal(operation.data().status, "completed");
  assert.equal(audit.data().action, "rejectAgencyApplication");
  assert.equal(notification.data().userId, seeded.ownerUid);
  assert.equal(notification.data().type, "agency_application_rejected");
  assert.equal(notification.data().read, false);
  for (const lock of hostLocks) {
    assert.equal(lock.data().status, "released");
    assert.equal(lock.data().reapplyMode, null);
    assert.equal(lock.data().reapplyAllowedAt, null);
  }

  const statusBefore = await getAgencyApplicationStatus(
    db,
    seeded.ownerUid,
    { now: new Date("2026-09-28T20:00:00.000Z") },
  );
  assert.equal(statusBefore.status, "rejected");
  assert.equal(statusBefore.canReapply, false);
  assert.equal(statusBefore.reapplyMode, "24h");
  assert.ok(statusBefore.remainingSeconds > 0);
  assert.equal(
    statusBefore.rejectionReason,
    "بيانات الوكالة تحتاج مراجعة",
  );

  await assert.rejects(
    submitAgencyApplication(db, seeded.ownerUid, {
      name: "Retry Too Early",
      country: "UAE",
      hostIds: seeded.hostIds,
      idempotencyKey: "stage03c_retry_early_0001",
    }, { now: new Date("2026-09-29T15:59:59.000Z") }),
    /agency_reapply_too_early/,
  );

  const statusAfter = await getAgencyApplicationStatus(
    db,
    seeded.ownerUid,
    { now: new Date("2026-09-29T16:00:00.000Z") },
  );
  assert.equal(statusAfter.canReapply, true);
  assert.equal(statusAfter.remainingSeconds, 0);

  const retry = await submitAgencyApplication(
    db,
    seeded.ownerUid,
    {
      name: "Retry Allowed",
      country: "UAE",
      hostIds: seeded.hostIds,
      idempotencyKey: "stage03c_retry_allowed_0001",
    },
    { now: new Date("2026-09-29T16:00:01.000Z") },
  );
  assert.equal(retry.status, "pending");
});

test("rejection is idempotent and conflicting reuse of key is blocked", async () => {
  const seeded = await seedApplication(
    "stage03c_idempotent",
    "332901",
    ["332001","332002","332003","332004","332005"],
  );
  const body = {
    applicationId: seeded.applicationId,
    rejectionReason: "الطلب غير مكتمل",
    reapplyMode: "3d",
    idempotencyKey: "stage03c_reject_idempotent_0001",
  };
  const first = await rejectAgencyApplication(db, "reviewer_stage03c", body, {
    now: new Date("2026-09-28T17:00:00.000Z"),
  });
  const duplicate = await rejectAgencyApplication(db, "reviewer_stage03c", body, {
    now: new Date("2026-09-28T18:00:00.000Z"),
  });
  assert.equal(first.code, "ok");
  assert.equal(duplicate.code, "duplicate");
  assert.equal(duplicate.applicationId, seeded.applicationId);

  await assert.rejects(
    rejectAgencyApplication(db, "reviewer_stage03c", {
      ...body,
      rejectionReason: "سبب مختلف",
    }),
    /idempotency_conflict/,
  );
});

test("manual rejection blocks until Control explicitly allows reapply", async () => {
  const seeded = await seedApplication(
    "stage03c_manual",
    "333901",
    ["333001","333002","333003","333004","333005"],
  );
  await rejectAgencyApplication(db, "reviewer_stage03c", {
    applicationId: seeded.applicationId,
    rejectionReason: "مطلوب مراجعة يدوية قبل إعادة التقديم",
    reapplyMode: "manual",
    idempotencyKey: "stage03c_reject_manual_0001",
  }, { now: new Date("2026-09-28T18:00:00.000Z") });

  const status = await getAgencyApplicationStatus(db, seeded.ownerUid, {
    now: new Date("2027-09-28T18:00:00.000Z"),
  });
  assert.equal(status.canReapply, false);
  assert.equal(status.reapplyMode, "manual");
  assert.equal(status.reapplyAllowedAt, null);

  const blocks = await listAgencyManualReapplyBlocks(db, 25);
  assert.ok(
    blocks.some((block) => block.applicationId === seeded.applicationId),
  );

  await assert.rejects(
    submitAgencyApplication(db, seeded.ownerUid, {
      name: "Manual Block Retry",
      hostIds: seeded.hostIds,
      idempotencyKey: "stage03c_manual_retry_0001",
    }, { now: new Date("2027-09-28T18:00:00.000Z") }),
    /agency_reapply_blocked/,
  );

  const unblocked = await allowAgencyReapply(
    db,
    "reviewer_stage03c",
    {
      applicationId: seeded.applicationId,
      idempotencyKey: "stage03c_manual_unblock_0001",
    },
    { now: new Date("2027-09-28T18:10:00.000Z") },
  );
  assert.equal(unblocked.code, "ok");
  assert.equal(unblocked.reapplyMode, "immediate");

  const [manualBlock, notification, audit] = await Promise.all([
    adminDb.collection("agency_manual_reapply_blocks")
      .doc(seeded.applicationId).get(),
    adminDb.collection("notifications")
      .doc("agency_reapply_unblocked_" + seeded.applicationId).get(),
    adminDb.collection("admin_audit_logs")
      .doc("agency_reapply_unblock_" + seeded.applicationId).get(),
  ]);
  assert.equal(manualBlock.exists, false);
  assert.equal(notification.data().userId, seeded.ownerUid);
  assert.equal(notification.data().type, "agency_reapply_unblocked");
  assert.equal(audit.data().action, "allowAgencyReapply");

  const statusAfter = await getAgencyApplicationStatus(db, seeded.ownerUid, {
    now: new Date("2027-09-28T18:10:00.000Z"),
  });
  assert.equal(statusAfter.canReapply, true);
  assert.equal(statusAfter.reapplyMode, "immediate");

  const retry = await submitAgencyApplication(
    db,
    seeded.ownerUid,
    {
      name: "Manual Block Cleared Retry",
      hostIds: seeded.hostIds,
      idempotencyKey: "stage03c_manual_retry_0002",
    },
    { now: new Date("2027-09-28T18:10:01.000Z") },
  );
  assert.equal(retry.status, "pending");
});

test("immediate rejection allows a new application right away", async () => {
  const seeded = await seedApplication(
    "stage03c_immediate",
    "334901",
    ["334001","334002","334003","334004","334005"],
  );
  const now = new Date("2026-09-28T19:00:00.000Z");
  await rejectAgencyApplication(db, "reviewer_stage03c", {
    applicationId: seeded.applicationId,
    rejectionReason: "يمكن إعادة التقديم بعد تعديل البيانات",
    reapplyMode: "immediate",
    idempotencyKey: "stage03c_reject_immediate_0001",
  }, { now });

  const status = await getAgencyApplicationStatus(db, seeded.ownerUid, { now });
  assert.equal(status.canReapply, true);
  assert.equal(status.reapplyMode, "immediate");

  const retry = await submitAgencyApplication(db, seeded.ownerUid, {
    name: "Immediate Retry",
    hostIds: seeded.hostIds,
    idempotencyKey: "stage03c_immediate_retry_0001",
  }, { now });
  assert.equal(retry.status, "pending");
});

test("approved application cannot be rejected", async () => {
  const seeded = await seedApplication(
    "stage03c_approved_guard",
    "335901",
    ["335001","335002","335003","335004","335005"],
  );
  await adminDb.collection("agency_applications").doc(seeded.applicationId).set(
    { status: "approved", agencyId: "635001" },
    { merge: true },
  );
  await assert.rejects(
    rejectAgencyApplication(db, "reviewer_stage03c", {
      applicationId: seeded.applicationId,
      rejectionReason: "should fail",
      reapplyMode: "24h",
      idempotencyKey: "stage03c_approved_reject_0001",
    }),
    /application_not_rejectable/,
  );
});
