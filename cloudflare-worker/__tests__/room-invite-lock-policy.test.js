import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  roomPasswordLockVersion,
  nextRoomPasswordLockVersion,
  roomInviteAllowsPasswordAccess,
} from "../src/room-invite-lock-policy.js";

const NOW = 1793448000000;
const LOCKED = { visibility: "password", passwordLockVersion: 8 };
const grant = () => ({
  roomId: "room-a",
  userId: "recipient-a",
  invitedBy: "host-a",
  inviteId: "msg-verified-a",
  passwordProtectedAtIssue: true,
  passwordLockVersion: 8,
  createdAt: new Date(NOW - 60000),
  expiresAt: new Date(NOW + 60000),
});
const valid = (room, invite, overrides = {}) =>
  roomInviteAllowsPasswordAccess({
    room, invite, roomId: "room-a",
    recipientUid: "recipient-a", nowMs: NOW,
    ...overrides,
  });

test("invited intended recipient enters unchanged password-locked room", () => {
  assert.equal(valid(LOCKED, grant()), true);
  assert.equal(roomPasswordLockVersion(LOCKED), 8);
});
test("old pre-lock invitation is never silently admitted", () => {
  const preLock = { ...grant(), passwordProtectedAtIssue: false };
  assert.equal(valid(LOCKED, preLock), false);
  const beforeLock = { ...grant(), passwordLockVersion: 7 };
  assert.equal(valid(LOCKED, beforeLock), false);
  assert.equal(nextRoomPasswordLockVersion(
    { visibility: "public", passwordLockVersion: 7 }, "password", "1234"), 8);
});
test("a password reset revokes previous invites without impacting unchanged settings", () => {
  assert.equal(nextRoomPasswordLockVersion(LOCKED, "password", ""), 8);
  assert.equal(nextRoomPasswordLockVersion(LOCKED, "password", "abcd"), 9);
  assert.equal(valid({ ...LOCKED, passwordLockVersion: 9 }, grant()), false);
});
test("another recipient/room or missing server-issued identifiers always fail", () => {
  assert.equal(valid(LOCKED, grant(), { recipientUid: "other" }), false);
  assert.equal(valid(LOCKED, grant(), { roomId: "other" }), false);
  assert.equal(valid(LOCKED, { ...grant(), userId: "other" }), false);
  assert.equal(valid(LOCKED, { ...grant(), roomId: "other" }), false);
  assert.equal(valid(LOCKED, { ...grant(), inviteId: "" }), false);
  assert.equal(valid(LOCKED, { ...grant(), invitedBy: "" }), false);
  assert.equal(valid(LOCKED, { ...grant(), passwordLockVersion: "8" }), false);
  assert.equal(valid(LOCKED, { ...grant(), passwordLockVersion: undefined }), false);
});
test("legacy, revoked, expired and future invitations fail closed", () => {
  assert.equal(valid(LOCKED, { createdAt: new Date(), expiresAt: new Date(NOW + 1000) }), false);
  assert.equal(valid(LOCKED, null), false);
  assert.equal(valid(LOCKED, { ...grant(), expiresAt: new Date(NOW) }), false);
  assert.equal(valid(LOCKED, { ...grant(), createdAt: new Date(NOW + 1000) }), false);
  assert.equal(valid(LOCKED, {
    ...grant(), expiresAt: new Date(NOW + 13 * 60 * 60 * 1000),
  }), false);
  assert.equal(valid({ visibility: "public", passwordLockVersion: 8 }, grant()), false);
});
test("Firebase Timestamp data and old locks accept only newly minted scoped grants", () => {
  const stamp = ms => ({ toMillis: () => ms });
  const legacyRoom = { visibility: "password" };
  const newer = {
    ...grant(), passwordLockVersion: 0,
    createdAt: stamp(NOW - 1000), expiresAt: stamp(NOW + 1000),
  };
  assert.equal(roomPasswordLockVersion(legacyRoom), 0);
  assert.equal(valid(legacyRoom, newer), true);
  assert.equal(valid(legacyRoom, { ...newer, passwordProtectedAtIssue: false }), false);
});
test("issuer, room lock rotation and voice token gate use the same policy", () => {
  const issuer = readFileSync(
    new URL("../src/chat-safety-actions.js", import.meta.url), "utf8");
  const token = readFileSync(
    new URL("../src/voice-session-legacy.js", import.meta.url), "utf8");
  assert.match(issuer, /const passwordProtectedAtIssue = clean\(roomData\.visibility\) === "password"/);
  assert.match(issuer, /const passwordLockVersion = roomPasswordLockVersion\(roomData\)/);
  assert.match(issuer, /inviteId: messageId/);
  assert.match(token, /passwordLockVersion:nextRoomPasswordLockVersion\(room,visibility,password\)/);
  assert.match(token, /inviteSnap\.exists&&roomInviteAllowsPasswordAccess\(/);
  assert.doesNotMatch(token, /inviteSnap\.exists&&inviteExpiry>Date\.now\(\)/);
});
