import assert from "node:assert/strict";
import { after, test } from "node:test";
import { readFileSync } from "node:fs";
import { deleteApp, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

import {
  getAgencyPolicyControlDetails,
  overrideAgencyCooldownByPublicId,
  propagateAgencyPolicyPage,
  updateAgencyPolicyOverride,
} from "../../cloudflare-worker/src/agency-control.js";
import { sendRoomGift } from "../../cloudflare-worker/src/room-gift.js";
import { cloudflareFirestoreAdapter } from "./helpers/cloudflare-firestore-adapter.js";

const app = initializeApp(
  { projectId: "shadow-live-economy-test" },
  "agency-stage13b-" + Date.now(),
);
const adminDb = getFirestore(app);
const db = cloudflareFirestoreAdapter(adminDb);

after(async () => {
  await deleteApp(app);
});

const globalEconomy = {
  enabled: true,
  policyMode: "tiered_host_agency",
  coinsPerUsd: 10000,
  coinsPerDiamond: 10000,
  agencyPerformanceBonusBps: 200,
  agencyBonusActiveHosts: 10,
  hostPerformanceBonusBps: 200,
  hostBonusQualifiedDays: 9,
  tiers: [
    { id: "starter", nameAr: "Starter", minGiftCoins: 0, hostShareBps: 5000, agencyShareBps: 500 },
    { id: "bronze", nameAr: "Bronze", minGiftCoins: 1000000, hostShareBps: 5700, agencyShareBps: 600 },
    { id: "silver", nameAr: "Silver", minGiftCoins: 5000000, hostShareBps: 6000, agencyShareBps: 800 },
    { id: "gold", nameAr: "Gold", minGiftCoins: 20000000, hostShareBps: 6200, agencyShareBps: 900 },
    { id: "diamond", nameAr: "Diamond", minGiftCoins: 50000000, hostShareBps: 6300, agencyShareBps: 1000 },
  ],
};

function realtimeNamespaceWithPresentUids(uids = []) {
  const present = new Set(uids);
  return {
    idFromName(roomId) {
      return "room:" + roomId;
    },
    get() {
      return {
        async fetch(url) {
          const uid = new URL(url).searchParams.get("uid");
          return Response.json({ ok: true, present: present.has(uid) });
        },
      };
    },
  };
}

async function seedAgency(agencyId, ownerUid = "stage13b_platform_owner") {
  const now = new Date("2026-09-30T00:00:00.000Z");
  await Promise.all([
    adminDb.collection("agencies").doc(agencyId).set({
      schemaVersion: 1,
      agencyId,
      publicId: agencyId,
      name: "Stage 13-B Agency",
      ownerUid,
      status: "active",
      memberCount: 0,
      hostCount: 0,
      managerCount: 0,
      seniorManagerCount: 0,
      createdAt: now,
      updatedAt: now,
    }),
    adminDb.collection("users").doc(ownerUid).set({
      publicId: "713101",
      role: "owner",
      accountStatus: "active",
    }, { merge: true }),
    adminDb.collection("system_config").doc("gift_economy").set(globalEconomy),
  ]);
}

const customTiers = [
  { id: "starter", nameAr: "Starter", minGiftCoins: 0, hostShareBps: 5500, agencyShareBps: 500 },
  { id: "bronze", nameAr: "Bronze", minGiftCoins: 1000000, hostShareBps: 5700, agencyShareBps: 600 },
  { id: "silver", nameAr: "Silver", minGiftCoins: 5000000, hostShareBps: 6000, agencyShareBps: 800 },
  { id: "gold", nameAr: "Gold", minGiftCoins: 20000000, hostShareBps: 6200, agencyShareBps: 900 },
  { id: "diamond", nameAr: "Diamond", minGiftCoins: 50000000, hostShareBps: 6300, agencyShareBps: 1000 },
];

const customTargets = [
  { id: "custom_one", tierId: "starter", rank: "G", thresholdCoins: 55000, salaryDiamonds: 7 },
  { id: "custom_two", tierId: "starter", rank: "F", thresholdCoins: 120000, salaryDiamonds: 12 },
];

test("13-B policy control inherits global then stores an idempotent per-agency override", async () => {
  const agencyId = "813101";
  const actorUid = "stage13b_platform_owner";
  await seedAgency(agencyId, actorUid);

  const inherited = await getAgencyPolicyControlDetails(db, agencyId);
  assert.equal(inherited.overrideExists, false);
  assert.equal(inherited.effective.inherited.tiers, true);
  assert.equal(inherited.effective.inherited.targets, true);
  assert.equal(inherited.effective.inherited.bonus, true);
  assert.equal(inherited.effective.surplusToShadow, null);

  const body = {
    agencyId,
    overrideTiers: true,
    tiers: customTiers,
    overrideTargets: true,
    targets: customTargets,
    overrideBonus: true,
    agencyPerformanceBonusBps: 125,
    agencyBonusActiveHosts: 3,
    surplusToShadow: false,
    idempotencyKey: "stage13b_policy_0001",
  };
  const now = new Date("2026-09-30T00:10:00.000Z");
  const first = await updateAgencyPolicyOverride(db, actorUid, body, { now });
  const replay = await updateAgencyPolicyOverride(db, actorUid, body, { now });
  assert.equal(first.code, "ok");
  assert.equal(first.propagationRequired, true);
  assert.equal(replay.code, "duplicate");

  const current = await getAgencyPolicyControlDetails(db, agencyId);
  assert.equal(current.overrideExists, true);
  assert.equal(current.effective.inherited.tiers, false);
  assert.equal(current.effective.inherited.targets, false);
  assert.equal(current.effective.inherited.bonus, false);
  assert.equal(current.effective.inherited.surplus, false);
  assert.equal(current.effective.tiers[0].hostShareBps, 5500);
  assert.equal(current.effective.targets[0].thresholdCoins, 55000);
  assert.equal(current.effective.agencyPerformanceBonusBps, 125);
  assert.equal(current.effective.agencyBonusActiveHosts, 3);
  assert.equal(current.effective.surplusToShadow, false);

  const [override, agency, audit] = await Promise.all([
    adminDb.collection("agency_policy_overrides").doc(agencyId).get(),
    adminDb.collection("agencies").doc(agencyId).get(),
    adminDb.collection("admin_audit_logs")
      .doc("agency_policy_" + agencyId + "_stage13b_policy_0001").get(),
  ]);
  assert.equal(override.data().policyVersion, "stage13b_policy_0001");
  assert.equal(agency.data().policyVersion, "stage13b_policy_0001");
  assert.equal(audit.exists, true);
  assert.equal(audit.data().action, "updateAgencyPolicy");
});

test("13-B propagates policy snapshots in bounded cursor pages and never touches outsiders", async () => {
  const agencyId = "813102";
  const actorUid = "stage13b_platform_owner";
  await seedAgency(agencyId, actorUid);
  await updateAgencyPolicyOverride(db, actorUid, {
    agencyId,
    overrideTiers: true,
    tiers: customTiers,
    overrideTargets: true,
    targets: customTargets,
    overrideBonus: true,
    agencyPerformanceBonusBps: 125,
    agencyBonusActiveHosts: 3,
    surplusToShadow: true,
    idempotencyKey: "stage13b_policy_0002",
  });

  const memberWrites = [];
  for (let index = 0; index < 30; index += 1) {
    memberWrites.push(
      adminDb.collection("users").doc(
        "stage13b_member_" + String(index).padStart(2, "0"),
      ).set({
        role: "user",
        accountStatus: "active",
        agencyId,
        agencyRole: "host",
        coins: 0,
        diamonds: 0,
      }),
    );
  }
  memberWrites.push(
    adminDb.collection("users").doc("stage13b_outsider").set({
      role: "user",
      accountStatus: "active",
      agencyId: "999999",
      agencyRole: "host",
    }),
  );
  await Promise.all(memberWrites);

  const first = await propagateAgencyPolicyPage(db, agencyId, { limit: 25 });
  assert.equal(first.updated, 25);
  assert.equal(first.hasMore, true);
  assert.ok(first.nextCursor);

  const second = await propagateAgencyPolicyPage(db, agencyId, {
    limit: 25,
    cursor: first.nextCursor,
  });
  assert.equal(second.updated, 5);
  assert.equal(second.hasMore, false);
  assert.equal(second.nextCursor, null);

  const [firstMember, lastMember, outsider] = await Promise.all([
    adminDb.collection("users").doc("stage13b_member_00").get(),
    adminDb.collection("users").doc("stage13b_member_29").get(),
    adminDb.collection("users").doc("stage13b_outsider").get(),
  ]);
  assert.equal(firstMember.data().agencyPolicySnapshot.agencyId, agencyId);
  assert.equal(firstMember.data().agencyPolicySnapshot.tiers[0].hostShareBps, 5500);
  assert.equal(lastMember.data().agencyPolicySnapshot.targets[0].salaryDiamonds, 7);
  assert.equal("agencyPolicySnapshot" in outsider.data(), false);
});

test("13-B room gift consumes propagated tier and Target overrides with no policy read on hot path", async () => {
  const agencyId = "813103";
  const actorUid = "stage13b_platform_owner";
  const senderUid = "stage13b_sender";
  const hostUid = "stage13b_host";
  const roomId = "stage13b_room";
  await seedAgency(agencyId, actorUid);
  await updateAgencyPolicyOverride(db, actorUid, {
    agencyId,
    overrideTiers: true,
    tiers: customTiers,
    overrideTargets: true,
    targets: customTargets,
    overrideBonus: false,
    surplusToShadow: false,
    idempotencyKey: "stage13b_policy_0003",
  });
  await Promise.all([
    adminDb.collection("users").doc(senderUid).set({
      role: "user",
      accountStatus: "active",
      coins: 500000,
      diamonds: 0,
    }),
    adminDb.collection("users").doc(hostUid).set({
      role: "user",
      accountStatus: "active",
      agencyId,
      agencyRole: "host",
      coins: 0,
      diamonds: 0,
      pendingGiftEarningCoins: 0,
      pendingAgencyGiftEarningCoins: 0,
    }),
    adminDb.collection("rooms").doc(roomId).set({
      isActive: true,
      agencyId,
      totalSupport: 0,
    }),
    adminDb.collection("system_config").doc("gift_catalog").set({
      gifts: [{
        id: "stage13b_gift",
        nameAr: "هدية 13-B",
        priceCoins: 100000,
        enabled: true,
        assetKey: "gifts.placeholder.default",
      }],
    }),
  ]);
  await propagateAgencyPolicyPage(db, agencyId, { limit: 25 });

  const result = await sendRoomGift(
    db,
    senderUid,
    {
      roomId,
      receiverId: hostUid,
      giftId: "stage13b_gift",
      quantity: 1,
      idempotencyKey: "stage13b_roomgift_0001",
    },
    {
      realtimeNamespace: realtimeNamespaceWithPresentUids([senderUid, hostUid]),
      now: new Date("2026-09-30T00:30:00.000Z"),
    },
  );
  assert.equal(result.recipientShareCoins, 55000);
  assert.equal(result.agencyTargetId, "custom_one");
  assert.equal(result.salaryDeltaDiamonds, 7);

  const host = await adminDb.collection("users").doc(hostUid).get();
  assert.equal(host.data().diamonds, 7);
  assert.equal(host.data().agencyTargetProgressCoins, 55000);

  const roomGiftSource = readFileSync(
    new URL("../../cloudflare-worker/src/room-gift.js", import.meta.url),
    "utf8",
  );
  const chatGiftSource = readFileSync(
    new URL("../../cloudflare-worker/src/chat-safety-actions.js", import.meta.url),
    "utf8",
  );
  assert.equal(roomGiftSource.includes("agency_policy_overrides"), false);
  assert.equal(chatGiftSource.includes("agency_policy_overrides"), false);
  assert.equal(roomGiftSource.includes("economyWithAgencyPolicySnapshot"), true);
  assert.equal(chatGiftSource.includes("economyWithAgencyPolicySnapshot"), true);
});

test("13-B cooldown exception resolves Public ID and reuses audited Stage 04 override", async () => {
  const actorUid = "stage13b_platform_owner";
  const targetUid = "stage13b_cooldown_user";
  const oldAgencyId = "813104";
  await seedAgency(oldAgencyId, actorUid);
  await Promise.all([
    adminDb.collection("users").doc(targetUid).set({
      publicId: "713104",
      role: "user",
      accountStatus: "active",
      agencyId: "",
      agencyRole: "",
    }),
    adminDb.collection("public_ids").doc("713104").set({ uid: targetUid }),
    adminDb.collection("agency_user_memberships").doc(targetUid).set({
      agencyId: oldAgencyId,
      uid: targetUid,
      role: "host",
      status: "left",
      cooldownUntil: new Date("2026-10-07T00:00:00.000Z"),
      updatedAt: new Date("2026-09-30T00:00:00.000Z"),
    }),
    adminDb.collection("agency_memberships")
      .doc(oldAgencyId + "__" + targetUid).set({
        agencyId: oldAgencyId,
        uid: targetUid,
        role: "host",
        status: "left",
        cooldownUntil: new Date("2026-10-07T00:00:00.000Z"),
        updatedAt: new Date("2026-09-30T00:00:00.000Z"),
      }),
  ]);

  const now = new Date("2026-09-30T00:40:00.000Z");
  const result = await overrideAgencyCooldownByPublicId(
    db,
    actorUid,
    {
      targetPublicId: "713104",
      reason: "approved_stage13b_exception",
      idempotencyKey: "stage13b_exception_0001",
    },
    { now },
  );
  assert.equal(result.overrideApplied, true);
  assert.equal(result.uid, targetUid);

  const pointer = await adminDb.collection("agency_user_memberships")
    .doc(targetUid).get();
  assert.equal(pointer.data().cooldownUntil.toDate().toISOString(), now.toISOString());
});
