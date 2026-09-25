import assert from "node:assert/strict";
import test from "node:test";

import {
  ROOM_REALTIME_PROTOCOL_VERSION,
  ROOM_REALTIME_TICKET_TTL_MS,
  normalizeRoomId,
  parseClientRealtimeMessage,
  realtimeEnvelope,
} from "../../cloudflare-worker/src/room-realtime-protocol.js";

test("room realtime uses a short-lived handshake ticket", () => {
  assert.equal(ROOM_REALTIME_TICKET_TTL_MS, 45_000);
});

test("room IDs map only to the approved Durable Object name-safe shape", () => {
  assert.equal(normalizeRoomId("room_123-A"), "room_123-A");
  assert.equal(normalizeRoomId(" room_123 "), "room_123");
  assert.equal(normalizeRoomId("room/123"), "");
  assert.equal(normalizeRoomId("room 123"), "");
  assert.equal(normalizeRoomId(""), "");
});

test("realtime envelope carries protocol version and server clock", () => {
  assert.deepEqual(
    realtimeEnvelope("server.ready", { roomId: "r1" }, 1234),
    {
      v: ROOM_REALTIME_PROTOCOL_VERSION,
      type: "server.ready",
      serverTimeMs: 1234,
      payload: { roomId: "r1" },
    },
  );
});

test("only ping is accepted from clients during architecture foundation step", () => {
  const ping = parseClientRealtimeMessage(
    JSON.stringify({ type: "client.ping", requestId: "p1" }),
    5000,
  );
  assert.equal(ping.ok, true);
  assert.equal(ping.response.type, "server.pong");
  assert.equal(ping.response.serverTimeMs, 5000);
  assert.equal(ping.response.payload.requestId, "p1");

  const presence = parseClientRealtimeMessage(
    JSON.stringify({ type: "presence.join" }),
    5001,
  );
  assert.equal(presence.ok, false);
  assert.equal(presence.response.payload.code, "client_message_not_enabled");
});

test("invalid and binary messages are rejected without business side effects", () => {
  const invalid = parseClientRealtimeMessage("{bad-json", 6000);
  assert.equal(invalid.ok, false);
  assert.equal(invalid.response.payload.code, "invalid_json");

  const binary = parseClientRealtimeMessage(new Uint8Array([1, 2]), 6001);
  assert.equal(binary.ok, false);
  assert.equal(binary.response.payload.code, "binary_messages_not_supported");
});
