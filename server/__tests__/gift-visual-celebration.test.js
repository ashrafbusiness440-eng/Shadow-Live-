import assert from "node:assert/strict";
import test from "node:test";

import {
  giftVisualPolicy,
  premiumGiftCelebrationEvent,
} from "../../cloudflare-worker/src/gift-visual-policy.js";
import {
  normalizeGlobalAppFeedEvent,
} from "../../cloudflare-worker/src/global-app-feed.js";

test("gift room effect threshold is SKU metadata, never a gift-id rule", () => {
  const gift = {
    id: "anything",
    assetKey: "gifts.anything.default",
    effectMode: "cinematic",
    effectAssetKey: "gifts.anything.effect",
    effectMinQuantity: 7,
    effectDurationMs: 3200,
    premiumBannerMinQuantity: 77,
  };

  assert.equal(giftVisualPolicy(gift, 1).roomEffect, null);
  assert.deepEqual(giftVisualPolicy(gift, 7).roomEffect, {
    mode: "cinematic",
    assetKey: "gifts.anything.effect",
    durationMs: 3200,
    minQuantity: 7,
  });
  assert.equal(giftVisualPolicy(gift, 7).premiumBanner, null);
  assert.equal(giftVisualPolicy(gift, 77).premiumBanner.minQuantity, 77);
});

test("premium gift celebration uses the shared app event contract", () => {
  const event = premiumGiftCelebrationEvent({
    operationId: "gift_operation_123456",
    gift: {
      id: "luxury",
      nameAr: "هدية فاخرة",
      assetKey: "gifts.luxury.default",
      premiumBannerMinQuantity: 7,
    },
    quantity: 7,
    totalCost: 70000,
    sender: {
      uid: "sender",
      displayName: "Sender",
      profileImageUrl: "sender.webp",
    },
    receiver: {
      uid: "receiver",
      displayName: "Receiver",
      profileImageUrl: "receiver.webp",
    },
    roomId: "room_1",
    nowMs: 10000,
  });
  assert.equal(event.kind, "premium_gift");
  assert.equal(event.giftQuantity, 7);
  assert.equal(event.giftTotalCoins, 70000);
  assert.equal(event.secondaryUid, "receiver");

  const normalized = normalizeGlobalAppFeedEvent(event, 12000);
  assert.equal(normalized.kind, "premium_gift");
  assert.equal(normalized.giftName, "هدية فاخرة");
  assert.equal(normalized.secondaryUid, "receiver");
});

test("shared celebration feed accepts game and relationship level-up payloads", () => {
  const game = normalizeGlobalAppFeedEvent({
    eventId: "game_win_1",
    kind: "game_win",
    startsAtMs: 10000,
    endsAtMs: 16000,
    uid: "u1",
    displayName: "Winner",
    profileImageUrl: "winner.webp",
    payoutCoins: 88000,
    assetKey: "celebrations.game_win.default",
  }, 12000);
  assert.equal(game.kind, "game_win");
  assert.equal(game.payoutCoins, 88000);

  const relation = normalizeGlobalAppFeedEvent({
    eventId: "rel_level_1",
    kind: "relationship_level_up",
    startsAtMs: 10000,
    endsAtMs: 16000,
    uid: "u1",
    displayName: "A",
    secondaryUid: "u2",
    secondaryDisplayName: "B",
    relationshipType: "cp",
    relationshipLevel: 4,
    assetKey: "relationships.cp.level_up",
  }, 12000);
  assert.equal(relation.kind, "relationship_level_up");
  assert.equal(relation.relationshipType, "cp");
  assert.equal(relation.relationshipLevel, 4);
  assert.equal(relation.secondaryUid, "u2");
});
