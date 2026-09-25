import { DurableObject } from "cloudflare:workers";

import {
  ROOM_REALTIME_PROTOCOL_VERSION,
  normalizeRoomId,
  parseClientRealtimeMessage,
  realtimeEnvelope,
} from "./room-realtime-protocol.js";
import {
  hasPresenceUid,
  presenceSnapshotFromAttachments,
} from "./room-realtime-presence.js";

const TICKET_PREFIX = "ticket:";

async function ticketStorageKey(ticket) {
  const bytes = new TextEncoder().encode(String(ticket || ""));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  const hex = Array.from(new Uint8Array(digest))
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("");
  return `${TICKET_PREFIX}${hex}`;
}

function safeSend(webSocket, value) {
  try {
    webSocket.send(typeof value === "string" ? value : JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

export class RoomRealtimeObject extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.ctx = ctx;
    this.env = env;

    if (typeof WebSocketRequestResponsePair === "function") {
      this.ctx.setWebSocketAutoResponse(
        new WebSocketRequestResponsePair("ping", "pong"),
      );
    }
  }

  #presenceAttachments() {
    return this.ctx.getWebSockets()
      .map((socket) => socket.deserializeAttachment())
      .filter((value) => value && typeof value === "object");
  }

  async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname === "/ticket" && request.method === "POST") {
      return this.#issueTicket(request);
    }
    if (url.pathname === "/connect" && request.method === "GET") {
      return this.#connect(request, url);
    }
    if (url.pathname === "/presence" && request.method === "GET") {
      return Response.json({
        ok: true,
        participants: presenceSnapshotFromAttachments(
          this.#presenceAttachments(),
          Date.now(),
        ),
      });
    }
    if (url.pathname === "/presence/has" && request.method === "GET") {
      return Response.json({
        ok: true,
        present: hasPresenceUid(
          this.#presenceAttachments(),
          url.searchParams.get("uid"),
        ),
      });
    }
    if (url.pathname === "/broadcast" && request.method === "POST") {
      return this.#broadcast(request);
    }
    return Response.json({ ok: false, code: "route_not_found" }, { status: 404 });
  }

  async #issueTicket(request) {
    const body = await request.json().catch(() => ({}));
    const roomId = normalizeRoomId(body.roomId);
    const uid = String(body.uid || "").trim();
    const ticket = String(body.ticket || "").trim();
    const expiresAtMs = Number(body.expiresAtMs || 0);
    const displayName = String(body.displayName || "").trim();
    const profileImageUrl = String(body.profileImageUrl || "").trim();

    if (!roomId || !uid || !ticket || expiresAtMs <= Date.now()) {
      return Response.json({ ok: false, code: "invalid_ticket" }, { status: 400 });
    }

    const alreadyPresent = hasPresenceUid(this.#presenceAttachments(), uid);
    const key = await ticketStorageKey(ticket);
    await this.ctx.storage.put(key, {
      roomId,
      uid,
      ticket,
      expiresAtMs,
      displayName,
      profileImageUrl,
    });

    const currentAlarm = await this.ctx.storage.getAlarm();
    if (currentAlarm === null || expiresAtMs < currentAlarm) {
      await this.ctx.storage.setAlarm(expiresAtMs + 1000);
    }
    return Response.json({ ok: true, alreadyPresent });
  }

  async #connect(request, url) {
    if (String(request.headers.get("Upgrade") || "").toLowerCase() !== "websocket") {
      return Response.json({ ok: false, code: "websocket_required" }, { status: 426 });
    }

    const roomId = normalizeRoomId(url.searchParams.get("roomId"));
    const ticket = String(url.searchParams.get("ticket") || "").trim();
    if (!roomId || !ticket) {
      return Response.json(
        { ok: false, code: "invalid_realtime_request" },
        { status: 400 },
      );
    }

    const key = await ticketStorageKey(ticket);
    const record = await this.ctx.storage.get(key);
    if (!record) {
      return Response.json({ ok: false, code: "realtime_ticket_invalid" }, { status: 401 });
    }

    await this.ctx.storage.delete(key);
    if (String(record.roomId || "") !== roomId || Number(record.expiresAtMs || 0) <= Date.now()) {
      return Response.json({ ok: false, code: "realtime_ticket_expired" }, { status: 401 });
    }

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    const uid = String(record.uid || "");
    const connectionId = crypto.randomUUID();
    const connectedAtMs = Date.now();
    const existing = presenceSnapshotFromAttachments(
      this.#presenceAttachments().filter((item) => String(item.uid || "") === uid),
      connectedAtMs,
    );
    const joinedAtMs = existing.length
      ? Number(existing[0].joinedAtMs || connectedAtMs)
      : connectedAtMs;

    server.serializeAttachment({
      roomId,
      uid,
      connectionId,
      connectedAtMs,
      joinedAtMs,
      displayName: String(record.displayName || "").trim(),
      profileImageUrl: String(record.profileImageUrl || "").trim(),
    });
    this.ctx.acceptWebSocket(server, [`uid:${uid}`]);

    safeSend(
      server,
      realtimeEnvelope("server.ready", {
        protocolVersion: ROOM_REALTIME_PROTOCOL_VERSION,
        roomId,
        connectionId,
      }),
    );

    return new Response(null, { status: 101, webSocket: client });
  }

  async #broadcast(request) {
    const body = await request.json().catch(() => ({}));
    const type = String(body?.event?.type || "").trim();
    const payload =
      body?.event?.payload && typeof body.event.payload === "object"
        ? body.event.payload
        : {};

    if (!type || type.startsWith("client.")) {
      return Response.json({ ok: false, code: "invalid_server_event" }, { status: 400 });
    }

    const envelope = realtimeEnvelope(type, payload);
    let delivered = 0;
    for (const socket of this.ctx.getWebSockets()) {
      if (safeSend(socket, envelope)) delivered += 1;
    }
    return Response.json({ ok: true, delivered });
  }

  webSocketMessage(webSocket, message) {
    const parsed = parseClientRealtimeMessage(message, Date.now());
    if (parsed.response) safeSend(webSocket, parsed.response);
  }

  webSocketClose(webSocket, code, reason) {
    try {
      webSocket.close(code || 1000, reason || "room_leave");
    } catch {}
  }

  webSocketError(webSocket) {
    try {
      webSocket.close(1011, "realtime_error");
    } catch {}
  }

  async alarm() {
    const nowMs = Date.now();
    const tickets = await this.ctx.storage.list({ prefix: TICKET_PREFIX });
    const expired = [];
    let nextExpiry = null;

    for (const [key, value] of tickets) {
      const expiresAtMs = Number(value?.expiresAtMs || 0);
      if (expiresAtMs <= nowMs) {
        expired.push(key);
      } else if (nextExpiry === null || expiresAtMs < nextExpiry) {
        nextExpiry = expiresAtMs;
      }
    }

    if (expired.length) await this.ctx.storage.delete(expired);
    if (nextExpiry !== null) await this.ctx.storage.setAlarm(nextExpiry + 1000);
  }
}
