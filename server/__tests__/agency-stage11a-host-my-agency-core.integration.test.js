import assert from "node:assert/strict";
import { after, test } from "node:test";
import { readFileSync } from "node:fs";
import { deleteApp, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

import { loadAgencyHostCore } from "../../cloudflare-worker/src/agency-host.js";
import { cloudflareFirestoreAdapter } from "./helpers/cloudflare-firestore-adapter.js";

const app = initializeApp(
  { projectId: "shadow-live-economy-test" },
  "agency-stage11a-" + Date.now(),
);
const adminDb = getFirestore(app);
const db = cloudflareFirestoreAdapter(adminDb);

after(async () => {
  await deleteApp(app);
});

test("11-A Host My Agency returns only the signed-in Host core data", async () => {
  const agencyId = "741201";
  const uid = "stage11a_host";
  const ownerUid = "stage11a_owner";

  await Promise.all([
    adminDb.collection("users").doc(uid).set({
      agencyId,
      agencyRole: "host",
      agencyTargetMonth: "2026-09",
      agencyTargetProgressCoins: 650000,
      agencySalaryPaidDiamonds: 65,
      agencyPolicySnapshot: {
        targets: [
          {
            id: "starter_g",
            tierId: "starter",
            rank: "G",
            thresholdCoins: 50000,
            salaryDiamonds: 5,
          },
          {
            id: "starter_b",
            tierId: "starter",
            rank: "B",
            thresholdCoins: 650000,
            salaryDiamonds: 65,
          },
          {
            id: "starter_a",
            tierId: "starter",
            rank: "A",
            thresholdCoins: 850000,
            salaryDiamonds: 85,
          },
        ],
      },
      giftHostActivityMonth: "2026-09",
      giftHostQualifiedDays: 7,
      giftHostMicSecondsMonth: 54000,
    }),
    adminDb.collection("agency_user_memberships").doc(uid).set({
      agencyId,
      uid,
      role: "host",
      status: "active",
    }),
    adminDb.collection("agencies").doc(agencyId).set({
      agencyId,
      publicId: agencyId,
      name: "Host Core Agency",
      country: "AE",
      ownerUid,
      status: "active",
      roomId: "agency_room_741201",
      agencyProfitDiamonds: 999999,
    }),
    adminDb.collection("users").doc(ownerUid).set({
      publicId: "930001",
      displayName: "Agency Owner",
      profileImageUrl: "https://example.invalid/owner.webp",
      diamonds: 999999,
    }),
    adminDb.collection("system_config").doc("gift_economy").set({
      hostBonusQualifiedDays: 9,
      hostBonusMinutesPerQualifiedDay: 120,
    }),
  ]);

  const result = await loadAgencyHostCore(
    db,
    uid,
    new Date("2026-09-29T12:00:00.000Z"),
  );

  assert.equal(result.ok, true);
  assert.equal(result.agency.agencyId, agencyId);
  assert.equal(result.agency.name, "Host Core Agency");
  assert.equal(result.agency.roomId, "agency_room_741201");
  assert.equal(result.owner.uid, ownerUid);
  assert.equal(result.membership.role, "host");
  assert.equal(result.target.month, "2026-09");
  assert.equal(result.target.progressCoins, 650000);
  assert.equal(result.target.paidDiamonds, 65);
  assert.equal(result.target.remainingCoins, 200000);
  assert.equal(result.target.currentLevel.id, "starter_b");
  assert.equal(result.target.currentLevel.rank, "B");
  assert.equal(result.target.nextLevel.id, "starter_a");
  assert.equal(result.target.targetCoins, 850000);
  assert.equal(result.activity.qualifiedDays, 7);
  assert.equal(result.activity.micSecondsMonth, 54000);
  assert.equal(result.activity.requiredQualifiedDays, 9);
  assert.equal(result.activity.requiredMinutesPerDay, 120);

  const serialized = JSON.stringify(result);
  assert.equal(serialized.includes("agencyProfitDiamonds"), false);
  assert.equal(serialized.includes("hostShareCoins"), false);
  assert.equal(serialized.includes("agencyShareCoins"), false);
  assert.equal(serialized.includes("diamonds\":999999"), false);
});

test("11-A stale monthly Host counters reset in the read model", async () => {
  const agencyId = "741202";
  const uid = "stage11a_stale_host";
  const ownerUid = "stage11a_stale_owner";

  await Promise.all([
    adminDb.collection("users").doc(uid).set({
      agencyId,
      agencyTargetMonth: "2026-08",
      agencyTargetProgressCoins: 850000,
      agencySalaryPaidDiamonds: 85,
      giftHostActivityMonth: "2026-08",
      giftHostQualifiedDays: 9,
      giftHostMicSecondsMonth: 64800,
    }),
    adminDb.collection("agency_user_memberships").doc(uid).set({
      agencyId,
      uid,
      role: "host",
      status: "active",
    }),
    adminDb.collection("agencies").doc(agencyId).set({
      agencyId,
      ownerUid,
      status: "active",
      name: "Month Reset Agency",
    }),
    adminDb.collection("users").doc(ownerUid).set({
      displayName: "Reset Owner",
    }),
  ]);

  const result = await loadAgencyHostCore(
    db,
    uid,
    new Date("2026-09-01T00:00:00.000Z"),
  );

  assert.equal(result.target.progressCoins, 0);
  assert.equal(result.target.paidDiamonds, 0);
  assert.equal(result.target.currentLevel, null);
  assert.equal(result.target.nextLevel.id, "starter_g");
  assert.equal(result.target.remainingCoins, 50000);
  assert.equal(result.activity.qualifiedDays, 0);
  assert.equal(result.activity.micSecondsMonth, 0);
});

test("11-A newly auto-joined Host loads with zeroed monthly state", async () => {
  const agencyId = "741205";
  const uid = "stage11a_fresh_auto_host";
  const ownerUid = "stage11a_fresh_auto_owner";

  await Promise.all([
    adminDb.collection("users").doc(uid).set({
      agencyId,
      agencyRole: "host",
      publicId: "36627984",
      displayName: "Fresh Host",
    }),
    adminDb.collection("agency_user_memberships").doc(uid).set({
      agencyId,
      uid,
      role: "host",
      status: "active",
    }),
    adminDb.collection("agencies").doc(agencyId).set({
      agencyId,
      publicId: agencyId,
      name: "Fresh Auto Join Agency",
      country: "الباشان",
      ownerUid,
      status: "active",
    }),
    adminDb.collection("users").doc(ownerUid).set({
      publicId: "930005",
      displayName: "Fresh Agency Owner",
    }),
  ]);

  const result = await loadAgencyHostCore(
    db,
    uid,
    new Date("2026-09-30T18:30:00.000Z"),
  );

  assert.equal(result.ok, true);
  assert.equal(result.membership.role, "host");
  assert.equal(result.membership.status, "active");
  assert.equal(result.target.month, "2026-09");
  assert.equal(result.target.progressCoins, 0);
  assert.equal(result.target.paidDiamonds, 0);
  assert.equal(result.target.currentLevel, null);
  assert.equal(result.target.nextLevel.id, "starter_g");
  assert.equal(result.target.remainingCoins, 50000);
  assert.equal(result.activity.qualifiedDays, 0);
  assert.equal(result.activity.micSecondsMonth, 0);
});

test("11-A pressure contract is five direct reads with zero query/write", async () => {
  const agencyId = "741203";
  const uid = "stage11a_pressure_host";
  const ownerUid = "stage11a_pressure_owner";
  const calls = { gets: [], queries: 0, writes: 0 };

  const fakeDb = {
    async get(path) {
      calls.gets.push(path);
      if (path === "users/" + uid) {
        return {
          exists: true,
          data: {
            agencyId,
            accountStatus: "active",
            sessionsRevokedAt: "2026-09-01T00:00:00.000Z",
            agencyTargetMonth: "2026-09",
            agencyTargetProgressCoins: 100000,
            agencySalaryPaidDiamonds: 10,
            giftHostActivityMonth: "2026-09",
            giftHostQualifiedDays: 2,
            giftHostMicSecondsMonth: 14000,
          },
        };
      }
      if (path === "agency_user_memberships/" + uid) {
        return {
          exists: true,
          data: { agencyId, uid, role: "host", status: "active" },
        };
      }
      if (path === "agencies/" + agencyId) {
        return {
          exists: true,
          data: {
            agencyId,
            publicId: agencyId,
            name: "Pressure Agency",
            ownerUid,
            status: "active",
            agencyRoomId: "agency_room_741203",
          },
        };
      }
      if (path === "system_config/gift_economy") {
        return {
          exists: true,
          data: {
            hostBonusQualifiedDays: 9,
            hostBonusMinutesPerQualifiedDay: 120,
          },
        };
      }
      if (path === "users/" + ownerUid) {
        return {
          exists: true,
          data: { displayName: "Pressure Owner", publicId: "930003" },
        };
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

  const result = await loadAgencyHostCore(
    fakeDb,
    uid,
    new Date("2026-09-29T12:00:00.000Z"),
    { sessionPayload: { sub: uid, iat: 1790683200 } },
  );

  assert.equal(result.ok, true);
  assert.equal(result.agency.roomId, "agency_room_741203");
  assert.deepEqual(calls.gets, [
    "users/" + uid,
    "agency_user_memberships/" + uid,
    "agencies/" + agencyId,
    "system_config/gift_economy",
    "users/" + ownerUid,
  ]);
  assert.equal(calls.queries, 0);
  assert.equal(calls.writes, 0);
});

test("11-A revoked session fails from the existing users read", async () => {
  const uid = "stage11a_revoked_host";
  const calls = [];

  const fakeDb = {
    async get(path) {
      calls.push(path);
      if (path === "users/" + uid) {
        return {
          exists: true,
          data: {
            agencyId: "741206",
            accountStatus: "active",
            sessionsRevokedAt: "2026-09-30T12:00:00.000Z",
          },
        };
      }
      if (path === "agency_user_memberships/" + uid) {
        return {
          exists: true,
          data: {
            agencyId: "741206",
            uid,
            role: "host",
            status: "active",
          },
        };
      }
      throw new Error("unexpected_get:" + path);
    },
  };

  await assert.rejects(
    () =>
      loadAgencyHostCore(
        fakeDb,
        uid,
        new Date("2026-09-30T13:00:00.000Z"),
        { sessionPayload: { sub: uid, iat: 1790767800 } },
      ),
    (error) => error && error.message === "unauthorized",
  );

  assert.deepEqual(calls, [
    "users/" + uid,
    "agency_user_memberships/" + uid,
  ]);
});

test("11-A non-Host membership fails closed before Agency reads", async () => {
  const uid = "stage11a_manager_only";
  const calls = [];

  const fakeDb = {
    async get(path) {
      calls.push(path);
      if (path === "users/" + uid) {
        return {
          exists: true,
          data: { agencyId: "741204" },
        };
      }
      if (path === "agency_user_memberships/" + uid) {
        return {
          exists: true,
          data: {
            agencyId: "741204",
            uid,
            role: "manager",
            status: "active",
          },
        };
      }
      throw new Error("unexpected_get:" + path);
    },
  };

  await assert.rejects(
    () =>
      loadAgencyHostCore(
        fakeDb,
        uid,
        new Date("2026-09-29T12:00:00.000Z"),
      ),
    (error) => error && error.message === "agency_host_not_active",
  );

  assert.deepEqual(calls, [
    "users/" + uid,
    "agency_user_memberships/" + uid,
  ]);
});


test("11-B Host UI reuses public ranking/archive and existing room/chat routes", () => {
  const page = readFileSync(
    new URL("../../lib/features/agency/screens/host_my_agency_page.dart", import.meta.url),
    "utf8",
  );
  const hostService = readFileSync(
    new URL("../../lib/features/agency/services/host_my_agency_service.dart", import.meta.url),
    "utf8",
  );

  assert.equal(page.includes("PublicAgencyService"), true);
  assert.equal(page.includes("loadRanking("), true);
  assert.equal(page.includes("loadArchive("), true);
  assert.equal(page.includes("host-agency-ranking-card"), true);
  assert.equal(page.includes("host-agency-archive-button"), true);
  assert.equal(page.includes("host-agency-room-button"), true);
  assert.equal(page.includes("ProfileActionService.openChat"), true);
  assert.equal(page.includes("AppRoutes.voiceChatRoom"), true);
  assert.equal(page.includes("FirebaseFirestore"), false);
  assert.equal(hostService.includes("roomId"), true);
  assert.equal(hostService.includes(".timeout(_requestTimeout)"), true);
  assert.equal(hostService.includes("agency_host_core_timeout"), true);
  assert.equal(page.includes("انتهت مهلة تحديث جلسة الدخول"), true);
  assert.equal(page.includes("الخادم تأخر في تحميل معلومات الوكالة"), true);
  assert.equal(hostService.includes("Duration(seconds: 20)"), true);
});
