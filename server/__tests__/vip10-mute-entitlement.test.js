import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { vipEntitlementsForLevel } from "../../cloudflare-worker/src/vip-entitlements.js";

test("VIP10 includes mute protection and VIP9 does not", () => {
  assert.equal(vipEntitlementsForLevel(9).muteProtection, false);
  assert.equal(vipEntitlementsForLevel(10).muteProtection, true);
});

test("room moderator mute path enforces VIP10 protection server-side", () => {
  const source = readFileSync(
    "cloudflare-worker/src/voice-session-legacy.js",
    "utf8",
  );
  assert.match(source, /vipEntitlementsFromUser\([\s\S]*?\)\.muteProtection/);
  assert.match(source, /vip_mute_protected/);
  assert.match(source, /canOverrideVipRoomProtection\(actor\)/);
  assert.match(source, /vipMuteProtectionOverride/);
});
