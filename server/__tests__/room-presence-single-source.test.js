import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function source(path) {
  return readFileSync(new URL(path, import.meta.url), "utf8");
}

test("room participant surfaces reuse the existing realtime session", () => {
  const object = source("../../cloudflare-worker/src/room-realtime-object.js");
  const session = source(
    "../../lib/features/voice/services/voice_room_session_controller.dart",
  );
  const main = source("../../lib/main.dart");

  assert.equal(
    object.includes("const ROOM_PRESENCE_CLIENT_SNAPSHOT_LIMIT = 200;"),
    true,
  );
  assert.equal(
    object.includes(
      "participants: participants.slice(\n          0,\n          ROOM_PRESENCE_CLIENT_SNAPSHOT_LIMIT",
    ),
    true,
  );
  assert.equal(session.includes("List<RoomPresenceUser> get roomParticipants"), true);
  assert.equal(session.includes("event.type == 'server.ready'"), true);
  assert.equal(session.includes("event.type == 'room.presence_left'"), true);
  assert.equal(session.includes("_upsertRoomParticipant(event.payload)"), true);
  assert.equal(main.includes("_voiceSession.roomParticipants"), true);
  assert.equal(main.includes("_roomPresence.load(roomId)"), false);
  assert.equal(main.includes("RoomPresenceService _roomPresence"), false);
});
