import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import { test } from "node:test";

test("both approved VIP Growth sources wire VIP10 maintenance trial-card awards", () => {
  const vipActions = readFileSync(
    "cloudflare-worker/src/vip-actions.js",
    "utf8",
  );
  const play = readFileSync(
    "cloudflare-worker/src/google-play-purchase.js",
    "utf8",
  );

  assert.match(vipActions, /vip10MaintenanceTrialCardWrites\(/);
  assert.match(vipActions, /trialCardsAwarded:\s*trialAward\.count/);
  assert.match(vipActions, /\.\.\.trialAward\.writes/);

  assert.match(play, /vip10MaintenanceTrialCardWrites\(/);
  assert.match(play, /trialCardsAwarded:\s*trialAward\.count/);
  assert.match(play, /\.\.\.trialAward\.writes/);
});
