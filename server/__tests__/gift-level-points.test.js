import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function source(relative) {
  return readFileSync(new URL("../../" + relative, import.meta.url), "utf8");
}

for (const [label, relative] of [
  ["room", "cloudflare-worker/src/room-gift.js"],
  ["chat", "cloudflare-worker/src/chat-safety-actions.js"],
]) {
  test(label + " paid gifts credit level points inside existing user writes", () => {
    const code = source(relative);

    assert.equal(
      code.includes('db.increment("wealthPoints", totalCost)'),
      true,
    );
    assert.equal(
      code.includes('db.increment("attractionPoints", totalCost)'),
      true,
    );
    assert.equal(code.includes('giftFundingSource: "coins"'), true);
    assert.equal(code.includes("wealthPointsAdded: totalCost"), true);
    assert.equal(code.includes("attractionPointsAdded: totalCost"), true);
  });

  test(label + " gift hot path does not read level thresholds", () => {
    const code = source(relative);

    assert.equal(code.includes("user-level-policy"), false);
    assert.equal(code.includes("system_config/user_levels"), false);
    assert.equal(code.includes("wealthPoints"), true);
    assert.equal(code.includes("attractionPoints"), true);
  });
}

test("paid gift points reuse existing gift-operation idempotency", () => {
  const room = source("cloudflare-worker/src/room-gift.js");
  const chat = source("cloudflare-worker/src/chat-safety-actions.js");

  for (const code of [room, chat]) {
    const duplicateCheck = code.indexOf("if (opSnap.exists)");
    const roomSenderWrite = code.indexOf('db.increment("wealthPoints", totalCost)');
    const chatDuplicateCheck = code.indexOf("if (op.exists)");
    const senderWrite = roomSenderWrite >= 0
      ? roomSenderWrite
      : code.indexOf('db.increment("wealthPoints", totalCost)');

    const idempotencyGuard = duplicateCheck >= 0 ? duplicateCheck : chatDuplicateCheck;
    assert.ok(idempotencyGuard >= 0);
    assert.ok(senderWrite > idempotencyGuard);
  }
});

test("level point fields are protected from client writes", () => {
  const rules = source("firestore.rules");
  const security = source("server/__tests__/firestore-security.integration.test.js");

  assert.equal(rules.includes("'wealthPoints'"), true);
  assert.equal(rules.includes("'attractionPoints'"), true);
  assert.equal(rules.includes("!('wealthPoints' in request.resource.data)"), true);
  assert.equal(rules.includes("!('attractionPoints' in request.resource.data)"), true);
  assert.equal(security.includes("{wealthPoints:5000}"), true);
  assert.equal(security.includes("{attractionPoints:5000}"), true);
});
