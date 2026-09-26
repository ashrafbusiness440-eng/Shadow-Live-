import fs from "node:fs";
import { performance } from "node:perf_hooks";
import admin from "firebase-admin";

const base = process.env.SHADOW_WORKER_URL || "https://shadow-live.ashraf-business-440.workers.dev";
const shardIndex = Number(process.env.SHARD_INDEX || 0);
const shardCount = Number(process.env.SHARD_COUNT || 10);
const users = Number(process.env.VUS_PER_SHARD || 500);
const durationMs = Number(process.env.DURATION_MS || 30000);
const rampMs = Number(process.env.RAMP_MS || 10000);
const intervalMs = Number(process.env.INTERVAL_MS || 5000);
const roomsPerRequest = Number(process.env.ROOMS_PER_REQUEST || 5);
const totalRooms = Number(process.env.TOTAL_SYNTHETIC_ROOMS || 20);
const roomIds = Array.from({ length: totalRooms }, (_, i) => `step12-load-room-${i}`);
const latencies = [];
const statuses = new Map();
const diagnostics = [];
let requests = 0;
let errors = 0;
let networkErrors = 0;
let semanticErrors = 0;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
function recordDiagnostic(value) {
  if (diagnostics.length < 12) diagnostics.push(value);
}
function parseServiceAccount() {
  let value = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT || "{}");
  if (typeof value === "string") value = JSON.parse(value);
  if (!value?.project_id || !value?.client_email || !value?.private_key) {
    throw new Error("firebase_service_account_missing");
  }
  return value;
}
function readWebApiKey() {
  const source = fs.readFileSync("lib/firebase_options.dart", "utf8");
  const match = source.match(/apiKey:\s*'([^']+)'/);
  if (!match) throw new Error("firebase_web_api_key_not_found");
  return match[1];
}
async function mintIdToken() {
  const serviceAccount = parseServiceAccount();
  const app = admin.apps.length
    ? admin.app()
    : admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
  const auth = app.auth();
  const uid = `ci-pressure-step12-realtime-${shardIndex}`;
  await auth.deleteUser(uid).catch((error) => {
    if (error?.code !== "auth/user-not-found") throw error;
  });
  const customToken = await auth.createCustomToken(uid);
  const response = await fetch(
    "https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=" +
      encodeURIComponent(readWebApiKey()),
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token: customToken, returnSecureToken: true }),
    },
  );
  const body = await response.json().catch(() => ({}));
  if (!response.ok || !body.idToken) {
    throw new Error(`custom_token_exchange_failed:${response.status}`);
  }
  return { auth, uid, idToken: body.idToken };
}
function selectedRooms(globalVu, iteration) {
  const start = (globalVu + iteration) % totalRooms;
  return Array.from(
    { length: roomsPerRequest },
    (_, offset) => roomIds[(start + offset) % totalRooms],
  );
}
function pct(values, p) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[
    Math.min(
      sorted.length - 1,
      Math.max(0, Math.ceil(sorted.length * p) - 1),
    )
  ] || 0;
}

const session = await mintIdToken();
const startedAt = Date.now();
const deadline = startedAt + rampMs + durationMs;

async function vu(vuIndex) {
  const globalVu = shardIndex * users + vuIndex;
  const offset = users <= 1 ? 0 : Math.floor((vuIndex / (users - 1)) * rampMs);
  await sleep(offset);
  let iteration = 0;
  while (Date.now() < deadline) {
    const start = performance.now();
    try {
      const response = await fetch(base + "/api/room-realtime", {
        method: "POST",
        cache: "no-store",
        headers: {
          accept: "application/json",
          authorization: "Bearer " + session.idToken,
          "content-type": "application/json",
          "user-agent": "ShadowLive-Step12-Realtime/1.0",
        },
        body: JSON.stringify({
          action: "presenceCounts",
          roomIds: selectedRooms(globalVu, iteration),
        }),
      });
      const text = await response.text();
      const latency = performance.now() - start;
      latencies.push(latency);
      requests += 1;
      statuses.set(response.status, (statuses.get(response.status) || 0) + 1);
      let parsed = null;
      try { parsed = JSON.parse(text); } catch {}
      if (!response.ok || parsed?.ok !== true) {
        errors += 1;
        if (response.ok) semanticErrors += 1;
        recordDiagnostic({
          type: response.ok ? "semantic" : "http",
          status: response.status,
          cfRay: response.headers.get("cf-ray") || "",
          server: response.headers.get("server") || "",
          body: text.slice(0, 240),
        });
      }
    } catch (error) {
      const latency = performance.now() - start;
      latencies.push(latency);
      requests += 1;
      errors += 1;
      networkErrors += 1;
      statuses.set(0, (statuses.get(0) || 0) + 1);
      recordDiagnostic({
        type: "network",
        name: String(error?.name || ""),
        message: String(error?.message || error || "").slice(0, 240),
        cause: String(error?.cause?.code || error?.cause?.message || "").slice(0, 240),
      });
    }
    iteration += 1;
    const jitter = globalVu % 750;
    await sleep(Math.max(250, intervalMs - 375 + jitter));
  }
}

try {
  await Promise.all(Array.from({ length: users }, (_, i) => vu(i)));
} finally {
  await session.auth.deleteUser(session.uid).catch(() => {});
}

const result = {
  kind: "realtime_presence_counts",
  shardIndex,
  shardCount,
  users,
  rampSec: rampMs / 1000,
  durationSec: durationMs / 1000,
  intervalMs,
  roomsPerRequest,
  totalSyntheticRooms: totalRooms,
  requests,
  errors,
  networkErrors,
  semanticErrors,
  errorRate: Number((errors / Math.max(1, requests)).toFixed(6)),
  p50Ms: Number(pct(latencies, 0.50).toFixed(1)),
  p95Ms: Number(pct(latencies, 0.95).toFixed(1)),
  p99Ms: Number(pct(latencies, 0.99).toFixed(1)),
  statuses: Object.fromEntries(statuses),
  diagnostics,
  latencies: latencies.map((value) => Number(value.toFixed(1))),
};
fs.writeFileSync(`step12-rt-shard-${shardIndex}.json`, JSON.stringify(result));
console.log("STEP12_REALTIME_5000_SHARD " + JSON.stringify({ ...result, latencies: undefined }));
