import fs from "node:fs";
import { performance } from "node:perf_hooks";
import admin from "firebase-admin";
import { normalizeRoomRocketConfig } from "../cloudflare-worker/src/room-rocket.js";

const base = process.env.SHADOW_WORKER_URL || "https://shadow-live.ashraf-business-440.workers.dev";
let sa = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT || "{}");
if (typeof sa === "string") sa = JSON.parse(sa);
if (!sa?.project_id || !sa?.client_email || !sa?.private_key) {
  throw new Error("firebase_service_account_missing");
}
admin.initializeApp({ credential: admin.credential.cert(sa) });
const db = admin.firestore();
const auth = admin.auth();
const stamp = Date.now();
const senderUid = `ci_step12_hot_sender_${stamp}`;
const receiverUid = `ci_step12_hot_receiver_${stamp}`;
const roomId = `ci_step12_hot_room_${stamp}`;
const agencyId = `ci_step12_hot_agency_${stamp}`;
const firebaseOptions = fs.readFileSync("lib/firebase_options.dart", "utf8");
const apiKey = firebaseOptions.match(/apiKey:\s*'([^']+)'/)?.[1] || "";
if (!apiKey) throw new Error("firebase_api_key_missing");

async function idToken(uid) {
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
  if (!response.ok || !body.idToken) throw new Error(`token_exchange_failed_${response.status}`);
  return body.idToken;
}
function pct(values, p) {
  const sorted = [...values].sort((a,b)=>a-b);
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * p) - 1))] || 0;
}
async function openRoomSocket(token) {
  if (typeof WebSocket !== "function") throw new Error("node_websocket_unavailable");
  const ticketResponse = await fetch(base + "/api/room-realtime", {
    method: "POST",
    headers: {
      authorization: "Bearer " + token,
      "content-type": "application/json",
      origin: "https://ashrafbusiness440-eng.github.io",
    },
    body: JSON.stringify({ action: "ticket", roomId }),
  });
  const ticket = await ticketResponse.json().catch(() => ({}));
  if (!ticketResponse.ok || ticket?.ok !== true || !ticket?.socketPath) {
    throw new Error("room_ticket_failed:" + ticketResponse.status);
  }
  const url = new URL(ticket.socketPath, base);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  const socket = new WebSocket(url.toString());
  const ready = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("room_socket_ready_timeout")), 10000);
    socket.addEventListener("message", (event) => {
      let body = null;
      try { body = JSON.parse(String(event?.data || "")); } catch {}
      if (body?.type === "server.ready" && body?.payload?.roomId === roomId) {
        clearTimeout(timer);
        resolve();
      }
    });
    socket.addEventListener("error", () => {
      clearTimeout(timer);
      reject(new Error("room_socket_error"));
    }, { once: true });
  });
  await new Promise((resolve, reject) => {
    if (socket.readyState === WebSocket.OPEN) return resolve();
    const timer = setTimeout(() => reject(new Error("room_socket_open_timeout")), 10000);
    socket.addEventListener("open", () => {
      clearTimeout(timer);
      resolve();
    }, { once: true });
    socket.addEventListener("error", () => {
      clearTimeout(timer);
      reject(new Error("room_socket_open_error"));
    }, { once: true });
  });
  await ready;
  return socket;
}

function periods(date = new Date()) {
  const day = date.toISOString().slice(0,10);
  const month = day.slice(0,7);
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const weekday = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - weekday);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const week = Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
  const cycle = month + "-" + (date.getUTCDate() <= 15 ? "C1" : "C2");
  return {
    day,
    week: d.getUTCFullYear() + "-W" + String(week).padStart(2,"0"),
    month,
    cycle,
  };
}

const [catalogSnap, rocketSnap] = await Promise.all([
  db.collection("system_config").doc("gift_catalog").get(),
  db.collection("system_config").doc("room_rocket").get(),
]);
const gifts = Array.isArray(catalogSnap.data()?.gifts) ? catalogSnap.data().gifts : [];
const gift = gifts
  .filter((g) => g?.enabled !== false && Number.isSafeInteger(Number(g?.priceCoins)) && Number(g.priceCoins) > 0)
  .sort((a,b)=>Number(a.priceCoins)-Number(b.priceCoins))[0] ||
  { id: "rose", priceCoins: 100 };
