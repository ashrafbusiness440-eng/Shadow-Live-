import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile } from "node:fs/promises";

import {
  userLevelSupportAggregateWrites,
  userLevelSupportInternals,
} from "../../cloudflare-worker/src/user-level-support.js";

function fakeDb() {
  return {
    increment(fieldPath, amount) {
      return { fieldPath, amount };
    },
    writeUpdate(path, fields, mask, transforms) {
      return { path, fields, mask, transforms };
    },
  };
}

test("support aggregates split paid wealth from nominal attraction", () => {
  const writes = userLevelSupportAggregateWrites(fakeDb(), {
    senderUid: "sender_1",
    receiverUid: "receiver_1",
    sender: { displayName: "Sender" },
    receiver: { displayName: "Receiver" },
    wealthPoints: 0,
    attractionPoints: 1000,
    giftCount: 2,
  });
  assert.equal(writes.length, 1);
  assert.equal(writes[0].path, "user_level_support/receiver_1/attraction/sender_1");
  assert.equal(writes[0].transforms[0].fieldPath, "points");
  assert.equal(writes[0].transforms[0].amount, 1000);
});

test("support pagination stays bounded to 20 per page and 100 total", () => {
  assert.equal(userLevelSupportInternals.MAX_PAGE_SIZE, 20);
  assert.equal(userLevelSupportInternals.MAX_RESULTS, 100);
});

test("gift paths update pair aggregates inside the existing gift transaction", async () => {
  const room = await readFile(
    new URL("../../cloudflare-worker/src/room-gift.js", import.meta.url),
    "utf8",
  );
  const direct = await readFile(
    new URL("../../cloudflare-worker/src/chat-safety-actions.js", import.meta.url),
    "utf8",
  );
  assert.equal(room.includes("userLevelSupportAggregateWrites(db, {"), true);
  assert.equal(direct.includes("userLevelSupportAggregateWrites(db, {"), true);
  assert.equal(room.includes("wealthPoints: paidRecipientCost"), true);
  assert.equal(
    direct.includes("attractionPoints: levelPointAwards.attractionPoints"),
    true,
  );
});

test("user-level support endpoint applies mysterious identity server-side", async () => {
  const support = await readFile(
    new URL("../../cloudflare-worker/src/user-level-support.js", import.meta.url),
    "utf8",
  );
  assert.equal(support.includes("applyMysteriousIdentityPresentation("), true);
  assert.equal(support.includes("Promise.all("), true);
  assert.equal(support.includes("MAX_PAGE_SIZE = 20"), true);
  assert.equal(support.includes("MAX_RESULTS = 100"), true);
});
