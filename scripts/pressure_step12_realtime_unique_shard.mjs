import fs from "node:fs";
import { performance } from "node:perf_hooks";
import {
  deleteAuthUser,
  firebaseIdToken,
  firestoreDelete,
  firestoreSet,
  googleDatastoreAccessToken,
  loadFirebaseTestIdentity,
  mapLimit,
} from "./pressure_step12_realtime_identity.mjs";
import { issueRealtimeAdmission } from "../cloudflare-worker/src/realtime-admission.js";

const workerBase = process.env.SHADOW_WORKER_URL || "https://shadow-live.ashraf-business-440.workers.dev";
const shardIndex = Number(process.env.SHARD_INDEX || 0);
const shardCount = Number(process.env.SHARD_COUNT || 10);
const users = Number(process.env.VUS_PER_SHARD || 500);
const roomsPerShard = Number(process.env.ROOMS_PER_SHARD || 10);
const rampMs = Number(process.env.RAMP_MS || 15000);
const holdMs = Number(process.env.HOLD_MS || 30000);
const syncAtMs = Number(process.env.SYNC_AT_MS || 0);
const runId = String(process.env.GITHUB_RUN_ID || Date.now());
const zegoServerSecret = String(process.env.ZEGO_SERVER_SECRET || "").trim();

const identity = loadFirebaseTestIdentity();
const uidPrefix = `ci_step12_rt_${runId}_${shardIndex}`;
const uids = Array.from({ length: users }, (_, i) => `${uidPrefix}_${i}`);
const roomIds = Array.from(
  { length: roomsPerShard },
  (_, i) => `ci_step12_rt_${runId}_${shardIndex}_${i}`,
);

const ticketLatencies = [];
const connectLatencies = [];
const ticketStatuses = new Map();
const activeEvents = [];
const diagnostics = [];
const failedUsers = new Set();
const records = [];
let idTokens = [];
let accessToken = "";
let plannedClosing = false;
let earlyCloses = 0;
let pingFailures = 0;
let presenceFailures = 0;
let presenceMismatches = 0;
let fatalError = "";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function realtimePost(body, token) {
  const res = await fetch(`${workerBase}/api/room-realtime`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      origin: "https://ashrafbusiness440-eng.github.io",
      "user-agent": "ShadowLive-Step12-Realtime/2.0",
    },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  return { res, body: data };
}

function waitForSocketOpen(socket, timeoutMs = 12000) {
  if (socket.readyState === WebSocket.OPEN) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error("websocket_open_timeout"));
    }, timeoutMs);
    const onOpen = () => { cleanup(); resolve(); };
    const onError = () => { cleanup(); reject(new Error("websocket_open_failed")); };
    const cleanup = () => {
      clearTimeout(timer);
      socket.removeEventListener("open", onOpen);
      socket.removeEventListener("error", onError);
    };
    socket.addEventListener("open", onOpen);
    socket.addEventListener("error", onError);
  });
}

function waitForReady(socket, roomId, timeoutMs = 12000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error("server_ready_timeout"));
    }, timeoutMs);
    const onMessage = (event) => {
      let data;
      try { data = JSON.parse(String(event?.data || "")); } catch { return; }
      if (data?.type !== "server.ready" || data?.payload?.roomId !== roomId) return;
      cleanup();
      resolve(data);
    };
    const onClose = () => { cleanup(); reject(new Error("socket_closed_before_ready")); };
    const onError = () => { cleanup(); reject(new Error("socket_error_before_ready")); };
    const cleanup = () => {
      clearTimeout(timer);
      socket.removeEventListener("message", onMessage);
      socket.removeEventListener("close", onClose);
      socket.removeEventListener("error", onError);
    };
    socket.addEventListener("message", onMessage);
    socket.addEventListener("close", onClose);
    socket.addEventListener("error", onError);
  });
}

