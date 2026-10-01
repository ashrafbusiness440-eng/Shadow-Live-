import assert from "node:assert/strict";
import { after, test } from "node:test";
import { readFileSync } from "node:fs";
import { deleteApp, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

import {
  getMyAgencyLeaveRequestStatus,
  requestAgencyLeave,
} from "../../cloudflare-worker/src/agency-membership.js";
import { cloudflareFirestoreAdapter } from "./helpers/cloudflare-firestore-adapter.js";

const app = initializeApp(
  { projectId: "shadow-live-economy-test" },
  "agency-stage11c-" + Date.now(),
);
const adminDb = getFirestore(app);
const db = cloudflareFirestoreAdapter(adminDb);

after(async () => {
  await deleteApp(app);
});

async function seedAgencyHost({ agencyId, ownerUid, hostUid }) {
  const joinedAt = new Date("2026-09-29T16:00:00.000Z");
  const hostMembership = {
    schemaVersion: 1,
    agencyId,
    uid: hostUid,
    role: "host",
    status: "active",
    joinedAt,
    updatedAt: joinedAt,
    leftAt: null,
    removedAt: null,
    cooldownUntil: null,
  };
  const ownerMembership = {
    ...hostMembership,
    uid: ownerUid,
    role: "owner",
  };

  await Promise.all([
    adminDb.collection("agencies").doc(agencyId).set({
      schemaVersion: 1,
      agencyId,
      publicId: agencyId,
      name: "Stage 11-C Agency",
      ownerUid,
      status: "active",
      memberCount: 2,
      hostCount: 1,
      managerCount: 0,
      seniorManagerCount: 0,
    }),
    adminDb.collection("users").doc(ownerUid).set({
      accountStatus: "active",
      publicId: "981001",
      agencyId,
      agencyRole: "owner",
    }),
    adminDb.collection("users").doc(hostUid).set({
      accountStatus: "active",
      publicId: "981002",
      agencyId,
      agencyRole: "host",
    }),
    adminDb.collection("agency_user_memberships").doc(ownerUid).set(ownerMembership),
    adminDb.collection("agency_memberships")
      .doc(agencyId + "__" + ownerUid).set(ownerMembership),
    adminDb.collection("agency_user_memberships").doc(hostUid).set(hostMembership),
    adminDb.collection("agency_memberships")
      .doc(agencyId + "__" + hostUid).set(hostMembership),
  ]);
}

test("11-C Host leave request stays pending and does not depart the membership", async () => {
  const agencyId = "781101";
  const ownerUid = "stage11c_owner";
  const hostUid = "stage11c_host";
  await seedAgencyHost({ agencyId, ownerUid, hostUid });

  const body = {
    agencyId,
    idempotencyKey: "stage11c_leave_request_0001",
  };
  const now = new Date("2026-09-29T17:30:00.000Z");
  const first = await requestAgencyLeave(db, hostUid, body, { now });
  const duplicate = await requestAgencyLeave(db, hostUid, body, { now });

  assert.equal(first.ok, true);
  assert.equal(first.code, "ok");
  assert.equal(first.type, "leave");
  assert.equal(first.status, "pending");
  assert.equal(first.userConsent, true);
  assert.equal(first.agencyConsent, false);
  assert.equal(duplicate.code, "duplicate");

  const requestId = hostUid + "__stage11c_leave_request_0001";
  const [
    requestSnap,
    pairSnap,
    pendingSnap,
    membershipSnap,
    agencyMembershipSnap,
    userSnap,
    agencySnap,
    ownerNotification,
  ] = await Promise.all([
    adminDb.collection("agency_membership_requests").doc(requestId).get(),
    adminDb.collection("agency_membership_request_keys")
      .doc(agencyId + "__" + hostUid).get(),
    adminDb.collection("agency_membership_pending")
      .doc(agencyId + "__" + hostUid).get(),
    adminDb.collection("agency_user_memberships").doc(hostUid).get(),
    adminDb.collection("agency_memberships")
      .doc(agencyId + "__" + hostUid).get(),
    adminDb.collection("users").doc(hostUid).get(),
    adminDb.collection("agencies").doc(agencyId).get(),
    adminDb.collection("notifications")
      .doc("agency_leave_request_" + requestId).get(),
  ]);

  assert.equal(requestSnap.exists, true);
  assert.equal(requestSnap.data().type, "leave");
  assert.equal(requestSnap.data().status, "pending");
  assert.equal(requestSnap.data().initiatorSide, "user");
  assert.equal(requestSnap.data().userConsent, true);
  assert.equal(pairSnap.data().type, "leave");
  assert.equal(pendingSnap.data().status, "pending");

  assert.equal(membershipSnap.data().status, "active");
  assert.equal(agencyMembershipSnap.data().status, "active");
  assert.equal(userSnap.data().agencyId, agencyId);
  assert.equal(userSnap.data().agencyRole, "host");
  assert.equal(agencySnap.data().memberCount, 2);
  assert.equal(agencySnap.data().hostCount, 1);
  assert.equal(ownerNotification.data().userId, ownerUid);

  const status = await getMyAgencyLeaveRequestStatus(db, hostUid, { agencyId });
  assert.equal(status.ok, true);
  assert.equal(status.canRequestLeave, true);
  assert.equal(status.request.requestId, requestId);
  assert.equal(status.request.status, "pending");
});

test("11-C repeated leave request with a new key reuses the existing pending request", async () => {
  const agencyId = "781102";
  const ownerUid = "stage11c_repeat_owner";
  const hostUid = "stage11c_repeat_host";
  await seedAgencyHost({ agencyId, ownerUid, hostUid });

  const first = await requestAgencyLeave(db, hostUid, {
    agencyId,
    idempotencyKey: "stage11c_repeat_leave_0001",
  });
  const second = await requestAgencyLeave(db, hostUid, {
    agencyId,
    idempotencyKey: "stage11c_repeat_leave_0002",
  });

  assert.equal(first.code, "ok");
  assert.equal(second.code, "already_pending");
  assert.equal(second.requestId, first.requestId);

  const requests = await adminDb.collection("agency_membership_requests")
    .where("uid", "==", hostUid)
    .get();
  assert.equal(requests.size, 1);
});

test("11-C Agency Owner cannot request member-path departure", async () => {
  const agencyId = "781103";
  const ownerUid = "stage11c_guard_owner";
  const hostUid = "stage11c_guard_host";
  await seedAgencyHost({ agencyId, ownerUid, hostUid });

  await assert.rejects(
    () => requestAgencyLeave(db, ownerUid, {
      agencyId,
      idempotencyKey: "stage11c_owner_leave_0001",
    }),
    /agency_owner_departure_forbidden/,
  );

  const pending = await adminDb.collection("agency_membership_pending")
    .doc(agencyId + "__" + ownerUid).get();
  assert.equal(pending.exists, false);
});

test("11-C leave status is two direct reads with zero query or write", async () => {
  const agencyId = "781104";
  const uid = "stage11c_pressure_host";
  const calls = { gets: [], queries: 0, writes: 0 };
  const fakeDb = {
    async get(path) {
      calls.gets.push(path);
      if (path === "agency_user_memberships/" + uid) {
        return {
          exists: true,
          data: { agencyId, uid, role: "host", status: "active" },
        };
      }
      if (path === "agency_membership_pending/" + agencyId + "__" + uid) {
        return { exists: false, data: null };
      }
      throw new Error("unexpected_get:" + path);
    },
    async runQuery() {
      calls.queries += 1;
      throw new Error("unexpected_query");
    },
    async commit() {
      calls.writes += 1;
      throw new Error("unexpected_write");
    },
  };

  const result = await getMyAgencyLeaveRequestStatus(
    fakeDb,
    uid,
    { agencyId },
  );

  assert.equal(result.ok, true);
  assert.equal(result.canRequestLeave, true);
  assert.equal(result.request, null);
  assert.deepEqual(calls.gets, [
    "agency_user_memberships/" + uid,
    "agency_membership_pending/" + agencyId + "__" + uid,
  ]);
  assert.equal(calls.queries, 0);
  assert.equal(calls.writes, 0);
});

test("11-C UI/route guards keep My Agency on explicit navigation only", () => {
  const page = readFileSync(
    new URL("../../lib/features/agency/screens/host_my_agency_page.dart", import.meta.url),
    "utf8",
  );
  const service = readFileSync(
    new URL("../../lib/features/agency/services/host_my_agency_service.dart", import.meta.url),
    "utf8",
  );
  const profile = readFileSync(
    new URL("../../lib/features/user/screens/profile_screen.dart", import.meta.url),
    "utf8",
  );
  const settings = readFileSync(
    new URL("../../lib/screens/settings/settings_screen.dart", import.meta.url),
    "utf8",
  );
  const navigation = readFileSync(
    new URL("../../lib/services/navigation_service.dart", import.meta.url),
    "utf8",
  );
  const membershipSource = readFileSync(
    new URL("../../cloudflare-worker/src/agency-membership.js", import.meta.url),
    "utf8",
  );

  assert.equal(page.includes("host-agency-leave-card"), false);
  assert.equal(page.includes("host-agency-leave-request-button"), true);
  assert.equal(page.includes("host-agency-finance-entries"), true);
  assert.equal(page.includes("host-agency-wallet-entry"), true);
  assert.equal(page.includes("host-agency-target-table-entry"), true);
  assert.equal(page.includes("AppRoutes.recharge"), true);
  assert.equal(page.includes("loadLeaveStatus"), true);
  assert.equal(page.includes("requestLeave"), true);
  assert.equal(page.includes("FirebaseFirestore"), false);
  assert.equal(service.includes("'action': 'leaveStatus'"), true);
  assert.equal(service.includes("'action': 'requestLeave'"), true);
  assert.equal(profile.includes("AppRoutes.myAgency"), true);
  assert.equal(profile.includes("إنشاء / طلب وكالة"), false);
  assert.equal(profile.includes("AppRoutes.agencyApplication"), false);
  assert.equal(settings.includes("AppRoutes.myAgency"), true);
  assert.equal(navigation.includes("static const String myAgency = '/my-agency';"), true);
  assert.equal(
    navigation.includes("static const String agencyApplication = '/agency-application';"),
    true,
  );

  const statusStart = membershipSource.indexOf(
    "export async function getMyAgencyLeaveRequestStatus",
  );
  const responseStart = membershipSource.indexOf("function responseFingerprint", statusStart);
  const statusSource = membershipSource.slice(statusStart, responseStart);
  assert.equal(statusSource.includes(".runQuery("), false);
  assert.equal(statusSource.includes(".list("), false);
  assert.equal(statusSource.includes("writeCreate("), false);
  assert.equal(statusSource.includes("writeUpdate("), false);

  const leaveStart = membershipSource.indexOf(
    "export async function requestAgencyLeave",
  );
  const leaveEnd = membershipSource.indexOf(
    "export async function getMyAgencyLeaveRequestStatus",
    leaveStart,
  );
  const leaveSource = membershipSource.slice(leaveStart, leaveEnd);
  assert.equal(leaveSource.includes(".runQuery("), false);
  assert.equal(leaveSource.includes(".list("), false);
});
