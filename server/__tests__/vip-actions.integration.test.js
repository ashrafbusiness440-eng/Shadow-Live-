import assert from "node:assert/strict";
import { after, test } from "node:test";
import { deleteApp, getApps, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

import {
  buyVipGrowth,
  vipSummary,
} from "../../cloudflare-worker/src/vip-actions.js";
import { cloudflareFirestoreAdapter } from "./helpers/cloudflare-firestore-adapter.js";

const app =
  getApps()[0] || initializeApp({ projectId: "shadow-live-vip-actions-test" });
const db = getFirestore(app);
const cloudflareDb = cloudflareFirestoreAdapter(db);

after(async () => {
  await deleteApp(app);
});

test("VIP Growth purchase debits coins once and upgrades progression atomically", async () => {
  const suffix = Date.now().toString();
  const uid = `vip_growth_${suffix}`;
  const key = `vip_growth_purchase_${suffix}`;

  await Promise.all([
    db.collection("users").doc(uid).set({
      role: "user",
      coins: 20000,
      vipGrowthPoints: 2308,
      vipMaintenancePoints: 0,
      earnedVipLevel: 0,
      effectiveVipLevel: 0,
      adminGrantVipLevel: 0,
    }),
    db.collection("public_profiles").doc(uid).set({
      uid,
      displayName: "VIP Test",
      vipLevel: 0,
      effectiveVipLevel: 0,
      vipExpiresAt: null,
    }),
    db.collection("system_config").doc("emergency_lock").set({
      enabled: false,
      economyLocked: false,
    }),
  ]);

  const before = await vipSummary(cloudflareDb, uid, Date.UTC(2026, 9, 4));
  assert.equal(before.growthPoints, 2308);
  assert.equal(before.effectiveVipLevel, 0);
  assert.equal(before.coins, 20000);

  const first = await buyVipGrowth(
    cloudflareDb,
    uid,
    {
      growthPoints: 30000,
      idempotencyKey: key,
    },
    Date.UTC(2026, 9, 4),
  );

  assert.equal(first.code, "ok");
  assert.equal(first.growthPointsPurchased, 30000);
  assert.equal(first.coinsSpent, 10000);
  assert.equal(first.coins, 10000);
  assert.equal(first.vip.growthPoints, 32308);
  assert.equal(first.vip.earnedVipLevel, 1);
  assert.equal(first.vip.effectiveVipLevel, 1);
  assert.equal(first.vip.validityDays, 30);

  const duplicate = await buyVipGrowth(
    cloudflareDb,
    uid,
    {
      growthPoints: 30000,
      idempotencyKey: key,
    },
    Date.UTC(2026, 9, 4),
  );
  assert.equal(duplicate.code, "duplicate");
  assert.equal(duplicate.coins, 10000);
  assert.equal(duplicate.vip.growthPoints, 32308);

  const [user, publicProfile, operation, ledger, history, audit] =
    await Promise.all([
    db.collection("users").doc(uid).get(),
    db.collection("public_profiles").doc(uid).get(),
    db.collection("vip_operations").doc(`${uid}__${key}`).get(),
    db.collection("financial_ledger").doc(`${uid}__${key}__vip_growth`).get(),
    db.collection("vip_growth_history").doc(`${uid}__${key}`).get(),
    db.collection("vip_audit_logs").doc(`${uid}__${key}`).get(),
  ]);

  assert.equal(user.data().coins, 10000);
  assert.equal(user.data().vipGrowthPoints, 32308);
  assert.equal(user.data().earnedVipLevel, 1);
  assert.equal(user.data().effectiveVipLevel, 1);
  assert.equal(user.data().vipLevel, 1);
  assert.equal(publicProfile.data().vipLevel, 1);
  assert.equal(publicProfile.data().effectiveVipLevel, 1);
  assert.ok(publicProfile.data().vipExpiresAt);
  assert.equal(operation.data().status, "completed");
  assert.equal(ledger.data().delta, -10000);
  assert.equal(history.data().deltaGrowthPoints, 30000);
  assert.equal(audit.data().action, "buyVipGrowth");
});

test("VIP Growth purchase rejects non-ratio amounts before spending", async () => {
  const suffix = Date.now().toString() + "_ratio";
  const uid = `vip_growth_${suffix}`;

  await Promise.all([
    db.collection("users").doc(uid).set({
      role: "user",
      coins: 1000,
      vipGrowthPoints: 0,
    }),
    db.collection("system_config").doc("emergency_lock").set({
      enabled: false,
      economyLocked: false,
    }),
  ]);

  await assert.rejects(
    buyVipGrowth(cloudflareDb, uid, {
      growthPoints: 100,
      idempotencyKey: `vip_growth_ratio_${suffix}`,
    }),
    /growth_amount_must_match_ratio/,
  );

  const user = await db.collection("users").doc(uid).get();
  assert.equal(user.data().coins, 1000);
  assert.equal(user.data().vipGrowthPoints, 0);
});

test("VIP Growth purchase rejects insufficient coins", async () => {
  const suffix = Date.now().toString() + "_funds";
  const uid = `vip_growth_${suffix}`;

  await Promise.all([
    db.collection("users").doc(uid).set({
      role: "user",
      coins: 5,
      vipGrowthPoints: 0,
    }),
    db.collection("system_config").doc("emergency_lock").set({
      enabled: false,
      economyLocked: false,
    }),
  ]);

  await assert.rejects(
    buyVipGrowth(cloudflareDb, uid, {
      growthPoints: 300,
      idempotencyKey: `vip_growth_funds_${suffix}`,
    }),
    /insufficient_coins/,
  );

  const user = await db.collection("users").doc(uid).get();
  assert.equal(user.data().coins, 5);
});
