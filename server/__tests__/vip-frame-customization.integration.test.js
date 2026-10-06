import assert from "node:assert/strict";
import { after, test } from "node:test";
import { deleteApp, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

import {
  setVipProfileFrame,
  vipSummary,
} from "../../cloudflare-worker/src/vip-actions.js";
import { cloudflareFirestoreAdapter } from "./helpers/cloudflare-firestore-adapter.js";

const app = initializeApp(
  { projectId: "shadow-live-vip-frame-test" },
  "vip-frame-" + Date.now(),
);
const adminDb = getFirestore(app);
const db = cloudflareFirestoreAdapter(adminDb);

after(async () => {
  await deleteApp(app);
});

async function seed(uid, level, nowMs) {
  const expiry = new Date(nowMs + 60 * 24 * 60 * 60 * 1000);
  await Promise.all([
    adminDb.collection("users").doc(uid).set({
      role: "user",
      effectiveVipLevel: level,
      adminGrantVipLevel: level,
      adminGrantExpiresAt: expiry,
      vipExpiresAt: expiry,
    }),
    adminDb.collection("public_profiles").doc(uid).set({
      uid,
      effectiveVipLevel: level,
      vipLevel: level,
      vipExpiresAt: expiry,
    }),
  ]);
}

test("VIP6 can choose an unlocked VIP frame and summary exposes cooldown", async () => {
  const nowMs = Date.UTC(2026, 9, 6, 8, 0, 0);
  const uid = "vip6_frame_user";
  await seed(uid, 6, nowMs);

  const changed = await setVipProfileFrame(
    db,
    uid,
    { frameLevel: 4 },
    nowMs,
  );
  assert.equal(changed.vipProfileFrameLevel, 4);
  assert.equal(
    changed.nextFrameCustomizationAtMs,
    nowMs + 30 * 24 * 60 * 60 * 1000,
  );

  const summary = await vipSummary(db, uid, nowMs + 1000);
  assert.equal(summary.canCustomizeVipFrame, true);
  assert.equal(summary.vipProfileFrameLevel, 4);
  assert.equal(summary.frameCustomizationChangedAtMs, nowMs);

  const profile = await adminDb.collection("public_profiles").doc(uid).get();
  assert.equal(profile.data().vipProfileFrameLevel, 4);
});

test("VIP frame change is blocked for 30 days and above current VIP", async () => {
  const nowMs = Date.UTC(2026, 9, 6, 9, 0, 0);
  const uid = "vip7_frame_user";
  await seed(uid, 7, nowMs);

  await setVipProfileFrame(db, uid, { frameLevel: 5 }, nowMs);

  await assert.rejects(
    setVipProfileFrame(
      db,
      uid,
      { frameLevel: 6 },
      nowMs + 29 * 24 * 60 * 60 * 1000,
    ),
    /vip_frame_customization_cooldown/,
  );

  const afterCooldown = await setVipProfileFrame(
    db,
    uid,
    { frameLevel: 6 },
    nowMs + 30 * 24 * 60 * 60 * 1000,
  );
  assert.equal(afterCooldown.vipProfileFrameLevel, 6);

  await assert.rejects(
    setVipProfileFrame(
      db,
      uid,
      { frameLevel: 8 },
      nowMs + 61 * 24 * 60 * 60 * 1000,
    ),
    /vip_frame_level_locked/,
  );
});

test("VIP5 cannot customize VIP frames", async () => {
  const nowMs = Date.UTC(2026, 9, 6, 10, 0, 0);
  const uid = "vip5_frame_user";
  await seed(uid, 5, nowMs);

  await assert.rejects(
    setVipProfileFrame(db, uid, { frameLevel: 3 }, nowMs),
    /vip_frame_customization_requires_vip6/,
  );
});
