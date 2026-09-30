import assert from "node:assert/strict";
import { after, test } from "node:test";
import { deleteApp, getApps, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

import {
  releaseAgencyApplicationHost,
  reserveAgencyApplicationHost,
  submitAgencyApplication,
} from "../../cloudflare-worker/src/agency-application.js";
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
    await adminDb.collection("public_ids").doc(publicId).set({
      uid,
      createdAt: new Date(),
    });
  }
}

async function seedFiveHosts(prefix, ids) {
  const uids = ids.map((id, index) => `${prefix}_host_${index + 1}`);
  await Promise.all(
    uids.map((uid, index) => seedUser(uid, ids[index])),
  );
  return uids;
}

test("host verification reserves 3-8 digit ids until release or final decision", async () => {
  const applicantUid = "stage03_reserve_applicant";
  const otherApplicantUid = "stage03_reserve_other";
  const hostUid = "stage03_reserve_host";
  await seedUser(applicantUid, "319910");
  await seedUser(otherApplicantUid, "319911");
  await seedUser(hostUid, "123", { displayName: "Reserved Host" });

  const key = "stage03_reserve_key_0001";
  const reserved = await reserveAgencyApplicationHost(
    db,
    applicantUid,
    {
      hostId: "123",
      idempotencyKey: key,
    },
    { now: new Date("2026-09-28T14:00:00.000Z") },
  );

  assert.equal(reserved.ok, true);
  assert.equal(reserved.requiredHostCount, 5);
  assert.equal(reserved.host.uid, hostUid);
  assert.equal(reserved.host.publicId, "123");
  assert.equal(reserved.host.displayName, "Reserved Host");

  const [applicantLock, hostLock] = await Promise.all([
    adminDb.collection("agency_application_locks").doc(applicantUid).get(),
    adminDb.collection("agency_application_locks").doc(hostUid).get(),
  ]);
  assert.equal(applicantLock.data().status, "draft");
  assert.deepEqual(applicantLock.data().hostIds, ["123"]);
  assert.equal(hostLock.data().status, "reserved");
  assert.equal(hostLock.data().hostPublicId, "123");

  await assert.rejects(
    reserveAgencyApplicationHost(db, otherApplicantUid, {
      hostId: "123",
      idempotencyKey: "stage03_reserve_other_0001",
    }),
    /agency_host_application_conflict/,
  );

  const released = await releaseAgencyApplicationHost(db, applicantUid, {
    hostId: "123",
    idempotencyKey: key,
  });
  assert.equal(released.ok, true);
  assert.equal(
    (await adminDb.collection("agency_application_locks").doc(hostUid).get())
      .data().status,
    "released",
  );

  const reservedAgain = await reserveAgencyApplicationHost(
    db,
    otherApplicantUid,
    {
      hostId: "123",
      idempotencyKey: "stage03_reserve_other_0001",
    },
  );
  assert.equal(reservedAgain.ok, true);
});

