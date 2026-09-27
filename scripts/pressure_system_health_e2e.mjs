import fs from "node:fs";
import admin from "firebase-admin";

const workerBase =
  process.env.SHADOW_WORKER_URL ||
  "https://shadow-live.ashraf-business-440.workers.dev";

let serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT || "{}");
if (typeof serviceAccount === "string") {
  serviceAccount = JSON.parse(serviceAccount);
}
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

const firebaseOptions = fs.readFileSync("lib/firebase_options.dart", "utf8");
const apiKey = firebaseOptions.match(/apiKey:\s*'([^']+)'/)?.[1] || "";
if (!apiKey) throw new Error("firebase_web_api_key_not_found");

const uid = `ci_system_health_${Date.now()}`;
let idToken = "";

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
    throw new Error(
      `system_health_token_exchange_failed:${response.status}`,
    );
  }
  return body.idToken;
}

function finite(value, name) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw new Error(`invalid_${name}`);
  return parsed;
}

try {
  await db.collection("users").doc(uid).set({
    displayName: "Step12 System Health E2E",
    role: "user",
    adminEnabled: true,
    capabilities: ["viewSystemHealth"],
    accountStatus: "active",
    createdAt: new Date(),
  });

  idToken = await signIn();
  const response = await fetch(workerBase + "/api/system-health", {
    method: "GET",
    headers: {
      authorization: "Bearer " + idToken,
      origin: "https://ashrafbusiness440-eng.github.io",
      "cache-control": "no-cache",
    },
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || body?.ok !== true) {
    throw new Error(
      `system_health_endpoint_failed:${response.status}:${body?.code || "unknown"}`,
    );
  }

  const score = finite(body?.health?.score, "health_score");
  const state = String(body?.health?.state || "");
  if (score < 0 || score > 100) throw new Error("health_score_out_of_range");
  const expectedState = score >= 80 ? "green" : score >= 50 ? "yellow" : "red";
  if (state !== expectedState) {
    throw new Error(`health_threshold_mismatch:${score}:${state}`);
  }
  if (Number(body?.cacheSeconds) !== 15) {
    throw new Error("system_health_cache_ttl_mismatch");
  }

  for (const key of ["5m", "1h", "24h"]) {
    const window = body?.windows?.[key];
    if (!window || typeof window !== "object") {
      throw new Error(`missing_health_window:${key}`);
    }
    for (const metric of [
      "requestsPerMinute",
      "firestoreReadsPerMinute",
      "firestoreWritesPerMinute",
      "p95Ms",
      "p99Ms",
      "status429",
      "status5xx",
      "firestoreRetries",
      "realtimeReconnects",
    ]) {
      finite(window[metric], `${key}_${metric}`);
    }
  }

  if (!Array.isArray(body?.topEndpoints)) {
    throw new Error("missing_top_endpoints");
  }
  if (!Array.isArray(body?.topFirestore)) {
    throw new Error("missing_top_firestore");
  }

  console.log(
    "SYSTEM_HEALTH_PRODUCTION_E2E_OK " +
      JSON.stringify({
        score,
        state,
        reasons: Array.isArray(body?.health?.reasons)
          ? body.health.reasons.slice(0, 4)
          : [],
        fiveMinute: {
          requestsPerMinute: body.windows["5m"].requestsPerMinute,
          firestoreReadsPerMinute: body.windows["5m"].firestoreReadsPerMinute,
          firestoreWritesPerMinute: body.windows["5m"].firestoreWritesPerMinute,
          p95Ms: body.windows["5m"].p95Ms,
          p99Ms: body.windows["5m"].p99Ms,
          status429: body.windows["5m"].status429,
          status5xx: body.windows["5m"].status5xx,
          firestoreRetries: body.windows["5m"].firestoreRetries,
          realtimeReconnects: body.windows["5m"].realtimeReconnects,
        },
        topEndpoint: body.topEndpoints[0] || null,
      }),
  );
} finally {
  await db.collection("users").doc(uid).delete().catch(() => {});
  await auth.deleteUser(uid).catch(() => {});
}
