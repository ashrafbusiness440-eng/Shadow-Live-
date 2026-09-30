import assert from "node:assert/strict";
import { after, test } from "node:test";
import { deleteApp, getApps, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

import {
  listAgencyMembers,
  setAgencyManagerRole,
} from "../../cloudflare-worker/src/agency-membership.js";
import { loadAgencyHostCore } from "../../cloudflare-worker/src/agency-host.js";
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
}

async function seedAgency(agencyId, ownerUid, ownerPublicId) {
  const now = new Date("2026-09-28T20:00:00.000Z");
  await seedUser(ownerUid, ownerPublicId, {
    agencyId,
    agencyRole: "owner",
    agencyJoinedAt: now,
  });
  const ownerMembership = {
    schemaVersion: 1,
    agencyId,
    uid: ownerUid,
    role: "owner",
    status: "active",
    joinedAt: now,
    updatedAt: now,
    leftAt: null,
    removedAt: null,
    cooldownUntil: null,
  };
  await Promise.all([
    adminDb.collection("agencies").doc(agencyId).set({
      schemaVersion: 1,
      agencyId,
      publicId: agencyId,
      name: "Stage05A " + agencyId,
      ownerUid,
      status: "active",
      memberCount: 1,
      hostCount: 0,
      managerCount: 0,
      seniorManagerCount: 0,
      updatedAt: now,
    }),
    adminDb.collection("agency_memberships")
      .doc(agencyId + "__" + ownerUid).set(ownerMembership),
    adminDb.collection("agency_user_memberships")
      .doc(ownerUid).set(ownerMembership),
    adminDb.collection("agency_manager_slots").doc(agencyId).set({
      schemaVersion: 1,
      agencyId,
      seniorManagerUid: null,
      managerUids: [],
      updatedAt: now,
    }),
  ]);
}

async function addMember(agencyId, uid, publicId, role = "host") {
  const now = new Date("2026-09-28T20:01:00.000Z");
  await seedUser(uid, publicId, {
    agencyId,
    agencyRole: role,
    agencyJoinedAt: now,
  });
  const membership = {
    schemaVersion: 1,
    agencyId,
    uid,
    role,
    status: "active",
    joinedAt: now,
    updatedAt: now,
    leftAt: null,
    removedAt: null,
    cooldownUntil: null,
  };
  await Promise.all([
    adminDb.collection("agency_memberships")
      .doc(agencyId + "__" + uid).set(membership),
    adminDb.collection("agency_user_memberships").doc(uid).set(membership),
    adminDb.collection("agencies").doc(agencyId).set({
      memberCount: role === "owner" ? 1 : 2,
      hostCount: role === "host" ? 1 : 0,
      managerCount: role === "manager" ? 1 : 0,
      seniorManagerCount: role === "senior_manager" ? 1 : 0,
    }, { merge: true }),
  ]);
  if (role === "manager") {
    await adminDb.collection("agency_manager_slots").doc(agencyId).set({
      managerUids: [uid],
    }, { merge: true });
  } else if (role === "senior_manager") {
    await adminDb.collection("agency_manager_slots").doc(agencyId).set({
      seniorManagerUid: uid,
    }, { merge: true });
  }
}

test("agency owner promotes host to manager atomically and duplicate is safe", async () => {
  const agencyId = "701001";
  const ownerUid = "stage05a_owner_1";
  const hostUid = "stage05a_host_1";
  await seedAgency(agencyId, ownerUid, "701901");
  await addMember(agencyId, hostUid, "701101");

  const body = {
    agencyId,
    targetUid: hostUid,
    targetRole: "manager",
    idempotencyKey: "stage05a_promote_manager_0001",
  };
  const now = new Date("2026-09-28T20:10:00.000Z");
  const first = await setAgencyManagerRole(db, ownerUid, body, { now });
  const duplicate = await setAgencyManagerRole(db, ownerUid, body, { now });

  assert.equal(first.role, "manager");
  assert.equal(first.previousRole, "host");
  assert.equal(duplicate.code, "duplicate");

  const eventId = ownerUid + "__stage05a_promote_manager_0001";
  const [agency, pointer, membership, user, slots, audit, notification] =
    await Promise.all([
      adminDb.collection("agencies").doc(agencyId).get(),
      adminDb.collection("agency_user_memberships").doc(hostUid).get(),
      adminDb.collection("agency_memberships").doc(agencyId + "__" + hostUid).get(),
      adminDb.collection("users").doc(hostUid).get(),
      adminDb.collection("agency_manager_slots").doc(agencyId).get(),
      adminDb.collection("admin_audit_logs")
        .doc("agency_manager_role_" + eventId).get(),
      adminDb.collection("notifications")
        .doc("agency_manager_role_" + eventId).get(),
    ]);

  assert.equal(agency.data().hostCount, 0);
  assert.equal(agency.data().managerCount, 1);
  assert.equal(agency.data().seniorManagerCount, 0);
  assert.equal(pointer.data().role, "manager");
  assert.equal(membership.data().role, "manager");
  assert.equal(user.data().agencyRole, "manager");
  assert.deepEqual(slots.data().managerUids, [hostUid]);
  assert.equal(slots.data().seniorManagerUid, null);
  assert.equal(audit.data().action, "setAgencyManagerRole");
  assert.equal(audit.data().before.role, "host");
  assert.equal(audit.data().after.role, "manager");
  assert.equal(notification.data().userId, hostUid);
});

