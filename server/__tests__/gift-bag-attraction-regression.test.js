import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile } from "node:fs/promises";

test("gift bag keeps wealth at paid value and attraction at nominal value", async () => {
  const room = await readFile(
    new URL("../../cloudflare-worker/src/room-gift.js", import.meta.url),
    "utf8",
  );
  const direct = await readFile(
    new URL("../../cloudflare-worker/src/chat-safety-actions.js", import.meta.url),
    "utf8",
  );

  assert.equal(
    room.includes("nominalCoins: recipientCost,\n        paidCoins: paidRecipientCost"),
    true,
  );
  assert.equal(
    direct.includes("nominalCoins: totalCost,\n      paidCoins: paidCost"),
    true,
  );
  assert.equal(
    room.includes("nominalCoins: paidRecipientCost,\n        paidCoins: paidRecipientCost"),
    false,
  );
  assert.equal(
    direct.includes("nominalCoins: paidCost,\n      paidCoins: paidCost"),
    false,
  );
});
