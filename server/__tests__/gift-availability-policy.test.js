import { test } from "node:test";
import assert from "node:assert/strict";
import { GIFT_CONTEXTS, validateGiftAvailability, giftAvailableFor } from "../../cloudflare-worker/src/gift-availability-policy.js";

test("legacy gifts are usable in every context with no schedule", () => {
  assert.deepEqual(validateGiftAvailability({}).allowedContexts, GIFT_CONTEXTS);
  for (const context of GIFT_CONTEXTS) {
    assert.equal(giftAvailableFor({ enabled: true }, context, 1000), true);
  }
});

test("visibility contexts are exact; a chat-only gift cannot be sent in room or diary", () => {
  const gift = { allowedContexts: ["chat"], enabled: true };
  assert.equal(giftAvailableFor(gift, "chat", 1000), true);
  assert.equal(giftAvailableFor(gift, "room", 1000), false);
  assert.equal(giftAvailableFor(gift, "diary", 1000), false);
  assert.equal(giftAvailableFor(gift, "profile", 1000), false);
});

test("start inclusive and end exclusive, using server clock", () => {
  const gift = { visibleFromMs: 1000, visibleUntilMs: 2000, enabled: true };
  assert.equal(giftAvailableFor(gift, "room", 999), false);
  assert.equal(giftAvailableFor(gift, "room", 1000), true);
  assert.equal(giftAvailableFor(gift, "room", 1999), true);
  assert.equal(giftAvailableFor(gift, "room", 2000), false);
});
test("invalid schedule and invalid context fail closed", () => {
  for (const item of [
    { allowedContexts: [] }, { allowedContexts: ["room", "room"] },
    { allowedContexts: ["room", "admin"] },
    { visibleFromMs: -1 }, { visibleFromMs: 1.5 },
    { visibleFromMs: 3000, visibleUntilMs: 2000 },
  ]) {
    assert.throws(() => validateGiftAvailability(item));
    assert.equal(giftAvailableFor(item, "room", 1000), false);
  }
  assert.equal(giftAvailableFor({ enabled: false }, "chat", 1000), false);
});

test("policy is enforced by room, chat and diary sending on authoritative server clock", async () => {
  const { readFileSync } = await import("node:fs");
  const root = new URL("../../cloudflare-worker/src/", import.meta.url);
  const room = readFileSync(new URL("room-gift.js", root), "utf8");
  const direct = readFileSync(new URL("chat-safety-actions.js", root), "utf8");
  const catalog = readFileSync(new URL("legacy-economy/gift-catalog.js", root), "utf8");
  assert.match(room, /giftAvailableFor\(gift, "room", nowMs\)/);
  assert.match(direct, /giftAvailableFor\(giftData, contextType, now\.getTime\(\)\)/);
  assert.match(catalog, /giftAvailableFor\(item\)/);
  assert.match(catalog, /validateGiftAvailability\(item\)/);
});