test("manager slots enforce two managers and one senior manager", async () => {
  const agencyId = "702001";
  const ownerUid = "stage05a_owner_2";
  const host1 = "stage05a_slots_h1";
  const host2 = "stage05a_slots_h2";
  const host3 = "stage05a_slots_h3";
  const senior1 = "stage05a_slots_s1";
  const senior2 = "stage05a_slots_s2";
  await seedAgency(agencyId, ownerUid, "702901");
  for (const [uid, publicId] of [
    [host1, "702101"],
    [host2, "702102"],
    [host3, "702103"],
    [senior1, "702104"],
    [senior2, "702105"],
  ]) {
    await addMember(agencyId, uid, publicId);
  }
  await adminDb.collection("agencies").doc(agencyId).set({
    memberCount: 6,
    hostCount: 5,
    managerCount: 0,
    seniorManagerCount: 0,
  }, { merge: true });

  await setAgencyManagerRole(db, ownerUid, {
    agencyId,
    targetUid: host1,
    targetRole: "manager",
    idempotencyKey: "stage05a_slots_manager_01",
  });
  await setAgencyManagerRole(db, ownerUid, {
    agencyId,
    targetUid: host2,
    targetRole: "manager",
    idempotencyKey: "stage05a_slots_manager_02",
  });

  await assert.rejects(
    setAgencyManagerRole(db, ownerUid, {
      agencyId,
      targetUid: host3,
      targetRole: "manager",
      idempotencyKey: "stage05a_slots_manager_03",
    }),
    /agency_manager_slots_full/,
  );

  await setAgencyManagerRole(db, ownerUid, {
    agencyId,
    targetUid: senior1,
    targetRole: "senior_manager",
    idempotencyKey: "stage05a_slots_senior_01",
  });

  await assert.rejects(
    setAgencyManagerRole(db, ownerUid, {
      agencyId,
      targetUid: senior2,
      targetRole: "senior_manager",
      idempotencyKey: "stage05a_slots_senior_02",
    }),
    /agency_senior_manager_slot_full/,
  );

  const agency = await adminDb.collection("agencies").doc(agencyId).get();
  const slots = await adminDb.collection("agency_manager_slots").doc(agencyId).get();
  assert.equal(agency.data().hostCount, 2);
  assert.equal(agency.data().managerCount, 2);
  assert.equal(agency.data().seniorManagerCount, 1);
  assert.deepEqual(slots.data().managerUids, [host1, host2]);
  assert.equal(slots.data().seniorManagerUid, senior1);
});

test("owner can move manager to senior and later demote to host without counter drift", async () => {
  const agencyId = "703001";
  const ownerUid = "stage05a_owner_3";
  const memberUid = "stage05a_transition_member";
  await seedAgency(agencyId, ownerUid, "703901");
  await addMember(agencyId, memberUid, "703101", "manager");

  await setAgencyManagerRole(db, ownerUid, {
    agencyId,
    targetUid: memberUid,
    targetRole: "senior_manager",
    idempotencyKey: "stage05a_manager_to_senior",
  });
  let agency = await adminDb.collection("agencies").doc(agencyId).get();
  let slots = await adminDb.collection("agency_manager_slots").doc(agencyId).get();
  assert.equal(agency.data().hostCount, 0);
  assert.equal(agency.data().managerCount, 0);
  assert.equal(agency.data().seniorManagerCount, 1);
  assert.deepEqual(slots.data().managerUids, []);
  assert.equal(slots.data().seniorManagerUid, memberUid);

  await setAgencyManagerRole(db, ownerUid, {
    agencyId,
    targetUid: memberUid,
    targetRole: "host",
    idempotencyKey: "stage05a_senior_to_host",
  });
  agency = await adminDb.collection("agencies").doc(agencyId).get();
  slots = await adminDb.collection("agency_manager_slots").doc(agencyId).get();
  const pointer = await adminDb.collection("agency_user_memberships").doc(memberUid).get();
  assert.equal(agency.data().hostCount, 1);
  assert.equal(agency.data().managerCount, 0);
  assert.equal(agency.data().seniorManagerCount, 0);
  assert.deepEqual(slots.data().managerUids, []);
  assert.equal(slots.data().seniorManagerUid, null);
  assert.equal(pointer.data().role, "host");
});


