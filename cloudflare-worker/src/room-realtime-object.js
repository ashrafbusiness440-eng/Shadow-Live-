import { DurableObject } from "cloudflare:workers";
import { getFirestoreForEnv } from "./legacy-firebase-admin-shim.js";
import { roomSessionLeave } from "./voice-session-legacy.js";
import { recordRealtimeTelemetry } from "./pressure-telemetry.js";
import {
  applyCustomerServiceMicExpiries,
  persistRoomChatReport,
} from "./room-realtime-persistence.js";

import { validateAnimatedEmojiForVip } from "./animated-emoji-catalog.js";
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
import {
  ROCKET_FEED_MAX_EVENTS,
  ROCKET_FEED_STORAGE_PREFIX,
  normalizeRocketFeedEvent,
  rocketFeedRetainUntilMs,
  rocketFeedStorageKey,
} from "./room-rocket-feed.js";
import {
  GLOBAL_APP_FEED_MAX_EVENTS,
  GLOBAL_APP_FEED_STORAGE_PREFIX,
  globalAppFeedRetainUntilMs,
  globalAppFeedStorageKey,
  normalizeGlobalAppFeedEvent,
} from "./global-app-feed.js";

const TICKET_PREFIX = "ticket:";
const SEAT_DEPARTURE_PREFIX = "seat_departure:";
const SEAT_DEPARTURE_GRACE_MS = 20_000;
const SEAT_DEPARTURE_RETRY_MS = 60_000;
const SEAT_DEPARTURE_BATCH_LIMIT = 24;
const CUSTOMER_SERVICE_MIC_SCHEDULE_PREFIX = "cs_mic:";
const ROOM_PRESENCE_CLIENT_SNAPSHOT_LIMIT = 200;

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
    this.chatRateByUid = new Map();
    this.chatReportRateByUid = new Map();

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
      .filter((value) => String(value.mode || "room") !== "rocket_feed")
      .filter(
        (value) =>
          !excluded || String(value.connectionId || "") !== excluded,
      );
  }

  #presenceSnapshot(excludeConnectionId = "", { includeGhost = false } = {}) {
    return presenceSnapshotFromAttachments(
      this.#presenceAttachments(excludeConnectionId),
      Date.now(),
      { includeGhost },
    );
  }

  #broadcastEvent(type, payload) {
    const envelope = realtimeEnvelope(type, payload);
    const chatMessage =
      type === "room.chat_message" &&
      payload?.message &&
      typeof payload.message === "object"
        ? payload.message
        : null;
    let delivered = 0;
    for (const socket of this.ctx.getWebSockets()) {
      if (chatMessage) {
        try {
          const attachment = socket.deserializeAttachment() || {};
          if (String(attachment.mode || "room") === "room") {
            const previous = Array.isArray(attachment.recentChat)
              ? attachment.recentChat
              : [];
            socket.serializeAttachment({
              ...attachment,
              recentChat: [...previous, chatMessage].slice(-7),
            });
          }
        } catch {}
      }
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

  async #rocketFeedRecentEvents(nowMs = Date.now()) {
    const records = await this.ctx.storage.list({
      prefix: ROCKET_FEED_STORAGE_PREFIX,
      limit: ROCKET_FEED_MAX_EVENTS,
    });
    return Array.from(records.values())
      .map((record) => record?.event)
      .map((event) => normalizeRocketFeedEvent(event, nowMs))
      .filter(Boolean)
      .filter((event) => Number(event.startsAtMs || 0) <= nowMs)
      .sort((a, b) => Number(a.startsAtMs || 0) - Number(b.startsAtMs || 0))
      .slice(-ROCKET_FEED_MAX_EVENTS);
  }

  async #globalFeedRecentEvents(nowMs = Date.now()) {
    const records = await this.ctx.storage.list({
      prefix: GLOBAL_APP_FEED_STORAGE_PREFIX,
      limit: GLOBAL_APP_FEED_MAX_EVENTS,
    });
    return Array.from(records.values())
      .map((record) => record?.event)
      .map((event) => normalizeGlobalAppFeedEvent(event, nowMs))
      .filter(Boolean)
      .filter((event) => Number(event.startsAtMs || 0) <= nowMs)
      .sort((a, b) => Number(a.startsAtMs || 0) - Number(b.startsAtMs || 0))
      .slice(-GLOBAL_APP_FEED_MAX_EVENTS);
  }

  async #publishGlobalEvents(request) {
    const body = await request.json().catch(() => ({}));
    const nowMs = Date.now();
    const events = Array.isArray(body.events)
      ? body.events
          .map((event) => normalizeGlobalAppFeedEvent(event, nowMs))
          .filter(Boolean)
          .slice(0, GLOBAL_APP_FEED_MAX_EVENTS)
      : [];
    if (events.length === 0) {
      return Response.json({ ok: true, stored: 0, delivered: 0 });
    }

    let stored = 0;
    let delivered = 0;
    for (const event of events) {
      const key = globalAppFeedStorageKey(event.eventId);
      if (!key) continue;
      const retainUntilMs = globalAppFeedRetainUntilMs(event);
      await this.ctx.storage.put(key, { event, retainUntilMs });
      stored += 1;
      if (event.startsAtMs <= nowMs && event.endsAtMs > nowMs) {
        delivered += this.#broadcastEvent("app.global_event", event);
      }
    }

    const records = await this.ctx.storage.list({
      prefix: GLOBAL_APP_FEED_STORAGE_PREFIX,
      limit: GLOBAL_APP_FEED_MAX_EVENTS,
    });
    const expired = [];
    for (const [key, record] of records) {
      if (Number(record?.retainUntilMs || 0) <= nowMs) expired.push(key);
    }
    if (expired.length) await this.ctx.storage.delete(expired);

    return Response.json({ ok: true, stored, delivered });
  }


  async #processRocketFeed(nowMs = Date.now()) {
    const records = await this.ctx.storage.list({
      prefix: ROCKET_FEED_STORAGE_PREFIX,
      limit: ROCKET_FEED_MAX_EVENTS,
    });
    const deletes = [];
    let nextAtMs = null;
    let delivered = 0;

    for (const [key, record] of records) {
      const event = normalizeRocketFeedEvent(record?.event, nowMs);
      const retainUntilMs = Number(
        record?.retainUntilMs || rocketFeedRetainUntilMs(record?.event),
      );
      if (!event || retainUntilMs <= nowMs) {
        deletes.push(key);
        continue;
      }

      const broadcastedAtMs = Number(record?.broadcastedAtMs || 0);
      if (broadcastedAtMs <= 0 && event.startsAtMs <= nowMs) {
        delivered += this.#broadcastEvent("room.rocket_explosion", event);
        await this.ctx.storage.put(key, {
          ...record,
          event,
          retainUntilMs,
          broadcastedAtMs: nowMs,
        });
      } else if (broadcastedAtMs <= 0) {
        nextAtMs =
          nextAtMs === null
            ? event.startsAtMs
            : Math.min(nextAtMs, event.startsAtMs);
      }

      nextAtMs =
        nextAtMs === null
          ? retainUntilMs
          : Math.min(nextAtMs, retainUntilMs);
    }

    if (deletes.length) await this.ctx.storage.delete(deletes);
    return { nextAtMs, delivered, checked: records.size };
  }

  async #publishRocketEvents(request) {
    const body = await request.json().catch(() => ({}));
    const nowMs = Date.now();
    const events = Array.isArray(body.events)
      ? body.events
          .map((event) => normalizeRocketFeedEvent(event, nowMs))
          .filter(Boolean)
          .slice(0, ROCKET_FEED_MAX_EVENTS)
      : [];
    if (events.length === 0) {
      return Response.json({ ok: true, stored: 0, delivered: 0 });
    }

    let stored = 0;
    for (const event of events) {
      const key = rocketFeedStorageKey(event.explosionId);
      if (!key) continue;
      const existing = await this.ctx.storage.get(key);
      await this.ctx.storage.put(key, {
        event,
        retainUntilMs: rocketFeedRetainUntilMs(event),
        broadcastedAtMs: Number(existing?.broadcastedAtMs || 0),
      });
      stored += 1;
    }

    const processed = await this.#processRocketFeed(nowMs);
    if (processed.nextAtMs !== null) {
      const currentAlarm = await this.ctx.storage.getAlarm();
      if (currentAlarm === null || processed.nextAtMs < currentAlarm) {
        await this.ctx.storage.setAlarm(
          Math.max(Date.now() + 20, processed.nextAtMs),
        );
      }
    }
    recordRealtimeTelemetry(this.env, {
      event: "rocket_feed_publish",
      fanout: processed.delivered,
      onlineCount: this.ctx.getWebSockets().length,
    });
    return Response.json({
      ok: true,
      stored,
      delivered: processed.delivered,
    });
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
    if (url.pathname === "/presence/internal" && request.method === "GET") {
      const participants = this.#presenceSnapshot("", { includeGhost: true });
      return Response.json({
        ok: true,
        onlineCount: participants.length,
        participants,
      });
    }
    if (url.pathname === "/presence/bounded" && request.method === "GET") {
      const requested = Number(url.searchParams.get("limit") || 24);
      const limit = Math.max(1, Math.min(64, Math.floor(requested)));
      const participants = this.#presenceSnapshot("", {
        includeGhost: true,
      });
      const requiredUid = String(
        url.searchParams.get("requiredUid") || "",
      ).trim();
      return Response.json({
        ok: true,
        onlineCount: participants.length,
        participants: participants.slice(0, limit),
        truncated: participants.length > limit,
        requiredUidPresent: requiredUid
          ? hasPresenceUid(this.#presenceAttachments(), requiredUid)
          : null,
      });
    }
    if (url.pathname === "/presence/identity" && request.method === "POST") {
      return this.#updatePresenceIdentity(request);
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
    if (url.pathname === "/presence/resolve" && request.method === "POST") {
      const body = await request.json().catch(() => ({}));
      const rawUids = Array.isArray(body.uids) ? body.uids : [];
      const uids = Array.from(
        new Set(
          rawUids
            .map((value) => String(value || "").trim())
            .filter(Boolean),
        ),
      ).slice(0, 24);
      const attachments = this.#presenceAttachments();
      const presentUids = uids.filter((uid) =>
        hasPresenceUid(attachments, uid)
      );
      recordRealtimeTelemetry(this.env, {
        event: "presence_resolve",
        fanout: uids.length,
        onlineCount: this.#presenceSnapshot().length,
      });
      return Response.json({
        ok: true,
        requestedCount: uids.length,
        presentUids,
      });
    }
    if (url.pathname === "/rocket/publish" && request.method === "POST") {
      return this.#publishRocketEvents(request);
    }
    if (url.pathname === "/global/publish" && request.method === "POST") {
      return this.#publishGlobalEvents(request);
    }
    if (url.pathname === "/game/register" && request.method === "POST") {
      return this.#registerGameSchedules(request);
    }
    if (
      url.pathname === "/customer-service/mic/register" &&
      request.method === "POST"
    ) {
      return this.#registerCustomerServiceMicSchedules(request);
    }
    if (url.pathname === "/broadcast" && request.method === "POST") {
      return this.#broadcast(request);
    }
    if (url.pathname === "/chat/policy" && request.method === "POST") {
      return this.#updateChatPolicy(request);
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
    const activeProfileFrameAssetKey =
      String(body.activeProfileFrameAssetKey || "").trim();
    const activeProfileFrameImageUrl =
      String(body.activeProfileFrameImageUrl || "").trim();
    const activeProfileFrameExpiresAtMs = Math.max(
      0,
      Number(body.activeProfileFrameExpiresAtMs || 0),
    );
    const activeProfileFramePermanent =
      body.activeProfileFramePermanent === true;
    const publicId = String(body.publicId || "").trim().slice(0, 16);
    const mysteriousMode = body.mysteriousMode === true;
    const mysteriousId = String(body.mysteriousId || "").trim().slice(0, 9);
    const wealthLevel = Math.max(0, Math.min(35, Number(body.wealthLevel || 0)));
    const attractionLevel = Math.max(0, Math.min(35, Number(body.attractionLevel || 0)));
    const gameLevel = Math.max(0, Math.min(21, Number(body.gameLevel || 0)));
    const chatEnabled = body.chatEnabled !== false;
    const canModerateChat = body.canModerateChat === true;
    const ghostMode = body.ghostMode === true;
    const hiddenRoomEntry = body.hiddenRoomEntry === true;
    const vipLevel = Math.max(0, Math.min(10, Number(body.vipLevel || 0)));
    const entryEffectKey = String(body.entryEffectKey || "").trim();
    const mode = String(body.mode || "room") === "rocket_feed"
      ? "rocket_feed"
      : "room";
    const reconnectAttempt = Math.max(
      0,
      Math.min(3, Number(body.reconnectAttempt || 0)),
    );

    if (!roomId || !uid || !ticket || expiresAtMs <= Date.now()) {
      return Response.json({ ok: false, code: "invalid_ticket" }, { status: 400 });
    }

    const alreadyPresent =
      mode === "room" && hasPresenceUid(this.#presenceAttachments(), uid);
    const key = await ticketStorageKey(ticket);
    await this.ctx.storage.put(key, {
      roomId,
      uid,
      ticket,
      expiresAtMs,
      displayName,
      profileImageUrl,
      activeProfileFrameAssetKey,
      activeProfileFrameImageUrl,
      activeProfileFrameExpiresAtMs,
      activeProfileFramePermanent,
      publicId,
      mysteriousMode,
      mysteriousId,
      wealthLevel,
      attractionLevel,
      gameLevel,
      chatEnabled,
      canModerateChat,
      ghostMode,
      hiddenRoomEntry,
      vipLevel,
      entryEffectKey,
      mode,
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
    const reconnectAttempt = Math.max(
      0,
      Math.min(3, Number(record.reconnectAttempt || 0)),
    );
    const mode = String(record.mode || "room");

    if (mode === "rocket_feed") {
      server.serializeAttachment({
        mode,
        roomId,
        uid,
        connectionId,
        connectedAtMs,
        reconnectAttempt,
      });
      this.ctx.acceptWebSocket(server, [`uid:${uid}`, "feed:rocket"]);
      const [recentEvents, recentGlobalEvents] = await Promise.all([
        this.#rocketFeedRecentEvents(connectedAtMs),
        this.#globalFeedRecentEvents(connectedAtMs),
      ]);
      safeSend(
        server,
        realtimeEnvelope("server.ready", {
          protocolVersion: ROOM_REALTIME_PROTOCOL_VERSION,
          feed: "rocket",
          connectionId,
          recentEvents,
          recentGlobalEvents,
        }),
      );
      recordRealtimeTelemetry(this.env, {
        event: "rocket_feed_connect",
        reconnect: reconnectAttempt > 0,
        fanout: recentEvents.length,
        onlineCount: this.ctx.getWebSockets().length,
      });
      return new Response(null, { status: 101, webSocket: client });
    }

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
    server.serializeAttachment({
      mode: "room",
      roomId,
      uid,
      connectionId,
      connectedAtMs,
      joinedAtMs,
      displayName,
      profileImageUrl,
      activeProfileFrameAssetKey:
        String(record.activeProfileFrameAssetKey || "").trim(),
      activeProfileFrameImageUrl:
        String(record.activeProfileFrameImageUrl || "").trim(),
      activeProfileFrameExpiresAtMs: Math.max(
        0,
        Number(record.activeProfileFrameExpiresAtMs || 0),
      ),
      activeProfileFramePermanent:
        record.activeProfileFramePermanent === true,
      publicId: String(record.publicId || "").trim().slice(0, 16),
      mysteriousMode: record.mysteriousMode === true,
      mysteriousId: String(record.mysteriousId || "").trim().slice(0, 9),
      wealthLevel: Math.max(0, Math.min(35, Number(record.wealthLevel || 0))),
      attractionLevel: Math.max(0, Math.min(35, Number(record.attractionLevel || 0))),
      gameLevel: Math.max(0, Math.min(21, Number(record.gameLevel || 0))),
      chatEnabled: record.chatEnabled !== false,
      canModerateChat: record.canModerateChat === true,
      ghostMode: record.ghostMode === true,
      hiddenRoomEntry: record.hiddenRoomEntry === true,
      vipLevel: Math.max(0, Math.min(10, Number(record.vipLevel || 0))),
      entryEffectKey: String(record.entryEffectKey || ""),
      recentChat: [],
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
        participants: participants.slice(
          0,
          ROOM_PRESENCE_CLIENT_SNAPSHOT_LIMIT,
        ),
        participantsTruncated:
          participants.length > ROOM_PRESENCE_CLIENT_SNAPSHOT_LIMIT,
      }),
    );
    this.#publishOnlineCount(roomId, participants);
    recordRealtimeTelemetry(this.env, {
      event: "connect",
      reconnect: reconnectAttempt > 0,
      onlineCount,
    });

    if (!alreadyPresent && record.hiddenRoomEntry !== true) {
      this.#broadcastEvent("room.presence_joined", {
        roomId,
        uid,
        displayName: displayName || "مستخدم Shadow Live",
        profileImageUrl,
        activeProfileFrameAssetKey:
          String(record.activeProfileFrameAssetKey || "").trim(),
        activeProfileFrameImageUrl:
          String(record.activeProfileFrameImageUrl || "").trim(),
        activeProfileFrameExpiresAtMs: Math.max(
          0,
          Number(record.activeProfileFrameExpiresAtMs || 0),
        ),
        activeProfileFramePermanent:
          record.activeProfileFramePermanent === true,
        publicId: String(record.publicId || "").trim().slice(0, 16),
        mysteriousMode: record.mysteriousMode === true,
        mysteriousId: String(record.mysteriousId || "").trim().slice(0, 9),
        wealthLevel: Math.max(0, Math.min(35, Number(record.wealthLevel || 0))),
        attractionLevel: Math.max(0, Math.min(35, Number(record.attractionLevel || 0))),
        gameLevel: Math.max(0, Math.min(21, Number(record.gameLevel || 0))),
        joinedAtMs,
        onlineCount,
        vipLevel: Math.max(0, Math.min(10, Number(record.vipLevel || 0))),
        entryEffectKey: String(record.entryEffectKey || ""),
      });
    }

    return new Response(null, { status: 101, webSocket: client });
  }

  async #registerCustomerServiceMicSchedules(request) {
    const body = await request.json().catch(() => ({}));
    const roomId = normalizeRoomId(body.roomId);
    const uid = String(body.uid || "").trim();
    const schedules = Array.isArray(body.schedules)
      ? body.schedules.slice(0, 2)
      : [];
    if (!roomId || !uid || schedules.length === 0) {
      return Response.json(
        { ok: false, code: "invalid_customer_service_mic_schedule" },
        { status: 400 },
      );
    }

    let stored = 0;
    let nextAtMs = null;
    for (const raw of schedules) {
      const kind = String(raw?.kind || "");
      if (!["invite_expire", "mic_expire"].includes(kind)) continue;
      const expiresAtMs = Number(raw?.expiresAtMs || 0);
      if (!Number.isFinite(expiresAtMs) || expiresAtMs <= Date.now()) continue;
      const key =
        CUSTOMER_SERVICE_MIC_SCHEDULE_PREFIX +
        kind +
        ":" +
        uid;
      await this.ctx.storage.put(key, {
        roomId,
        uid,
        kind,
        expiresAtMs,
      });
      nextAtMs =
        nextAtMs === null ? expiresAtMs : Math.min(nextAtMs, expiresAtMs);
      stored += 1;
    }

    if (stored === 0) {
      return Response.json(
        { ok: false, code: "invalid_customer_service_mic_schedule" },
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

  async #processCustomerServiceMicSchedules(nowMs = Date.now()) {
    const records = await this.ctx.storage.list({
      prefix: CUSTOMER_SERVICE_MIC_SCHEDULE_PREFIX,
      limit: 20,
    });
    if (records.size === 0) {
      return { nextAtMs: null, checked: 0, expired: 0 };
    }

    const due = [];
    let nextAtMs = null;
    for (const [key, value] of records) {
      const expiresAtMs = Number(value?.expiresAtMs || 0);
      if (expiresAtMs > nowMs) {
        nextAtMs =
          nextAtMs === null ? expiresAtMs : Math.min(nextAtMs, expiresAtMs);
        continue;
      }
      due.push([key, value]);
    }
    if (due.length === 0) {
      return { nextAtMs, checked: records.size, expired: 0 };
    }

    const roomId = normalizeRoomId(due[0]?.[1]?.roomId);
    if (!roomId) {
      await this.ctx.storage.delete(due.map(([key]) => key));
      return { nextAtMs, checked: records.size, expired: due.length };
    }

    const result = await applyCustomerServiceMicExpiries(
      this.env,
      roomId,
      due.map(([, schedule]) => schedule),
      nowMs,
    );
    const deletes = due.map(([key]) => key);
    if (deletes.length > 0) await this.ctx.storage.delete(deletes);

    recordRealtimeTelemetry(this.env, {
      event: "customer_service_mic_expiry",
      outcome: result.seatsChanged
        ? "auto_drop"
        : result.invitesChanged
          ? "invite_expired"
          : "noop",
      fanout: deletes.length,
      onlineCount: this.#presenceSnapshot().length,
    });
    return {
      nextAtMs,
      checked: records.size,
      expired: deletes.length,
    };
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

  async #handleRoomChatReport(webSocket, raw) {
    let attachment = {};
    try {
      attachment = webSocket.deserializeAttachment() || {};
    } catch {}
    if (String(attachment.mode || "room") !== "room") return false;

    let message;
    try {
      message = JSON.parse(raw);
    } catch {
      return false;
    }
    if (!message || message.type !== "client.room_chat_report") return false;

    const requestId = String(message.requestId || "").slice(0, 120);
    const payload =
      message.payload && typeof message.payload === "object"
        ? message.payload
        : {};
    const messageId = String(payload.messageId || "").trim().slice(0, 160);
    const reason = String(payload.reason || "").trim().slice(0, 160);
    const roomId = normalizeRoomId(attachment.roomId);
    const reporterUid = String(attachment.uid || "").trim();

    if (!requestId || !messageId || !reason || !roomId || !reporterUid) {
      this.#chatError(webSocket, requestId, "invalid_room_report");
      return true;
    }

    const nowMs = Date.now();
    const previousReportAt = Number(
      this.chatReportRateByUid.get(reporterUid) || 0,
    );
    if (previousReportAt > 0 && nowMs - previousReportAt < 5000) {
      this.#chatError(webSocket, requestId, "report_rate_limited");
      return true;
    }

    const recentChat = Array.isArray(attachment.recentChat)
      ? attachment.recentChat.slice(-7)
      : [];
    const targetIndex = recentChat.findIndex(
      (item) => String(item?.id || "") === messageId,
    );
    if (targetIndex < 0) {
      this.#chatError(
        webSocket,
        requestId,
        "report_message_not_in_session",
      );
      return true;
    }

    const target = recentChat[targetIndex];
    const targetUid = String(target?.senderUid || "").trim();
    if (!targetUid || targetUid === reporterUid) {
      this.#chatError(webSocket, requestId, "invalid_room_report");
      return true;
    }

    const from = Math.max(0, targetIndex - 2);
    const to = Math.min(recentChat.length, targetIndex + 3);
    const context = recentChat.slice(from, to).map((item) => ({
      id: String(item?.id || "").slice(0, 160),
      type: String(item?.type || "text").slice(0, 40),
      senderUid: String(item?.senderUid || "").slice(0, 180),
      displayName: String(item?.displayName || "").slice(0, 120),
      text: String(item?.text || "").slice(0, 500),
      createdAtMs: Math.max(0, Number(item?.createdAtMs || 0)),
      giftName: String(item?.giftName || "").slice(0, 120),
      quantity: Math.max(0, Number(item?.quantity || 0)),
      totalCost: Math.max(0, Number(item?.totalCost || 0)),
    }));

    let report;
    try {
      report = await persistRoomChatReport(this.env, {
        reporterUid,
        targetUid,
        roomId,
        messageId,
        reason,
        message: context.find((item) => item.id === messageId) || null,
        context,
        nowMs,
      });
    } catch {
      this.#chatError(webSocket, requestId, "room_report_failed");
      return true;
    }
    const reportId = String(report?.reportId || "");
    if (!reportId) {
      this.#chatError(webSocket, requestId, "room_report_failed");
      return true;
    }

    this.chatReportRateByUid.set(reporterUid, nowMs);
    safeSend(
      webSocket,
      realtimeEnvelope("room.chat_report_ack", {
        requestId,
        reportId,
      }),
    );
    recordRealtimeTelemetry(this.env, {
      event: "room_chat_report",
      outcome: "saved",
      onlineCount: this.#presenceSnapshot().length,
    });
    return true;
  }

  async #updatePresenceIdentity(request) {
    const body = await request.json().catch(() => ({}));
    const roomId = normalizeRoomId(body.roomId);
    const uid = String(body.uid || "").trim();
    if (!roomId || !uid) {
      return Response.json(
        { ok: false, code: "invalid_presence_identity" },
        { status: 400 },
      );
    }
    const patch = {
      displayName: String(body.displayName || "مستخدم Shadow Live").trim(),
      profileImageUrl: String(body.profileImageUrl || "").trim(),
      activeProfileFrameAssetKey:
        String(body.activeProfileFrameAssetKey || "").trim(),
      activeProfileFrameImageUrl:
        String(body.activeProfileFrameImageUrl || "").trim(),
      activeProfileFrameExpiresAtMs: Math.max(
        0,
        Number(body.activeProfileFrameExpiresAtMs || 0),
      ),
      activeProfileFramePermanent:
        body.activeProfileFramePermanent === true,
      publicId: String(body.publicId || "").trim().slice(0, 16),
      mysteriousMode: body.mysteriousMode === true,
      mysteriousId: String(body.mysteriousId || "").trim().slice(0, 9),
      wealthLevel: Math.max(0, Math.min(35, Number(body.wealthLevel || 0))),
      attractionLevel:
        Math.max(0, Math.min(35, Number(body.attractionLevel || 0))),
      gameLevel: Math.max(0, Math.min(21, Number(body.gameLevel || 0))),
      vipLevel: Math.max(0, Math.min(10, Number(body.vipLevel || 0))),
      entryEffectKey: String(body.entryEffectKey || "").trim(),
      canModerateChat: body.canModerateChat === true,
    };
    let updated = 0;
    let hidden = false;
    for (const socket of this.ctx.getWebSockets()) {
      let attachment = {};
      try {
        attachment = socket.deserializeAttachment() || {};
      } catch {}
      if (String(attachment.mode || "room") !== "room") continue;
      if (normalizeRoomId(attachment.roomId) !== roomId) continue;
      if (String(attachment.uid || "").trim() !== uid) continue;
      hidden = hidden || attachment.ghostMode === true;
      try {
        socket.serializeAttachment({ ...attachment, ...patch });
        updated += 1;
      } catch {}
    }
    if (updated > 0 && !hidden) {
      const participant = this.#presenceSnapshot("", { includeGhost: true })
        .find((item) => String(item.uid || "") === uid);
      if (participant) {
        this.#broadcastEvent("room.presence_updated", {
          roomId,
          participant,
        });
      }
    }
    return Response.json({ ok: true, roomId, uid, updated });
  }

  async #updateChatPolicy(request) {
    const body = await request.json().catch(() => ({}));
    const roomId = normalizeRoomId(body.roomId);
    if (!roomId) {
      return Response.json(
        { ok: false, code: "invalid_room_id" },
        { status: 400 },
      );
    }
    const chatEnabled = body.chatEnabled !== false;
    let updated = 0;
    for (const socket of this.ctx.getWebSockets()) {
      let attachment = {};
      try {
        attachment = socket.deserializeAttachment() || {};
      } catch {}
      if (String(attachment.mode || "room") !== "room") continue;
      if (normalizeRoomId(attachment.roomId) !== roomId) continue;
      try {
        socket.serializeAttachment({
          ...attachment,
          chatEnabled,
        });
        updated += 1;
      } catch {}
    }
    return Response.json({ ok: true, roomId, chatEnabled, updated });
  }

  #chatError(webSocket, requestId, code) {
    safeSend(
      webSocket,
      realtimeEnvelope("server.error", {
        requestId: String(requestId || "").slice(0, 120),
        code,
      }),
    );
  }

  #handleRoomChatMessage(webSocket, raw) {
    let attachment = {};
    try {
      attachment = webSocket.deserializeAttachment() || {};
    } catch {}
    if (String(attachment.mode || "room") !== "room") return false;

    let message;
    try {
      message = JSON.parse(raw);
    } catch {
      return false;
    }
    if (!message || message.type !== "client.room_chat") return false;

    const requestId = String(message.requestId || "").slice(0, 120);
    const payload =
      message.payload && typeof message.payload === "object"
        ? message.payload
        : {};
    const roomId = normalizeRoomId(payload.roomId);
    const attachedRoomId = normalizeRoomId(attachment.roomId);
    const uid = String(attachment.uid || "").trim();
    const text = String(payload.text || "").trim();
    const vipLevel = Math.max(
      0,
      Math.min(10, Number(attachment.vipLevel || 0)),
    );
    const animatedEmojiId = String(
      payload.animatedEmojiId || payload.vipEmojiToken || "",
    ).trim();
    let animatedEmoji = null;
    try {
      animatedEmoji = validateAnimatedEmojiForVip(
        animatedEmojiId,
        vipLevel,
      );
    } catch (error) {
      this.#chatError(
        webSocket,
        requestId,
        String(error?.code || error?.message || "invalid_animated_emoji"),
      );
      return true;
    }

    if (!requestId || !roomId || roomId !== attachedRoomId || !uid) {
      this.#chatError(webSocket, requestId, "invalid_room_message");
      return true;
    }
    if (!text || text.length > 500) {
      this.#chatError(webSocket, requestId, "invalid_room_message");
      return true;
    }
    if (
      attachment.chatEnabled === false &&
      attachment.canModerateChat !== true
    ) {
      this.#chatError(webSocket, requestId, "room_chat_disabled");
      return true;
    }

    const nowMs = Date.now();
    const current = this.chatRateByUid.get(uid) || {
      windowStartedAtMs: nowMs,
      count: 0,
    };
    const sameWindow =
      nowMs - Number(current.windowStartedAtMs || 0) < 10_000;
    const count = sameWindow ? Number(current.count || 0) : 0;
    if (count >= 8) {
      this.#chatError(webSocket, requestId, "rate_limited");
      return true;
    }
    this.chatRateByUid.set(uid, {
      windowStartedAtMs: sameWindow
        ? Number(current.windowStartedAtMs || nowMs)
        : nowMs,
      count: count + 1,
    });

    const mentions = Array.isArray(payload.mentionUids)
      ? Array.from(
          new Set(
            payload.mentionUids
              .map((value) => String(value || "").trim())
              .filter(Boolean),
          ),
        ).slice(0, 10)
      : [];
    const replyTo = String(payload.replyTo || "").trim().slice(0, 120);
    const replyPreview = String(payload.replyPreview || "")
      .trim()
      .slice(0, 120);
    const replySenderUid = String(payload.replySenderUid || "")
      .trim()
      .slice(0, 160);
    const messageId = crypto.randomUUID();

    this.#broadcastEvent("room.chat_message", {
      roomId,
      message: {
        id: messageId,
        type: "text",
        senderUid: uid,
        displayName:
          String(attachment.displayName || "").trim() ||
          "مستخدم Shadow Live",
        profileImageUrl: String(attachment.profileImageUrl || "").trim(),
        activeProfileFrameAssetKey:
          String(attachment.activeProfileFrameAssetKey || "").trim(),
        activeProfileFrameImageUrl:
          String(attachment.activeProfileFrameImageUrl || "").trim(),
        activeProfileFrameExpiresAtMs: Math.max(
          0,
          Number(attachment.activeProfileFrameExpiresAtMs || 0),
        ),
        activeProfileFramePermanent:
          attachment.activeProfileFramePermanent === true,
        publicId: String(attachment.publicId || "").trim().slice(0, 16),
        mysteriousMode: attachment.mysteriousMode === true,
        mysteriousId: String(attachment.mysteriousId || "").trim().slice(0, 9),
        wealthLevel: Math.max(0, Math.min(35, Number(attachment.wealthLevel || 0))),
        attractionLevel: Math.max(0, Math.min(35, Number(attachment.attractionLevel || 0))),
        gameLevel: Math.max(0, Math.min(21, Number(attachment.gameLevel || 0))),
        text,
        animatedEmojiId: animatedEmoji?.id || "",
        animatedEmojiAssetKey: animatedEmoji?.assetKey || "",
        animatedEmojiFallbackGlyph: animatedEmoji?.fallbackGlyph || "",
        animatedEmojiMinVipLevel: animatedEmoji?.minVipLevel || 0,
        mentionUids: mentions,
        replyTo: replyTo || null,
        replyPreview: replyPreview || null,
        replySenderUid: replySenderUid || null,
        createdAtMs: nowMs,
        systemKind: animatedEmoji ? "animated_emoji" : "",
        vipLevel,
        entryEffectKey: "",
      },
    });
    safeSend(
      webSocket,
      realtimeEnvelope("room.chat_ack", {
        requestId,
        messageId,
      }),
    );
    recordRealtimeTelemetry(this.env, {
      event: "room_chat",
      outcome: "sent",
      onlineCount: this.#presenceSnapshot().length,
    });
    return true;
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

  async webSocketMessage(webSocket, message) {
    if (
      typeof message === "string" &&
      await this.#handleRoomChatReport(webSocket, message)
    ) {
      return;
    }
    if (
      typeof message === "string" &&
      this.#handleRoomChatMessage(webSocket, message)
    ) {
      return;
    }
    const parsed = parseClientRealtimeMessage(message, Date.now());
    if (parsed.response) safeSend(webSocket, parsed.response);
  }

  async #scheduleSeatDeparture(roomId, uid, nowMs = Date.now()) {
    // One delayed task per disconnected UID, only when their last live
    // socket leaves. Reconnects are verified in the existing DO on expiry.
    const dueAtMs = nowMs + SEAT_DEPARTURE_GRACE_MS;
    await this.ctx.storage.put(SEAT_DEPARTURE_PREFIX + uid, {
      roomId,
      uid,
      dueAtMs,
      attempts: 0,
    });
    const currentAlarm = await this.ctx.storage.getAlarm();
    if (currentAlarm === null || currentAlarm > dueAtMs) {
      await this.ctx.storage.setAlarm(dueAtMs);
    }
  }

  async #processSeatDepartures(nowMs = Date.now()) {
    // No timer, room scan, or Firestore listener: work is bounded and only
    // runs after an actual room websocket disconnect (or a bounded retry).
    const pending = await this.ctx.storage.list({
      prefix: SEAT_DEPARTURE_PREFIX,
      limit: SEAT_DEPARTURE_BATCH_LIMIT,
    });
    if (!pending.size) return { nextAtMs: null, processed: 0, failed: 0 };
    const deletes = [];
    let nextAtMs = null;
    let processed = 0;
    let failed = 0;
    let db = null;
    const live = this.#presenceAttachments();

    for (const [key, task] of pending) {
      const uid = String(task?.uid || "").trim();
      const roomId = normalizeRoomId(task?.roomId);
      const dueAtMs = Number(task?.dueAtMs || 0);
      if (!uid || !roomId) {
        deletes.push(key);
        continue;
      }
      if (hasPresenceUid(live, uid)) {
        // User returned inside the grace window; never drop their mic.
        deletes.push(key);
        continue;
      }
      if (dueAtMs > nowMs) {
        nextAtMs =
          nextAtMs === null ? dueAtMs : Math.min(nextAtMs, dueAtMs);
        continue;
      }

      try {
        // Reuse the SAME transactional seat release and host mic activity
        // accounting as a normal client leave; no duplicated economy logic.
        db ??= getFirestoreForEnv(this.env);
        await roomSessionLeave(db, uid, roomId);
        deletes.push(key);
        processed += 1;
      } catch (_) {
        failed += 1;
        const attempts = Math.max(0, Number(task?.attempts || 0)) + 1;
        if (attempts >= 2) {
          deletes.push(key); // No unbounded database retry loops.
        } else {
          const retryAtMs = nowMs + SEAT_DEPARTURE_RETRY_MS;
          await this.ctx.storage.put(key, {
            ...task,
            attempts,
            dueAtMs: retryAtMs,
          });
          nextAtMs =
            nextAtMs === null ? retryAtMs : Math.min(nextAtMs, retryAtMs);
        }
      }
    }
    if (deletes.length > 0) await this.ctx.storage.delete(deletes);
    if (pending.size === SEAT_DEPARTURE_BATCH_LIMIT) {
      // A finite backlog beyond the bounded page must make progress.
      const nextBatchAtMs = nowMs + 1000;
      nextAtMs =
        nextAtMs === null ? nextBatchAtMs : Math.min(nextAtMs, nextBatchAtMs);
    }
    recordRealtimeTelemetry(this.env, {
      event: "seat_departure_cleanup",
      outcome: failed ? "partial_error" : "done",
      fanout: processed,
      error: failed > 0,
      onlineCount: this.#presenceSnapshot().length,
    });
    return { nextAtMs, processed, failed };
  }

  async #handleDeparture(webSocket, reason = "close") {
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

    if (String(attachment.mode || "room") === "rocket_feed") {
      recordRealtimeTelemetry(this.env, {
        event: "rocket_feed_departure",
        outcome: String(reason || "close"),
        onlineCount: this.ctx.getWebSockets().length,
        error: reason === "error",
      });
      return;
    }

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
      this.chatRateByUid.delete(uid);
      this.chatReportRateByUid.delete(uid);
      this.#broadcastEvent("room.presence_left", {
        roomId,
        uid,
        onlineCount,
      });
      try {
        await this.#scheduleSeatDeparture(roomId, uid);
      } catch (_) {
        recordRealtimeTelemetry(this.env, {
          event: "seat_departure_schedule",
          outcome: "error",
          error: true,
        });
      }
    }
  }

  async webSocketClose(webSocket, code, reason) {
    await this.#handleDeparture(webSocket, "close");
    try {
      webSocket.close(code || 1000, reason || "room_leave");
    } catch {}
  }

  async webSocketError(webSocket) {
    await this.#handleDeparture(webSocket, "error");
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
    const rocketFeed = await this.#processRocketFeed(nowMs);
    const customerServiceMic =
      await this.#processCustomerServiceMicSchedules(nowMs);
    const seatDepartures = await this.#processSeatDepartures(nowMs);
    const deletes = [];
    let nextAlarmAtMs = rocketFeed.nextAtMs;
    if (
      customerServiceMic.nextAtMs !== null &&
      (nextAlarmAtMs === null ||
        customerServiceMic.nextAtMs < nextAlarmAtMs)
    ) {
      nextAlarmAtMs = customerServiceMic.nextAtMs;
    }
    if (
      seatDepartures.nextAtMs !== null &&
      (nextAlarmAtMs === null ||
        seatDepartures.nextAtMs < nextAlarmAtMs)
    ) {
      nextAlarmAtMs = seatDepartures.nextAtMs;
    }

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
      fanout:
        schedules.size +
        Number(rocketFeed.delivered || 0) +
        Number(customerServiceMic.expired || 0) +
        Number(seatDepartures.processed || 0),
      onlineCount: this.#presenceSnapshot().length,
    });
  }
}
