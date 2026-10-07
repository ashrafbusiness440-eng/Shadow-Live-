import assert from "node:assert/strict";
import { after, test } from "node:test";
import { readFileSync } from "node:fs";
import { deleteApp, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

import {
  loadAgencyHostCore,
  loadAgencyHostTargetHistory,
} from "../../cloudflare-worker/src/agency-host.js";
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
            id: "starter_f",
            tierId: "starter",
            rank: "F",
            thresholdCoins: 100000,
            salaryDiamonds: 10,
          },
          {
            id: "starter_e",
            tierId: "starter",
            rank: "E",
            thresholdCoins: 200000,
            salaryDiamonds: 20,
          },
          {
            id: "starter_d",
            tierId: "starter",
            rank: "D",
            thresholdCoins: 300000,
            salaryDiamonds: 30,
          },
          {
            id: "starter_c",
            tierId: "starter",
            rank: "C",
            thresholdCoins: 450000,
            salaryDiamonds: 45,
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
      hostBonusQualifiedDays: 14,
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
  assert.deepEqual(
    result.target.levels.map((level) => level.id),
    ["starter_g", "starter_f", "starter_e", "starter_d", "starter_c", "starter_b", "starter_a"],
  );
  const topLevel = result.target.levels.find((level) => level.id === "starter_a");
  assert.equal(topLevel.salaryDiamonds, 85);
  assert.equal(topLevel.hostShareBps, 5000);
  assert.equal(topLevel.grossSupportCoins, 1700000);
  assert.deepEqual(topLevel.activityBonus, {
    asset: "diamonds",
    amount: 4,
  });
  assert.equal(result.activity.qualifiedDays, 7);
  assert.equal(result.activity.micSecondsMonth, 54000);
  assert.equal(result.activity.requiredQualifiedDays, 14);
  assert.equal(result.activity.requiredMinutesPerDay, 120);
  assert.equal(result.activity.bonusMode, "highest_target_month_end");
  assert.equal(result.activity.requiredMicSecondsMonth, 100800);
  assert.equal(JSON.stringify(result).includes("activityBonusBps"), false);

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

test("11-B personal Target history preserves multi-target jump snapshots and Diamonds paid", async () => {
  const agencyId = "741209";
  const uid = "stage11b_history_host";

  await Promise.all([
    adminDb.collection("users").doc(uid).set({
      agencyId,
      agencyRole: "host",
      accountStatus: "active",
      publicId: "741299",
    }),
    adminDb.collection("agency_user_memberships").doc(uid).set({
      agencyId,
      uid,
      role: "host",
      status: "active",
    }),
    adminDb.collection("gift_transactions").doc("history_jump_01").set({
      receiverId: uid,
      agencyId,
      agencyTargetMonth: "2026-10",
      agencyTargetId: "starter_e",
      earningsStatus: "target_paid",
      salaryDeltaDiamonds: 20,
      agencyTargetAchievements: [
        {
          id: "starter_g",
          tierId: "starter",
          rank: "G",
          thresholdCoins: 50000,
          salaryDiamonds: 5,
          salaryDeltaDiamonds: 5,
        },
        {
          id: "starter_f",
          tierId: "starter",
          rank: "F",
          thresholdCoins: 100000,
          salaryDiamonds: 10,
          salaryDeltaDiamonds: 5,
        },
        {
          id: "starter_e",
          tierId: "starter",
          rank: "E",
          thresholdCoins: 200000,
          salaryDiamonds: 20,
          salaryDeltaDiamonds: 10,
        },
      ],
      createdAt: new Date("2026-10-02T08:00:00.000Z"),
    }),
  ]);

  const result = await loadAgencyHostTargetHistory(
    db,
    uid,
    { month: "2026-10" },
    new Date("2026-10-02T10:00:00.000Z"),
  );

  assert.equal(result.ok, true);
  assert.equal(result.month, "2026-10");
  assert.equal(result.transactionLimit, 30);
  assert.deepEqual(
    result.achievements.map((item) => item.targetId),
    ["starter_g", "starter_f", "starter_e"],
  );
  assert.deepEqual(
    result.achievements.map((item) => item.salaryDeltaDiamonds),
    [5, 5, 10],
  );
  assert.equal(
    result.achievements.reduce(
      (sum, item) => sum + item.salaryDeltaDiamonds,
      0,
    ),
    20,
  );
  assert.equal(result.achievements[2].rank, "E");
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
            hostBonusQualifiedDays: 14,
            hostBonusMinutesPerQualifiedDay: 120,
          },
        };
      }
      if (path === "public_profiles/" + ownerUid) {
        return {
          exists: true,
          data: {
            uid: ownerUid,
            displayName: "Pressure Owner",
            publicId: "930003",
          },
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
    "public_profiles/" + ownerUid,
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

test("11-A manager role transitions keep My Agency valid and review permission stays explicit", async () => {
  const cases = [
    {
      agencyId: "741204",
      uid: "stage11a_manager_with_review",
      ownerUid: "stage11a_manager_owner",
      role: "manager",
      capabilities: ["reviewMembershipRequest"],
      canReview: true,
    },
    {
      agencyId: "741207",
      uid: "stage11a_manager_without_review",
      ownerUid: "stage11a_manager_owner_no_cap",
      role: "manager",
      capabilities: [],
      canReview: false,
    },
    {
      agencyId: "741208",
      uid: "stage11a_senior_manager",
      ownerUid: "stage11a_senior_owner",
      role: "senior_manager",
      capabilities: [],
      canReview: true,
    },
  ];

  for (const entry of cases) {
    await Promise.all([
      adminDb.collection("users").doc(entry.uid).set({
        agencyId: entry.agencyId,
        agencyRole: entry.role,
        accountStatus: "active",
        publicId: entry.agencyId.slice(0, 5) + "1",
      }),
      adminDb.collection("agency_user_memberships").doc(entry.uid).set({
        agencyId: entry.agencyId,
        uid: entry.uid,
        role: entry.role,
        status: "active",
        capabilities: entry.capabilities,
      }),
      adminDb.collection("agencies").doc(entry.agencyId).set({
        agencyId: entry.agencyId,
        publicId: entry.agencyId,
        ownerUid: entry.ownerUid,
        status: "active",
        name: "Management Role Agency",
      }),
      adminDb.collection("users").doc(entry.ownerUid).set({
        publicId: entry.agencyId.slice(0, 5) + "9",
        displayName: "Management Role Owner",
      }),
    ]);

    const result = await loadAgencyHostCore(
      db,
      entry.uid,
      new Date("2026-09-29T12:00:00.000Z"),
    );

    assert.equal(result.ok, true);
    assert.equal(result.membership.role, entry.role);
    assert.equal(
      result.membership.permissions.canReviewMembershipRequests,
      entry.canReview,
    );
  }
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
  assert.equal(page.includes("host-agency-target-history-entry"), true);
  assert.equal(page.includes("سجل الـTargets والـDiamonds"), true);
  assert.equal(hostService.includes("'action': 'targetHistory'"), true);
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