test("role transitions keep My Agency core readable for manager and senior manager", async () => {
  const agencyId = "704001";
  const ownerUid = "stage05a_role_core_owner";
  const memberUid = "stage05a_role_core_member";
  await seedAgency(agencyId, ownerUid, "704901");
  await addMember(agencyId, memberUid, "704101", "host");

  await setAgencyManagerRole(db, ownerUid, {
    agencyId,
    targetUid: memberUid,
    targetRole: "manager",
    idempotencyKey: "stage05a_role_core_to_manager",
  });
  let core = await loadAgencyHostCore(
    db,
    memberUid,
    new Date("2026-09-30T18:00:00.000Z"),
  );
  assert.equal(core.membership.role, "manager");

  await setAgencyManagerRole(db, ownerUid, {
    agencyId,
    targetUid: memberUid,
    targetRole: "senior_manager",
    idempotencyKey: "stage05a_role_core_to_senior",
  });
  core = await loadAgencyHostCore(
    db,
    memberUid,
    new Date("2026-09-30T18:01:00.000Z"),
  );
  assert.equal(core.membership.role, "senior_manager");
  assert.equal(core.membership.permissions.canReviewMembershipRequests, true);

  await setAgencyManagerRole(db, ownerUid, {
    agencyId,
    targetUid: memberUid,
    targetRole: "manager",
    idempotencyKey: "stage05a_role_core_back_manager",
  });
  core = await loadAgencyHostCore(
    db,
    memberUid,
    new Date("2026-09-30T18:02:00.000Z"),
  );
  assert.equal(core.membership.role, "manager");
  assert.equal(core.ok, true);
});

test("manager and senior manager cannot manage manager roles", async () => {
  const agencyId = "704001";
  const ownerUid = "stage05a_owner_4";
  const managerUid = "stage05a_manager_actor";
  const seniorUid = "stage05a_senior_actor";
  const hostUid = "stage05a_target_4";
  await seedAgency(agencyId, ownerUid, "704901");
  await addMember(agencyId, managerUid, "704101", "manager");
  await addMember(agencyId, seniorUid, "704102", "senior_manager");
  await addMember(agencyId, hostUid, "704103", "host");
  await adminDb.collection("agencies").doc(agencyId).set({
    memberCount: 4,
    hostCount: 1,
    managerCount: 1,
    seniorManagerCount: 1,
  }, { merge: true });
  await adminDb.collection("agency_manager_slots").doc(agencyId).set({
    managerUids: [managerUid],
    seniorManagerUid: seniorUid,
  }, { merge: true });

  for (const [actorUid, key] of [
    [managerUid, "stage05a_forbid_manager_01"],
    [seniorUid, "stage05a_forbid_senior_01"],
  ]) {
    await assert.rejects(
      setAgencyManagerRole(db, actorUid, {
        agencyId,
        targetUid: hostUid,
        targetRole: "manager",
        idempotencyKey: key,
      }),
      /forbidden/,
    );
  }
});

test("enabled platform admin with manageAgencyManagers can manage roles, disabled admin cannot", async () => {
  const agencyId = "705001";
  const ownerUid = "stage05a_owner_5";
  const targetUid = "stage05a_target_5";
  const enabledAdmin = "stage05a_platform_enabled";
  const disabledAdmin = "stage05a_platform_disabled";
  await seedAgency(agencyId, ownerUid, "705901");
  await addMember(agencyId, targetUid, "705101");
  await seedUser(enabledAdmin, "705801", {
    role: "admin",
    adminEnabled: true,
    capabilities: ["manageAgencyManagers"],
  });
  await seedUser(disabledAdmin, "705802", {
    role: "admin",
    adminEnabled: false,
    capabilities: ["manageAgencyManagers"],
  });

  await assert.rejects(
    setAgencyManagerRole(db, disabledAdmin, {
      agencyId,
      targetUid,
      targetRole: "manager",
      idempotencyKey: "stage05a_disabled_admin",
    }),
    /forbidden/,
  );

  const result = await setAgencyManagerRole(db, enabledAdmin, {
    agencyId,
    targetUid,
    targetRole: "manager",
    idempotencyKey: "stage05a_enabled_admin",
  });
  assert.equal(result.role, "manager");
});

test("owner role is immutable through manager-role core", async () => {
  const agencyId = "706001";
  const ownerUid = "stage05a_owner_6";
  const platformOwnerUid = "stage05a_platform_owner_6";
  await seedAgency(agencyId, ownerUid, "706901");
  await seedUser(platformOwnerUid, "706999", {
    role: "owner",
    adminEnabled: true,
  });

  await assert.rejects(
    setAgencyManagerRole(db, platformOwnerUid, {
      agencyId,
      targetUid: ownerUid,
      targetRole: "host",
      idempotencyKey: "stage05a_owner_locked_01",
    }),
    /agency_owner_role_locked/,
  );
});


