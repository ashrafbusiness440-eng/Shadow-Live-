import assert from "node:assert/strict";
import { after, test } from "node:test";
import { deleteApp, getApps, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

import {
  roomGhostState,
  roomPresenceState,
  setRoomGhostMode,
} from "../../cloudflare-worker/src/voice-session-legacy.js";

const app =
  getApps()[0] || initializeApp({ projectId: "shadow-live-vip-ghost-test" });
const db = getFirestore(app);

after(async () => {
  await deleteApp(app);
});

function futureDate(days = 1) {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000);
}

test("VIP4 cannot enable Ghost while VIP5 can, and anyone can disable it", async () => {
  const vip4 = "ghost_vip4";
  const vip5 = "ghost_vip5";

  await Promise.all([
    db.collection("users").doc(vip4).set({
      role: "user",
      effectiveVipLevel: 4,
      vipExpiresAt: futureDate(),
      roomGhostMode: false,
    }),
    db.collection("users").doc(vip5).set({
      role: "user",
      effectiveVipLevel: 5,
      vipExpiresAt: futureDate(),
      roomGhostMode: false,
    }),
  ]);

  await assert.rejects(
    setRoomGhostMode(db, vip4, { enabled: true }),
    /ghost_mode_requires_vip5/,
  );

  const enabled = await setRoomGhostMode(db, vip5, { enabled: true });
  assert.equal(enabled.ghostMode, true);

  const vip5Doc = await db.collection("users").doc(vip5).get();
  assert.equal(vip5Doc.data().roomGhostMode, true);

  const disabled = await setRoomGhostMode(db, vip4, { enabled: false });
  assert.equal(disabled.ghostMode, false);
});

test("expired VIP cannot keep Ghost active and legacy privacy flag is ignored", async () => {
  const uid = "ghost_expired";
  await db.collection("users").doc(uid).set({
    role: "user",
    effectiveVipLevel: 10,
    vipExpiresAt: new Date(Date.now() - 1000),
    roomGhostMode: true,
    privacy: { ghostMode: true },
  });

  const state = await roomGhostState(db, uid);
  assert.equal(state.ghostMode, false);
  assert.equal(state.canUseGhostMode, false);
});

test("Owner and delegated Safety can inspect hidden presence, public users cannot", async () => {
  const roomId = "ghost_presence_room";
  const publicUid = "ghost_public_viewer";
  const ownerUid = "ghost_owner_viewer";
  const safetyUid = "ghost_safety_viewer";
  const now = Date.now();

  await Promise.all([
    db.collection("rooms").doc(roomId).set({
      ownerUid,
      isActive: true,
      onlineCount: 0,
      participantsCount: 0,
    }),
    db.collection("users").doc(publicUid).set({
      role: "user",
      adminEnabled: false,
    }),
    db.collection("users").doc(ownerUid).set({
      role: "owner",
      adminEnabled: true,
    }),
    db.collection("users").doc(safetyUid).set({
      role: "admin",
      adminEnabled: true,
      capabilities: ["reviewReports"],
    }),
    db.collection("room_presence").doc(roomId).collection("users").doc("visible_user").set({
      displayName: "Visible",
      lastSeenAtMs: now,
      joinedAtMs: now - 2000,
      ghostMode: false,
    }),
    db.collection("room_presence").doc(roomId).collection("users").doc("ghost_user").set({
      displayName: "Ghost",
      lastSeenAtMs: now,
      joinedAtMs: now - 1000,
      ghostMode: true,
      vipExpiresAtMs: now + 60_000,
    }),
  ]);

  const publicState = await roomPresenceState(db, publicUid, roomId);
  assert.equal(publicState.hiddenPresenceVisible, false);
  assert.deepEqual(
    publicState.participants.map((item) => item.uid),
    ["visible_user"],
  );
  assert.equal(publicState.onlineCount, 1);

  const ownerState = await roomPresenceState(db, ownerUid, roomId);
  assert.equal(ownerState.hiddenPresenceVisible, true);
  assert.deepEqual(
    ownerState.participants.map((item) => item.uid),
    ["visible_user", "ghost_user"],
  );
  assert.equal(ownerState.onlineCount, 2);

  const safetyState = await roomPresenceState(db, safetyUid, roomId);
  assert.equal(safetyState.hiddenPresenceVisible, true);
  assert.deepEqual(
    safetyState.participants.map((item) => item.uid),
    ["visible_user", "ghost_user"],
  );

  const room = await db.collection("rooms").doc(roomId).get();
  assert.equal(room.data().onlineCount, 1);
  assert.equal(room.data().participantsCount, 1);
});
