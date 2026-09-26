import { DurableObject } from "cloudflare:workers";
import { recordRealtimeTelemetry } from "./pressure-telemetry.js";

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
import {
  GAME_SCHEDULE_PREFIX,
  gameScheduleStorageKey,
  normalizeGameSchedule,
  processGameSchedule,
} from "./room-realtime-game.js";

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

    recordRealtimeTelemetry(this.env, { event: "activate" });

    if (typeof WebSocketRequestResponsePair === "function") {
      this.ctx.setWebSocketAutoResponse(
        new WebSocketRequestResponsePair("ping", "pong"),
      );
    }
  }

  #presenceAttachments(excludeConnectionId = "") {
    const excluded = String(excludeConnectionId || "");
    return this.ctx.getWebSockets()
      .map((socket) => {
        try {
          return socket.deserializeAttachment();
        } catch {
          return null;
        }
      })
      .filter((value) => value && typeof value === "object")
      .filter(
        (value) =>
          !excluded || String(value.connectionId || "") !== excluded,
      );
  }

  #presenceSnapshot(excludeConnectionId = "") {
    return presenceSnapshotFromAttachments(
      this.#presenceAttachments(excludeConnectionId),
      Date.now(),
    );
  }

  #broadcastEvent(type, payload) {
    const envelope = realtimeEnvelope(type, payload);
    let delivered = 0;
    for (const socket of this.ctx.getWebSockets()) {
      if (safeSend(socket, envelope)) delivered += 1;
    }
    recordRealtimeTelemetry(this.env, {
      event: "broadcast",
      outcome: String(type || "unknown"),
      fanout: delivered,
      onlineCount: this.#presenceSnapshot().length,
    });
    return delivered;
  }

  #publishOnlineCount(roomId, participants) {
    const onlineCount = participants.length;
    this.#broadcastEvent("room.online_count", {
      roomId,
      onlineCount,
      participantsCount: onlineCount,
    });
    return onlineCount;
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
      const participants = this.#presenceSnapshot();
      return Response.json({
        ok: true,
        onlineCount: participants.length,
        participants,
      });
    }
    if (url.pathname === "/presence/count" && request.method === "GET") {
      const onlineCount = this.#presenceSnapshot().length;
      recordRealtimeTelemetry(this.env, {
        event: "presence_count",
        onlineCount,
      });
      return Response.json({
        ok: true,
        onlineCount,
      });
    }
    if (url.pathname === "/presence/has" && request.method === "GET") {
      const present = hasPresenceUid(
        this.#presenceAttachments(),
        url.searchParams.get("uid"),
      );
      recordRealtimeTelemetry(this.env, {
        event: "presence_has",
        outcome: present ? "present" : "absent",
        onlineCount: this.#presenceSnapshot().length,
      });
      return Response.json({
        ok: true,
        present,
      });
    }
    if (url.pathname === "/game/register" && request.method === "POST") {
      return this.#registerGameSchedules(request);
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
    const reconnectAttempt = Math.max(
      0,
      Math.min(3, Number(body.reconnectAttempt || 0)),
    );

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
      reconnectAttempt,
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
    const existingAttachments = this.#presenceAttachments();
    const alreadyPresent = hasPresenceUid(existingAttachments, uid);
    const existing = presenceSnapshotFromAttachments(
      existingAttachments.filter((item) => String(item.uid || "") === uid),
      connectedAtMs,
    );
    const joinedAtMs = existing.length
      ? Number(existing[0].joinedAtMs || connectedAtMs)
      : connectedAtMs;
    const displayName = String(record.displayName || "").trim();
    const profileImageUrl = String(record.profileImageUrl || "").trim();
    const reconnectAttempt = Math.max(
      0,
      Math.min(3, Number(record.reconnectAttempt || 0)),
    );

    server.serializeAttachment({
      roomId,
      uid,
      connectionId,
      connectedAtMs,
      joinedAtMs,
      displayName,
      profileImageUrl,
      reconnectAttempt,
    });
    this.ctx.acceptWebSocket(server, [`uid:${uid}`]);

    const participants = this.#presenceSnapshot();
    const onlineCount = participants.length;
    safeSend(
      server,
      realtimeEnvelope("server.ready", {
        protocolVersion: ROOM_REALTIME_PROTOCOL_VERSION,
        roomId,
        connectionId,
        onlineCount,
        participantsCount: onlineCount,
      }),
    );
    this.#publishOnlineCount(roomId, participants);
    recordRealtimeTelemetry(this.env, {
      event: "connect",
      reconnect: reconnectAttempt > 0,
      onlineCount,
    });

    if (!alreadyPresent) {
      this.#broadcastEvent("room.presence_joined", {
        roomId,
        uid,
        displayName: displayName || "مستخدم Shadow Live",
        profileImageUrl,
        joinedAtMs,
        onlineCount,
      });
    }

    return new Response(null, { status: 101, webSocket: client });
  }

  async #registerGameSchedules(request) {
    const body = await request.json().catch(() => ({}));
    const roomId = normalizeRoomId(body.roomId);
    const uid = String(body.uid || "").trim();
    const schedules = Array.isArray(body.schedules)
      ? body.schedules.slice(0, 4)
      : [];

    if (!roomId || !uid || schedules.length === 0) {
      return Response.json(
        { ok: false, code: "invalid_game_schedule" },
        { status: 400 },
      );
    }
    if (!hasPresenceUid(this.#presenceAttachments(), uid)) {
      return Response.json(
        { ok: false, code: "user_not_in_room" },
        { status: 409 },
      );
    }

    const nowMs = Date.now();
    let nextAtMs = null;
    let stored = 0;
    for (const raw of schedules) {
      const candidate = normalizeGameSchedule(
        { ...raw, roomId },
        nowMs,
      );
      if (!candidate) continue;
      const key = gameScheduleStorageKey(candidate);
      const existing = await this.ctx.storage.get(key);
      const normalized = normalizeGameSchedule(
        { ...raw, roomId },
        nowMs,
        existing,
      );
      if (!normalized) continue;
      await this.ctx.storage.put(key, normalized);
      const processed = processGameSchedule(normalized, nowMs);
      if (processed.nextAtMs !== null &&
          (nextAtMs === null || processed.nextAtMs < nextAtMs)) {
        nextAtMs = processed.nextAtMs;
      }
      stored += 1;
    }

    if (stored === 0) {
      return Response.json(
        { ok: false, code: "invalid_game_schedule" },
        { status: 400 },
      );
    }

    if (nextAtMs !== null) {
      const currentAlarm = await this.ctx.storage.getAlarm();
      if (currentAlarm === null || nextAtMs < currentAlarm) {
        await this.ctx.storage.setAlarm(Math.max(Date.now() + 20, nextAtMs));
      }
    }
    return Response.json({ ok: true, stored });
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

    return Response.json({
      ok: true,
      delivered: this.#broadcastEvent(type, payload),
    });
  }

  webSocketMessage(webSocket, message) {
    const parsed = parseClientRealtimeMessage(message, Date.now());
    if (parsed.response) safeSend(webSocket, parsed.response);
  }

  #handleDeparture(webSocket, reason = "close") {
    let attachment = {};
    try {
      attachment = webSocket.deserializeAttachment() || {};
    } catch {}
    if (attachment.departureHandled === true) return;

    try {
      webSocket.serializeAttachment({
        ...attachment,
        departureHandled: true,
      });
    } catch {}

    const roomId = normalizeRoomId(attachment.roomId);
    const uid = String(attachment.uid || "").trim();
    const connectionId = String(attachment.connectionId || "").trim();
    if (!roomId || !connectionId) return;

    const participants = this.#presenceSnapshot(connectionId);
    const onlineCount = this.#publishOnlineCount(roomId, participants);
    recordRealtimeTelemetry(this.env, {
      event: "departure",
      outcome: String(reason || "close"),
      onlineCount,
      error: reason === "error",
    });
    if (uid && !hasPresenceUid(participants, uid)) {
      this.#broadcastEvent("room.presence_left", {
        roomId,
        uid,
        onlineCount,
      });
    }
  }

  webSocketClose(webSocket, code, reason) {
    this.#handleDeparture(webSocket, "close");
    try {
      webSocket.close(code || 1000, reason || "room_leave");
    } catch {}
  }

  webSocketError(webSocket) {
    this.#handleDeparture(webSocket, "error");
    try {
      webSocket.close(1011, "realtime_error");
    } catch {}
  }

  async alarm() {
    const alarmStartedAtMs = Date.now();
    const nowMs = alarmStartedAtMs;
    const tickets = await this.ctx.storage.list({ prefix: TICKET_PREFIX });
    const schedules = await this.ctx.storage.list({
      prefix: GAME_SCHEDULE_PREFIX,
    });
    const deletes = [];
    let nextAlarmAtMs = null;

    for (const [key, value] of tickets) {
      const expiresAtMs = Number(value?.expiresAtMs || 0);
      if (expiresAtMs <= nowMs) {
        deletes.push(key);
      } else if (
        nextAlarmAtMs === null ||
        expiresAtMs + 1000 < nextAlarmAtMs
      ) {
        nextAlarmAtMs = expiresAtMs + 1000;
      }
    }

    for (const [key, value] of schedules) {
      const processed = processGameSchedule(value, nowMs);
      for (const event of processed.events) {
        this.#broadcastEvent(event.type, event.payload);
      }
      if (processed.complete) {
        deletes.push(key);
      } else {
        await this.ctx.storage.put(key, processed.schedule);
        if (
          processed.nextAtMs !== null &&
          (nextAlarmAtMs === null || processed.nextAtMs < nextAlarmAtMs)
        ) {
          nextAlarmAtMs = processed.nextAtMs;
        }
      }
    }

    if (deletes.length) await this.ctx.storage.delete(deletes);
    if (nextAlarmAtMs !== null) {
      await this.ctx.storage.setAlarm(
        Math.max(Date.now() + 20, nextAlarmAtMs),
      );
    }
    recordRealtimeTelemetry(this.env, {
      event: "alarm",
      durationMs: Date.now() - alarmStartedAtMs,
      fanout: schedules.size,
      onlineCount: this.#presenceSnapshot().length,
    });
  }
}
