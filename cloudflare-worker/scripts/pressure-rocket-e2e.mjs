import fs from "node:fs";
import { performance } from "node:perf_hooks";
import admin from "firebase-admin";

const workerBase =
  process.env.SHADOW_WORKER_URL ||
  "https://shadow-live.ashraf-business-440.workers.dev";

let serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT || "{}");
if (typeof serviceAccount === "string") serviceAccount = JSON.parse(serviceAccount);
if (
  !serviceAccount.project_id ||
  !serviceAccount.client_email ||
  !serviceAccount.private_key
) {
  throw new Error("invalid_firebase_service_account");
}

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  projectId: serviceAccount.project_id,
});
const db = admin.firestore();
const auth = admin.auth();

const firebaseOptions = fs.readFileSync(
  new URL("../../lib/firebase_options.dart", import.meta.url),
  "utf8",
);
const apiKey = firebaseOptions.match(/apiKey:\s*'([^']+)'/)?.[1] || "";
if (!apiKey) throw new Error("firebase_web_api_key_not_found");

const stamp = Date.now();
const uid = `ci_step12_rocket_${stamp}`;
const roomId = `ci_step12_rocket_room_${stamp}`;
const explosionId = `ci_step12_rocket_explosion_${stamp}`;
let idToken = "";
let socket = null;

async function signIn() {
  const customToken = await auth.createCustomToken(uid);
  const response = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=${encodeURIComponent(apiKey)}`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token: customToken, returnSecureToken: true }),
    },
  );
  const body = await response.json().catch(() => ({}));
  if (!response.ok || !body.idToken) {
    throw new Error(`rocket_token_exchange_failed:${response.status}`);
  }
  return body.idToken;
}

async function openRoomSocket() {
  const ticketResponse = await fetch(workerBase + "/api/room-realtime", {
    method: "POST",
    headers: {
      authorization: "Bearer " + idToken,
      "content-type": "application/json",
      origin: "https://ashrafbusiness440-eng.github.io",
    },
    body: JSON.stringify({ action: "ticket", roomId }),
  });
  const ticket = await ticketResponse.json().catch(() => ({}));
  if (!ticketResponse.ok || ticket?.ok !== true || !ticket?.socketPath) {
    throw new Error(`rocket_room_ticket_failed:${ticketResponse.status}`);
  }

  const url = new URL(ticket.socketPath, workerBase);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  const ws = new WebSocket(url.toString());

  await new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error("rocket_socket_ready_timeout")),
      10000,
    );
    const cleanup = () => {
      clearTimeout(timer);
      ws.removeEventListener("message", onMessage);
      ws.removeEventListener("error", onError);
      ws.removeEventListener("close", onClose);
    };
    const onMessage = (event) => {
      let body = null;
      try {
        body = JSON.parse(String(event?.data || ""));
      } catch {
        return;
      }
      if (
        body?.type === "server.ready" &&
        body?.payload?.roomId === roomId
      ) {
        cleanup();
        resolve();
      }
    };
    const onError = () => {
      cleanup();
      reject(new Error("rocket_socket_error"));
    };
    const onClose = () => {
      cleanup();
      reject(new Error("rocket_socket_closed_before_ready"));
    };
    ws.addEventListener("message", onMessage);
    ws.addEventListener("error", onError);
    ws.addEventListener("close", onClose);
  });

  return ws;
}

function percentile(values, p) {
  const sorted = [...values].sort((a, b) => a - b);
  if (!sorted.length) return 0;
  return sorted[
    Math.min(
      sorted.length - 1,
      Math.max(0, Math.ceil(sorted.length * p) - 1),
    )
  ];
}

try {
  await Promise.all([
    db.collection("users").doc(uid).set({
      displayName: "Step12 Rocket Probe",
      role: "user",
      accountStatus: "active",
      coins: 0,
      diamonds: 0,
      createdAt: new Date(),
    }),
    db.collection("rooms").doc(roomId).set({
      name: "Step12 Rocket Probe Room",
      ownerUid: uid,
      isActive: true,
      isHidden: true,
      pressureTest: true,
      createdAt: new Date(),
    }),
    db.collection("room_rocket_explosions").doc(explosionId).set({
      explosionId,
      roomId,
      level: 1,
      startsAtMs: Date.now() - 5000,
      endsAtMs: Date.now() + 120000,
      contributorIds: [],
      top3: [],
      rewardPool: {},
      winProbabilityBps: 0,
      noWinMessageAr: "حظ أوفر في المرة القادمة",
      createdAt: new Date(),
    }),
  ]);

  idToken = await signIn();
  socket = await openRoomSocket();

  const latencies = [];
  const statuses = [];
  for (let index = 0; index < 5; index += 1) {
    const started = performance.now();
    const response = await fetch(workerBase + "/api/room-rocket", {
      method: "POST",
      headers: {
        authorization: "Bearer " + idToken,
        "content-type": "application/json",
        origin: "https://ashrafbusiness440-eng.github.io",
      },
      body: JSON.stringify({ action: "enter", explosionId }),
    });
    const body = await response.json().catch(() => ({}));
    latencies.push(performance.now() - started);
    statuses.push(response.status);
    if (!response.ok || body?.ok !== true) {
      throw new Error(
        `rocket_enter_failed:${response.status}:${body?.code || "unknown"}`,
      );
    }
  }

  const entry = await db.collection("room_rocket_explosions")
    .doc(explosionId).collection("entries").doc(uid).get();
  if (!entry.exists) throw new Error("rocket_entry_not_persisted");

  const result = {
    requests: latencies.length,
    statuses,
    p50Ms: Number(percentile(latencies, 0.50).toFixed(1)),
    p95Ms: Number(percentile(latencies, 0.95).toFixed(1)),
    p99Ms: Number(percentile(latencies, 0.99).toFixed(1)),
  };
  fs.writeFileSync(
    "step12-rocket-probe.json",
    JSON.stringify(result, null, 2) + "\n",
  );
  console.log("STEP12_ROCKET_PRODUCTION_OK " + JSON.stringify(result));
} finally {
  if (socket) {
    try {
      socket.close(1000, "step12_rocket_probe_done");
    } catch {}
  }
  await db.collection("room_rocket_explosions").doc(explosionId)
    .collection("entries").doc(uid).delete().catch(() => {});
  await Promise.all([
    db.collection("room_rocket_explosions").doc(explosionId).delete().catch(() => {}),
    db.collection("rooms").doc(roomId).delete().catch(() => {}),
    db.collection("users").doc(uid).delete().catch(() => {}),
  ]);
  await auth.deleteUser(uid).catch(() => {});
}
