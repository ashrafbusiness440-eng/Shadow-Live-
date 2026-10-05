import assert from "node:assert/strict";
import { after, test } from "node:test";
import { deleteApp, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

import {
  setVip4PrivacyPreference,
  vipSummary,
} from "../../cloudflare-worker/src/vip-actions.js";
import { cloudflareFirestoreAdapter } from "./helpers/cloudflare-firestore-adapter.js";

const app = initializeApp(
  { projectId: "shadow-live-vip4-privacy-test" },
  "vip4-privacy-" + Date.now(),
);
const db = getFirestore(app);
const cloudflareDb = cloudflareFirestoreAdapter(db);

after(async () => {
  await deleteApp(app);
});

const futureFrom = (nowMs) => new Date(nowMs + 24 * 60 * 60 * 1000);

async function seed(uid, level, nowMs) {
  await db.collection("users").doc(uid).set({
    role: "user",
    effectiveVipLevel: level,
    adminGrantVipLevel: level,
    adminGrantExpiresAt: level > 0 ? futureFrom(nowMs) : null,
    vipExpiresAt: level > 0 ? futureFrom(nowMs) : null,
  });
}

test("VIP4 privacy preferences are independent and server-authoritative", async () => {
  const nowMs = Date.UTC(2026, 9, 5, 22, 0, 0);
  const vip3 = "vip4_privacy_vip3_" + Date.now();
  const vip4 = "vip4_privacy_vip4_" + Date.now();
  await Promise.all([seed(vip3, 3, nowMs), seed(vip4, 4, nowMs)]);

  await assert.rejects(
    setVip4PrivacyPreference(
      cloudflareDb,
      vip3,
      { field: "hideNobleLevel", enabled: true },
      nowMs,
    ),
    /vip4_privacy_requires_vip4/,
  );

  for (const field of [
    "hideNobleLevel",
    "hideGameWinBanner",
    "hideBetWinNotification",
  ]) {
    const result = await setVip4PrivacyPreference(
      cloudflareDb,
      vip4,
      { field, enabled: true },
      nowMs,
    );
    assert.equal(result.field, field);
    assert.equal(result.enabled, true);
    assert.equal(result.canUse, true);
    assert.equal(result.requiredVipLevel, 4);
  }

  const summary = await vipSummary(cloudflareDb, vip4, nowMs);
  assert.equal(summary.hideNobleLevel, true);
  assert.equal(summary.hideGameWinBanner, true);
  assert.equal(summary.hideBetWinNotification, true);
  assert.equal(summary.canHideNobleLevel, true);
  assert.equal(summary.canHideGameWinBanner, true);
  assert.equal(summary.canHideBetWinNotification, true);
});
