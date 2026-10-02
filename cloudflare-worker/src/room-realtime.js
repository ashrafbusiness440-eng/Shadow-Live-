import { firestoreClient } from "./firestore.js";
import {
  assertUserDocumentSessionState,
  verifyFirebaseIdToken,
} from "./firebase-auth.js";
import { firestoreQuotaResponse, json, readJson } from "./http.js";
import { annotatePressureRequest } from "./pressure-telemetry.js";
import {
  createAsyncLimiter,
  createAsyncTtlCache,
} from "./room-realtime-pressure.js";
import {
  ROOM_REALTIME_PROTOCOL_VERSION,
  ROOM_REALTIME_TICKET_TTL_MS,
  normalizeRoomId,
} from "./room-realtime-protocol.js";
import {
  normalizeRocketFeedEvent,
  rocketFeedRoomIdForUid,
  rocketFeedRoomIds,
} from "./room-rocket-feed.js";

const REALTIME_TICKET_FIRESTORE_CONCURRENCY = 32;
const REALTIME_ROOM_CACHE_TTL_MS = 30000;
const ticketFirestoreLimiter = createAsyncLimiter(REALTIME_TICKET_FIRESTORE_CONCURRENCY);
const roomAdmissionCache = createAsyncTtlCache({
  ttlMs: REALTIME_ROOM_CACHE_TTL_MS,
  maxEntries: 4096,
});

function roomObject(env, roomId) {
  if (!env?.ROOM_REALTIME) throw new Error("room_realtime_not_configured");
  const id = env.ROOM_REALTIME.idFromName(roomId);
  return env.ROOM_REALTIME.get(id);
}

function clean(value) {
  return String(value ?? "").trim();
}

function isOfficialRoom(room = {}) {
  const type = clean(room.roomType || room.type || "personal");
  return room.systemOwned === true ||
    room.officialRoom === true ||
    ["official", "administrative", "customer_service"].includes(type);
}

function roomOwnerUid(room = {}) {
  return clean(room.ownerUid || room.ownerId);
}

function roomHostUid(room = {}) {
  return clean(room.hostUid || room.hostId);
}

function roomModeratorCan(room = {}, uid, capability) {
  const moderators = Array.isArray(room.moderators) ? room.moderators : [];
  const entry = moderators.find((item) => clean(item?.uid) === clean(uid));
  const capabilities = Array.isArray(entry?.capabilities)
    ? entry.capabilities.map(clean)
    : [];
  return capabilities.includes(capability);
}

function globalRoomManageAllowed(user = {}) {
  const capabilities = Array.isArray(user.capabilities)
    ? user.capabilities.map(clean)
    : [];
  const role = clean(user.role);
  return role === "owner" ||
    (user.adminEnabled === true &&
      (capabilities.includes("manageRooms") ||
       capabilities.includes("manage_rooms")));
}

function agencyRoomChatAllowed(room = {}, user = {}, uid) {
  const type = clean(room.roomType || room.type || "personal");
  const roomAgencyId = clean(room.agencyId);
  if (type !== "agency" || !roomAgencyId) return false;
  if (clean(user.agencyId) !== roomAgencyId) return false;
  const role = clean(user.agencyRole);
  return (role === "owner" && roomOwnerUid(room) === clean(uid)) ||
    role === "manager" ||
    role === "senior_manager";
}

function canModerateRoomChat(room = {}, user = {}, uid) {
  const id = clean(uid);
  if (!id) return false;
  if (!isOfficialRoom(room) && roomOwnerUid(room) === id) return true;
  if (isOfficialRoom(room) && roomHostUid(room) === id) return true;
  return globalRoomManageAllowed(user) ||
    agencyRoomChatAllowed(room, user, id) ||
    roomModeratorCan(room, id, "moderateChat");
}

function activeBan(ban = {}, nowMs = Date.now()) {
  if (ban.permanent === true) return true;
  const raw = ban.expiresAt;
  const parsed = typeof raw === "string" ? Date.parse(raw) : NaN;
  const expiresAtMs = Number(
    ban.expiresAtMs ||
    ban.expires_at_ms ||
    (Number.isFinite(parsed) ? parsed : 0),
  );
  return expiresAtMs > nowMs;
}

export async function publishRoomRealtimeEvent(
  env,
  roomId,
  type,
  payload = {},
) {
  const normalized = normalizeRoomId(roomId);
  if (!normalized) return { ok: false, delivered: 0 };
  const response = await roomObject(env, normalized).fetch(
    "https://room-realtime.internal/broadcast",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        event: {
          type: String(type || "").trim(),
          payload: { roomId: normalized, ...(payload || {}) },
        },
      }),
    },
  );
  if (!response.ok) return { ok: false, delivered: 0 };
  return response.json().catch(() => ({ ok: true, delivered: 0 }));
}