test("agency application creates one pending application with five public host ids and locks", async () => {
  const applicantUid = "stage03_applicant_success";
  const applicantPublicId = "319900";
  const hostIds = ["310001", "310002", "310003", "310004", "310005"];
  const hostUids = await seedFiveHosts("stage03_success", hostIds);
  await seedUser(applicantUid, applicantPublicId);

  const body = {
    name: "Shadow Agency Test",
    country: "UAE",
    hostIds,
    idempotencyKey: "stage03_success_key_0001",
  };
  const first = await submitAgencyApplication(
    db,
    applicantUid,
    body,
    { now: new Date("2026-09-28T15:00:00.000Z") },
  );

  assert.equal(first.ok, true);
  assert.equal(first.code, "ok");
  assert.equal(first.status, "pending");
  assert.deepEqual(first.hostIds, hostIds);

  const [application, operation, applicantLock, audit, ...hostLocks] =
    await Promise.all([
      adminDb.collection("agency_applications").doc(first.applicationId).get(),
      adminDb.collection("agency_application_operations")
        .doc(applicantUid + "__" + body.idempotencyKey).get(),
      adminDb.collection("agency_application_locks").doc(applicantUid).get(),
      adminDb.collection("admin_audit_logs")
        .doc("agency_application_submit_" + first.applicationId).get(),
      ...hostUids.map((uid) =>
        adminDb.collection("agency_application_locks").doc(uid).get()
      ),
    ]);

  assert.equal(application.exists, true);
  assert.equal(application.data().applicantUid, applicantUid);
  assert.equal(application.data().applicantPublicId, applicantPublicId);
  assert.deepEqual(application.data().hostIds, hostIds);
  assert.deepEqual(application.data().hostUids, hostUids);
  assert.equal(application.data().status, "pending");
  assert.equal(operation.data().status, "completed");
  assert.equal(applicantLock.data().participantType, "applicant");
  assert.equal(applicantLock.data().status, "pending");
  assert.equal(audit.data().action, "submitAgencyApplication");
  assert.equal(hostLocks.length, 5);
  for (const lock of hostLocks) {
    assert.equal(lock.exists, true);
    assert.equal(lock.data().participantType, "host_candidate");
    assert.equal(lock.data().status, "pending");
  }

  const duplicate = await submitAgencyApplication(db, applicantUid, body);
  assert.equal(duplicate.code, "duplicate");
  assert.equal(duplicate.applicationId, first.applicationId);

  await assert.rejects(
    submitAgencyApplication(db, applicantUid, {
      ...body,
      name: "Changed Name",
    }),
    /idempotency_conflict/,
  );

  await assert.rejects(
    submitAgencyApplication(db, applicantUid, {
      ...body,
      idempotencyKey: "stage03_success_key_0002",
    }),
    /agency_application_already_pending/,
  );
});

test("agency application rejects invalid or unavailable host public ids", async () => {
  const applicantUid = "stage03_applicant_missing_host";
  await seedUser(applicantUid, "319901");
  const hostIds = ["311001", "311002", "311003", "311004", "311005"];
  await seedFiveHosts("stage03_missing", hostIds.slice(0, 4));

  await assert.rejects(
    submitAgencyApplication(db, applicantUid, {
      name: "Missing Host Agency",
      hostIds,
      idempotencyKey: "stage03_missing_key_0001",
    }),
    /agency_host_id_not_found/,
  );

  await assert.rejects(
    submitAgencyApplication(db, applicantUid, {
      name: "Bad Host Count",
      hostIds: hostIds.slice(0, 4),
      idempotencyKey: "stage03_missing_key_0002",
    }),
    /invalid_agency_application_hosts/,
  );
});

test("agency application rejects applicant or host already in an agency", async () => {
  const applicantUid = "stage03_applicant_membership";
  const hostIds = ["312001", "312002", "312003", "312004", "312005"];
  await seedFiveHosts("stage03_member", hostIds);
  await seedUser(applicantUid, "319902", { agencyId: "654321" });

  await assert.rejects(
    submitAgencyApplication(db, applicantUid, {
      name: "Applicant Conflict",
      hostIds,
      idempotencyKey: "stage03_member_key_0001",
    }),
    /applicant_already_in_agency/,
  );

  const cleanApplicant = "stage03_applicant_host_membership";
  await seedUser(cleanApplicant, "319903");
  await adminDb.collection("users").doc("stage03_member_host_3").set(
    { agencyId: "654322" },
    { merge: true },
  );

  await assert.rejects(
    submitAgencyApplication(db, cleanApplicant, {
      name: "Host Conflict",
      hostIds,
      idempotencyKey: "stage03_member_key_0002",
    }),
    /agency_host_already_in_agency/,
  );
});

