import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { assertPrivateChatAccountLive } from "../../cloudflare-worker/src/chat-safety-actions.js";

test("chat recipient and sender checks reject erased, processing and auth-deleted users", () => {
  for (const data of [
    { accountStatus: "deleted" },
    { accountStatus: "deletion_completed" },
    { accountStatus: "deletion_processing" },
    { authDeleted: true },
    { deletionProcessing: true },
  ]) {
    assert.throws(() => assertPrivateChatAccountLive(data, "recipient"),
      e => e.code === "recipient_account_deleted" && e.status === 409);
    assert.throws(() => assertPrivateChatAccountLive(data, "sender"),
      e => e.code === "sender_account_deleted" && e.status === 409);
  }
  for (const data of [{ accountStatus: "active" }, { accountStatus: "pending" },
    { accountStatus: "review_ready" }, {}]) {
    assert.doesNotThrow(() => assertPrivateChatAccountLive(data, "recipient"));
  }
});

test("server guards text and gifts before new financial or message writes", () => {
  const source = readFileSync("cloudflare-worker/src/chat-safety-actions.js", "utf8");
  const calls = source.match(/assertPrivateChatAccountLive\(sender\.data, "sender"\);/g) || [];
  assert.equal(calls.length, 2);
  const receiver = source.match(/assertPrivateChatAccountLive\(receiver\.data, "recipient"\);/g) || [];
  assert.equal(receiver.length, 2);
});

test("chat list and detail screens never expose deleted profiles or enable composer", () => {
  const model = readFileSync("lib/features/profile/services/profile_visual_identity_service.dart", "utf8");
  const list = readFileSync("lib/features/chat/screens/chat_list_screen.dart", "utf8");
  const detail = readFileSync("lib/features/chat/screens/private_chat_screen.dart", "utf8");
  assert.match(model, /publicRecordMissing: missing \|\| deleted/);
  assert.match(model, /ProfileVisualIdentity\.empty\(uid, missing: true\)/);
  assert.match(model, /if \(publicRecordMissing\) 'accountDeleted': true/);
  assert.match(list, /final accountDeleted = user\['accountDeleted'\] == true/);
  assert.match(list, /final name = accountDeleted \? 'حساب محذوف'/);
  assert.match(list, /if \(!accountDeleted\) ListTile/);
  assert.match(detail, /_peerDeleted = true;/);
  assert.match(detail, /if \(_peerDeleted \|\| !_peerProfileLoaded\) return;/);
  assert.match(detail, /Widget _composer\(\) => !_peerProfileLoaded \|\| _peerDeleted/);
  assert.match(detail, /_peerProfileLoaded && !_peerDeleted/);
  assert.match(detail, /'حساب محذوف'/);
  assert.match(detail, /_peerProfileLoaded && _peerDeleted/);
  assert.match(detail, /'text', 'voice_note', 'image'/);
  assert.match(list, /'محادثة مع حساب محذوف'/);
  assert.doesNotMatch(detail, /Timer\.periodic/);
});
