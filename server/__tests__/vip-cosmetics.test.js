import assert from "node:assert/strict";
import test from "node:test";

import {
  VIP_COSMETIC_LEVELS,
  vipCosmeticAssetKey,
  vipCosmeticsFromUser,
  vipEntitlementsFromUser,
} from "../../cloudflare-worker/src/vip-entitlements.js";

test("VIP cosmetic thresholds map to stable Asset Studio keys", () => {
  assert.equal(VIP_COSMETIC_LEVELS.chatBubble, 2);
  assert.equal(VIP_COSMETIC_LEVELS.profileFrame, 3);
  assert.equal(VIP_COSMETIC_LEVELS.giftVisual, 4);
  assert.equal(VIP_COSMETIC_LEVELS.profileBackground, 5);
  assert.equal(VIP_COSMETIC_LEVELS.dataCard, 5);
  assert.equal(VIP_COSMETIC_LEVELS.audioWave, 7);
  assert.equal(VIP_COSMETIC_LEVELS.entryStrip, 8);
  assert.equal(VIP_COSMETIC_LEVELS.profileDecoration, 9);
  assert.equal(VIP_COSMETIC_LEVELS.nameEffect, 10);

  assert.equal(vipCosmeticAssetKey(1, "chatBubble"), "");
  assert.equal(vipCosmeticAssetKey(2, "chatBubble"), "vip.v2.chatBubble");
  assert.equal(vipCosmeticAssetKey(6, "audioWave"), "");
  assert.equal(vipCosmeticAssetKey(7, "audioWave"), "vip.v7.audioWave");
  assert.equal(vipCosmeticAssetKey(8, "entryStrip"), "vip.v8.entryStrip");
  assert.equal(vipCosmeticAssetKey(9, "profileDecoration"), "vip.v9.profileDecoration");
  assert.equal(vipCosmeticAssetKey(10, "nameEffect"), "vip.v10.nameEffect");
});

test("effective VIP level drives cumulative cosmetics and expires cleanly", () => {
  const nowMs = Date.UTC(2026, 9, 6, 12, 0, 0);
  const active = {
    effectiveVipLevel: 10,
    vipLevel: 10,
    vipExpiresAt: new Date(nowMs + 60_000),
  };

  const cosmetics = vipCosmeticsFromUser(active, nowMs);
  assert.equal(cosmetics.level, 10);
  assert.equal(cosmetics.keys.chatBubble, "vip.v10.chatBubble");
  assert.equal(cosmetics.keys.profileFrame, "vip.v10.profileFrame");
  assert.equal(cosmetics.keys.giftVisual, "vip.v10.giftVisual");
  assert.equal(cosmetics.keys.profileBackground, "vip.v10.profileBackground");
  assert.equal(cosmetics.keys.dataCard, "vip.v10.dataCard");
  assert.equal(cosmetics.keys.audioWave, "vip.v10.audioWave");
  assert.equal(cosmetics.keys.entryStrip, "vip.v10.entryStrip");
  assert.equal(cosmetics.keys.profileDecoration, "vip.v10.profileDecoration");
  assert.equal(cosmetics.keys.nameEffect, "vip.v10.nameEffect");

  const entitlements = vipEntitlementsFromUser(active, nowMs);
  assert.equal(entitlements.chatBubble, true);
  assert.equal(entitlements.voiceWave, true);
  assert.equal(entitlements.entryStrip, true);
  assert.equal(entitlements.roomEntryBroadcast, true);
  assert.equal(entitlements.profileDecoration, true);
  assert.equal(entitlements.nameEffect, true);

  const expired = vipCosmeticsFromUser(active, nowMs + 120_000);
  assert.equal(expired.level, 0);
  assert.equal(expired.keys.chatBubble, "");
  assert.equal(expired.keys.entryStrip, "");
  assert.equal(expired.keys.nameEffect, "");
});
