import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  ROCKET_FEED_SHARD_COUNT,
  normalizeRocketFeedEvent,
  rocketFeedRoomIdForUid,
  rocketFeedRoomIds,
  rocketFeedShardForUid,
} from "../../cloudflare-worker/src/room-rocket-feed.js";

test("rocket feed uses stable bounded sharding", () => {
  assert.equal(ROCKET_FEED_SHARD_COUNT, 16);
  const shard = rocketFeedShardForUid("user-123");
  assert.ok(shard >= 0 && shard < ROCKET_FEED_SHARD_COUNT);
  assert.equal(shard, rocketFeedShardForUid("user-123"));
  assert.equal(rocketFeedRoomIdForUid("user-123"), `global-rocket-feed-v1-${shard}`);

  const ids = rocketFeedRoomIds();
  assert.equal(ids.length, ROCKET_FEED_SHARD_COUNT);
  assert.equal(new Set(ids).size, ROCKET_FEED_SHARD_COUNT);
});

test("rocket feed payload keeps only banner and claim metadata", () => {
  const event = normalizeRocketFeedEvent(
    {
      explosionId: "exp-1",
      roomId: "room-1",
      level: 3,
      startsAtMs: 1000,
      endsAtMs: 11000,
      triggerUid: "u1",
      triggerDisplayName: "Sender",
      triggerProfileImageUrl: "https://example.test/u.webp",
      contributorIds: ["u1", "u2"],
      top3: [{ uid: "u1", coins: 1000 }, { uid: "u2", coins: 500 }],
      rewardPool: { secret: "not-for-feed" },
      contributors: [{ uid: "u1", coins: 1000 }],
    },
    5000,
  );

  assert.deepEqual(event, {
    explosionId: "exp-1",
    roomId: "room-1",
    level: 3,
    startsAtMs: 1000,
    endsAtMs: 11000,
    triggerUid: "u1",
    triggerDisplayName: "Sender",
    triggerProfileImageUrl: "https://example.test/u.webp",
    contributorIds: ["u1", "u2"],
    top3: [{ uid: "u1" }, { uid: "u2" }],
  });
  assert.equal("rewardPool" in event, false);
  assert.equal("contributors" in event, false);
});

test("expired rocket feed payloads are rejected", () => {
  const event = normalizeRocketFeedEvent(
    {
      explosionId: "expired",
      roomId: "room-1",
      startsAtMs: 1000,
      endsAtMs: 2000,
    },
    2000 + 120001,
  );
  assert.equal(event, null);
});

test("active Flutter code has no global rocket explosions Firestore listener", () => {
  const service = readFileSync(
    new URL("../../lib/features/room/services/room_rocket_service.dart", import.meta.url),
    "utf8",
  );
  const banner = readFileSync(
    new URL("../../lib/features/room/widgets/room_rocket_banner_host.dart", import.meta.url),
    "utf8",
  );

  assert.equal(service.includes("collection('room_rocket_explosions')"), false);
  assert.equal(service.includes("'action': 'rocketFeedTicket'"), true);
  assert.equal(service.includes("room.rocket_explosion"), true);
  assert.equal(banner.includes("_maxNetworkAttempts = 4"), true);
  assert.equal(banner.includes("_enterRetryAtMs"), true);
  assert.equal(banner.includes("_claimRetryAtMs"), true);
});
