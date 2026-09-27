import fs from "node:fs";
import { performance } from "node:perf_hooks";
import admin from "firebase-admin";

const base = process.env.SHADOW_WORKER_URL || "https://shadow-live.ashraf-business-440.workers.dev";
const vus = Math.max(1, Math.min(50, Number(process.env.VUS || 20)));
const roomsPerRequest = 60;
const durationMs = Math.max(5000, Math.min(20000, Number(process.env.DURATION_MS || 10000)));
const intervalMs = Math.max(750, Number(process.env.INTERVAL_MS || 1500));
const roomIds = Array.from({ length: 60 }, (_, i) => `step12-home-fanout-${i}`);
const latencies = [];
const statuses = new Map();
let requests = 0;
let errors = 0;

let sa = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT || "{}");
if (typeof sa === "string") sa = JSON.parse(sa);
if (!sa?.project_id || !sa?.client_email || !sa?.private_key) {
  throw new Error("firebase_service_account_missing");
}
admin.initializeApp({ credential: admin.credential.cert(sa) });
const auth = admin.auth();
const uid = `ci_step12_home_${Date.now()}`;
const customToken = await auth.createCustomToken(uid);
const firebaseOptions = fs.readFileSync("lib/firebase_options.dart", "utf8");
const apiKey = firebaseOptions.match(/apiKey:\s*'([^']+)'/)?.[1] || "";
if (!apiKey) throw new Error("firebase_api_key_missing");

const signIn = await fetch(
  `https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=${encodeURIComponent(apiKey)}`,
  {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ token: customToken, returnSecureToken: true }),
  },
);
const signInBody = await signIn.json().catch(() => ({}));
if (!signIn.ok || !signInBody.idToken) {
  throw new Error(`custom_token_exchange_failed_${signIn.status}`);
}
const idToken = signInBody.idToken;

function pct(values, p) {
  const sorted = [...values].sort((a,b)=>a-b);
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * p) - 1))] || 0;
}
const deadline = Date.now() + durationMs;

async function vu(index) {
  await new Promise((resolve) => setTimeout(resolve, index * 25));
  while (Date.now() < deadline) {
    const start = performance.now();
    try {
      const response = await fetch(base + "/api/room-realtime", {
        method: "POST",
        cache: "no-store",
        headers: {
          authorization: "Bearer " + idToken,
          "content-type": "application/json",
          "user-agent": "ShadowLive-Step12-HomeFanout/1.0",
        },
        body: JSON.stringify({ action: "presenceCounts", roomIds }),
      });
      const body = await response.json().catch(() => ({}));
      latencies.push(performance.now() - start);
      requests += 1;
      statuses.set(response.status, (statuses.get(response.status) || 0) + 1);
      if (!response.ok || body?.ok !== true || Object.keys(body?.counts || {}).length !== 60) {
        errors += 1;
      }
    } catch {
      latencies.push(performance.now() - start);
      requests += 1;
      errors += 1;
      statuses.set(0, (statuses.get(0) || 0) + 1);
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}

try {
  await Promise.all(Array.from({ length: vus }, (_, i) => vu(i)));
} finally {
  await auth.deleteUser(uid).catch(() => {});
}

const result = {
  kind: "home_presenceCounts_60_do_fanout",
  vus,
  roomsPerRequest,
  durationSec: durationMs / 1000,
  requests,
  estimatedDoReads: requests * roomsPerRequest,
  errors,
  errorRate: Number((errors / Math.max(1, requests)).toFixed(6)),
  p50Ms: Number(pct(latencies, .50).toFixed(1)),
  p95Ms: Number(pct(latencies, .95).toFixed(1)),
  p99Ms: Number(pct(latencies, .99).toFixed(1)),
  statuses: Object.fromEntries(statuses),
};
fs.writeFileSync("step12-home-fanout.json", JSON.stringify(result, null, 2));
console.log("STEP12_HOME_FANOUT " + JSON.stringify(result));
if (errors > 0) process.exitCode = 1;
