import fs from "node:fs";
import { performance } from "node:perf_hooks";
import { sign } from "node:crypto";
import { issueRealtimeAdmission } from "../cloudflare-worker/src/realtime-admission.js";

const workerBase = process.env.SHADOW_WORKER_URL || "https://shadow-live.ashraf-business-440.workers.dev";
const shardIndex = Number(process.env.SHARD_INDEX || 0);
const shardCount = Number(process.env.SHARD_COUNT || 10);
const users = Number(process.env.VUS_PER_SHARD || 500);
const roomsPerShard = Number(process.env.ROOMS_PER_SHARD || 10);
const rampMs = Number(process.env.RAMP_MS || 10000);
const holdMs = Number(process.env.HOLD_MS || 30000);
const runId = String(process.env.GITHUB_RUN_ID || Date.now());
const zegoServerSecret = String(process.env.ZEGO_SERVER_SECRET || "").trim();

let sa = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT || "{}");
if (typeof sa === "string") sa = JSON.parse(sa);
const projectId = String(sa.project_id || "");
const clientEmail = String(sa.client_email || "");
const privateKey = String(sa.private_key || "").replace(/\\n/g, "\n");

const firebaseOptions = fs.readFileSync("lib/firebase_options.dart", "utf8");
const apiKey = firebaseOptions.match(/apiKey:\s*'([^']+)'/)?.[1] || "";

const controlUid = `ci_step12_rt_control_${runId}_${shardIndex}`;
const vuUids = Array.from({ length: users }, (_, i) => `ci_step12_rt_${runId}_${shardIndex}_${i}`);
const vuTokens = new Array(users).fill("");
const roomIds = Array.from(
  { length: roomsPerShard },
  (_, i) => `ci_step12_rt_${runId}_${shardIndex}_${i}`,
);

const ticketLatencies = [];
const connectLatencies = [];
const ticketStatuses = new Map();
const diagnostics = [];
const activeEvents = [];
const failedUsers = new Set();
const records = [];
let earlyCloses = 0;
let pingFailures = 0;
let presenceMismatches = 0;
let presenceFailures = 0;
let fatalError = "";
let controlIdToken = "";
let accessToken = "";
let plannedClosing = false;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function b64url(value) {
  return Buffer.from(value).toString("base64")
    .replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}

async function googleAccessToken() {
  if (!projectId || !clientEmail || !privateKey) {
    throw new Error("invalid_service_account");
  }
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const payload = b64url(JSON.stringify({
    iss: clientEmail,
    scope: "https://www.googleapis.com/auth/datastore",
    aud: "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3600,
  }));
  const unsigned = `${header}.${payload}`;
  const signature = sign("RSA-SHA256", Buffer.from(unsigned), privateKey);
  const assertion = `${unsigned}.${b64url(signature)}`;
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
    }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || !body.access_token) {
    throw new Error(`google_oauth_failed_${res.status}`);
  }
  return body.access_token;
}

function customToken(targetUid) {
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const payload = b64url(JSON.stringify({
    iss: clientEmail,
    sub: clientEmail,
    aud: "https://identitytoolkit.googleapis.com/google.identity.identitytoolkit.v1.IdentityToolkit",
    iat: now,
    exp: now + 3600,
    uid: targetUid,
  }));
  const unsigned = `${header}.${payload}`;
  const signature = sign("RSA-SHA256", Buffer.from(unsigned), privateKey);
  return `${unsigned}.${b64url(signature)}`;
}

async function firebaseIdToken(targetUid) {
  if (!apiKey) throw new Error("firebase_api_key_missing");
  let lastStatus = 0;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const res = await fetch(
      `https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=${encodeURIComponent(apiKey)}`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token: customToken(targetUid), returnSecureToken: true }),
      },
    );
    const body = await res.json().catch(() => ({}));
    lastStatus = res.status;
    if (res.ok && body.idToken) return body.idToken;
    if (![429, 500, 502, 503, 504].includes(res.status)) break;
    await sleep(250 * (2 ** attempt));
  }
  throw new Error(`custom_token_exchange_failed_${lastStatus}`);
}

