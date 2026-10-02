import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function source(path) {
  return readFileSync(new URL(path, import.meta.url), "utf8");
}

test("room chat uses the existing realtime socket and session-scoped memory", () => {
  const socketBase = source(
    "../../lib/features/room/services/room_presence_socket_base.dart",
  );
  const presence = source(
    "../../lib/features/room/services/room_presence_service.dart",
  );
  const session = source(
    "../../lib/features/voice/services/voice_room_session_controller.dart",
  );
  const chatService = source(
    "../../lib/features/room/services/room_chat_service.dart",
  );
  const chatPanel = source(
    "../../lib/features/room/widgets/room_chat_panel.dart",
  );

  assert.equal(socketBase.includes("void send(String message);"), true);
  assert.equal(presence.includes("'client.room_chat'"), true);
  assert.equal(presence.includes("room.chat_ack"), true);

  assert.equal(session.includes("_roomChatMessages"), true);
  assert.equal(session.includes("event.type == 'room.chat_message'"), true);
  assert.equal(session.includes("event.type == 'room.presence_joined'"), true);
  assert.equal(session.includes("_roomChatMessages.clear();"), true);

  assert.equal(chatService.includes("FirebaseFirestore"), false);
  assert.equal(chatService.includes("watchMessages"), false);
  assert.equal(
    chatService.includes("VoiceRoomSessionController.instance"),
    true,
  );
  assert.equal(chatPanel.includes("AnimatedBuilder("), true);
  assert.equal(chatPanel.includes("watchMessages"), false);
});

test("Durable Object owns ephemeral chat fanout, policy and rate limiting", () => {
  const realtime = source("../../cloudflare-worker/src/room-realtime.js");
  const object = source(
    "../../cloudflare-worker/src/room-realtime-object.js",
  );
  const voice = source(
    "../../cloudflare-worker/src/voice-session-legacy.js",
  );
  const gift = source("../../cloudflare-worker/src/room-gift.js");

  assert.equal(realtime.includes("setRoomRealtimeChatPolicy"), true);
  assert.equal(realtime.includes("canModerateRoomChat"), true);
  assert.equal(realtime.includes("room_bans/"), true);

  assert.equal(object.includes('message.type !== "client.room_chat"'), true);
  assert.equal(object.includes('"room.chat_message"'), true);
  assert.equal(object.includes('"room.chat_ack"'), true);
  assert.equal(object.includes('"rate_limited"'), true);
  assert.equal(object.includes('url.pathname === "/chat/policy"'), true);

  const announceStart = voice.indexOf(
    "async function roomPresenceAnnounceJoin(",
  );
  const sessionLeaveStart = voice.indexOf(
    "async function roomSessionLeave",
    announceStart,
  );
  const announce = voice.slice(announceStart, sessionLeaveStart);
  assert.equal(announce.includes('collection("messages")'), false);

  const legacyJoinStart = voice.indexOf(
    "async function roomPresenceJoin(",
  );
  const heartbeatStart = voice.indexOf(
    "async function roomPresenceHeartbeat",
    legacyJoinStart,
  );
  const legacyJoin = voice.slice(legacyJoinStart, heartbeatStart);
  assert.equal(legacyJoin.includes('collection("messages")'), false);

  assert.equal(gift.includes("messagePath"), false);
  assert.equal(gift.includes("publishRoomRealtimeEvent"), true);
  assert.equal(gift.includes('_chatEvent'), true);
});
