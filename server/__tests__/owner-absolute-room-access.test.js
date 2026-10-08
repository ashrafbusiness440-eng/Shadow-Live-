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
  assert.match(
    voice,
    /ownerAbsoluteRoomAccess=appOwner&&data\.ownerAbsoluteRoomAccess!==false/,
  );
});

test("Owner absolute room access gates global room authority", () => {
  assert.match(voice, /manageRooms:ownerAbsoluteRoomAccess\|\|/);
  assert.match(voice, /manageIds:ownerAbsoluteRoomAccess\|\|/);
  assert.match(
    realtime,
    /role === "owner" && user\.ownerAbsoluteRoomAccess !== false/,
  );
});

test("bootstrap exposes one authoritative management state", () => {
  assert.match(voice, /platformOwner:global\.appOwner/);
  assert.match(
    voice,
    /ownerAbsoluteRoomAccess:global\.ownerAbsoluteRoomAccess/,
  );
  assert.match(
    voice,
    /globalRoomManage:authoritySuppressed\?false:global\.manageRooms/,
  );
  assert.match(voice, /authoritySuppressed/);
  assert.match(
    voice,
    /myCapabilities:authoritySuppressed[\s\S]*\? \[\][\s\S]*\(actualOwner\|\|global\.manageRooms\)/,
  );
});

test("Shadow Control mutation is Owner-only idempotent and audited", () => {
  assert.match(voice, /controlAction==="ownerAbsoluteRoomAccessState"/);
  assert.match(voice, /controlAction==="setOwnerAbsoluteRoomAccess"/);
  assert.match(voice, /action:"setOwnerAbsoluteRoomAccess"/);
  assert.match(voice, /targetType:"owner_room_access"/);
  assert.match(voice, /owner_required/);
});

test("cross-room absolute actions carry an audit source", () => {
  assert.match(voice, /absoluteRoomAccessAudit/);
  assert.match(voice, /authoritySource:"ownerAbsoluteRoomAccess"/);
  assert.match(voice, /action:"ownerAbsoluteRoomAccess:"\+action/);
});


test("room mic locks are authoritative: empty lock blocks join, persistent mute blocks unmute", () => {
  const normalizeStart = voice.indexOf("function normalizeSeats(room)");
  const normalizeEnd = voice.indexOf("function roomControlPolicySnapshot(", normalizeStart);
  const normalized = voice.slice(normalizeStart, normalizeEnd);
  assert.equal(normalized.includes("locked:found.locked===true"), true);
  assert.equal(normalized.includes("muteLocked:found.muteLocked===true"), true);

  const actionStart = voice.indexOf("export async function roomSeatAction(");
  const actionEnd = voice.indexOf("async function sendRoomChat(", actionStart);
  assert.ok(actionStart >= 0 && actionEnd > actionStart);
  const action = voice.slice(actionStart, actionEnd);
  assert.equal(action.includes('action==="lockSeat"||action==="unlockSeat"'), true);
  assert.equal(action.includes('action==="muteLockSeat"||action==="unmuteLockSeat"'), true);
  assert.equal(action.includes('if(!canManageMic)throw new ApiError("forbidden",403);'), true);
  assert.equal(action.includes('if(seat.locked)throw new ApiError("seat_locked",403);'), true);
  assert.equal(action.includes('if(currentSeat.muteLocked)throw new ApiError("seat_mute_locked",403);'), true);
  assert.equal(action.includes('if(targetSeat.muteLocked)throw new ApiError("seat_mute_locked",403);'), true);
  assert.equal(action.includes("muted:seat.muteLocked===true||!keepMicActive"), true);
  assert.equal(action.includes("await recordMicActivity(tx,db,selected.uid,selected)"), true);
  assert.equal(action.includes('if(muteProtected&&!canOverrideVipRoomProtection(actor))'), true);
  assert.equal(action.includes('"lockSeat","unlockSeat","muteLockSeat","unmuteLockSeat"'), true);
});