async function prepareVuTokens() {
  let cursor = 0;
  const workers = Array.from({ length: Math.min(25, users) }, async () => {
    while (true) {
      const i = cursor++;
      if (i >= users) return;
      try {
        vuTokens[i] = await firebaseIdToken(vuUids[i]);
      } catch (error) {
        failedUsers.add(i);
        if (diagnostics.length < 20) {
          diagnostics.push({ type: "auth", vuIndex: i, message: String(error?.message || error) });
        }
      }
    }
  });
  await Promise.all(workers);
}

function encodeValue(value) {
  if (value === null || value === undefined) return { nullValue: null };
  if (value instanceof Date) return { timestampValue: value.toISOString() };
  if (typeof value === "boolean") return { booleanValue: value };
  if (typeof value === "string") return { stringValue: value };
  if (typeof value === "number") {
    return Number.isInteger(value)
      ? { integerValue: String(value) }
      : { doubleValue: value };
  }
  return { stringValue: String(value) };
}

async function fsSet(path, fields) {
  const root = `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(projectId)}/databases/(default)/documents`;
  const res = await fetch(`${root}/${path}`, {
    method: "PATCH",
    headers: {
      authorization: `Bearer ${accessToken}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      fields: Object.fromEntries(
        Object.entries(fields).map(([k, v]) => [k, encodeValue(v)]),
      ),
    }),
  });
  if (!res.ok) throw new Error(`firestore_set_failed_${res.status}`);
}

async function fsDelete(path) {
  if (!accessToken) return;
  const root = `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(projectId)}/databases/(default)/documents`;
  const res = await fetch(`${root}/${path}`, {
    method: "DELETE",
    headers: { authorization: `Bearer ${accessToken}` },
  }).catch(() => null);
  if (res && !res.ok && res.status !== 404) {
    diagnostics.push({ type: "cleanup", path, status: res.status });
  }
}

async function deleteAuthUser(token) {
  if (!token || !apiKey) return;
  await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:delete?key=${encodeURIComponent(apiKey)}`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ idToken: token }),
    },
  ).catch(() => {});
}

async function deleteAuthUsers(tokens) {
  let cursor = 0;
  const clean = Array.from(new Set(tokens.filter(Boolean)));
  const workers = Array.from({ length: Math.min(25, clean.length) }, async () => {
    while (true) {
      const i = cursor++;
      if (i >= clean.length) return;
      await deleteAuthUser(clean[i]);
    }
  });
  await Promise.all(workers);
}

async function realtimePost(body, token = controlIdToken) {
  const res = await fetch(`${workerBase}/api/room-realtime`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      origin: "https://ashrafbusiness440-eng.github.io",
      "user-agent": "ShadowLive-Step12-Realtime/1.0",
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
        uid: vuUids[vuIndex],
        roomId,
        displayName: `Step12 User ${shardIndex}-${vuIndex}`,
      },
    );
    ticket = await realtimePost(
      { action: "ticket", roomId, realtimeAdmission },
      vuTokens[vuIndex],
    );
  } catch (error) {
    failedUsers.add(vuIndex);
    if (diagnostics.length < 20) {
      diagnostics.push({ type: "ticket_network", vuIndex, message: String(error?.message || error) });
    }
    return null;
  }

  const ticketMs = performance.now() - ticketStart;
  ticketLatencies.push(ticketMs);
  ticketStatuses.set(ticket.res.status, (ticketStatuses.get(ticket.res.status) || 0) + 1);
  if (!ticket.res.ok || ticket.body?.ok !== true || !ticket.body?.socketPath) {
    failedUsers.add(vuIndex);
    if (diagnostics.length < 20) {
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
    socketError: false,
  };
  records.push(record);

  socket.addEventListener("error", () => {
    record.socketError = true;
  });
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
    if (diagnostics.length < 20) {
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
        if (diagnostics.length < 20) {
          diagnostics.push({ type: "ping", phase, vuIndex: record.vuIndex, roomId: record.roomId });
        }
      }
      resolve(ok);
    };
    record.socket.addEventListener("message", onMessage);
    record.socket.addEventListener("close", onClose);
    record.socket.addEventListener("error", onError);
    try {
      record.socket.send("ping");
    } catch {
      finish(false);
    }
  });
}

