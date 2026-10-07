import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  DEFAULT_VIP_POLICY,
  vipMaintenanceThreshold,
} from "../../cloudflare-worker/src/vip-policy.js";
import {
  materializeVipState,
} from "../../cloudflare-worker/src/vip-state.js";
import {
  vipEntitlementsFromUser,
} from "../../cloudflare-worker/src/vip-entitlements.js";
import {
  presenceSnapshotFromAttachments,
} from "../../cloudflare-worker/src/room-realtime-presence.js";

function source(path) {
  return readFileSync(new URL("../../" + path, import.meta.url), "utf8");
}

function activeVip(level, nowMs) {
  return {
    effectiveVipLevel: level,
    vipLevel: level,
    vipExpiresAt: new Date(nowMs + 60_000),
  };
}

test("remaining VIP runtime entitlements unlock at approved cumulative levels", () => {
  const nowMs = Date.UTC(2026, 9, 6, 12, 0, 0);
  const vip1 = vipEntitlementsFromUser(activeVip(1, nowMs), nowMs);
  const vip2 = vipEntitlementsFromUser(activeVip(2, nowMs), nowMs);
  const vip4 = vipEntitlementsFromUser(activeVip(4, nowMs), nowMs);

  assert.equal(vip1.vipCustomerService, true);
  assert.equal(vip1.priorityOnlineList, false);
  assert.equal(vip2.priorityOnlineList, true);
  assert.equal(vip2.unlimitedGreetings, true);
  assert.equal(vip4.vipGifts, true);
  assert.equal(vip4.exclusiveCustomerService, true);
  assert.equal(vip4.levelGuarantee, true);
  assert.equal(vip4.exclusiveEmoji, true);
});

test("VIP2 online priority reuses realtime attachments and preserves join order", () => {
  const snapshot = presenceSnapshotFromAttachments(
    [
      { uid: "normal_1", joinedAtMs: 100, vipLevel: 0 },
      { uid: "vip_2_late", joinedAtMs: 300, vipLevel: 2 },
      { uid: "vip_5_early", joinedAtMs: 200, vipLevel: 5 },
      { uid: "normal_2", joinedAtMs: 150, vipLevel: 1 },
    ],
    1000,
  );
  assert.deepEqual(
    snapshot.map((item) => item.uid),
    ["vip_5_early", "vip_2_late", "normal_1", "normal_2"],
  );
  assert.equal(snapshot[0].vipOnlinePriority, true);
  assert.equal(snapshot[2].vipOnlinePriority, false);
});

test("VIP4 level guarantee renews on maintenance and downgrade remains live policy", () => {
  const cycleEndMs = Date.UTC(2026, 9, 1, 0, 0, 0);
  const nowMs = cycleEndMs + 1000;
  const required = vipMaintenanceThreshold(DEFAULT_VIP_POLICY, 4);
  assert.ok(required > 0);

  const renewed = materializeVipState(
    DEFAULT_VIP_POLICY,
    {
      earnedVipLevel: 4,
      earnedVipExpiresAtMs: cycleEndMs,
      growthPoints: DEFAULT_VIP_POLICY.growthThresholds[3],
      maintenancePoints: required,
    },
    nowMs,
    { collectEvents: true },
  );
  assert.equal(renewed.earnedVipLevel, 4);
  assert.equal(renewed.maintenancePoints, 0);
  assert.equal(renewed.lifecycleEvents.length, 1);
  assert.equal(renewed.lifecycleEvents[0].eventType, "vip_renewal");
  assert.equal(renewed.lifecycleEvents[0].oldVipLevel, 4);
  assert.equal(renewed.lifecycleEvents[0].newVipLevel, 4);
  assert.ok(renewed.earnedVipExpiresAtMs > cycleEndMs);

  const downgraded = materializeVipState(
    DEFAULT_VIP_POLICY,
    {
      earnedVipLevel: 4,
      earnedVipExpiresAtMs: cycleEndMs,
      growthPoints: DEFAULT_VIP_POLICY.growthThresholds[3],
      maintenancePoints: Math.max(0, required - 1),
    },
    nowMs,
    { collectEvents: true },
  );
  assert.equal(downgraded.earnedVipLevel, 3);
  assert.equal(downgraded.lifecycleEvents.length, 1);
  assert.equal(downgraded.lifecycleEvents[0].eventType, "vip_downgrade");
  assert.equal(
    downgraded.lifecycleEvents[0].growthPointsAfter,
    downgraded.growthPoints,
  );
});

test("runtime consumers enforce VIP privileges without new polling or listeners", () => {
  const chat = source("cloudflare-worker/src/chat-safety-actions.js");
  const realtime = source("cloudflare-worker/src/room-realtime-object.js");
  const emojiCatalog = source("cloudflare-worker/src/animated-emoji-catalog.js");
  const ticket = source("cloudflare-worker/src/room-realtime.js");
  const voice = source("cloudflare-worker/src/voice-session-legacy.js");
  const roomGift = source("cloudflare-worker/src/room-gift.js");
  const giftCatalog = source(
    "cloudflare-worker/src/legacy-economy/gift-catalog.js",
  );
  const vipActions = source("cloudflare-worker/src/vip-actions.js");

  assert.equal(chat.includes("unlimitedGreetings = senderVip >= 2"), true);
  assert.equal(chat.includes("vip_gift_requires_level"), true);
  assert.equal(roomGift.includes("vip_gift_requires_level"), true);
  assert.equal(giftCatalog.includes("minVipLevel"), true);

  assert.equal(emojiCatalog.includes("vip4_emoji_required"), true);
  assert.equal(realtime.includes("animatedEmojiId"), true);
  assert.equal(realtime.includes("validateAnimatedEmojiForVip"), true);
  assert.equal(
    realtime.includes("vipLevel: 0,\n        entryEffectKey"),
    false,
  );

  assert.equal(ticket.includes("customerServiceMinVipLevel"), true);
  assert.equal(ticket.includes("vip1_customer_service_required"), true);
  assert.equal(ticket.includes("vip4_customer_service_required"), true);
  assert.equal(voice.includes("customer_service_exclusive_busy"), true);
  assert.equal(voice.includes("setCustomerServiceVipMode"), true);
  assert.equal(voice.includes("actorVip>=2"), true);

  assert.equal(vipActions.includes("vipLifecycleHistoryWrites"), true);
  assert.equal(vipActions.includes("vip_renewal"), false);
  assert.equal(vipActions.includes("source: \"vip_lifecycle\""), true);

  for (const sourceText of [chat, realtime, ticket, roomGift]) {
    assert.equal(sourceText.includes("Timer.periodic"), false);
  }
});
