import assert from "node:assert/strict";
import test from "node:test";

import { normalizeGlobalAppFeedEvent } from "../../cloudflare-worker/src/global-app-feed.js";
import { vipUpgradeBroadcastEvent } from "../../cloudflare-worker/src/vip-upgrade-broadcast.js";

test("VIP upgrade banner starts only on natural VIP5+ upgrade", () => {
  const nowMs = Date.UTC(2026, 9, 6, 12, 0, 0);
  const user = {
    displayName: "VIP User",
    profileImageUrl: "https://example.invalid/u.webp",
    publicId: "12345678",
  };

  assert.equal(
    vipUpgradeBroadcastEvent(
      "uid",
      user,
      { earnedVipLevel: 3 },
      { earnedVipLevel: 4 },
      "op_1",
      nowMs,
    ),
    null,
  );
  assert.equal(
    vipUpgradeBroadcastEvent(
      "uid",
      user,
      { earnedVipLevel: 5 },
      { earnedVipLevel: 5 },
      "op_2",
      nowMs,
    ),
    null,
  );

  const event = vipUpgradeBroadcastEvent(
    "uid",
    user,
    { earnedVipLevel: 4 },
    { earnedVipLevel: 6 },
    "op_3",
    nowMs,
  );
  assert.equal(event.kind, "vip_level_upgrade");
  assert.equal(event.vipLevel, 6);
  assert.equal(event.assetKey, "vip.v6.globalEntryBanner");
  assert.equal(event.eventId, "vip_upgrade_uid_op_3");
  assert.equal(event.startsAtMs, nowMs);
  assert.equal(event.endsAtMs, nowMs + 12_000);

  const normalized = normalizeGlobalAppFeedEvent(event, nowMs);
  assert.equal(normalized.kind, "vip_level_upgrade");
  assert.equal(normalized.vipLevel, 6);
});

test("global feed rejects unknown event kinds", () => {
  const nowMs = Date.UTC(2026, 9, 6, 12, 0, 0);
  assert.equal(
    normalizeGlobalAppFeedEvent({
      eventId: "bad",
      kind: "unknown",
      startsAtMs: nowMs,
      endsAtMs: nowMs + 12_000,
    }, nowMs),
    null,
  );
});
