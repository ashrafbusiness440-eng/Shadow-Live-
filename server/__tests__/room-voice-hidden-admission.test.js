import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { authorizeRoomRealtimeTicket } from "../../cloudflare-worker/src/room-realtime-admission.js";

const room = { roomType: "official", ownerUid: "", ownerId: "", hostId: "host-1",
  isHidden: true, visibility: "hidden" };
const check = async (uid, user = {}) => authorizeRoomRealtimeTicket({
  room, roomId: "official-1", uid, user,
  loadInvite: async () => { throw Error("hidden_must_not_load_invite"); },
});

test("hidden room may issue audio credential to its room host", async () => {
  assert.deepEqual(await check("host-1"), { allowed: true });
});

test("hidden room rejects arbitrary authenticated users including password guessers", async () => {
  const result = await check("stranger", { role: "user" });
  assert.deepEqual(result, { allowed: false, code: "room_private" });
});

test("authorized administration permits hidden rooms under the same realtime policy", async () => {
  assert.deepEqual(await check("admin", {
    adminEnabled: true, capabilities: ["manageRooms"],
  }), { allowed: true });
  assert.deepEqual(await check("unprivileged", {
    adminEnabled: false, capabilities: ["manageRooms"],
  }), { allowed: false, code: "room_private" });
});

test("voice-token handler applies hidden policy before attempting voice token generation", () => {
  const legacy = readFileSync(
    new URL("../../cloudflare-worker/src/voice-session-legacy.js", import.meta.url), "utf8");
  const handler = legacy.slice(legacy.indexOf('if(action!=="token")'),
    legacy.indexOf('const generated=generateToken04('));
  assert.match(handler, /if\(roomData\.isHidden===true\|\|clean\(roomData\.visibility\)==="hidden"\)/);
  assert.match(handler, /authorizeRoomRealtimeTicket\(/);
  assert.match(handler, /user:entryUserSnap\.data\(\)\|\|\{\}/);
  assert.match(handler, /if\(!admission\.allowed\)throw new ApiError\(admission\.code,403\)/);
  assert.match(handler, /if\(roomOwnerUid!==decoded\.uid\)/);
  assert.match(handler, /roomInviteAllowsPasswordAccess\(/);
  assert.doesNotMatch(handler, /getSecret|modifyZego|createAccount|billing/);
  const hiddenPosition = handler.indexOf('if(roomData.isHidden===true');
  const tokenPosition = legacy.indexOf('const generated=generateToken04(');
  assert.ok(hiddenPosition >= 0 && tokenPosition > legacy.indexOf('if(action!=="token")'));
});
