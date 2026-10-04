import assert from "node:assert/strict";
import { after, test } from "node:test";
import { deleteApp, getApps, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

import { creditPurchase } from "../../cloudflare-worker/src/google-play-purchase.js";
import { cloudflareFirestoreAdapter } from "./helpers/cloudflare-firestore-adapter.js";

const app =
  getApps()[0] || initializeApp({ projectId: "shadow-live-vip-recharge-test" });
const db = getFirestore(app);
const cloudflareDb = cloudflareFirestoreAdapter(db);

after(async () => {
  await deleteApp(app);
});

test("paid recharge awards VIP Growth from base Coins only, never bonus Coins", async () => {
  const suffix = Date.now().toString();
  const uid = `vip_recharge_${suffix}`;
  const hash = `vip_recharge_hash_${suffix}`;
  const productId = "shadow_test_vip_recharge";
  const packageId = "test_vip_recharge";

  await Promise.all([
    db.collection("users").doc(uid).set({
      role: "user",
      coins: 1000,
      vipGrowthPoints: 2308,
      vipMaintenancePoints: 0,
      earnedVipLevel: 0,
      effectiveVipLevel: 0,
      adminGrantVipLevel: 0,
    }),
    db.collection("public_profiles").doc(uid).set({
      uid,
      displayName: "Recharge VIP",
      vipLevel: 0,
      effectiveVipLevel: 0,
      vipExpiresAt: null,
    }),
    db.collection("system_config").doc("emergency_lock").set({
      enabled: false,
      economyLocked: false,
      rechargeLocked: false,
    }),
  ]);

  const result = await creditPurchase(
    cloudflareDb,
    uid,
    hash,
    productId,
    "com.shadowlive.app",
    {
      id: packageId,
      productId,
      baseCoins: 30000,
      bonusCoins: 10000,
      totalCoins: 40000,
      enabled: true,
    },
    {
      orderId: "order_test",
      regionCode: "AE",
      purchaseCompletionTime: new Date().toISOString(),
    },
    1,
  );

  assert.equal(result.duplicate, false);
  assert.equal(result.baseCoins, 30000);
  assert.equal(result.bonusCoins, 10000);
  assert.equal(result.coins, 40000);
  assert.equal(result.closingCoins, 41000);
  assert.equal(result.vipGrowthPoints, 30000);
  assert.equal(result.vipLevel, 1);

  const [user, publicProfile, purchase, history, ledger] = await Promise.all([
    db.collection("users").doc(uid).get(),
    db.collection("public_profiles").doc(uid).get(),
    db.collection("google_play_purchases").doc(hash).get(),
    db.collection("vip_growth_history").doc(`play_${hash}`).get(),
    db.collection("financial_ledger").doc(`play_${hash}`).get(),
  ]);

  assert.equal(user.data().coins, 41000);
  assert.equal(user.data().vipGrowthPoints, 32308);
  assert.equal(user.data().earnedVipLevel, 1);
  assert.equal(user.data().effectiveVipLevel, 1);
  assert.equal(user.data().vipLevel, 1);
  assert.equal(publicProfile.data().vipLevel, 1);
  assert.equal(publicProfile.data().effectiveVipLevel, 1);
  assert.ok(publicProfile.data().vipExpiresAt);

  assert.equal(purchase.data().baseCoins, 30000);
  assert.equal(purchase.data().bonusCoins, 10000);
  assert.equal(purchase.data().vipGrowthPoints, 30000);

  assert.equal(history.data().deltaGrowthPoints, 30000);
  assert.equal(history.data().baseCoins, 30000);
  assert.equal(history.data().bonusCoinsExcluded, 10000);

  assert.equal(ledger.data().delta, 40000);
});

test("duplicate credited purchase never adds Coins or VIP Growth twice", async () => {
  const suffix = Date.now().toString() + "_duplicate";
  const uid = `vip_recharge_${suffix}`;
  const hash = `vip_recharge_hash_${suffix}`;

  await Promise.all([
    db.collection("users").doc(uid).set({
      role: "user",
      coins: 5000,
      vipGrowthPoints: 500,
    }),
    db.collection("google_play_purchases").doc(hash).set({
      uid,
      status: "credited",
      coins: 12000,
      baseCoins: 10000,
      bonusCoins: 2000,
      vipGrowthPoints: 10000,
      vipLevel: 0,
    }),
    db.collection("system_config").doc("emergency_lock").set({
      enabled: false,
      economyLocked: false,
      rechargeLocked: false,
    }),
  ]);

  const result = await creditPurchase(
    cloudflareDb,
    uid,
    hash,
    "shadow_duplicate",
    "com.shadowlive.app",
    {
      id: "duplicate",
      productId: "shadow_duplicate",
      baseCoins: 10000,
      bonusCoins: 2000,
      totalCoins: 12000,
      enabled: true,
    },
    {},
    1,
  );

  assert.equal(result.duplicate, true);
  assert.equal(result.vipGrowthPoints, 10000);

  const user = await db.collection("users").doc(uid).get();
  assert.equal(user.data().coins, 5000);
  assert.equal(user.data().vipGrowthPoints, 500);
});
