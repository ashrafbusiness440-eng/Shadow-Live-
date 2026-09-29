import assert from "node:assert/strict";
import { after, test } from "node:test";
import { readFileSync } from "node:fs";
import { deleteApp, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

import {
  getAgencyControlDetails,
  transferAgencyOwnership,
  updateAgencyIdentity,
} from "../../cloudflare-worker/src/agency-control.js";
import { cloudflareFirestoreAdapter } from "./helpers/cloudflare-firestore-adapter.js";

const app = initializeApp(
  { projectId: "shadow-live-economy-test" },
  "agency-stage13a-" + Date.now(),
);
const adminDb = getFirestore(app);
const db = cloudflareFirestoreAdapter(adminDb);

after(async () => {
  await deleteApp(app);
});

async function seedAgency({
  agencyId,
  oldOwnerUid,
  newOwnerUid,
  oldOwnerPublicId,
  newOwnerPublicId,
  newOwnerRole = "manager",
}) {
  const now = new Date("2026-09-29T20:00:00.000Z");
  const oldMembership = {
    schemaVersion: 1,
    agencyId,
    uid: oldOwnerUid,
    role: "owner",
    status: "active",
    joinedAt: now,
    updatedAt: now,
    leftAt: null,
    removedAt: null,
    cooldownUntil: null,
  };
  const newMembership = {
    ...oldMembership,
    uid: newOwnerUid,
    role: newOwnerRole,
  };
  await Promise.all([
    adminDb.collection("agencies").doc(agencyId).set({
      schemaVersion: 1,
      agencyId,
      publicId: agencyId,
      name: "Stage 13-A Agency",
      country: "UAE",
      ownerUid: oldOwnerUid,
      status: "active",
      memberCount: 2,
      hostCount: newOwnerRole === "host" ? 1 : 0,
      managerCount: newOwnerRole === "manager" ? 1 : 0,
      seniorManagerCount: newOwnerRole === "senior_manager" ? 1 : 0,
      createdAt: now,
      updatedAt: now,
    }),
    adminDb.collection("users").doc(oldOwnerUid).set({
      publicId: oldOwnerPublicId,
      accountStatus: "active",
      agencyId,
      agencyRole: "owner",
    }),
    adminDb.collection("users").doc(newOwnerUid).set({
      publicId: newOwnerPublicId,
      accountStatus: "active",
      agencyId,
      agencyRole: newOwnerRole,
    }),
    adminDb.collection("public_ids").doc(oldOwnerPublicId).set({ uid: oldOwnerUid }),
    adminDb.collection("public_ids").doc(newOwnerPublicId).set({ uid: newOwnerUid }),
    adminDb.collection("agency_memberships")
      .doc(agencyId + "__" + oldOwnerUid).set(oldMembership),
    adminDb.collection("agency_user_memberships")
      .doc(oldOwnerUid).set(oldMembership),
    adminDb.collection("agency_memberships")
      .doc(agencyId + "__" + newOwnerUid).set(newMembership),
    adminDb.collection("agency_user_memberships")
      .doc(newOwnerUid).set(newMembership),
    adminDb.collection("agency_manager_slots").doc(agencyId).set({
      schemaVersion: 1,
      agencyId,
      seniorManagerUid: newOwnerRole === "senior_manager" ? newOwnerUid : null,
      managerUids: newOwnerRole === "manager" ? [newOwnerUid] : [],
      updatedAt: now,
    }),
  ]);
}

test("13-A lookup is direct and identity update is idempotent", async () => {
  const agencyId = "813001";
  const oldOwnerUid = "stage13a_owner_1";
  const newOwnerUid = "stage13a_manager_1";
  await seedAgency({
    agencyId,
    oldOwnerUid,
    newOwnerUid,
    oldOwnerPublicId: "713001",
    newOwnerPublicId: "713002",
  });

  const before = await getAgencyControlDetails(db, agencyId);
  assert.equal(before.agencyId, agencyId);
  assert.equal(before.ownerPublicId, "713001");
  assert.equal(before.name, "Stage 13-A Agency");

  const body = {
    agencyId,
    name: "Stage 13-A Updated",
    country: "Syria",
    idempotencyKey: "stage13a_identity_0001",
  };
  const now = new Date("2026-09-29T20:10:00.000Z");
  const first = await updateAgencyIdentity(db, "shadow_owner", body, { now });
  const duplicate = await updateAgencyIdentity(db, "shadow_owner", body, { now });
  assert.equal(first.code, "ok");
  assert.equal(duplicate.code, "duplicate");

  const agency = await adminDb.collection("agencies").doc(agencyId).get();
  assert.equal(agency.data().name, "Stage 13-A Updated");
  assert.equal(agency.data().country, "Syria");

  const audit = await adminDb.collection("admin_audit_logs")
    .doc("agency_identity_" + agencyId + "_stage13a_identity_0001").get();
  assert.equal(audit.exists, true);
  assert.equal(audit.data().before.name, "Stage 13-A Agency");
  assert.equal(audit.data().after.name, "Stage 13-A Updated");
});

test("13-A ownership transfer swaps the incoming member role and preserves counters", async () => {
  const agencyId = "813002";
  const oldOwnerUid = "stage13a_owner_2";
  const newOwnerUid = "stage13a_manager_2";
  await seedAgency({
    agencyId,
    oldOwnerUid,
    newOwnerUid,
    oldOwnerPublicId: "713011",
    newOwnerPublicId: "713012",
    newOwnerRole: "manager",
  });

  const body = {
    agencyId,
    newOwnerPublicId: "713012",
    idempotencyKey: "stage13a_transfer_0001",
  };
  const now = new Date("2026-09-29T20:20:00.000Z");
  const first = await transferAgencyOwnership(db, "shadow_owner", body, { now });
  const duplicate = await transferAgencyOwnership(db, "shadow_owner", body, { now });
  assert.equal(first.code, "ok");
  assert.equal(first.previousNewOwnerRole, "manager");
  assert.equal(duplicate.code, "duplicate");

  const [
    agency,
    oldMember,
    newMember,
    oldUserMember,
    newUserMember,
    oldUser,
    newUser,
    slots,
  ] = await Promise.all([
    adminDb.collection("agencies").doc(agencyId).get(),
    adminDb.collection("agency_memberships").doc(agencyId + "__" + oldOwnerUid).get(),
    adminDb.collection("agency_memberships").doc(agencyId + "__" + newOwnerUid).get(),
    adminDb.collection("agency_user_memberships").doc(oldOwnerUid).get(),
    adminDb.collection("agency_user_memberships").doc(newOwnerUid).get(),
    adminDb.collection("users").doc(oldOwnerUid).get(),
    adminDb.collection("users").doc(newOwnerUid).get(),
    adminDb.collection("agency_manager_slots").doc(agencyId).get(),
  ]);

  assert.equal(agency.data().ownerUid, newOwnerUid);
  assert.equal(agency.data().memberCount, 2);
  assert.equal(agency.data().managerCount, 1);
  assert.equal(oldMember.data().role, "manager");
  assert.equal(newMember.data().role, "owner");
  assert.equal(oldUserMember.data().role, "manager");
  assert.equal(newUserMember.data().role, "owner");
  assert.equal(oldUser.data().agencyRole, "manager");
  assert.equal(newUser.data().agencyRole, "owner");
  assert.deepEqual(slots.data().managerUids, [oldOwnerUid]);
  assert.equal(slots.data().seniorManagerUid, null);

  const audit = await adminDb.collection("admin_audit_logs")
    .doc("agency_owner_transfer_" + agencyId + "_stage13a_transfer_0001").get();
  assert.equal(audit.exists, true);
  assert.equal(audit.data().before.ownerUid, oldOwnerUid);
  assert.equal(audit.data().after.ownerUid, newOwnerUid);
});

test("13-A ownership requires the incoming owner to already be active in the agency", async () => {
  const agencyId = "813003";
  const oldOwnerUid = "stage13a_owner_3";
  const memberUid = "stage13a_member_3";
  await seedAgency({
    agencyId,
    oldOwnerUid,
    newOwnerUid: memberUid,
    oldOwnerPublicId: "713021",
    newOwnerPublicId: "713022",
    newOwnerRole: "host",
  });

  await adminDb.collection("agency_user_memberships").doc(memberUid).delete();

  await assert.rejects(
    transferAgencyOwnership(
      db,
      "shadow_owner",
      {
        agencyId,
        newOwnerPublicId: "713022",
        idempotencyKey: "stage13a_transfer_guard_0001",
      },
      { now: new Date("2026-09-29T20:30:00.000Z") },
    ),
    /new_owner_must_be_active_member/,
  );

  const agency = await adminDb.collection("agencies").doc(agencyId).get();
  assert.equal(agency.data().ownerUid, oldOwnerUid);
});

test("13-A pressure guard: identity/ownership control is direct-read and scan-free", () => {
  const source = readFileSync(
    new URL("../../cloudflare-worker/src/agency-control.js", import.meta.url),
    "utf8",
  );

  const lookupStart = source.indexOf("export async function getAgencyControlDetails");
  const identityStart = source.indexOf("export async function updateAgencyIdentity");
  const transferStart = source.indexOf("export async function transferAgencyOwnership");
  const directCreateStart = source.indexOf("export async function directCreateAgency");

  assert.ok(lookupStart >= 0 && identityStart > lookupStart);
  assert.ok(identityStart >= 0 && transferStart > identityStart);
  assert.ok(transferStart >= 0 && directCreateStart > transferStart);

  for (const segment of [
    source.slice(lookupStart, identityStart),
    source.slice(identityStart, transferStart),
    source.slice(transferStart, directCreateStart),
  ]) {
    assert.equal(segment.includes(".runQuery("), false);
    assert.equal(segment.includes(".list("), false);
  }

  const route = source.slice(source.indexOf("export async function agencyControl"));
  assert.equal(route.includes('if (action === "transferOwnership")'), true);
  assert.equal(
    route.includes('if (!actor.permissions.isOwner) throw new ApiError("forbidden", 403);'),
    true,
  );

  const controlPage = readFileSync(
    new URL("../../lib/admin/agency_control_page.dart", import.meta.url),
    "utf8",
  );
  assert.equal(controlPage.includes("'action': 'getAgency'"), true);
  assert.equal(controlPage.includes("'action': 'updateIdentity'"), true);
  assert.equal(controlPage.includes("'action': 'transferOwnership'"), true);
  assert.equal(controlPage.includes("Timer.periodic"), false);
  assert.equal(controlPage.includes(".snapshots()"), false);
  assert.equal(controlPage.includes("StreamBuilder"), false);
  assert.equal(controlPage.includes("FirebaseFirestore"), false);
});
