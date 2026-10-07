import assert from "node:assert/strict";
import { after, test } from "node:test";
import { deleteApp, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

import { sendMessage } from "../../cloudflare-worker/src/chat-safety-actions.js";
import { setFriendsOnlyMessages } from "../../cloudflare-worker/src/vip-actions.js";
import { cloudflareFirestoreAdapter } from "./helpers/cloudflare-firestore-adapter.js";

const app = initializeApp(
  { projectId: "shadow-live-vip-friends-only-test" },
  "vip-friends-only-" + Date.now(),
);
const db = getFirestore(app);
const cloudflareDb = cloudflareFirestoreAdapter(db);

after(async () => {
  await deleteApp(app);
});

const futureFrom = (nowMs) => new Date(nowMs + 24 * 60 * 60 * 1000);

async function seedUser(uid, level, nowMs, extra = {}) {
  await db.collection("users").doc(uid).set({
    role: "user",
    adminEnabled: false,
    effectiveVipLevel: level,
    adminGrantVipLevel: level,
    adminGrantExpiresAt: level > 0 ? futureFrom(nowMs) : null,
    vipExpiresAt: level > 0 ? futureFrom(nowMs) : null,
    ...extra,
  });
}

async function seedConversation(a, b, id) {
  await Promise.all([
    db.collection("conversations").doc(id).set({
      participants: [a, b].sort(),
      unreadCounts: {},
    }),
    db.collection("system_config").doc("messaging").set({
      messageRateWindowSeconds: 10,
      messageRateMax: 8,
    }),
  ]);
}

test("VIP1 friends-only messages requires mutual follow without extra receiver lookup", async () => {
  const suffix = Date.now().toString();
  const sender = "friends_sender_" + suffix;
  const receiver = "friends_receiver_" + suffix;
  const conversationId = "friends_chat_" + suffix;
  const nowMs = Date.now();

  await Promise.all([
    seedUser(sender, 0, nowMs),
    seedUser(receiver, 1, nowMs),
    seedConversation(sender, receiver, conversationId),
    db.collection("follows").doc(sender + "__" + receiver).set({
      followerUid: sender,
      followingUid: receiver,
    }),
  ]);

  const enabled = await setFriendsOnlyMessages(
    cloudflareDb,
    receiver,
    { enabled: true },
    nowMs,
  );
  assert.equal(enabled.friendsOnlyMessages, true);
  assert.equal(enabled.requiredVipLevel, 1);

  await assert.rejects(
    sendMessage(cloudflareDb, sender, {
      receiverId: receiver,
      conversationId,
      text: "hello",
      idempotencyKey: "friends_only_block_" + suffix,
    }),
    /friends_only_messages/,
  );

  await db.collection("follows").doc(receiver + "__" + sender).set({
    followerUid: receiver,
    followingUid: sender,
  });

  const allowed = await sendMessage(cloudflareDb, sender, {
    receiverId: receiver,
    conversationId,
    text: "hello mutual",
    idempotencyKey: "friends_only_allow_" + suffix,
  });
  assert.equal(allowed.ok, true);
  assert.equal(allowed.mutual, true);
});

test("friends-only preference cannot be enabled without active VIP1", async () => {
  const uid = "friends_locked_" + Date.now();
  const nowMs = Date.now();
  await seedUser(uid, 0, nowMs);

  await assert.rejects(
    setFriendsOnlyMessages(cloudflareDb, uid, { enabled: true }, nowMs),
    /friends_only_messages_requires_vip1/,
  );

  const off = await setFriendsOnlyMessages(
    cloudflareDb,
    uid,
    { enabled: false },
    nowMs,
  );
  assert.equal(off.friendsOnlyMessages, false);
});


test("animated emoji in DM uses shared catalog and persists one asset identity", async () => {
  const suffix = Date.now().toString() + "_emoji";
  const sender = "emoji_sender_" + suffix;
  const receiver = "emoji_receiver_" + suffix;
  const conversationId = "emoji_chat_" + suffix;
  const nowMs = Date.now();

  await Promise.all([
    seedUser(sender, 4, nowMs),
    seedUser(receiver, 0, nowMs),
    seedConversation(sender, receiver, conversationId),
    db.collection("follows").doc(sender + "__" + receiver).set({
      followerUid: sender,
      followingUid: receiver,
    }),
    db.collection("follows").doc(receiver + "__" + sender).set({
      followerUid: receiver,
      followingUid: sender,
    }),
  ]);

  const result = await sendMessage(cloudflareDb, sender, {
    receiverId: receiver,
    conversationId,
    text: "🌟",
    animatedEmojiId: "vip_star",
    idempotencyKey: "dm_emoji_send_" + suffix,
  });
  assert.equal(result.ok, true);
  assert.equal(result.animatedEmojiId, "vip_star");

  const message = await db.collection("conversations")
    .doc(conversationId)
    .collection("messages")
    .doc(result.messageId)
    .get();
  assert.equal(message.exists, true);
  assert.equal(message.data().type, "animated_emoji");
  assert.equal(message.data().animatedEmojiId, "vip_star");
  assert.equal(
    message.data().animatedEmojiAssetKey,
    "emoji.vip_star.animation",
  );
  assert.equal(message.data().animatedEmojiFallbackGlyph, "🌟");
  assert.equal(message.data().vipLevel, 4);
});

test("animated emoji in DM is rejected server-side below its VIP requirement", async () => {
  const suffix = Date.now().toString() + "_emoji_guard";
  const sender = "emoji_guard_sender_" + suffix;
  const receiver = "emoji_guard_receiver_" + suffix;
  const conversationId = "emoji_guard_chat_" + suffix;
  const nowMs = Date.now();

  await Promise.all([
    seedUser(sender, 3, nowMs),
    seedUser(receiver, 0, nowMs),
    seedConversation(sender, receiver, conversationId),
    db.collection("follows").doc(sender + "__" + receiver).set({
      followerUid: sender,
      followingUid: receiver,
    }),
    db.collection("follows").doc(receiver + "__" + sender).set({
      followerUid: receiver,
      followingUid: sender,
    }),
  ]);

  await assert.rejects(
    sendMessage(cloudflareDb, sender, {
      receiverId: receiver,
      conversationId,
      text: "🌟",
      animatedEmojiId: "vip_star",
      idempotencyKey: "dm_emoji_guard_" + suffix,
    }),
    /vip4_emoji_required/,
  );

  const messages = await db.collection("conversations")
    .doc(conversationId)
    .collection("messages")
    .get();
  assert.equal(messages.size, 0);
});
