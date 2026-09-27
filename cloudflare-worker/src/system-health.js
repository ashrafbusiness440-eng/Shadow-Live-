import { json } from "./http.js";
import {
  assertUserDocumentSessionState,
  verifyFirebaseIdToken,
} from "./firebase-auth.js";
import { firestoreClient } from "./firestore.js";

const cache = new Map();
const CACHE_TTL_MS = 15_000;
const ALLOWED_WINDOWS = new Set([5, 60, 1440]);

const clean = (value) => String(value ?? "").trim();
const num = (value) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
};
const round = (value, digits = 2) => {
  const scale = 10 ** digits;
  return Math.round(num(value) * scale) / scale;
};

async function analyticsSql(env, sql) {
  const accountId = clean(env.R2_ACCOUNT_ID || env.CLOUDFLARE_ACCOUNT_ID);
  const token = clean(env.CLOUDFLARE_ANALYTICS_READ_TOKEN);
  if (!accountId || !token) throw new Error("analytics_not_configured");
  const response = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(accountId)}/analytics_engine/sql`,
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "text/plain; charset=utf-8",
      },
      body: `${sql.trim()}\nFORMAT JSONEachRow`,
    },
  );
  const raw = await response.text();
  if (!response.ok) {
    throw new Error(`analytics_query_failed_${response.status}`);
  }
  if (!raw.trim()) return [];
  return raw.trim().split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
}

function scoreSnapshot(metrics) {
  let score = 100;
  const reasons = [];
  const requests = Math.max(0, num(metrics.requests));
  const status429 = Math.max(0, num(metrics.status429));
  const status5xx = Math.max(0, num(metrics.status5xx));
  const quotaEvents = Math.max(0, num(metrics.quotaEvents));
  const retries = Math.max(0, num(metrics.retries));
  const reconnects = Math.max(0, num(metrics.reconnects));
  const p95Ms = Math.max(0, num(metrics.p95Ms));
  const p99Ms = Math.max(0, num(metrics.p99Ms));
  const loadRatio = Math.max(0, num(metrics.loadRatio));
  const errorRate = requests > 0 ? status5xx / requests : 0;

  if (quotaEvents > 0) {
    score -= 50;
    reasons.push("Firestore quota/503");
  }
  if (status429 > 0) {
    score -= 30;
    reasons.push("HTTP 429");
  }
  if (errorRate >= 0.01) {
    score -= 25;
    reasons.push("5xx rate مرتفع");
  } else if (status5xx > 0) {
    score -= 15;
    reasons.push("وجود أخطاء 5xx");
  }
  if (p95Ms > 2000) {
    score -= 20;
    reasons.push("p95 أعلى من 2s");
  } else if (p95Ms > 1000) {
    score -= 10;
    reasons.push("p95 أعلى من 1s");
  }
  if (p99Ms > 4000) {
    score -= 10;
    reasons.push("p99 أعلى من 4s");
  }
  if (retries > 5) {
    score -= 10;
    reasons.push("Firestore retries مرتفعة");
  }
  if (reconnects > 10) {
    score -= 10;
    reasons.push("Realtime reconnects مرتفعة");
  }
  if (loadRatio > 2.5) {
    score -= 15;
    reasons.push("الطلبات أعلى بكثير من baseline");
  } else if (loadRatio > 1.5) {
    score -= 8;
    reasons.push("الطلبات أعلى من baseline");
  }

  score = Math.max(0, Math.min(100, Math.round(score)));
  const level = score >= 80 ? "green" : score >= 50 ? "yellow" : "red";
  return {
    score,
    level,
    reasons: reasons.length ? reasons : ["المؤشرات ضمن الحدود الطبيعية"],
  };
}

export function computeSystemHealth(metrics) {
  return { ...metrics, ...scoreSnapshot(metrics) };
}

async function querySnapshot(env, minutes) {
  const key = String(minutes);
  const now = Date.now();
  const cached = cache.get(key);
  if (cached && cached.expiresAtMs > now) return cached.value;

  const current = await analyticsSql(env, `
    SELECT
      SUMIf(_sample_interval * double1, blob1='request') AS requests,
      SUMIf(_sample_interval * double1, blob1='request' AND blob4='429') AS status429,
      SUMIf(_sample_interval * double1, blob1='request' AND startsWith(blob4,'5')) AS status5xx,
      SUMIf(_sample_interval * double3, blob1='firestore') AS firestoreReads,
      SUMIf(_sample_interval * double4, blob1='firestore') AS firestoreWrites,
      SUMIf(_sample_interval * double5, blob1='firestore') AS retries,
      SUMIf(_sample_interval * double7, blob1='firestore') AS quotaEvents,
      SUMIf(_sample_interval * double8, blob1='realtime') AS reconnects,
      quantileExactWeightedIf(0.95)(double2, _sample_interval, blob1='request') AS p95Ms,
      quantileExactWeightedIf(0.99)(double2, _sample_interval, blob1='request') AS p99Ms
    FROM shadow_live_pressure_v1
    WHERE timestamp >= NOW() - INTERVAL '${minutes}' MINUTE
  `);
  const baselineRows = await analyticsSql(env, `
    SELECT
      SUM(_sample_interval * double1) AS requests
    FROM shadow_live_pressure_v1
    WHERE timestamp >= NOW() - INTERVAL '60' MINUTE AND blob1='request'
  `);
  const row = current[0] || {};
  const baselineRequests = num(baselineRows[0]?.requests);
  const requests = num(row.requests);
  const rpm = requests / Math.max(1, minutes);
  const baselineRpm = baselineRequests / 60;
  const loadRatio = baselineRpm > 0 ? rpm / baselineRpm : 1;

  const snapshot = computeSystemHealth({
    generatedAt: new Date().toISOString(),
    windowMinutes: minutes,
    requests: Math.round(requests),
    requestsPerMinute: round(rpm, 3),
    firestoreReads: Math.round(num(row.firestoreReads)),
    firestoreWrites: Math.round(num(row.firestoreWrites)),
    firestoreReadsPerMinute: round(num(row.firestoreReads) / Math.max(1, minutes), 3),
    firestoreWritesPerMinute: round(num(row.firestoreWrites) / Math.max(1, minutes), 3),
    retries: Math.round(num(row.retries)),
    quotaEvents: Math.round(num(row.quotaEvents)),
    reconnects: Math.round(num(row.reconnects)),
    status429: Math.round(num(row.status429)),
    status5xx: Math.round(num(row.status5xx)),
    p95Ms: round(row.p95Ms),
    p99Ms: round(row.p99Ms),
    loadRatio: round(loadRatio, 2),
  });
  cache.set(key, { value: snapshot, expiresAtMs: now + CACHE_TTL_MS });
  return snapshot;
}

export async function systemHealth(request, env) {
  if (request.method !== "GET") {
    return json(request, env, { ok: false, code: "method_not_allowed" }, 405);
  }
  try {
    const decoded = await verifyFirebaseIdToken(request, env, {
      checkUserState: false,
    });
    const db = firestoreClient(env);
    const actorSnap = await db.get(`users/${decoded.sub}`);
    const actor = actorSnap.data || {};
    if (actorSnap.exists) assertUserDocumentSessionState(decoded, actor);
    const caps = Array.isArray(actor.capabilities) ? actor.capabilities : [];
    const allowed =
      actorSnap.exists &&
      actor.adminEnabled === true &&
      (actor.role === "owner" || caps.includes("viewSystemHealth"));
    if (!allowed) {
      return json(request, env, { ok: false, code: "forbidden" }, 403);
    }

    const url = new URL(request.url);
    const minutes = Number.parseInt(url.searchParams.get("minutes") || "5", 10);
    if (!ALLOWED_WINDOWS.has(minutes)) {
      return json(request, env, { ok: false, code: "invalid_window" }, 400);
    }
    const snapshot = await querySnapshot(env, minutes);
    return json(request, env, { ok: true, ...snapshot }, 200, {
      "Cache-Control": "private, max-age=10",
    });
  } catch (error) {
    const code = clean(error?.message);
    if (code === "unauthorized") {
      return json(request, env, { ok: false, code }, 401);
    }
    if (code === "analytics_not_configured") {
      return json(request, env, { ok: false, code }, 503);
    }
    return json(request, env, {
      ok: false,
      code: code || "system_health_failed",
    }, 500);
  }
}
