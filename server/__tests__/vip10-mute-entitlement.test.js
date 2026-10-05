import assert from "node:assert/strict";
import { test } from "node:test";
import { vipEntitlementsForLevel } from "../../cloudflare-worker/src/vip-entitlements.js";

test("VIP10 includes mute protection and VIP9 does not", () => {
  assert.equal(vipEntitlementsForLevel(9).muteProtection, false);
  assert.equal(vipEntitlementsForLevel(10).muteProtection, true);
});
