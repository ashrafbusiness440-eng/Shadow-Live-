import test from "node:test";
import assert from "node:assert/strict";
import {
  PRIVATE_MESSAGE_DELETE_WINDOW_MS,
  mayDeletePrivateMessageForEveryone,
  changePrivateMessageVisibility,
} from "../../cloudflare-worker/src/chat-safety-actions.js";

function fakeDb({
  senderId = "alice",
  receiverId = "bob",
  participants = ["alice", "bob"],
  sentAt = new Date(Date.now() - 1000),
  messageType = "text",
  latestId = "msg123",
  deletedForEveryone = false,
  hiddenForUids = [],
} = {}) {
  const entries = {
    "conversations/conv123": {
      exists: true, data: { participants, lastMessage: "hello", lastSenderId: senderId },
    },
    "conversations/conv123/messages/msg123": {
      exists: true,
      data: {
        senderId, receiverId, createdAt: sentAt, type: messageType,
        text: "hello", storageObjectId: "f".repeat(32), giftId: "gift_1",
        deletedForEveryone, hiddenForUids,
      },
    },
  };
  const calls = { reads: [], queries: [], commits: [], rollback: 0 };
  return {
    calls,
    async beginTransaction() { return "tx1"; },
    async get(path, transaction) {
      calls.reads.push([path, transaction]);
      return entries[path] ?? { exists: false, data: null };
    },
    async runQuery(path, args) {
      calls.queries.push({ path, args });
      return [{ id: latestId }];
    },
    writeUpdate(path, data, mask) { return { op: "update", path, data, mask }; },
    writeCreate(path, data) { return { op: "create", path, data }; },
    async commit(tx, writes) { calls.commits.push({ tx, writes }); },
    async rollback() { calls.rollback++; },
  };
}

test("sender window is five minutes from trusted message timestamp", () => {
  const now = 1_900_000_000_000;
  assert.equal(PRIVATE_MESSAGE_DELETE_WINDOW_MS, 300000);
  assert.equal(mayDeletePrivateMessageForEveryone({
    senderId: "alice", createdAt: new Date(now - 300000),
  }, "alice", now), true);
  assert.equal(mayDeletePrivateMessageForEveryone({
    senderId: "alice", createdAt: new Date(now - 300001),
  }, "alice", now), false);
  assert.equal(mayDeletePrivateMessageForEveryone({
    senderId: "alice", createdAt: new Date(now + 1000),
  }, "alice", now), false);
  assert.equal(mayDeletePrivateMessageForEveryone({
    senderId: "alice", createdAt: new Date(now),
  }, "bob", now), false);
});

test("recipient may hide a message from their view without deleting it globally", async () => {
  const db = fakeDb();
  const value = await changePrivateMessageVisibility(db, "bob", {
    action: "hideMessageForMe", conversationId: "conv123", messageId: "msg123",
  });
  assert.equal(value.ok, true);
  assert.equal(db.calls.queries.length, 0);
  assert.equal(db.calls.commits.length, 1);
  const changes = db.calls.commits[0].writes;
  assert.equal(changes.length, 1);
  assert.deepEqual(changes[0].data.hiddenForUids, ["bob"]);
  assert.deepEqual(changes[0].mask, ["hiddenForUids"]);
});

test("sender deletes recent message with tombstone and removes sensitive fields", async () => {
  const db = fakeDb({ messageType: "image" });
  const result = await changePrivateMessageVisibility(db, "alice", {
    action: "deleteMessageForEveryone",
    conversationId: "conv123", messageId: "msg123",
  });
  assert.equal(result.code, "ok");
  assert.equal(db.calls.queries.length, 1);
  assert.equal(db.calls.queries[0].args.limit, 1);
  const writes = db.calls.commits[0].writes;
  const tombstone = writes[0];
  assert.equal(tombstone.path, "conversations/conv123/messages/msg123");
  assert.equal(tombstone.data.type, "deleted");
  assert.equal(tombstone.data.deletedForEveryone, true);
  assert.equal(tombstone.data.senderId, "alice");
  assert.equal(tombstone.data.storageObjectId, undefined);
  assert.equal(tombstone.data.text, undefined);
  assert.ok(tombstone.mask.includes("storageObjectId"));
  assert.ok(tombstone.mask.includes("text"));
  assert.equal(writes[1].data.lastMessage, "تم حذف رسالة");
  assert.equal(writes[2].path.startsWith("message_deletion_audit/"), true);
  assert.equal(writes.some((v) => v.path.includes("gift_transactions")), false);
});

test("old message cannot be deleted for both, including direct API requests", async () => {
  const db = fakeDb({ sentAt: new Date(Date.now() - 400000) });
  await assert.rejects(
    changePrivateMessageVisibility(db, "alice", {
      action: "deleteMessageForEveryone", conversationId: "conv123",
      messageId: "msg123",
    }),
    { code: "delete_window_expired", status: 403 },
  );
  assert.equal(db.calls.commits.length, 0);
});

test("receiver cannot delete for both even within the five-minute window", async () => {
  const db = fakeDb();
  await assert.rejects(
    changePrivateMessageVisibility(db, "bob", {
      action: "deleteMessageForEveryone",
      conversationId: "conv123", messageId: "msg123",
    }),
    { code: "forbidden", status: 403 },
  );
  assert.equal(db.calls.commits.length, 0);
});

test("a stranger cannot hide or delete messages and IDs cannot escape the path", async () => {
  const db = fakeDb();
  await assert.rejects(
    changePrivateMessageVisibility(db, "mallory", {
      action: "hideMessageForMe", conversationId: "conv123", messageId: "msg123",
    }),
    { code: "forbidden", status: 403 },
  );
  await assert.rejects(
    changePrivateMessageVisibility(db, "alice", {
      action: "hideMessageForMe", conversationId: "conv123/../bad", messageId: "msg123",
    }),
    { code: "invalid_request", status: 400 },
  );
  assert.equal(db.calls.commits.length, 0);
});

test("deleting an older message never overwrites newer conversation preview", async () => {
  const db = fakeDb({ latestId: "newest" });
  await changePrivateMessageVisibility(db, "alice", {
    action: "deleteMessageForEveryone",
    conversationId: "conv123", messageId: "msg123",
  });
  const writes = db.calls.commits[0].writes;
  assert.equal(writes.some((write) => write.path === "conversations/conv123"), false);
});