async function openVu(vuIndex) {
  const offset = users <= 1 ? 0 : Math.floor((vuIndex / (users - 1)) * rampMs);
  await sleep(offset);
  const roomId = roomIds[vuIndex % roomIds.length];
  const ticketStart = performance.now();

  let ticket;
  try {
    const realtimeAdmission = issueRealtimeAdmission(
      zegoServerSecret,
      {
        uid: uids[vuIndex],
        roomId,
        displayName: `Step12 User ${shardIndex}-${vuIndex}`,
      },
    );
    ticket = await realtimePost(
      { action: "ticket", roomId, realtimeAdmission },
      idTokens[vuIndex],
    );
  } catch (error) {
    failedUsers.add(vuIndex);
    if (diagnostics.length < 24) {
      diagnostics.push({ type: "ticket_network", vuIndex, message: String(error?.message || error) });
    }
    return null;
  }

  ticketLatencies.push(performance.now() - ticketStart);
  ticketStatuses.set(ticket.res.status, (ticketStatuses.get(ticket.res.status) || 0) + 1);

  if (!ticket.res.ok || ticket.body?.ok !== true || !ticket.body?.socketPath) {
    failedUsers.add(vuIndex);
    if (diagnostics.length < 24) {
      diagnostics.push({
        type: "ticket_http",
        vuIndex,
        status: ticket.res.status,
        code: String(ticket.body?.code || ""),
      });
    }
    return null;
  }

  const socketUrl = new URL(ticket.body.socketPath, workerBase);
  socketUrl.protocol = socketUrl.protocol === "https:" ? "wss:" : "ws:";
  const socket = new WebSocket(socketUrl.toString());
  const record = {
    vuIndex,
    roomId,
    socket,
    ready: false,
    closed: false,
    closeMarked: false,
  };
  records.push(record);

  socket.addEventListener("close", () => {
    record.closed = true;
    if (record.ready && !record.closeMarked) {
      record.closeMarked = true;
      activeEvents.push([Date.now(), -1]);
      if (!plannedClosing) {
        earlyCloses += 1;
        failedUsers.add(vuIndex);
      }
    }
  });

  const connectStart = performance.now();
  try {
    const readyPromise = waitForReady(socket, roomId);
    await waitForSocketOpen(socket);
    await readyPromise;
    if (socket.readyState !== WebSocket.OPEN) throw new Error("socket_not_open_after_ready");
    record.ready = true;
    activeEvents.push([Date.now(), 1]);
    connectLatencies.push(performance.now() - connectStart);
    return record;
  } catch (error) {
    failedUsers.add(vuIndex);
    if (diagnostics.length < 24) {
      diagnostics.push({ type: "connect", vuIndex, roomId, message: String(error?.message || error) });
    }
    try { socket.close(1011, "pressure_connect_failed"); } catch {}
    return null;
  }
}

function pingSocket(record, phase) {
  if (!record || record.closed || record.socket.readyState !== WebSocket.OPEN) {
    if (record) failedUsers.add(record.vuIndex);
    pingFailures += 1;
    return Promise.resolve(false);
  }
  return new Promise((resolve) => {
    let done = false;
    const timer = setTimeout(() => finish(false), 5000);
    const onMessage = (event) => {
      if (String(event?.data || "") === "pong") finish(true);
    };
    const onClose = () => finish(false);
    const onError = () => finish(false);
    const finish = (ok) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      record.socket.removeEventListener("message", onMessage);
      record.socket.removeEventListener("close", onClose);
      record.socket.removeEventListener("error", onError);
      if (!ok) {
        pingFailures += 1;
        failedUsers.add(record.vuIndex);
        if (diagnostics.length < 24) {
          diagnostics.push({ type: "ping", phase, vuIndex: record.vuIndex, roomId: record.roomId });
        }
      }
      resolve(ok);
    };
    record.socket.addEventListener("message", onMessage);
    record.socket.addEventListener("close", onClose);
    record.socket.addEventListener("error", onError);
    try { record.socket.send("ping"); } catch { finish(false); }
  });
}

