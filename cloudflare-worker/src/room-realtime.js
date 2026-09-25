import { firestoreClient } from "./firestore.js";
import { verifyFirebaseIdToken } from "./firebase-auth.js";
import { json, readJson } from "./http.js";
import {
  ROOM_REALTIME_PROTOCOL_VERSION,
  ROOM_REALTIME_TICKET_TTL_MS,
  normalizeRoomId,
} from "./room-realtime-protocol.js";

function roomObject(env, roomId) {
  if (!env?.ROOM_REALTIME) throw new Error("room_realtime_not_configured");
  const id = env.ROOM_REALTIME.idFromName(roomId);
  return env.ROOM_REALTIME.get(id);
}

function isAnonymous(payload) {
  return String(payload?.firebase?.sign_in_provider || "") === "anonymous";
}

export async function roomRealtime(request, env) {
  const url = new URL(request.url);

  if (request.method === "POST") {
    try {
      const payload = await verifyFirebaseIdToken(request, env);
      if (isAnonymous(payload)) {
        return json(request, env, { ok: false, code: "account_required" }, 403);
      }

      const body = await readJson(request);
      const roomId = normalizeRoomId(body.roomId);
      if (!roomId) {
        return json(request, env, { ok: false, code: "invalid_room_id" }, 400);
      }

      const db = firestoreClient(env);
      const room = await db.get(`rooms/${roomId}`);
      if (!room.exists || room.data?.isActive === false) {
        return json(request, env, { ok: false, code: "room_unavailable" }, 404);
      }

      const ticket = crypto.randomUUID();
      const expiresAtMs = Date.now() + ROOM_REALTIME_TICKET_TTL_MS;
      const stub = roomObject(env, roomId);
      const stored = await stub.fetch("https://room-realtime.internal/ticket", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          roomId,
          uid: String(payload.sub || ""),
          ticket,
          expiresAtMs,
        }),
      });

      if (!stored.ok) {
        return json(request, env, { ok: false, code: "realtime_ticket_failed" }, 503);
      }

      const socketPath =
        `/api/room-realtime?roomId=${encodeURIComponent(roomId)}&ticket=${encodeURIComponent(ticket)}`;
      return json(request, env, {
        ok: true,
        protocolVersion: ROOM_REALTIME_PROTOCOL_VERSION,
        roomId,
        ticket,
        expiresAtMs,
        socketPath,
      });
    } catch (error) {
      const code = String(error?.message || "");
      if (code === "unauthorized") {
        return json(request, env, { ok: false, code: "unauthorized" }, 401);
      }
      if (code === "room_realtime_not_configured") {
        return json(request, env, { ok: false, code }, 503);
      }
      return json(request, env, { ok: false, code: "server_failed" }, 500);
    }
  }

  if (request.method === "GET") {
    const roomId = normalizeRoomId(url.searchParams.get("roomId"));
    const ticket = String(url.searchParams.get("ticket") || "").trim();
    if (!roomId || !ticket) {
      return json(request, env, { ok: false, code: "invalid_realtime_request" }, 400);
    }
    if (String(request.headers.get("Upgrade") || "").toLowerCase() !== "websocket") {
      return json(request, env, { ok: false, code: "websocket_required" }, 426);
    }

    try {
      const stub = roomObject(env, roomId);
      const target = new URL("https://room-realtime.internal/connect");
      target.searchParams.set("roomId", roomId);
      target.searchParams.set("ticket", ticket);
      return stub.fetch(new Request(target, request));
    } catch (error) {
      const code = String(error?.message || "");
      return json(
        request,
        env,
        {
          ok: false,
          code: code === "room_realtime_not_configured" ? code : "realtime_connect_failed",
        },
        503,
      );
    }
  }

  return json(request, env, { ok: false, code: "method_not_allowed" }, 405);
}
