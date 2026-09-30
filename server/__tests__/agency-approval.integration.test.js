import assert from "node:assert/strict";
import { after, test } from "node:test";
import { deleteApp, getApps, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

import { submitAgencyApplication } from "../../cloudflare-worker/src/agency-application.js";
import {
  approveAgencyApplication,
  directCreateAgency,
  listAgencyReviewQueue,
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

test("approval creates unique agency owner membership wallet and preserves host candidates as non members", async () => {
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
      adminDb.collection("agency_application_locks").doc(uid).get(),
    ]),
  ]);

  assert.equal(registry.exists, true);
  assert.equal(agency.data().ownerUid, seeded.ownerUid);
  assert.equal(agency.data().publicId, "623001");
  assert.equal(agency.data().createdFrom, "application");
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

  for (let i = 0; i < hostChecks.length; i += 2) {
    assert.equal(hostChecks[i].exists, false);
    assert.equal(hostChecks[i + 1].data().status, "approved");
    assert.equal(hostChecks[i + 1].data().agencyId, "623001");
  }

  const duplicate = await approveAgencyApplication(db, "reviewer_stage03b", {
    applicationId: seeded.applicationId,
    idempotencyKey: "stage03b_approve_operation_0001",
  }, { agencyIdCandidates: ["623001"] });
  assert.equal(duplicate.code, "duplicate");
  assert.equal(duplicate.agencyId, "623001");
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