async function checkPresence(label) {
  const active = records.filter(
    (r) => r.ready && !r.closed && r.socket.readyState === WebSocket.OPEN,
  );
  const expected = Object.fromEntries(roomIds.map((roomId) => [roomId, 0]));
  for (const record of active) expected[record.roomId] += 1;

  const started = performance.now();
  let out;
  try {
    out = await realtimePost(
      { action: "presenceCounts", roomIds },
      idTokens[0],
    );
  } catch (error) {
    presenceFailures += 1;
    if (diagnostics.length < 24) {
      diagnostics.push({ type: "presence_network", label, message: String(error?.message || error) });
    }
    return { ok: false, latencyMs: performance.now() - started };
  }

  const latencyMs = performance.now() - started;
  if (!out.res.ok || out.body?.ok !== true) {
    presenceFailures += 1;
    if (diagnostics.length < 24) {
      diagnostics.push({ type: "presence_http", label, status: out.res.status, code: String(out.body?.code || "") });
    }
    return { ok: false, latencyMs };
  }

  const counts = out.body?.counts || {};
  let mismatches = 0;
  for (const roomId of roomIds) {
    const actual = Number(counts[roomId] ?? -1);
    if (actual !== Number(expected[roomId])) {
      mismatches += 1;
      if (diagnostics.length < 24) {
        diagnostics.push({
          type: "presence_mismatch",
          label,
          roomId,
          expected: expected[roomId],
          actual,
        });
      }
    }
  }
  presenceMismatches += mismatches;
  return { ok: mismatches === 0, latencyMs };
}

let initialPresence = null;
let finalPresence = null;

try {
  if (typeof WebSocket !== "function") throw new Error("node_websocket_unavailable");
  if (!zegoServerSecret) throw new Error("zego_server_secret_missing");

  accessToken = await googleDatastoreAccessToken(identity);

  await Promise.all(roomIds.map((roomId, i) => firestoreSet(
    identity,
    accessToken,
    `rooms/${roomId}`,
    {
      name: `Shadow Live Step12 RT ${shardIndex}-${i}`,
      isActive: true,
      isHidden: true,
      visibility: "hidden",
      pressureTest: true,
      ownerUid: uids[0],
      createdAt: new Date(),
    },
  )));

  idTokens = await mapLimit(
    uids,
    10,
    async (uid) => firebaseIdToken(identity, uid),
  );

  if (syncAtMs > Date.now()) {
    await sleep(syncAtMs - Date.now());
  }

  await Promise.all(Array.from({ length: users }, (_, i) => openVu(i)));

  initialPresence = await checkPresence("initial");
  await Promise.all(
    records.filter((r) => r.ready && !r.closed).map((r) => pingSocket(r, "initial")),
  );

  await sleep(holdMs);

  finalPresence = await checkPresence("final");
  await Promise.all(
    records.filter((r) => r.ready && !r.closed).map((r) => pingSocket(r, "final")),
  );
} catch (error) {
  fatalError = String(error?.message || error);
  if (diagnostics.length < 24) diagnostics.push({ type: "fatal", message: fatalError });
} finally {
  plannedClosing = true;
  for (const record of records) {
    if (!record.closed) {
      try { record.socket.close(1000, "step12_realtime_done"); } catch {}
    }
  }
  await sleep(1000);

  for (const roomId of roomIds) {
    try {
      await firestoreDelete(identity, accessToken, `rooms/${roomId}`);
    } catch (error) {
      if (diagnostics.length < 24) {
        diagnostics.push({ type: "room_cleanup", roomId, message: String(error?.message || error) });
      }
    }
  }

  await mapLimit(
    idTokens,
    20,
    async (token) => deleteAuthUser(identity, token),
  );
}

for (const record of records) {
  if (record.ready && !record.closed) {
    failedUsers.add(record.vuIndex);
    if (!record.closeMarked) {
      record.closeMarked = true;
      activeEvents.push([Date.now(), -1]);
    }
  }
}

const result = {
  shardIndex,
  shardCount,
  users,
  uniqueAuthUsers: idTokens.length,
  rooms: roomIds.length,
  readyConnections: records.filter((r) => r.ready).length,
  successfulUsers: users - failedUsers.size,
  failedUsers: failedUsers.size,
  earlyCloses,
  pingFailures,
  presenceFailures,
  presenceMismatches,
  fatalError,
  ticketStatuses: Object.fromEntries(ticketStatuses),
  ticketLatencies: ticketLatencies.map((v) => Number(v.toFixed(1))),
  connectLatencies: connectLatencies.map((v) => Number(v.toFixed(1))),
  activeEvents,
  initialPresence,
  finalPresence,
  diagnostics,
};

fs.writeFileSync(
  `step12-realtime-shard-${shardIndex}.json`,
  JSON.stringify(result),
);

console.log("STEP12_REALTIME_UNIQUE_SHARD " + JSON.stringify({
  ...result,
  ticketLatencies: undefined,
  connectLatencies: undefined,
  activeEvents: undefined,
}));
