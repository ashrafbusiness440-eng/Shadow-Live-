import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const voice = readFileSync(
  new URL("../../cloudflare-worker/src/voice-session-legacy.js", import.meta.url),
  "utf8",
);
const realtime = readFileSync(
  new URL("../../cloudflare-worker/src/room-realtime.js", import.meta.url),
  "utf8",
);

test("Owner absolute room access defaults ON for backward compatibility", () => {
  assert.match(voice, /ownerAbsoluteRoomAccess=appOwner&&data\.ownerAbsoluteRoomAccess!==false/);
});

test("Owner absolute room access gates global room authority", () => {
  assert.match(voice, /manageRooms:ownerAbsoluteRoomAccess\|\|/);
  assert.match(voice, /manageIds:ownerAbsoluteRoomAccess\|\|/);
  assert.match(realtime, /role === "owner" && user\.ownerAbsoluteRoomAccess !== false/);
});

test("bootstrap exposes one authoritative management state", () => {
  assert.match(voice, /platformOwner:global\.appOwner/);
  assert.match(voice, /ownerAbsoluteRoomAccess:global\.ownerAbsoluteRoomAccess/);
  assert.match(voice, /globalRoomManage:global\.manageRooms/);
  assert.match(voice, /myCapabilities:\(actualOwner\|\|global\.manageRooms\)/);
});

test("Shadow Control mutation is Owner-only, idempotent and audited", () => {
  assert.match(voice, /controlAction==="ownerAbsoluteRoomAccessState"/);
  assert.match(voice, /controlAction==="setOwnerAbsoluteRoomAccess"/);
  assert.match(voice, /action:"setOwnerAbsoluteRoomAccess"/);
  assert.match(voice, /targetType:"owner_room_access"/);
  assert.match(voice, /owner_required/);
});

test("cross-room absolute actions carry an audit source", () => {
  assert.match(voice, /absoluteRoomAccessAudit/);
  assert.match(voice, /authoritySource:"ownerAbsoluteRoomAccess"/);
  assert.match(voice, /ownerAbsoluteRoomAccess:"\+action/);
});
