import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  createRoomChatRestrictionGate,
  roomChatRestricted,
} from "../../cloudflare-worker/src/room-chat-restriction.js";

test("room chat restriction respects expiry and Firestore timestamp formats", () => {
  const now = Date.parse("2026-10-14T10:00:00Z");
  assert.equal(roomChatRestricted({}, now), false);
  assert.equal(roomChatRestricted({
    roomChatRestrictedUntil: new Date(now + 60_000),
  }, now), true);
  assert.equal(roomChatRestricted({
    roomChatRestrictedUntil: { seconds: Math.floor((now + 60_000) / 1000) },
  }, now), true);
  assert.equal(roomChatRestricted({
    roomChatRestrictedUntil: new Date(now - 60_000),
  }, now), false);
  assert.equal(roomChatRestricted({
    roomChatRestrictedUntil: { toDate: () => new Date(now + 60_000) },
  }, now), true);
});

test("live socket restriction reads are coalesced, bounded and expire lazily", async () => {
  let now = 1_800_000_000_000;
  let reads = 0;
  const users = {
    a: { roomChatRestrictedUntil: new Date(now + 60_000) },
    b: {},
    c: {},
  };
  const check = createRoomChatRestrictionGate(async (uid) => {
    reads++;
    await Promise.resolve();
    return users[uid] ?? null;
  }, { ttlMs: 5_000, maxEntries: 2, now: () => now });
  assert.deepEqual(await Promise.all([check("a"), check("a"), check("a")]),
    [true, true, true]);
  assert.equal(reads, 1);
  assert.equal(await check("a"), true);
  assert.equal(reads, 1);
  await check("b");
  await check("c"); // bounded eviction removes least-recently-updated a
  assert.equal(reads, 3);
  assert.equal(await check("a"), true);
  assert.equal(reads, 4);
  now += 6000;
  users.a.roomChatRestrictedUntil = new Date(now - 1000);
  assert.equal(await check("a"), false);
  assert.equal(reads, 5);
  await assert.rejects(check("unknown"), /room_chat_user_unavailable/);
  await assert.rejects(check(""), /room_chat_sender_missing/);
});

test("room chat restriction fails closed when the user source is unavailable", async () => {
  let tries = 0;
  const check = createRoomChatRestrictionGate(async () => {
    tries++;
    throw new Error("Firestore unavailable");
  });
  await assert.rejects(check("uid1"), /Firestore unavailable/);
  await assert.rejects(check("uid1"), /Firestore unavailable/);
  assert.equal(tries, 2);
});

test("both realtime and legacy room chat enforce the same server restriction", () => {
  const socket = readFileSync("cloudflare-worker/src/room-realtime-object.js", "utf8");
  const legacy = readFileSync("cloudflare-worker/src/voice-session-legacy.js", "utf8");
  const control = readFileSync("lib/admin/general_reports_control_page.dart", "utf8");
  const panel = readFileSync("lib/features/room/widgets/room_chat_panel.dart", "utf8");
  assert.match(socket, /this\.isRoomChatRestricted\(uid\)/);
  assert.match(socket, /"room_chat_moderation_unavailable"/);
  assert.match(legacy, /roomChatRestricted\(actorUser\)/);
  assert.match(control, /'restrictRoomChat'/);
  assert.match(panel, /'room_chat_restricted'/);
});