const rocket = normalizeRoomRocketConfig(rocketSnap.data() || {});
const firstThreshold = Math.max(1, Number(rocket.levels?.[0]?.thresholdCoins || 10000));
const unitCoins = Number(gift.priceCoins);
const giftCount = Math.max(3, Math.min(8, Math.floor((firstThreshold - 1) / Math.max(1, unitCoins))));
if (giftCount < 3) throw new Error("rocket_threshold_too_low_for_bounded_test");
const openingCoins = Math.max(1000000, unitCoins * giftCount * 20);
const p = periods();
const keys = Array.from({ length: giftCount }, (_, i) => `step12_hot_${stamp}_${i}`);
const latencies = [];
const statuses = new Map();
let token = "";
let receiverToken = "";
let roomSocket = null;
let receiverRoomSocket = null;

try {
  await Promise.all([
    db.collection("users").doc(senderUid).set({
      displayName: "Step12 Hot Sender",
      role: "user",
      accountStatus: "active",
      coins: openingCoins,
      diamonds: 0,
    }),
    db.collection("users").doc(receiverUid).set({
      displayName: "Step12 Hot Receiver",
      role: "user",
      accountStatus: "active",
      coins: 0,
      diamonds: 0,
      agencyId,
      pendingGiftEarningCoins: 0,
    }),
    db.collection("rooms").doc(roomId).set({
      name: "Step12 Hot Document Measurement",
      ownerUid: receiverUid,
      isActive: true,
      isHidden: true,
      pressureTest: true,
    }),
    db.collection("room_rocket_state").doc(roomId).set({
      cycleNumber: 1,
      levelIndex: 0,
      currentLevel: 1,
      progressCoins: 0,
      levelThresholdCoins: firstThreshold,
      levelContributors: {},
      queueAvailableAtMs: 0,
      explosionSequence: 0,
    }),
  ]);
  [token, receiverToken] = await Promise.all([
    idToken(senderUid),
    idToken(receiverUid),
  ]);
  [roomSocket, receiverRoomSocket] = await Promise.all([
    openRoomSocket(token),
    openRoomSocket(receiverToken),
  ]);

  const results = await Promise.all(keys.map(async (key) => {
    const started = performance.now();
    const response = await fetch(base + "/api/room-gift", {
      method: "POST",
      headers: {
        authorization: "Bearer " + token,
        "content-type": "application/json",
        origin: "https://ashrafbusiness440-eng.github.io",
      },
      body: JSON.stringify({
        roomId,
        receiverId: receiverUid,
        giftId: String(gift.id),
        quantity: 1,
        idempotencyKey: key,
      }),
    });
    const body = await response.json().catch(() => ({}));
    latencies.push(performance.now() - started);
    statuses.set(response.status, (statuses.get(response.status) || 0) + 1);
    return { response, body };
  }));

  const succeeded = results.filter((x) => x.response.ok && x.body?.ok === true);
  const failed = results.filter((x) => !x.response.ok || x.body?.ok !== true);
  if (succeeded.length === 0) {
    throw new Error(
      "all_gift_requests_failed:" +
      failed.map((x)=>x.response.status + ":" + String(x.body?.code || "")).join(","),
    );
  }

  const [
    roomAfter,
    rocketAfter,
    dailyAfter,
    agencyDailyAfter,
    agencyAccrualAfter,
    senderAfter,
  ] = await Promise.all([
    db.collection("rooms").doc(roomId).get(),
    db.collection("room_rocket_state").doc(roomId).get(),
    db.collection("rooms").doc(roomId).collection("support_daily").doc(p.day).get(),
    db.collection("agency_support_stats").doc(agencyId)
      .collection("daily").doc(p.day).get(),
    db.collection("agency_settlement_accruals")
      .doc(agencyId + "__" + p.cycle + "__" + receiverUid).get(),
    db.collection("users").doc(senderUid).get(),
  ]);
  const expected = unitCoins * succeeded.length;
  const roomData = roomAfter.data() || {};
  if (Number(rocketAfter.data()?.progressCoins || 0) !== expected) {
    throw new Error("rocket_progress_mismatch");
  }
  if (Number(dailyAfter.data()?.supportCoins || 0) !== expected) {
    throw new Error("daily_support_mismatch");
  }
  if (Number(senderAfter.data()?.coins || 0) !== openingCoins - expected) {
    throw new Error("sender_balance_mismatch");
  }
  if (Number(agencyDailyAfter.data()?.supportCoins || 0) !== expected) {
    throw new Error("agency_daily_support_mismatch");
  }
  if (Number(agencyAccrualAfter.data()?.supportCoins || 0) !== expected) {
    throw new Error("agency_settlement_accrual_mismatch");
  }
  for (const field of ["dailySupport","weeklySupport","monthlySupport","totalSupport"]) {
    if (Object.prototype.hasOwnProperty.call(roomData, field)) {
      throw new Error("room_root_support_fanout_regression:" + field);
    }
  }

  const result = {
    kind: "room_hot_documents",
    concurrentGifts: giftCount,
    successfulGifts: succeeded.length,
    failedGifts: failed.length,
    failureRate: Number((failed.length / Math.max(1, results.length)).toFixed(4)),
    failureCodes: failed.map((x) => ({
      status: x.response.status,
      code: String(x.body?.code || ""),
    })),
    unitCoins,
    totalCoins: expected,
    rocketThreshold: firstThreshold,
    statuses: Object.fromEntries(statuses),
    p50Ms: Number(pct(latencies,.50).toFixed(1)),
    p95Ms: Number(pct(latencies,.95).toFixed(1)),
    p99Ms: Number(pct(latencies,.99).toFixed(1)),
    roomRootSupportWrites: 0,
    rocketProgressCoins: Number(rocketAfter.data()?.progressCoins || 0),
    dailySupportCoins: Number(dailyAfter.data()?.supportCoins || 0),
    agencySupportCoins: Number(agencyDailyAfter.data()?.supportCoins || 0),
    agencyAccrualSupportCoins: Number(
      agencyAccrualAfter.data()?.supportCoins || 0,
    ),
  };
  fs.writeFileSync("step12-hotdocs.json", JSON.stringify(result, null, 2));
  console.log("STEP12_HOTDOCS " + JSON.stringify(result));
} finally {
  if (roomSocket) {
    try { roomSocket.close(1000, "step12_hotdocs_done"); } catch {}
  }
  if (receiverRoomSocket) {
    try { receiverRoomSocket.close(1000, "step12_hotdocs_done"); } catch {}
  }
  await Promise.all(keys.flatMap((key) => [
    db.collection("gift_operations").doc(key).delete().catch(()=>{}),
    db.collection("gift_transactions").doc(key).delete().catch(()=>{}),
    db.collection("financial_ledger").doc("gift_" + key).delete().catch(()=>{}),
    db.collection("financial_ledger").doc("gift_earnings_" + key).delete().catch(()=>{}),
  ]));
  if (typeof db.recursiveDelete === "function") {
    await Promise.all([
      db.recursiveDelete(db.collection("rooms").doc(roomId)).catch(()=>{}),
      db.recursiveDelete(db.collection("gift_user_stats").doc(receiverUid)).catch(()=>{}),
      db.recursiveDelete(db.collection("public_gift_showcases").doc(receiverUid)).catch(()=>{}),
      db.recursiveDelete(db.collection("agency_support_stats").doc(agencyId)).catch(()=>{}),
    ]);
  } else {
    await db.collection("rooms").doc(roomId).delete().catch(()=>{});
  }
  await Promise.all([
    db.collection("room_rocket_state").doc(roomId).delete().catch(()=>{}),
    db.collection("agency_settlement_accruals")
      .doc(agencyId + "__" + p.cycle + "__" + receiverUid)
      .delete().catch(()=>{}),
    db.collection("users").doc(senderUid).delete().catch(()=>{}),
    db.collection("users").doc(receiverUid).delete().catch(()=>{}),
    auth.deleteUser(senderUid).catch(()=>{}),
    auth.deleteUser(receiverUid).catch(()=>{}),
  ]);
}