export function invalidateRoomRealtimeAdmissionCache(roomId) {
  const normalized = normalizeRoomId(roomId);
  if (normalized) roomAdmissionCache.clear(normalized);
}

export async function setRoomRealtimeChatPolicy(env, roomId, enabled) {
  const normalized = normalizeRoomId(roomId);
  if (!normalized) return { ok: false, updated: 0 };
  const response = await roomObject(env, normalized).fetch(
    "https://room-realtime.internal/chat/policy",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        roomId: normalized,
        chatEnabled: enabled !== false,
      }),
    },
  );
  if (!response.ok) return { ok: false, updated: 0 };
  return response.json().catch(() => ({ ok: true, updated: 0 }));
}

export async function publishGlobalRocketEvents(env, rawEvents = []) {
  const events = Array.isArray(rawEvents)
    ? rawEvents
        .map((event) => normalizeRocketFeedEvent(event))
        .filter(Boolean)
        .slice(0, 80)
    : [];
  if (events.length === 0) return { ok: true, shards: 0, events: 0 };

  const roomIds = rocketFeedRoomIds();
  const results = await Promise.allSettled(
    roomIds.map((roomId) =>
      roomObject(env, roomId).fetch(
        "https://room-realtime.internal/rocket/publish",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ events }),
        },
      ),
    ),
  );
  const successful = results.filter(
    (result) =>
      result.status === "fulfilled" &&
      result.value &&
      result.value.ok,
  ).length;
  return {
    ok: successful > 0,
    shards: successful,
    events: events.length,
  };
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

      if (action === "rocketFeedTicket") {
        const payload = await verifyFirebaseIdToken(request, env, {
          checkUserState: false,
        });
        if (isAnonymous(payload)) {
          return json(request, env, { ok: false, code: "account_required" }, 403);
        }
        const uid = String(payload.sub || "").trim();
        if (!uid) {
          return json(request, env, { ok: false, code: "unauthorized" }, 401);
        }
        const roomId = rocketFeedRoomIdForUid(uid);
        const stub = roomObject(env, roomId);
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
            mode: "rocket_feed",
            reconnectAttempt: Math.max(
              0,
              Math.min(3, Number(body.reconnectAttempt || 0)),
            ),
          }),
        });
        if (!stored.ok) {
          return json(
            request,
            env,
            { ok: false, code: "realtime_ticket_failed" },
            503,
          );
        }
        const socketPath =
          `/api/room-realtime?roomId=${encodeURIComponent(roomId)}&ticket=${encodeURIComponent(ticket)}`;
        return json(request, env, {
          ok: true,
          protocolVersion: ROOM_REALTIME_PROTOCOL_VERSION,
          feed: "rocket",
          roomId,
          ticket,
          expiresAtMs,
          socketPath,
        });
      }

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
      const [room, user, ban] = await Promise.all([
        roomAdmissionCache.get(
          roomId,
          () => ticketFirestoreLimiter.run(() => db.get(`rooms/${roomId}`)),
        ),
        ticketFirestoreLimiter.run(() => db.get(`users/${uid}`)),
        ticketFirestoreLimiter.run(
          () => db.get(`room_bans/${roomId}/users/${uid}`),
        ),
      ]);
      if (!room.exists || room.data?.isActive === false) {
        return json(request, env, { ok: false, code: "room_unavailable" }, 404);
      }
      if (ban.exists && activeBan(ban.data || {})) {
        return json(request, env, { ok: false, code: "room_banned" }, 403);
      }

      const roomData = room.data || {};
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
          chatEnabled: roomData.chatEnabled !== false,
          canModerateChat: canModerateRoomChat(
            roomData,
            profileData,
            uid,
          ),
          ghostMode:
            profileData.roomGhostMode === true ||
            profileData.privacy?.ghostMode === true,
          vipLevel: Math.max(
            0,
            Math.min(
              99,
              Number(
                profileData.vipLevel ??
                profileData.vip?.level ??
                0,
              ) || 0,
            ),
          ),
          entryEffectKey: String(
            profileData.vipEntryEffectKey ||
            profileData.vip?.entryEffectKey ||
            "",
          ),
          reconnectAttempt: Math.max(
            0,
            Math.min(3, Number(body.reconnectAttempt || 0)),
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