test("management surface lists active members with bounded profile data and role matrix", async () => {
  const agencyId = "707001";
  const ownerUid = "stage05b_owner_1";
  const managerUid = "stage05b_manager_1";
  const hostUid = "stage05b_host_1";
  await seedAgency(agencyId, ownerUid, "707901");
  await addMember(agencyId, managerUid, "707101", "manager");
  await addMember(agencyId, hostUid, "707102", "host");
  await adminDb.collection("users").doc(managerUid).set({
    displayName: "مدير الاختبار",
  }, { merge: true });
  await adminDb.collection("users").doc(hostUid).set({
    displayName: "مضيف الاختبار",
  }, { merge: true });
  await adminDb.collection("agencies").doc(agencyId).set({
    memberCount: 3,
    hostCount: 1,
    managerCount: 1,
    seniorManagerCount: 0,
  }, { merge: true });
  await adminDb.collection("agency_manager_slots").doc(agencyId).set({
    managerUids: [managerUid],
    seniorManagerUid: null,
  }, { merge: true });

  const result = await listAgencyMembers(db, ownerUid, {
    agencyId,
    limit: 999,
  });

  assert.equal(result.ok, true);
  assert.equal(result.limit, 50);
  assert.equal(result.members.length, 3);
  assert.equal(result.members[0].role, "owner");
  assert.equal(result.members[1].role, "manager");
  assert.equal(result.members[2].role, "host");
  assert.equal(result.members[1].publicId, "707101");
  assert.equal(result.members[1].displayName, "مدير الاختبار");
  assert.equal(result.managerSlots.managerLimit, 2);
  assert.equal(result.managerSlots.seniorManagerLimit, 1);
  assert.equal(result.permissions.canManageManagers, true);

  const ownerMatrix = result.roleMatrix.find((row) => row.role === "owner");
  const managerMatrix = result.roleMatrix.find((row) => row.role === "manager");
  const hostMatrix = result.roleMatrix.find((row) => row.role === "host");
  assert.equal(ownerMatrix.canManageManagers, true);
  assert.equal(managerMatrix.canManageManagers, false);
  assert.equal(managerMatrix.canManageRooms, true);
  assert.equal(hostMatrix.canViewOwnProgress, true);
  assert.equal(hostMatrix.canManageRooms, false);
});

test("manager can view management surface but cannot change manager roles", async () => {
  const agencyId = "708001";
  const ownerUid = "stage05b_owner_2";
  const managerUid = "stage05b_manager_2";
  const hostUid = "stage05b_host_2";
  await seedAgency(agencyId, ownerUid, "708901");
  await addMember(agencyId, managerUid, "708101", "manager");
  await addMember(agencyId, hostUid, "708102", "host");
  await adminDb.collection("agencies").doc(agencyId).set({
    memberCount: 3,
    hostCount: 1,
    managerCount: 1,
    seniorManagerCount: 0,
  }, { merge: true });
  await adminDb.collection("agency_manager_slots").doc(agencyId).set({
    managerUids: [managerUid],
    seniorManagerUid: null,
  }, { merge: true });

  const result = await listAgencyMembers(db, managerUid, {
    agencyId,
    limit: 25,
  });
  assert.equal(result.members.length, 3);
  assert.equal(result.permissions.canManageManagers, false);

  await assert.rejects(
    setAgencyManagerRole(db, managerUid, {
      agencyId,
      targetUid: hostUid,
      targetRole: "manager",
      idempotencyKey: "stage05b_manager_cannot_promote",
    }),
    /forbidden/,
  );
});

test("platform manageAgencyManagers can list and manage while ordinary host is denied", async () => {
  const agencyId = "709001";
  const ownerUid = "stage05b_owner_3";
  const hostUid = "stage05b_host_3";
  const adminUid = "stage05b_platform_admin";
  await seedAgency(agencyId, ownerUid, "709901");
  await addMember(agencyId, hostUid, "709101", "host");
  await adminDb.collection("agencies").doc(agencyId).set({
    memberCount: 2,
    hostCount: 1,
    managerCount: 0,
    seniorManagerCount: 0,
  }, { merge: true });
  await seedUser(adminUid, "709801", {
    role: "admin",
    adminEnabled: true,
    capabilities: ["manageAgencyManagers"],
  });

  const result = await listAgencyMembers(db, adminUid, {
    agencyId,
    limit: 25,
  });
  assert.equal(result.permissions.canManageManagers, true);
  assert.equal(result.members.length, 2);

  await assert.rejects(
    listAgencyMembers(db, hostUid, { agencyId, limit: 25 }),
    /forbidden/,
  );
});
