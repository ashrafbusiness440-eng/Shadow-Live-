import { firestoreClient } from "./firestore.js";
import {
  assertUserDocumentSessionState,
  verifyFirebaseIdToken,
} from "./firebase-auth.js";
import { firestoreQuotaResponse, json, readJson } from "./http.js";
import { annotatePressureRequest } from "./pressure-telemetry.js";
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

async function readPresence(stub) {
  const response = await stub.fetch("https://room-realtime.internal/presence");
  if (!response.ok) throw new Error("realtime_presence_failed");
  const body = await response.json().catch(() => ({}));
  return {
    participants: Array.isArray(body.participants) ? body.participants : [],
    onlineCount: Math.max(0, Number(body.onlineCount || 0)),
  };
}

async function readPresenceCount(stub) {
  const response = await stub.fetch(
    "https://room-realtime.internal/presence/count",
  );
  if (!response.ok) throw new Error("realtime_presence_failed");
  const body = await response.json().catch(() => ({}));
  return Math.max(0, Number(body.onlineCount || 0));
}

export async function roomRealtime(request, env) {
  const url = new URL(request.url);

  if (request.method === "POST") {
    try {
      const body = await readJson(request);
      const action = String(body.action || "ticket").trim();
      annotatePressureRequest(request, {
        action,
        reconnectAttempt: Math.max(0, Math.min(3, Number(body.reconnectAttempt || 0))),
      });

      if (action === "presenceCounts") {
        await verifyFirebaseIdToken(request, env, { checkUserState: false });
        const rawRoomIds = Array.isArray(body.roomIds) ? body.roomIds : [];
        const roomIds = Array.from(
          new Set(rawRoomIds.map(normalizeRoomId).filter(Boolean)),
        ).slice(0, 60);
        annotatePressureRequest(request, { fanout: roomIds.length });
        const counts = {};
        const batchSize = 12;
        for (let index = 0; index < roomIds.length; index += batchSize) {
          const batch = roomIds.slice(index, index + batchSize);
          await Promise.all(
            batch.map(async (roomId) => {
              try {
                counts[roomId] = await readPresenceCount(
                  roomObject(env, roomId),
                );
              } catch {
                // Omit failed rooms so clients can use their rollout fallback.
              }
            }),
          );
        }
        return json(request, env, { ok: true, counts });
      }

      const payload = await verifyFirebaseIdToken(request, env, {
        checkUserState: action !== "ticket",
      });
      if (isAnonymous(payload)) {
        return json(request, env, { ok: false, code: "account_required" }, 403);
      }

      const roomId = normalizeRoomId(body.roomId);
      if (!roomId) {
        return json(request, env, { ok: false, code: "invalid_room_id" }, 400);
      }

      const stub = roomObject(env, roomId);
      if (action === "presenceState") {
        const state = await readPresence(stub);
        return json(request, env, {
          ok: true,
          roomId,
          onlineCount: state.onlineCount,
          participants: state.participants,
        });
      }
      if (action !== "ticket") {
        return json(request, env, { ok: false, code: "invalid_action" }, 400);
      }

      const db = firestoreClient(env);
      const uid = String(payload.sub || "");
      const [room, user] = await Promise.all([
        db.get(`rooms/${roomId}`),
        db.get(`users/${uid}`),
      ]);
      if (!room.exists || room.data?.isActive === false) {
        return json(request, env, { ok: false, code: "room_unavailable" }, 404);
      }

      const profileData = user.data || {};
      if (user.exists) {
        assertUserDocumentSessionState(payload, profileData);
      }
      const ticket = crypto.randomUUID();
      const expiresAtMs = Date.now() + ROOM_REALTIME_TICKET_TTL_MS;
      const stored = await stub.fetch("https://room-realtime.internal/ticket", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          roomId,
          uid,
          ticket,
          expiresAtMs,
          displayName: String(
            profileData.displayName ||
            profileData.username ||
            payload.name ||
            "مستخدم Shadow Live",
          ),
          profileImageUrl: String(
            profileData.profileImageUrl || payload.picture || "",
          ),
        }),
      });

      if (!stored.ok) {
        return json(request, env, { ok: false, code: "realtime_ticket_failed" }, 503);
      }
      const storedBody = await stored.json().catch(() => ({}));

      const socketPath =
        `/api/room-realtime?roomId=${encodeURIComponent(roomId)}&ticket=${encodeURIComponent(ticket)}`;
      return json(request, env, {
        ok: true,
        protocolVersion: ROOM_REALTIME_PROTOCOL_VERSION,
        roomId,
        ticket,
        expiresAtMs,
        socketPath,
        alreadyPresent: storedBody.alreadyPresent === true,
      });
    } catch (error) {
      const quotaResponse = firestoreQuotaResponse(request, env, error);
      if (quotaResponse) return quotaResponse;
      const code = String(error?.message || "");
      if (code === "unauthorized") {
        return json(request, env, { ok: false, code: "unauthorized" }, 401);
      }
      if (code === "auth_state_lookup_failed") {
        return json(request, env, { ok: false, code }, 503);
      }
      if (code === "room_realtime_not_configured") {
        return json(request, env, { ok: false, code }, 503);
      }
      return json(request, env, { ok: false, code: "server_failed" }, 500);
    }
  }

  if (request.method === "GET") {
    annotatePressureRequest(request, { action: "connect" });
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
