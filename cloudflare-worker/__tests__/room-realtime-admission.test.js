import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { scryptSync } from "node:crypto";
import {
  authorizeRoomRealtimeTicket,
  verifyRealtimeRoomPassword,
} from "../src/room-realtime-admission.js";

const NOW = Date.now();
const password = "room-pass-123";
const salt = "1234567890abcdef1234567890abcdef";
const locked = {
  ownerUid: "host",
  visibility: "password",
  passwordLockVersion: 6,
  passwordSalt: salt,
  passwordHash: scryptSync(password, salt, 64).toString("hex"),
};
const invite = () => ({
  roomId: "roomA",
  userId: "guest",
  invitedBy: "host",
  inviteId: "invite-123",
  passwordProtectedAtIssue: true,
  passwordLockVersion: 6,
  createdAt: new Date(NOW - 60000),
  expiresAt: new Date(NOW + 60000),
});
const check = (options = {}) =>
  authorizeRoomRealtimeTicket({
    room: locked,
    roomId: "roomA",
    uid: "guest",
    user: {},
    roomPassword: "",
    nowMs: NOW,
    loadInvite: async () => ({ exists: false }),
    ...options,
  });

test("a public room needs neither a password nor an invite read", async () => {
  let calls = 0;
  assert.deepEqual(await check({
    room: { visibility: "public" },
    loadInvite: async () => { calls++; throw Error("should not run"); },
  }), { allowed: true });
  assert.equal(calls, 0);
});

test("owner bypasses their room password; stranger cannot", async () => {
  assert.deepEqual(await check({ uid: "host" }), { allowed: true });
  assert.deepEqual(await check(), { allowed: false, code: "room_password_required" });
  assert.deepEqual(await check({ roomPassword: "wrong-password" }),
    { allowed: false, code: "room_password_invalid" });
});

test("correct password passes exact scrypt verifier without a database invite read", async () => {
  assert.equal(verifyRealtimeRoomPassword(locked, password), true);
  assert.equal(verifyRealtimeRoomPassword(locked, password.toUpperCase()), false);
  assert.equal(verifyRealtimeRoomPassword(locked, {}), false);
  let calls = 0;
  assert.deepEqual(await check({
    roomPassword: password,
    loadInvite: async () => { calls++; throw Error("unnecessary read"); },
  }), { allowed: true });
  assert.equal(calls, 0);
});

test("recipient-bound valid invite admits without room password", async () => {
  let calls = 0;
  const result = await check({
    loadInvite: async () => { calls++; return { exists: true, data: invite() }; },
  });
  assert.deepEqual(result, { allowed: true });
  assert.equal(calls, 1);
});

test("revoked, expired, other-user or rotated-password invites fail closed", async () => {
  assert.equal((await check({
    loadInvite: async () => ({ exists: false, data: invite() }),
  })).allowed, false);
  for (const invalid of [
    { ...invite(), expiresAt: new Date(NOW - 1) },
    { ...invite(), userId: "other" },
    { ...invite(), passwordLockVersion: 5 },
    { ...invite(), passwordProtectedAtIssue: false },
  ]) {
    assert.deepEqual(await check({
      loadInvite: async () => ({ exists: true, data: invalid }),
    }), { allowed: false, code: "room_password_required" });
  }
  assert.deepEqual(await check({
    room: { ...locked, passwordLockVersion: 7 },
    loadInvite: async () => ({ exists: true, data: invite() }),
  }), { allowed: false, code: "room_password_required" });
});

test("hidden rooms allow room owner and active privileged admins, but not ID guesses", async () => {
  const room = { ...locked, visibility: "hidden", passwordHash: "" };
  assert.deepEqual(await check({ room, uid: "host" }), { allowed: true });
  assert.deepEqual(await check({ room, roomPassword: password }),
    { allowed: false, code: "room_private" });
  assert.deepEqual(await check({ room, user: { role: "owner", ownerAbsoluteRoomAccess: true } }),
    { allowed: true });
  assert.deepEqual(await check({ room, user: { role: "owner", ownerAbsoluteRoomAccess: false } }),
    { allowed: false, code: "room_private" });
  assert.deepEqual(await check({ room, user: { adminEnabled: true, capabilities: ["manageRooms"] } }),
    { allowed: true });
});

test("the request and client join/reconnect paths keep admission authoritative", () => {
  const realtime = readFileSync(new URL("../src/room-realtime.js", import.meta.url), "utf8");
  const presence = readFileSync(new URL("../../lib/features/room/services/room_presence_service.dart", import.meta.url), "utf8");
  const session = readFileSync(new URL("../../lib/features/voice/services/voice_room_session_controller.dart", import.meta.url), "utf8");
  assert.match(realtime, /authorizeRoomRealtimeTicket\(/);
  assert.match(realtime, /roomPassword: body\.roomPassword/);
  assert.match(realtime, /db\.get\(`room_invites\/\$\{roomId\}\/users\/\$\{uid\}\`\)/);
  assert.match(presence, /if \(_roomPassword\.isNotEmpty\) 'roomPassword': _roomPassword/);
  assert.match(presence, /_roomPassword = '';/);
  assert.match(session, /roomPassword: \(_roomArguments\['roomPassword'\] \?\? ''\)\.toString\(\)/);
});
