import assert from "node:assert/strict";
import { after, test } from "node:test";
import { deleteApp, getApps, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

import { submitAgencyApplication } from "../../cloudflare-worker/src/agency-application.js";
import {
  approveAgencyApplication,
  directCreateAgency,
  getAgencyApplicationSettings,
  getAgencyReviewDetails,
  listAgencyReviewQueue,
  setAgencyApplicationHostCount,
  startAgencyReview,
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
    agencyRole: "",
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
  return { ownerUid, hostUids, applicationId: result.applicationId };
}

test("Shadow Control can configure application hosts from 0 to 30", async () => {
  const changed = await setAgencyApplicationHostCount(
    db,
    "control_owner_stage03b",
    {
      requiredHostCount: 7,
      idempotencyKey: "stage03b_host_count_set_0001",
    },
    { now: new Date("2026-09-28T15:30:00.000Z") },
  );
  assert.equal(changed.requiredHostCount, 7);
  assert.equal((await getAgencyApplicationSettings(db)).requiredHostCount, 7);

  await assert.rejects(
    setAgencyApplicationHostCount(db, "control_owner_stage03b", {
      requiredHostCount: 31,
      idempotencyKey: "stage03b_host_count_invalid_0001",
    }),
    /invalid_agency_application_host_count/,
  );

  const restored = await setAgencyApplicationHostCount(
    db,
    "control_owner_stage03b",
    {
      requiredHostCount: 5,
      idempotencyKey: "stage03b_host_count_restore_0001",
    },
  );
  assert.equal(restored.requiredHostCount, 5);
});

test("Control can set required application hosts from 0 to 30", async () => {
  const actorUid = "owner_stage03_settings";
  const zero = await setAgencyApplicationHostCount(
    db,
    actorUid,
    {
      requiredHostCount: 0,
      idempotencyKey: "stage03_settings_zero_0001",
    },
    { now: new Date("2026-09-28T15:30:00.000Z") },
  );
  assert.equal(zero.requiredHostCount, 0);
  assert.equal((await getAgencyApplicationSettings(db)).requiredHostCount, 0);

  const thirty = await setAgencyApplicationHostCount(
    db,
    actorUid,
    {
      requiredHostCount: 30,
      idempotencyKey: "stage03_settings_thirty_0001",
    },
    { now: new Date("2026-09-28T15:31:00.000Z") },
  );
  assert.equal(thirty.requiredHostCount, 30);
  assert.equal((await getAgencyApplicationSettings(db)).requiredHostCount, 30);

  await assert.rejects(
    setAgencyApplicationHostCount(db, actorUid, {
      requiredHostCount: 31,
      idempotencyKey: "stage03_settings_invalid_0001",
    }),
    /invalid_agency_application_host_count/,
  );

  await adminDb.collection("system_config").doc("agency_application").delete();
});

test("zero-host applications approve without synthetic host memberships", async () => {
  await adminDb.collection("system_config").doc("agency_application").set({
    requiredHostCount: 0,
  });
  const ownerUid = "stage03b_zero_approve_owner";
  await seedUser(ownerUid, "323990");
  const submitted = await submitAgencyApplication(
    db,
    ownerUid,
    {
      name: "Zero Host Approval",
      hostIds: [],
      idempotencyKey: "stage03b_zero_submit_0001",
    },
    { now: new Date("2026-09-28T15:40:00.000Z") },
  );

  const approved = await approveAgencyApplication(
    db,
    "reviewer_stage03b",
    {
      applicationId: submitted.applicationId,
      idempotencyKey: "stage03b_zero_approve_0001",
    },
    {
      now: new Date("2026-09-28T15:41:00.000Z"),
      agencyIdCandidates: ["623990"],
    },
  );
  assert.equal(approved.hostCount, 0);
  const agency = await adminDb.collection("agencies").doc("623990").get();
  assert.equal(agency.data().memberCount, 1);
  assert.equal(agency.data().hostCount, 0);

  await adminDb.collection("system_config").doc("agency_application").delete();
});

test("review queue stays bounded and includes pending and under review applications", async () => {
  const first = await seedApplication(
    "stage03b_queue_a",
    "321901",
    ["321001","321002","321003","321004","321005"],
  );
  const second = await seedApplication(
    "stage03b_queue_b",
    "322901",
    ["322001","322002","322003","322004","322005"],
  );
  await startAgencyReview(db, "reviewer_stage03b", second.applicationId, {
    now: new Date("2026-09-28T16:00:00.000Z"),
  });

  const rows = await listAgencyReviewQueue(db, 50);
  assert.ok(rows.length <= 50);
  assert.ok(rows.some((row) => row.applicationId === first.applicationId && row.status === "pending"));
  assert.ok(rows.some((row) => row.applicationId === second.applicationId && row.status === "under_review"));
});

test("approval creates the agency and auto-joins every reserved host", async () => {
  const seeded = await seedApplication(
    "stage03b_approve",
    "323901",
    ["323001","323002","323003","323004","323005"],
  );
  const result = await approveAgencyApplication(
    db,
    "reviewer_stage03b",
    {
      applicationId: seeded.applicationId,
      idempotencyKey: "stage03b_approve_operation_0001",
    },
    {
      now: new Date("2026-09-28T16:30:00.000Z"),
      agencyIdCandidates: ["623001"],
    },
  );

  assert.equal(result.ok, true);
  assert.equal(result.agencyId, "623001");

  const [
    registry,
    agency,
    ownerMembership,
    userMembership,
    managerSlots,
    wallet,
    ownerUser,
    application,
    operation,
    audit,
    notification,
    ...hostChecks
  ] = await Promise.all([
    adminDb.collection("agency_ids").doc("623001").get(),
    adminDb.collection("agencies").doc("623001").get(),
    adminDb.collection("agency_memberships").doc("623001__" + seeded.ownerUid).get(),
    adminDb.collection("agency_user_memberships").doc(seeded.ownerUid).get(),
    adminDb.collection("agency_manager_slots").doc("623001").get(),
    adminDb.collection("agency_wallets").doc("623001").get(),
    adminDb.collection("users").doc(seeded.ownerUid).get(),
    adminDb.collection("agency_applications").doc(seeded.applicationId).get(),
    adminDb.collection("agency_creation_operations")
      .doc("reviewer_stage03b__stage03b_approve_operation_0001").get(),
    adminDb.collection("admin_audit_logs")
      .doc("agency_create_623001_stage03b_approve_operation_0001").get(),
    adminDb.collection("notifications")
      .doc("agency_created_623001_stage03b_approve_operation_0001").get(),
    ...seeded.hostUids.flatMap((uid) => [
      adminDb.collection("agency_user_memberships").doc(uid).get(),
      adminDb.collection("agency_memberships").doc("623001__" + uid).get(),
      adminDb.collection("users").doc(uid).get(),
      adminDb.collection("agency_application_locks").doc(uid).get(),
      adminDb.collection("notifications")
        .doc("agency_application_host_approved_" + seeded.applicationId + "_" + uid)
        .get(),
    ]),
  ]);

  assert.equal(registry.exists, true);
  assert.equal(agency.data().ownerUid, seeded.ownerUid);
  assert.equal(agency.data().publicId, "623001");
  assert.equal(agency.data().createdFrom, "application");
  assert.equal(agency.data().memberCount, 6);
  assert.equal(agency.data().hostCount, 5);
  assert.equal(result.hostCount, 5);
  assert.equal(ownerMembership.data().role, "owner");
  assert.equal(userMembership.data().role, "owner");
  assert.deepEqual(managerSlots.data().managerUids, []);
  assert.equal(wallet.data().diamonds, 0);
  assert.equal(wallet.data().remainderCoins, 0);
  assert.equal(ownerUser.data().agencyId, "623001");
  assert.equal(ownerUser.data().agencyRole, "owner");
  assert.equal(application.data().status, "approved");
  assert.equal(application.data().agencyId, "623001");
  assert.equal(operation.data().status, "completed");
  assert.equal(audit.data().action, "approveAgencyApplication");
  assert.equal(notification.data().userId, seeded.ownerUid);
  assert.equal(notification.data().type, "agency_application_approved");
  assert.equal(notification.data().read, false);

  for (let i = 0; i < hostChecks.length; i += 5) {
    const userMembership = hostChecks[i];
    const agencyMembership = hostChecks[i + 1];
    const user = hostChecks[i + 2];
    const lock = hostChecks[i + 3];
    const hostNotification = hostChecks[i + 4];
    assert.equal(userMembership.exists, true);
    assert.equal(userMembership.data().role, "host");
    assert.equal(userMembership.data().status, "active");
    assert.equal(userMembership.data().agencyId, "623001");
    assert.equal(agencyMembership.exists, true);
    assert.equal(agencyMembership.data().role, "host");
    assert.equal(user.data().agencyId, "623001");
    assert.equal(user.data().agencyRole, "host");
    assert.equal(lock.data().status, "approved");
    assert.equal(lock.data().agencyId, "623001");
    assert.equal(hostNotification.exists, true);
    assert.equal(hostNotification.data().type, "agency_application_host_approved");
    assert.equal(hostNotification.data().read, false);
  }

  const duplicate = await approveAgencyApplication(db, "reviewer_stage03b", {
    applicationId: seeded.applicationId,
    idempotencyKey: "stage03b_approve_operation_0001",
  }, { agencyIdCandidates: ["623001"] });
  assert.equal(duplicate.code, "duplicate");
  assert.equal(duplicate.agencyId, "623001");
});

test("approval converts the owner's existing personal room without changing its room/Public ID", async () => {
  const seeded = await seedApplication(
    "stage04_room_convert",
    "333901",
    ["333001","333002","333003","333004","333005"],
  );
  const roomId = "personal_" + seeded.ownerUid;
  await adminDb.collection("rooms").doc(roomId).set({
    ownerUid: seeded.ownerUid,
    hostId: seeded.ownerUid,
    roomType: "personal",
    type: "personal",
    publicId: "733001",
    name: "Existing Room",
    isActive: true,
  });

  const result = await approveAgencyApplication(
    db,
    "reviewer_stage04_room",
    {
      applicationId: seeded.applicationId,
      idempotencyKey: "stage04_room_convert_0001",
    },
    {
      now: new Date("2026-10-01T05:00:00.000Z"),
      agencyIdCandidates: ["733101"],
    },
  );

  const [agency, room] = await Promise.all([
    adminDb.collection("agencies").doc("733101").get(),
    adminDb.collection("rooms").doc(roomId).get(),
  ]);
  assert.equal(result.roomId, roomId);
  assert.equal(agency.data().roomId, roomId);
  assert.equal(room.data().publicId, "733001");
  assert.equal(room.data().roomType, "agency");
  assert.equal(room.data().type, "agency");
  assert.equal(room.data().agencyId, "733101");
});

test("review details lazily return applicant and Host cards with availability", async () => {
  const seeded = await seedApplication(
    "stage04_review_details",
    "334901",
    ["334001","334002","334003","334004","334005"],
  );
  await adminDb.collection("users").doc(seeded.ownerUid).set({
    displayName: "Review Owner",
    profileImageUrl: "https://example.test/owner.webp",
  }, { merge: true });
  await adminDb.collection("users").doc(seeded.hostUids[0]).set({
    displayName: "Review Host",
    profileImageUrl: "https://example.test/host.webp",
  }, { merge: true });

  await startAgencyReview(
    db,
    "reviewer_stage04_details",
    seeded.applicationId,
    { now: new Date("2026-10-01T05:10:00.000Z") },
  );
  const details = await getAgencyReviewDetails(db, seeded.applicationId);

  assert.equal(details.application.status, "under_review");
  assert.equal(details.applicant.uid, seeded.ownerUid);
  assert.equal(details.applicant.publicId, "334901");
  assert.equal(details.applicant.displayName, "Review Owner");
  assert.equal(details.applicant.availability, "available");
  assert.equal(details.hosts.length, 5);
  assert.equal(details.hosts[0].uid, seeded.hostUids[0]);
  assert.equal(details.hosts[0].publicId, "334001");
  assert.equal(details.hosts[0].displayName, "Review Host");
  assert.equal(details.hosts[0].availability, "available");
});

test("auto id allocation skips occupied id registry and uses next bounded candidate", async () => {
  const seeded = await seedApplication(
    "stage03b_collision",
    "324901",
    ["324001","324002","324003","324004","324005"],
  );
  await adminDb.collection("agency_ids").doc("624001").set({
    agencyId: "624001",
    ownerUid: "someone_else",
  });

  const result = await approveAgencyApplication(
    db,
    "reviewer_stage03b",
    {
      applicationId: seeded.applicationId,
      idempotencyKey: "stage03b_collision_operation_0001",
    },
    { agencyIdCandidates: ["624001", "624002"] },
  );
  assert.equal(result.agencyId, "624002");
  assert.equal((await adminDb.collection("agency_ids").doc("624002").get()).exists, true);
});

test("requested agency id collision is rejected without creating owner membership", async () => {
  const seeded = await seedApplication(
    "stage03b_requested_collision",
    "325901",
    ["325001","325002","325003","325004","325005"],
  );
  await adminDb.collection("agency_ids").doc("625001").set({
    agencyId: "625001",
    ownerUid: "occupied",
  });

  await assert.rejects(
    approveAgencyApplication(db, "reviewer_stage03b", {
      applicationId: seeded.applicationId,
      agencyId: "625001",
      idempotencyKey: "stage03b_requested_collision_0001",
    }),
    /agency_id_taken/,
  );
  const ownerMembership = await adminDb.collection("agency_user_memberships")
    .doc(seeded.ownerUid).get();
  assert.equal(ownerMembership.exists, false);
});

test("direct create resolves owner public id and creates agency without application", async () => {
  const ownerUid = "stage03b_direct_owner";
  await seedUser(ownerUid, "326901");

  const result = await directCreateAgency(
    db,
    "control_owner_stage03b",
    {
      ownerPublicId: "326901",
      name: "Direct Agency",
      country: "UAE",
      agencyId: "626001",
      idempotencyKey: "stage03b_direct_create_0001",
    },
    { now: new Date("2026-09-28T17:00:00.000Z") },
  );
  assert.equal(result.agencyId, "626001");

  const [agency, membership, operation] = await Promise.all([
    adminDb.collection("agencies").doc("626001").get(),
    adminDb.collection("agency_user_memberships").doc(ownerUid).get(),
    adminDb.collection("agency_creation_operations")
      .doc("control_owner_stage03b__stage03b_direct_create_0001").get(),
  ]);
  assert.equal(agency.data().createdFrom, "control_direct");
  assert.equal(agency.data().sourceApplicationId, null);
  assert.equal(membership.data().role, "owner");
  assert.equal(operation.data().status, "completed");
});

test("agency creation converts an existing personal room in place", async () => {
  const ownerUid = "stage16_agency_room_owner";
  await seedUser(ownerUid, "326991");
  const roomId = "personal_" + ownerUid;
  await adminDb.collection("rooms").doc(roomId).set({
    name: "غرفتي القديمة",
    title: "غرفتي القديمة",
    ownerUid,
    hostId: ownerUid,
    roomType: "personal",
    type: "personal",
    publicId: "889911",
    category: "دردشة",
    isActive: true,
    description: "يبقى المحتوى نفسه",
    seats: [],
  });

  const result = await directCreateAgency(
    db,
    "control_owner_stage16_room",
    {
      ownerPublicId: "326991",
      name: "Linked Agency",
      country: "UAE",
      agencyId: "626091",
      idempotencyKey: "stage16_agency_room_convert_0001",
    },
    { now: new Date("2026-10-01T05:00:00.000Z") },
  );

  const [agencySnap, roomSnap, auditSnap] = await Promise.all([
    adminDb.collection("agencies").doc("626091").get(),
    adminDb.collection("rooms").doc(roomId).get(),
    adminDb.collection("admin_audit_logs")
      .doc("agency_room_link_626091_stage16_agency_room_convert_0001")
      .get(),
  ]);
  const room = roomSnap.data();
  assert.equal(result.roomId, roomId);
  assert.equal(agencySnap.data().roomId, roomId);
  assert.equal(room.roomType, "agency");
  assert.equal(room.type, "agency");
  assert.equal(room.agencyId, "626091");
  assert.equal(room.publicId, "889911");
  assert.equal(room.name, "غرفتي القديمة");
  assert.equal(room.description, "يبقى المحتوى نفسه");
  assert.equal(auditSnap.data().action, "convertExistingRoomToAgencyRoom");
});

test("direct create refuses owner with active agency application", async () => {
  const seeded = await seedApplication(
    "stage03b_direct_conflict",
    "327901",
    ["327001","327002","327003","327004","327005"],
  );
  assert.ok(seeded.applicationId);
  await assert.rejects(
    directCreateAgency(db, "control_owner_stage03b", {
      ownerPublicId: "327901",
      name: "Blocked Direct Agency",
      idempotencyKey: "stage03b_direct_conflict_0001",
    }, { agencyIdCandidates: ["627001"] }),
    /owner_has_active_application/,
  );
});