test("active application locks prevent conflicting agency applications", async () => {
  const applicantUid = "stage03_applicant_lock";
  const hostIds = ["313001", "313002", "313003", "313004", "313005"];
  const hostUids = await seedFiveHosts("stage03_lock", hostIds);
  await seedUser(applicantUid, "319904");

  await adminDb.collection("agency_application_locks").doc(hostUids[1]).set({
    applicationId: "other_application",
    applicantUid: "other_applicant",
    participantType: "host_candidate",
    status: "under_review",
    createdAt: new Date(),
  });

  await assert.rejects(
    submitAgencyApplication(db, applicantUid, {
      name: "Locked Host Agency",
      hostIds,
      idempotencyKey: "stage03_lock_key_0001",
    }),
    /agency_host_application_conflict/,
  );
});

test("reapply policy blocks manual and early timed retry but allows expired cooldown", async () => {
  const hostIds = ["314001", "314002", "314003", "314004", "314005"];
  await seedFiveHosts("stage03_reapply", hostIds);
  const now = new Date("2026-09-28T15:00:00.000Z");

  const manualUid = "stage03_reapply_manual";
  await seedUser(manualUid, "319905");
  await adminDb.collection("agency_application_locks").doc(manualUid).set({
    applicationId: "old_manual",
    applicantUid: manualUid,
    participantType: "applicant",
    status: "rejected",
    reapplyMode: "manual",
    reapplyAllowedAt: null,
  });
  await assert.rejects(
    submitAgencyApplication(db, manualUid, {
      name: "Manual Block",
      hostIds,
      idempotencyKey: "stage03_manual_key_0001",
    }, { now }),
    /agency_reapply_blocked/,
  );

  const earlyUid = "stage03_reapply_early";
  await seedUser(earlyUid, "319906");
  await adminDb.collection("agency_application_locks").doc(earlyUid).set({
    applicationId: "old_early",
    applicantUid: earlyUid,
    participantType: "applicant",
    status: "rejected",
    reapplyMode: "24h",
    reapplyAllowedAt: new Date("2026-09-29T15:00:00.000Z"),
  });
  await assert.rejects(
    submitAgencyApplication(db, earlyUid, {
      name: "Early Retry",
      hostIds,
      idempotencyKey: "stage03_early_key_0001",
    }, { now }),
    /agency_reapply_too_early/,
  );

  const allowedUid = "stage03_reapply_allowed";
  await seedUser(allowedUid, "319907");
  await adminDb.collection("agency_application_locks").doc(allowedUid).set({
    applicationId: "old_allowed",
    applicantUid: allowedUid,
    participantType: "applicant",
    status: "rejected",
    reapplyMode: "7d",
    reapplyAllowedAt: new Date("2026-09-27T15:00:00.000Z"),
    rejectedAt: new Date("2026-09-20T15:00:00.000Z"),
    rejectedBy: "admin_old",
    rejectionReason: "old reason",
  });
  const result = await submitAgencyApplication(db, allowedUid, {
    name: "Allowed Retry",
    hostIds,
    idempotencyKey: "stage03_allowed_key_0001",
  }, { now });
  assert.equal(result.code, "ok");
  const lock = await adminDb.collection("agency_application_locks")
    .doc(allowedUid).get();
  assert.equal(lock.data().status, "pending");
  assert.equal(lock.data().reapplyMode, null);
  assert.equal(lock.data().reapplyAllowedAt, null);
  assert.equal(lock.data().rejectedAt, null);
  assert.equal(lock.data().rejectedBy, null);
  assert.equal(lock.data().rejectionReason, null);
});

test("applicant cannot use own public id as one of the five hosts", async () => {
  const applicantUid = "stage03_applicant_self";
  const applicantPublicId = "315001";
  await seedUser(applicantUid, applicantPublicId);
  const hostIds = [applicantPublicId, "315002", "315003", "315004", "315005"];
  await seedFiveHosts("stage03_self", hostIds.slice(1));

  await assert.rejects(
    submitAgencyApplication(db, applicantUid, {
      name: "Self Host Agency",
      hostIds,
      idempotencyKey: "stage03_self_key_0001",
    }),
    /applicant_cannot_be_application_host/,
  );
});