async function checkPresence(label) {
  const active = records.filter((r) => r.ready && !r.closed && r.socket.readyState === WebSocket.OPEN);
  const expected = Object.fromEntries(roomIds.map((roomId) => [roomId, 0]));
  for (const record of active) expected[record.roomId] += 1;

  const started = performance.now();
  let out;
  try {
    out = await realtimePost({ action: "presenceCounts", roomIds });
  } catch (error) {
    presenceFailures += 1;
    if (diagnostics.length < 20) {
      diagnostics.push({ type: "presence_network", label, message: String(error?.message || error) });
    }
    return { ok: false, latencyMs: performance.now() - started };
  }
  const latencyMs = performance.now() - started;
  if (!out.res.ok || out.body?.ok !== true) {
    presenceFailures += 1;
    if (diagnostics.length < 20) {
      diagnostics.push({ type: "presence_http", label, status: out.res.status, code: String(out.body?.code || "") });
    }
    return { ok: false, latencyMs };
  }

  const counts = out.body?.counts || {};
  let mismatches = 0;
  for (const roomId of roomIds) {
    if (Number(counts[roomId] ?? -1) !== Number(expected[roomId])) {
      mismatches += 1;
      if (diagnostics.length < 20) {
        diagnostics.push({
          type: "presence_mismatch",
          label,
          roomId,
          expected: expected[roomId],
          actual: counts[roomId] ?? null,
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
  accessToken = await googleAccessToken();

  await Promise.all(roomIds.map((roomId, i) => fsSet(`rooms/${roomId}`, {
    name: `Shadow Live Step12 RT ${shardIndex}-${i}`,
    isActive: true,
    isHidden: true,
    visibility: "hidden",
    pressureTest: true,
    ownerUid: controlUid,
    createdAt: new Date(),
  })));

  controlIdToken = await firebaseIdToken(controlUid);
  await prepareVuTokens();
  if (vuTokens.filter(Boolean).length !== users) throw new Error("vu_auth_tokens_incomplete");

  await Promise.all(Array.from({ length: users }, (_, i) => openVu(i)));

  initialPresence = await checkPresence("initial");
  await Promise.all(records.filter((r) => r.ready && !r.closed).map((r) => pingSocket(r, "initial")));

  await sleep(holdMs);

  finalPresence = await checkPresence("final");
  await Promise.all(records.filter((r) => r.ready && !r.closed).map((r) => pingSocket(r, "final")));
} catch (error) {
  fatalError = String(error?.message || error);
  if (diagnostics.length < 20) diagnostics.push({ type: "fatal", message: fatalError });
} finally {
  plannedClosing = true;
  for (const record of records) {
    if (!record.closed) {
      try { record.socket.close(1000, "step12_realtime_done"); } catch {}
    }
  }
  await sleep(1000);
  for (const roomId of roomIds) await fsDelete(`rooms/${roomId}`);
  await deleteAuthUsers([controlIdToken, ...vuTokens]);
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
  rooms: roomIds.length,
  uniqueAuthUsers: vuTokens.filter(Boolean).length,
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

fs.writeFileSync(`step12-realtime-shard-${shardIndex}.json`, JSON.stringify(result));
console.log("STEP12_REALTIME_SHARD " + JSON.stringify({
  ...result,
  ticketLatencies: undefined,
  connectLatencies: undefined,
  activeEvents: undefined,
}));
