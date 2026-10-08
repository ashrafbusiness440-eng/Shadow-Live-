import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile } from "node:fs/promises";

test("room gift chat masks sender and recipient identities while mysterious", async () => {
  const source = await readFile(
    new URL("../../cloudflare-worker/src/room-gift.js", import.meta.url),
    "utf8",
  );

  assert.equal(
    source.includes("const senderMysteriousMode = activeMysteriousIdentity(sender, nowMs)"),
    true,
  );
  assert.equal(source.includes('const roomSenderName = senderMysteriousMode'), true);
  assert.equal(
    source.includes("const receiverMysteriousMode =\n        activeMysteriousIdentity(receiver, nowMs)"),
    true,
  );
  assert.equal(source.includes("? first.roomReceiverName"), true);
  assert.equal(source.includes("displayName: roomSenderName"), true);
  assert.equal(source.includes("profileImageUrl: roomSenderPhoto"), true);
  assert.equal(source.includes("mysteriousMode: senderMysteriousMode"), true);
  assert.equal(source.includes("vipLevel: roomSenderVipLevel"), true);
  assert.equal(source.includes('roomSenderName +\n            " أرسل "'), true);
});

test("room rocket keeps real uid internal but masks visual contributor identity", async () => {
  const source = await readFile(
    new URL("../../cloudflare-worker/src/room-gift.js", import.meta.url),
    "utf8",
  );

  assert.equal(source.includes("uid: senderUid"), true);
  assert.equal(source.includes("displayName: roomSenderName"), true);
  assert.equal(source.includes("profileImageUrl: roomSenderPhoto"), true);
  assert.equal(
    source.includes("lastContributorMysteriousMode: senderMysteriousMode"),
    true,
  );
});

test("global premium event keeps normal identity outside room scope", async () => {
  const source = await readFile(
    new URL("../../cloudflare-worker/src/room-gift.js", import.meta.url),
    "utf8",
  );
  const start = source.indexOf("const premiumEvent = premiumGiftCelebrationEvent");
  const end = source.indexOf("return {", start);
  const block = source.slice(start, end);
  assert.equal(block.includes("displayName: senderName"), true);
  assert.equal(block.includes("profileImageUrl: senderPhoto"), true);
});
