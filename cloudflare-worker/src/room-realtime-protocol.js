export const ROOM_REALTIME_PROTOCOL_VERSION = 1;
export const ROOM_REALTIME_TICKET_TTL_MS = 45_000;

const ROOM_ID_PATTERN = /^[A-Za-z0-9_-]{1,180}$/;

export function normalizeRoomId(value) {
  const roomId = String(value || "").trim();
  return ROOM_ID_PATTERN.test(roomId) ? roomId : "";
}

export function realtimeEnvelope(type, payload = {}, serverTimeMs = Date.now()) {
  return {
    v: ROOM_REALTIME_PROTOCOL_VERSION,
    type: String(type || ""),
    serverTimeMs: Number(serverTimeMs),
    payload: payload && typeof payload === "object" ? payload : {},
  };
}

export function parseClientRealtimeMessage(raw, serverTimeMs = Date.now()) {
  if (typeof raw !== "string") {
    return {
      ok: false,
      response: realtimeEnvelope(
        "server.error",
        { code: "binary_messages_not_supported" },
        serverTimeMs,
      ),
    };
  }

  if (raw === "ping") {
    return { ok: true, autoResponse: "pong", response: null };
  }

  let message;
  try {
    message = JSON.parse(raw);
  } catch {
    return {
      ok: false,
      response: realtimeEnvelope("server.error", { code: "invalid_json" }, serverTimeMs),
    };
  }

  if (!message || typeof message !== "object") {
    return {
      ok: false,
      response: realtimeEnvelope("server.error", { code: "invalid_message" }, serverTimeMs),
    };
  }

  if (message.type === "client.ping") {
    return {
      ok: true,
      response: realtimeEnvelope(
        "server.pong",
        { requestId: String(message.requestId || "").slice(0, 120) },
        serverTimeMs,
      ),
    };
  }

  // Step 3 deliberately enables no presence/game/business writes.
  return {
    ok: false,
    response: realtimeEnvelope(
      "server.error",
      { code: "client_message_not_enabled" },
      serverTimeMs,
    ),
  };
}
