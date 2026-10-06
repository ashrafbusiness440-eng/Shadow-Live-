import assert from "node:assert/strict";
import { after, test } from "node:test";
import { deleteApp, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

import {
  giftVipTrialCard,
  listVipTrialCards,
  vip10MaintenanceTrialCardWrites,
} from "../../cloudflare-worker/src/vip-trial-cards.js";
import {
  materializeVipState,
} from "../../cloudflare-worker/src/vip-state.js";
import {
  vipStateFromUser,
} from "../../cloudflare-worker/src/vip-runtime.js";
import { cloudflareFirestoreAdapter } from "./helpers/cloudflare-firestore-adapter.js";

const app = initializeApp(
  { projectId: "shadow-live-vip-trial-cards-test" },
  "vip-trial-cards-" + Date.now(),
);
const adminDb = getFirestore(app);
const db = cloudflareFirestoreAdapter(adminDb);

after(async () => {
  await deleteApp(app);
});

async function commitWrites(writes) {
  const tx = await db.beginTransaction();
  await db.commit(tx, writes);
}

async function seedUser(uid, extra = {}) {
  await Promise.all([
    adminDb.collection("users").doc(uid).set({
      role: "user",
      adminEnabled: false,
      accountStatus: "active",
      effectiveVipLevel: 0,
      earnedVipLevel: 0,
      adminGrantVipLevel: 0,
      vipGrowthPoints: 0,
      vipMaintenancePoints: 0,
      ...extra,
    }),
    adminDb.collection("public_profiles").doc(uid).set({
      uid,
      displayName: uid,
      publicId: "9" + String(Math.abs(uid.length * 91234567)).padStart(7, "0").slice(-7),
      vipLevel: Number(extra.effectiveVipLevel || 0),
      effectiveVipLevel: Number(extra.effectiveVipLevel || 0),
      vipExpiresAt: extra.vipExpiresAt || null,
    }),
  ]);
}

async function makeFriends(a, b) {
  await Promise.all([
    adminDb.collection("follows").doc(a + "__" + b).set({
      followerUid: a,
      followingUid: b,
    }),
    adminDb.collection("follows").doc(b + "__" + a).set({
      followerUid: b,
      followingUid: a,
    }),
  ]);
}

async function seedCard(ownerUid, cardId, cycle = "cycle_test") {
  await adminDb
    .collection("vip_trial_cards")
    .doc(ownerUid)
    .collection("items")
    .doc(cardId)
    .set({
      cardId,
      ownerUid,
      source: "vip10_maintenance",
      sourceCycleId: cycle,
      sourceVipLevel: 10,
      trialVipLevel: 5,
      durationDays: 7,
      status: "available",
      issuedAt: new Date(),
      consumedAt: null,
      recipientUid: null,
      recipientTrialExpiresAt: null,
    });
}

test("VIP10 maintenance crossing creates exactly three deterministic trial cards", async () => {
  const uid = "trial_award_" + Date.now();
  const nowMs = Date.UTC(2026, 9, 6, 6, 0, 0);
  const cycleExpiry = nowMs + 30 * 24 * 60 * 60 * 1000;
  const before = {
    earnedVipLevel: 10,
    earnedVipExpiresAtMs: cycleExpiry,
    maintenancePoints: 999,
  };
  const after = {
    ...before,
    maintenancePoints: 1000,
  };

  const award = vip10MaintenanceTrialCardWrites(
    db,
    uid,
    before,
    after,
    1000,
    nowMs,
  );
  assert.equal(award.awarded, true);
  assert.equal(award.count, 3);
  assert.equal(award.writes.length, 4);

  await commitWrites(award.writes);
  const inventory = await listVipTrialCards(db, uid, nowMs);
  assert.equal(inventory.items.length, 3);
  assert.equal(inventory.items.every((item) => item.available), true);
  assert.equal(
    new Set(inventory.items.map((item) => item.sourceCycleId)).size,
    1,
  );

  const noRepeat = vip10MaintenanceTrialCardWrites(
    db,
    uid,
    after,
    after,
    1000,
    nowMs + 1000,
  );
  assert.equal(noRepeat.awarded, false);
  assert.equal(noRepeat.count, 0);
});

test("trial card requires mutual friendship and preserves earned/admin VIP", async () => {
  const suffix = Date.now().toString();
  const sender = "trial_sender_" + suffix;
  const recipient = "trial_recipient_" + suffix;
  const cardId = "trial_card_friend_" + suffix;
  const nowMs = Date.UTC(2026, 9, 6, 7, 0, 0);
  const earnedExpiry = new Date(nowMs + 30 * 24 * 60 * 60 * 1000);
  const adminExpiry = new Date(nowMs + 2 * 24 * 60 * 60 * 1000);

  await Promise.all([
    seedUser(sender, { effectiveVipLevel: 10 }),
    seedUser(recipient, {
      earnedVipLevel: 2,
      earnedVipExpiresAt: earnedExpiry,
      adminGrantVipLevel: 4,
      adminGrantExpiresAt: adminExpiry,
      effectiveVipLevel: 4,
      vipLevel: 4,
      vipExpiresAt: adminExpiry,
      effectiveVipSource: "admin_grant",
    }),
  ]);
  await seedCard(sender, cardId);

  await assert.rejects(
    giftVipTrialCard(db, sender, { cardId, recipientUid: recipient }, {}, nowMs),
    /friend_required/,
  );

  await makeFriends(sender, recipient);
  const gifted = await giftVipTrialCard(
    db,
    sender,
    { cardId, recipientUid: recipient },
    {},
    nowMs,
  );

  assert.equal(gifted.trialVipLevel, 5);
  assert.equal(gifted.durationDays, 7);
  assert.equal(gifted.effectiveVipLevel, 5);
  assert.equal(gifted.effectiveVipSource, "trial");

  const recipientDoc = await adminDb.collection("users").doc(recipient).get();
  const data = recipientDoc.data();
  assert.equal(data.earnedVipLevel, 2);
  assert.equal(data.adminGrantVipLevel, 4);
  assert.equal(data.trialVipLevel, 5);
  assert.equal(data.effectiveVipLevel, 5);
  assert.equal(data.effectiveVipSource, "trial");

  const consumed = await adminDb
    .collection("vip_trial_cards")
    .doc(sender)
    .collection("items")
    .doc(cardId)
    .get();
  assert.equal(consumed.data().status, "consumed");
  assert.equal(consumed.data().recipientUid, recipient);
});

test("a second card extends active trial by another seven days and expiry falls back", async () => {
  const suffix = Date.now().toString();
  const sender = "trial_extend_sender_" + suffix;
  const recipient = "trial_extend_recipient_" + suffix;
  const nowMs = Date.UTC(2026, 9, 6, 8, 0, 0);
  const naturalExpiry = new Date(nowMs + 40 * 24 * 60 * 60 * 1000);

  await Promise.all([
    seedUser(sender, { effectiveVipLevel: 10 }),
    seedUser(recipient, {
      earnedVipLevel: 2,
      earnedVipExpiresAt: naturalExpiry,
      effectiveVipLevel: 2,
      vipLevel: 2,
      vipExpiresAt: naturalExpiry,
      effectiveVipSource: "progression",
    }),
  ]);
  await makeFriends(sender, recipient);
  await seedCard(sender, "extend_1_" + suffix, "extend_cycle");
  await seedCard(sender, "extend_2_" + suffix, "extend_cycle");

  const first = await giftVipTrialCard(
    db,
    sender,
    { cardId: "extend_1_" + suffix, recipientUid: recipient },
    {},
    nowMs,
  );
  const second = await giftVipTrialCard(
    db,
    sender,
    { cardId: "extend_2_" + suffix, recipientUid: recipient },
    {},
    nowMs + 1000,
  );

  assert.equal(
    second.trialVipExpiresAtMs - first.trialVipExpiresAtMs,
    7 * 24 * 60 * 60 * 1000,
  );

  const recipientDoc = await adminDb.collection("users").doc(recipient).get();
  const afterExpiry = materializeVipState(
    {},
    vipStateFromUser(recipientDoc.data()),
    second.trialVipExpiresAtMs + 1,
  );
  assert.equal(afterExpiry.trialVipLevel, 0);
  assert.equal(afterExpiry.effectiveVipLevel, 2);
  assert.equal(afterExpiry.effectiveVipSource, "progression");
});
