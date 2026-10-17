import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import {
  privateTextPayloadFingerprint, privateTextOperationConflicts,
} from "../src/chat-safety-actions.js";

const alice = {
  senderId: "alice", receiverId: "bob", conversationId: "dm_alice_bob",
};
const receipt = (fingerprint) => ({
  ...alice, payloadFingerprint: fingerprint,
  action: "sendMessage", status: "completed",
});

test("private text operation fingerprint binds exact text AND emoji", async () => {
  const base = await privateTextPayloadFingerprint("hello", "");
  assert.equal(base.length, 64);
  assert.equal(base, await privateTextPayloadFingerprint("hello", ""));
  assert.notEqual(base, await privateTextPayloadFingerprint("HELLO", ""));
  assert.notEqual(base, await privateTextPayloadFingerprint("hello", "vip_emoji"));
  assert.equal(privateTextOperationConflicts(receipt(base), {
    ...alice, payloadFingerprint: base,
  }), false);
  assert.equal(privateTextOperationConflicts(receipt(base), {
    ...alice, payloadFingerprint: await privateTextPayloadFingerprint("bye", ""),
  }), true);
});

test("replayed key can never impersonate another sender or conversation", async () => {
  const fingerprint = await privateTextPayloadFingerprint("hi", "");
  for (const expected of [
    {...alice, senderId: "mallory", payloadFingerprint: fingerprint},
    {...alice, receiverId: "eve", payloadFingerprint: fingerprint},
    {...alice, conversationId: "dm_different", payloadFingerprint: fingerprint},
  ]) {
    assert.equal(privateTextOperationConflicts(receipt(fingerprint), expected), true);
  }
  for (const tampered of [
    {...receipt(fingerprint), action: "sendGift"},
    {...receipt(fingerprint), status: "pending"},
  ]) {
    assert.equal(privateTextOperationConflicts(tampered, {
      ...alice, payloadFingerprint: fingerprint,
    }), true);
  }
  assert.equal(privateTextOperationConflicts({
    ...alice, action:"sendMessage", status:"completed",
    // Legacy receipt lacks fingerprint but cannot cross user/conversation.
  }, {...alice, payloadFingerprint:fingerprint}), false);
});

test("sendMessage validates replay before returning a receipt", () => {
  const source = readFileSync("cloudflare-worker/src/chat-safety-actions.js", "utf8");
  const send = source.split("export async function sendMessage")[1].split("export async function")[0];
  const conflict = send.indexOf("privateTextOperationConflicts(op.data");
  const duplicate = send.indexOf('code: "duplicate"');
  assert.ok(conflict >= 0 && duplicate > conflict);
  assert.ok(send.includes('throw new ApiError("message_operation_conflict", 409)'));
  assert.ok(send.includes("payloadFingerprint,"));
  assert.ok(send.includes("db.writeCreate(opPath"));
});
