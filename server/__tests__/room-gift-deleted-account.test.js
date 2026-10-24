import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { assertRoomGiftAccountLive } from "../../cloudflare-worker/src/room-gift.js";

test("room gift rejects both deleted recipients and deleted senders", () => {
  for (const state of [
    { accountStatus: "deleted" },
    { accountStatus: "deletion_completed" },
    { accountStatus: "deletion_processing" },
    { authDeleted: true },
    { deletionProcessing: true },
  ]) {
    assert.throws(() => assertRoomGiftAccountLive(state, "recipient"),
      e => e.code === "recipient_account_deleted" && e.status === 409);
    assert.throws(() => assertRoomGiftAccountLive(state, "sender"),
      e => e.code === "sender_account_deleted" && e.status === 409);
  }
});

test("unexpired self-service cancellation window is not implicitly blocked", () => {
  for (const state of [{ accountStatus: "active" }, { accountStatus: "pending" },
    { accountStatus: "review_ready" }, {}]) {
    assert.doesNotThrow(() => assertRoomGiftAccountLive(state));
  }
});

test("room gift rejects every recipient before touching currency or gifting writes", () => {
  const source = readFileSync("cloudflare-worker/src/room-gift.js", "utf8");
  const senderGuard = source.indexOf('assertRoomGiftAccountLive(senderSnap.data, "sender")');
  const recipientGuard = source.indexOf('assertRoomGiftAccountLive(item.receiverSnap.data, "recipient")');
  const firstLedger = source.indexOf('"financial_ledger/gift_"');
  assert.ok(senderGuard > 0);
  assert.ok(recipientGuard > senderGuard);
  assert.ok(firstLedger > recipientGuard);
  assert.match(source, /for \(const item of recipientRecords\)/);
  assert.match(source, /if \(opSnap\.exists\)/);
  // Existing successful idempotency receipts stay re-readable, but no new
  // operation may silently debit a sender or credit a deleted recipient.
});
