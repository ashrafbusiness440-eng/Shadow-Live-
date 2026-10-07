import assert from "node:assert/strict";
import test from "node:test";

import {
  realtimeRoomParticipantsFromNamespace,
} from "../../cloudflare-worker/src/room-presence-authority.js";

test("bounded room presence helper requests one authoritative roster", async () => {
  const calls = [];
  const namespace = {
    idFromName(roomId) {
      return roomId;
    },
    get() {
      return {
        async fetch(url) {
          calls.push(url);
          return Response.json({
            ok: true,
            onlineCount: 30,
            truncated: true,
            participants: Array.from({ length: 24 }, (_, index) => ({
              uid: "u" + index,
            })),
          });
        },
      };
    },
  };

  const result = await realtimeRoomParticipantsFromNamespace(
    namespace,
    "room_one",
    24,
  );
  assert.equal(calls.length, 1);
  assert.equal(new URL(calls[0]).pathname, "/presence/bounded");
  assert.equal(new URL(calls[0]).searchParams.get("limit"), "24");
  assert.equal(result.participants.length, 24);
  assert.equal(result.onlineCount, 30);
  assert.equal(result.truncated, true);
});
