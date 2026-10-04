import assert from "node:assert/strict";
import { after, test } from "node:test";
import { deleteApp, getApps, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

import { kickRoomUser } from "../../cloudflare-worker/src/voice-session-legacy.js";

const app =
  getApps()[0] || initializeApp({ projectId: "shadow-live-vip-kick-test" });
const db = getFirestore(app);

after(async () => {
  await deleteApp(app);
});

const future = () => new Date(Date.now() + 24 * 60 * 60 * 1000);

async function seedRoom(roomId, ownerUid) {
  await db.collection("rooms").doc(roomId).set({
    ownerUid,
    hostId: ownerUid,
    roomType: "personal",
    isActive: true,
    level: 1,
    seats: [],
    micRequests: [],
    micInvites: [],
  });
}

async function seedUser(uid, data = {}) {
  await db.collection("users").doc(uid).set({
    role: "user",
    adminEnabled: false,
    effectiveVipLevel: 0,
    vipExpiresAt: null,
    ...data,
  });
}

test("ordinary room owner cannot kick active VIP6+ target", async () => {
  const roomId = "vip6_kick_room_owner";
  const actor = "vip6_room_owner";
  const target = "vip6_protected_target";

  await Promise.all([
    seedRoom(roomId, actor),
    seedUser(actor),
    seedUser(target, {
      effectiveVipLevel: 6,
      vipExpiresAt: future(),
    }),
  ]);

  await assert.rejects(
    kickRoomUser(db, actor, {
      roomId,
      targetUid: target,
      duration: "5",
    }),
    /vip_kick_protected/,
  );

  const ban = await db
    .collection("room_bans")
    .doc(roomId)
    .collection("users")
    .doc(target)
    .get();
  assert.equal(ban.exists, false);
});

test("VIP5 target is not protected from normal room kick", async () => {
  const roomId = "vip5_kick_room";
  const actor = "vip5_room_owner";
  const target = "vip5_target";

  await Promise.all([
    seedRoom(roomId, actor),
    seedUser(actor),
    seedUser(target, {
      effectiveVipLevel: 5,
      vipExpiresAt: future(),
    }),
  ]);

  const result = await kickRoomUser(db, actor, {
    roomId,
    targetUid: target,
    duration: "5",
  });
  assert.equal(result.ok, true);

  const ban = await db
    .collection("room_bans")
    .doc(roomId)
    .collection("users")
    .doc(target)
    .get();
  assert.equal(ban.exists, true);
});

test("App Owner can override VIP6 kick protection and audit the bypass", async () => {
  const roomId = "vip6_owner_override_room";
  const roomOwner = "vip6_other_room_owner";
  const actor = "vip6_app_owner";
  const target = "vip6_owner_override_target";

  await Promise.all([
    seedRoom(roomId, roomOwner),
    seedUser(roomOwner),
    seedUser(actor, {
      role: "owner",
      adminEnabled: true,
      ownerAbsoluteRoomAccess: true,
    }),
    seedUser(target, {
      effectiveVipLevel: 7,
      vipExpiresAt: future(),
    }),
  ]);

  const result = await kickRoomUser(db, actor, {
    roomId,
    targetUid: target,
    duration: "15",
  });
  assert.equal(result.ok, true);

  const audit = await db
    .collection("room_audit_logs")
    .doc(roomId)
    .collection("items")
    .where("targetUid", "==", target)
    .limit(1)
    .get();
  assert.equal(audit.empty, false);
  assert.equal(audit.docs[0].data().after.vipKickProtection, true);
  assert.equal(audit.docs[0].data().after.vipProtectionOverride, true);
});

test("delegated Safety with room authority can override VIP6 protection", async () => {
  const roomId = "vip6_safety_override_room";
  const roomOwner = "vip6_safety_room_owner";
  const actor = "vip6_safety_actor";
  const target = "vip6_safety_target";

  await Promise.all([
    seedRoom(roomId, roomOwner),
    seedUser(roomOwner),
    seedUser(actor, {
      role: "admin",
      adminEnabled: true,
      capabilities: ["manageRooms", "reviewReports"],
    }),
    seedUser(target, {
      effectiveVipLevel: 10,
      vipExpiresAt: future(),
    }),
  ]);

  const result = await kickRoomUser(db, actor, {
    roomId,
    targetUid: target,
    duration: "1",
  });
  assert.equal(result.ok, true);
});
