import assert from "node:assert/strict";
import { after, test } from "node:test";
import { deleteApp, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

import {
  roomInsights,
} from "../../cloudflare-worker/src/voice-session-legacy.js";

const app = initializeApp(
  { projectId: "shadow-live-vip-hide-lists-test" },
  "vip-hide-lists-" + Date.now(),
);
const db = getFirestore(app);

after(async () => {
  await deleteApp(app);
});

const future = () => new Date(Date.now() + 24 * 60 * 60 * 1000);
const expired = () => new Date(Date.now() - 1000);

async function seedRoom(roomId) {
  const day = new Date().toISOString().slice(0, 10);
  await db.collection("rooms").doc(roomId).set({
    ownerUid: "hide_lists_owner",
    isActive: true,
    level: 1,
    levelPoints: 0,
    levelTarget: 1000,
    followerCount: 0,
    onlineCount: 0,
    participantsCount: 0,
  });

  const supportUsers = db
    .collection("rooms")
    .doc(roomId)
    .collection("support_daily")
    .doc(day)
    .collection("users");

  await Promise.all([
    supportUsers.doc("hide_lists_hidden").set({
      displayName: "Hidden",
      supportCoins: 9000,
      giftCount: 9,
    }),
    supportUsers.doc("hide_lists_visible").set({
      displayName: "Visible",
      supportCoins: 7000,
      giftCount: 7,
    }),
    supportUsers.doc("hide_lists_expired").set({
      displayName: "Expired",
      supportCoins: 5000,
      giftCount: 5,
    }),
    supportUsers.doc("hide_lists_missing").set({
      displayName: "Missing User",
      supportCoins: 4000,
      giftCount: 4,
    }),
  ]);
}

async function seedUsers() {
  await Promise.all([
    db.collection("users").doc("hide_lists_viewer").set({
      role: "user",
      adminEnabled: false,
      effectiveVipLevel: 0,
    }),
    db.collection("users").doc("hide_lists_owner").set({
      role: "owner",
      adminEnabled: true,
      effectiveVipLevel: 0,
    }),
    db.collection("users").doc("hide_lists_hidden").set({
      role: "user",
      effectiveVipLevel: 7,
      vipExpiresAt: future(),
      hideRankingLists: true,
      publicId: "710001",
    }),
    db.collection("users").doc("hide_lists_visible").set({
      role: "user",
      effectiveVipLevel: 6,
      vipExpiresAt: future(),
      hideRankingLists: false,
      publicId: "610001",
    }),
    db.collection("users").doc("hide_lists_expired").set({
      role: "user",
      effectiveVipLevel: 7,
      vipExpiresAt: expired(),
      hideRankingLists: true,
      publicId: "710002",
    }),
  ]);
}

test("VIP7 Hide Lists removes public supporters but preserves Owner visibility", async () => {
  const roomId = "hide_lists_room_" + Date.now();
  await Promise.all([seedRoom(roomId), seedUsers()]);

  const publicTop3 = await roomInsights(db, "hide_lists_viewer", {
    roomId,
    includeSupporters: false,
  });
  assert.equal(
    publicTop3.supporters.some((item) => item.uid === "hide_lists_hidden"),
    false,
  );
  assert.equal(
    publicTop3.supporters.some((item) => item.uid === "hide_lists_missing"),
    false,
  );
  assert.deepEqual(
    publicTop3.supporters.map((item) => item.rank),
    publicTop3.supporters.map((_, index) => index + 1),
  );

  const publicFull = await roomInsights(db, "hide_lists_viewer", {
    roomId,
    includeSupporters: true,
  });
  assert.deepEqual(
    publicFull.supporters.map((item) => item.uid),
    ["hide_lists_visible", "hide_lists_expired"],
  );
  assert.deepEqual(
    publicFull.supporters.map((item) => item.rank),
    [1, 2],
  );

  const ownerFull = await roomInsights(db, "hide_lists_owner", {
    roomId,
    includeSupporters: true,
  });
  assert.deepEqual(
    ownerFull.supporters.map((item) => item.uid),
    [
      "hide_lists_hidden",
      "hide_lists_visible",
      "hide_lists_expired",
      "hide_lists_missing",
    ],
  );
  assert.deepEqual(
    ownerFull.supporters.map((item) => item.rank),
    [1, 2, 3, 4],
  );
});
