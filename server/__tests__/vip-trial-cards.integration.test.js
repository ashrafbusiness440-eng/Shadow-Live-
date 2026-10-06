import assert from "node:assert/strict";
import { after, test } from "node:test";
import { deleteApp, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

import { loadVipPolicy } from "../../cloudflare-worker/src/vip-policy.js";
import { applyVipGrowth, materializeVipState } from "../../cloudflare-worker/src/vip-state.js";
import {
  vip10TrialCardGrantWrites,
  listVipTrialCards,
  giftVipTrialCard,
  redeemVipTrialCard,
} from "../../cloudflare-worker/src/vip-trial-cards.js";
import { cloudflareFirestoreAdapter } from "./helpers/cloudflare-firestore-adapter.js";

const app = initializeApp(
  { projectId: "shadow-live-vip-trial-card-test" },
  "vip-trial-cards-" + Date.now(),
);
const adminDb = getFirestore(app);
const db = cloudflareFirestoreAdapter(adminDb);

after(async () => {
  await deleteApp(app);
});

async function seedPolicy() {
  await adminDb.collection("system_config").doc("vip").set({
    levels: Array.from({ length: 10 }, (_, i) => ({
      level: i + 1,
      growthRequired: (i + 1) * 1000,
      maintenanceRequired: (i + 1) * 100,
      validityDays: i + 1 >= 7 ? 60 : 30,
    })),
    purchasedGrowthPerCoin: 3,
    paidRechargeGrowthPerCoin: 1,
  });
}

async function seedUser(uid, extra = {}) {
  await adminDb.collection("users").doc(uid).set({
    role: "user",
    adminEnabled: false,
    effectiveVipLevel: 0,
    vipLevel: 0,
    vipGrowthPoints: 0,
    vipMaintenancePoints: 0,
    vipTrialCardIds: [],
    ...extra,
  });
  await adminDb.collection("public_profiles").doc(uid).set({
    uid,
    effectiveVipLevel: 0,
    vipLevel: 0,
  });
}

test("VIP10 maintenance threshold grants exactly 3 trial cards once per cycle", async () => {
  await seedPolicy();
  const nowMs = Date.UTC(2026, 9, 6, 8, 0, 0);
  const uid = "vip10_trial_owner";
  const cycleEnd = nowMs + 60 * 24 * 60 * 60 * 1000;
  await seedUser(uid, {
    earnedVipLevel: 10,
    effectiveVipLevel: 10,
    vipLevel: 10,
    earnedVipExpiresAt: new Date(cycleEnd),
    vipExpiresAt: new Date(cycleEnd),
    vipGrowthPoints: 10000,
    vipMaintenancePoints: 999,
  });

  const policy = await loadVipPolicy(db, { useCache: false });
  const before = materializeVipState(
    policy,
    {
      earnedVipLevel: 10,
      earnedVipExpiresAtMs: cycleEnd,
      adminGrantVipLevel: 0,
      adminGrantExpiresAtMs: 0,
      trialVipLevel: 0,
      trialVipExpiresAtMs: 0,
      growthPoints: 10000,
      maintenancePoints: 999,
    },
    nowMs,
  );
  const after = applyVipGrowth(policy, before, 1, nowMs);
  assert.equal(after.maintenancePoints, 1000);

  const userSnap = await db.get(`users/${uid}`);
  const grant = vip10TrialCardGrantWrites(
    db,
    uid,
    userSnap.data,
    policy,
    before,
    after,
    nowMs,
  );
  assert.equal(grant.granted, true);
  assert.equal(grant.cardIds.length, 3);

  const transaction = await db.beginTransaction();
  await db.commit(transaction, [
    db.writeUpdate(
      `users/${uid}`,
      grant.userPatch,
      Object.keys(grant.userPatch),
    ),
    ...grant.writes,
  ]);

  const listed = await listVipTrialCards(db, uid);
  assert.equal(listed.cards.length, 3);
  assert.ok(listed.cards.every((card) => card.vipLevel === 5));
  assert.ok(listed.cards.every((card) => card.durationDays === 7));

  const storedUser = (await db.get(`users/${uid}`)).data;
  const duplicate = vip10TrialCardGrantWrites(
    db,
    uid,
    storedUser,
    policy,
    before,
    after,
    nowMs + 1000,
  );
  assert.equal(duplicate.granted, false);
  assert.equal(duplicate.cardIds.length, 0);
});

test("trial card gifting requires mutual follow and transfers ownership atomically", async () => {
  const nowMs = Date.UTC(2026, 9, 6, 9, 0, 0);
  const sender = "trial_sender";
  const recipient = "trial_recipient";
  const cardId = "trial_sender_card_0001";
  await Promise.all([
    seedUser(sender, { vipTrialCardIds: [cardId] }),
    seedUser(recipient),
    adminDb.collection("vip_trial_cards").doc(cardId).set({
      cardId,
      ownerUid: sender,
      originalOwnerUid: sender,
      sourceUid: sender,
      source: "vip10_maintenance",
      sourceCycleKey: "cycle",
      vipLevel: 5,
      durationDays: 7,
      status: "available",
      recipientUid: sender,
      createdAt: new Date(nowMs),
      updatedAt: new Date(nowMs),
    }),
    adminDb.collection("follows").doc(sender + "__" + recipient).set({
      followerUid: sender,
      followingUid: recipient,
    }),
  ]);

  await assert.rejects(
    giftVipTrialCard(
      db,
      sender,
      { cardId, recipientUid: recipient },
      nowMs,
    ),
    /mutual_follow_required/,
  );

  await adminDb.collection("follows").doc(recipient + "__" + sender).set({
    followerUid: recipient,
    followingUid: sender,
  });

  const gifted = await giftVipTrialCard(
    db,
    sender,
    { cardId, recipientUid: recipient },
    nowMs + 1,
  );
  assert.equal(gifted.ok, true);

  const senderCards = await listVipTrialCards(db, sender);
  const recipientCards = await listVipTrialCards(db, recipient);
  assert.equal(senderCards.cards.length, 0);
  assert.equal(recipientCards.cards.length, 1);
  assert.equal(recipientCards.cards[0].ownerUid, recipient);
});

test("redeeming a card grants independent VIP5 trial for exactly 7 days", async () => {
  await seedPolicy();
  const nowMs = Date.UTC(2026, 9, 6, 10, 0, 0);
  const uid = "trial_redeemer";
  const cardId = "trial_redeemer_card_0001";
  await Promise.all([
    seedUser(uid, {
      earnedVipLevel: 2,
      effectiveVipLevel: 2,
      vipLevel: 2,
      earnedVipExpiresAt: new Date(nowMs + 30 * 24 * 60 * 60 * 1000),
      vipExpiresAt: new Date(nowMs + 30 * 24 * 60 * 60 * 1000),
      vipGrowthPoints: 2000,
      vipTrialCardIds: [cardId],
    }),
    adminDb.collection("vip_trial_cards").doc(cardId).set({
      cardId,
      ownerUid: uid,
      originalOwnerUid: "vip10_source",
      sourceUid: "vip10_source",
      source: "vip10_maintenance",
      sourceCycleKey: "cycle",
      vipLevel: 5,
      durationDays: 7,
      status: "available",
      recipientUid: uid,
      createdAt: new Date(nowMs),
      updatedAt: new Date(nowMs),
    }),
  ]);

  const redeemed = await redeemVipTrialCard(
    db,
    uid,
    { cardId },
    nowMs,
  );
  assert.equal(redeemed.trialVipLevel, 5);
  assert.equal(redeemed.effectiveVipLevel, 5);
  assert.equal(redeemed.effectiveVipSource, "trial_card");
  assert.equal(
    redeemed.trialVipExpiresAtMs,
    nowMs + 7 * 24 * 60 * 60 * 1000,
  );

  const user = (await db.get(`users/${uid}`)).data;
  assert.equal(user.earnedVipLevel, 2);
  assert.equal(user.adminGrantVipLevel || 0, 0);
  assert.equal(user.trialVipLevel, 5);
  assert.equal(user.vipTrialCardIds.length, 0);

  const card = (await db.get(`vip_trial_cards/${cardId}`)).data;
  assert.equal(card.status, "redeemed");
  assert.equal(card.redeemedByUid, uid);
});
