import { json } from "./http.js";
import {
  assertUserDocumentSessionState,
  verifyFirebaseIdToken,
} from "./firebase-auth.js";
import { firestoreClient } from "./firestore.js";
import { computeSystemHealth } from "./system-health-score.js";

const DATASET = "shadow_live_pressure_v1";
const SNAPSHOT_TTL_MS = 15_000;
const ACCESS_TTL_MS = 60_000;

let snapshotCache = { expiresAtMs: 0, value: null };
let snapshotInflight = null;
const accessCache = new Map();

const clean = (value) => String(value ?? "").trim();

function number(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function round(value, digits = 2) {
  const scale = 10 ** digits;
  return Math.round(number(value) * scale) / scale;
}

async function analyticsSql(env, query) {
  const accountId = clean(env.PRESSURE_ANALYTICS_ACCOUNT_ID);
  const token = clean(env.PRESSURE_ANALYTICS_READ_TOKEN);
  if (!accountId || !token) {
    const error = new Error("system_health_not_configured");
    error.status = 503;
    throw error;
  }

  const response = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(accountId)}/analytics_engine/sql`,
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "text/plain; charset=utf-8",
      },
      body: `${query.trim()}\nFORMAT JSONEachRow`,
    },
  );
  const raw = await response.text();
  if (!response.ok) {
    const error = new Error("system_health_query_failed");
    error.status = response.status || 503;
    error.details = raw.slice(0, 240);
    throw error;
  }
  if (!raw.trim()) return [];
  return raw
    .trim()
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

function intervalWhere(minutes) {
  const bounded = Math.max(1, Math.min(1440, Number(minutes) || 5));
  return `timestamp >= NOW() - INTERVAL '${bounded}' MINUTE`;
}

async function kindRows(env, minutes) {
  return analyticsSql(env, `
    SELECT
      blob1 AS kind,
      SUM(_sample_interval * double1) AS events,
      SUM(_sample_interval * double3) AS reads,
      SUM(_sample_interval * double4) AS writes,
      SUM(_sample_interval * double5) AS retries,
      SUM(_sample_interval * double6) AS errors,
      SUM(_sample_interval * double7) AS quota_events,
      SUM(_sample_interval * double8) AS reconnects,
      SUM(_sample_interval * double10) AS fanout,
      quantileExactWeighted(0.50)(double2, _sample_interval) AS p50_ms,
      quantileExactWeighted(0.95)(double2, _sample_interval) AS p95_ms,
      quantileExactWeighted(0.99)(double2, _sample_interval) AS p99_ms
    FROM ${DATASET}
    WHERE ${intervalWhere(minutes)}
    GROUP BY kind
    ORDER BY events DESC
    LIMIT 64
  `);
}

async function statusRows(env, minutes) {
  return analyticsSql(env, `
    SELECT
      blob4 AS status,
      SUM(_sample_interval * double1) AS requests
    FROM ${DATASET}
    WHERE ${intervalWhere(minutes)} AND blob1 = 'request'
    GROUP BY status
    ORDER BY requests DESC
    LIMIT 64
  `);
}

async function topEndpointRows(env) {
  return analyticsSql(env, `
    SELECT
      blob2 AS route,
      blob3 AS action,
      SUM(_sample_interval * double1) AS requests,
      SUM(_sample_interval * double5) AS retries,
      SUM(_sample_interval * double8) AS reconnects,
      quantileExactWeighted(0.50)(double2, _sample_interval) AS p50_ms,
      quantileExactWeighted(0.95)(double2, _sample_interval) AS p95_ms,
      quantileExactWeighted(0.99)(double2, _sample_interval) AS p99_ms
    FROM ${DATASET}
    WHERE ${intervalWhere(5)} AND blob1 = 'request'
    GROUP BY route, action
    ORDER BY requests DESC
    LIMIT 12
  `);
}

async function topFirestoreRows(env) {
  return analyticsSql(env, `
    SELECT
      blob2 AS operation,
      blob7 AS resource,
      blob4 AS outcome,
      SUM(_sample_interval * double1) AS calls,
      SUM(_sample_interval * double3) AS reads,
      SUM(_sample_interval * double4) AS writes,
      SUM(_sample_interval * double5) AS retries,
      SUM(_sample_interval * double6) AS errors,
      SUM(_sample_interval * double7) AS quota_events,
      quantileExactWeighted(0.95)(double2, _sample_interval) AS p95_ms
    FROM ${DATASET}
    WHERE ${intervalWhere(5)} AND blob1 = 'firestore'
    GROUP BY operation, resource, outcome
    ORDER BY calls DESC
    LIMIT 20
  `);
}

function windowSummary(kindInput, statusInput, minutes) {
  const byKind = new Map(
    (Array.isArray(kindInput) ? kindInput : []).map((row) => [
      clean(row.kind),
      row,
    ]),
  );
  const request = byKind.get("request") || {};
  const firestore = byKind.get("firestore") || {};
  const realtime = byKind.get("realtime") || {};

  let status429 = 0;
  let status5xx = 0;
  for (const row of Array.isArray(statusInput) ? statusInput : []) {
    const status = clean(row.status);
    const count = number(row.requests);
    if (status === "429") status429 += count;
    if (/^5\d\d$/.test(status)) status5xx += count;
  }

  const requests = number(request.events);
  return {
    minutes,
    requests,
    requestsPerMinute: round(requests / Math.max(1, minutes), 3),
    status429,
    status5xx,
    retries: number(request.retries),
    reconnects: number(request.reconnects),
    errors: number(request.errors),
    quotaEvents: number(request.quota_events) + number(firestore.quota_events),
    p50Ms: round(request.p50_ms),
    p95Ms: round(request.p95_ms),
    p99Ms: round(request.p99_ms),
    firestoreReads: number(firestore.reads),
    firestoreWrites: number(firestore.writes),
    firestoreReadsPerMinute: round(
      number(firestore.reads) / Math.max(1, minutes),
      3,
    ),
    firestoreWritesPerMinute: round(
      number(firestore.writes) / Math.max(1, minutes),
      3,
    ),
    firestoreRetries: number(firestore.retries),
    firestoreErrors: number(firestore.errors),
    realtimeEvents: number(realtime.events),
    realtimeReconnects: number(realtime.reconnects),
    realtimeFanout: number(realtime.fanout),
  };
}

async function loadSnapshot(env) {
  const [
    kinds5,
    kinds60,
    kinds1440,
    statuses5,
    statuses60,
    statuses1440,
    endpointRows,
    firestoreRows,
  ] = await Promise.all([
    kindRows(env, 5),
    kindRows(env, 60),
    kindRows(env, 1440),
    statusRows(env, 5),
    statusRows(env, 60),
    statusRows(env, 1440),
    topEndpointRows(env),
    topFirestoreRows(env),
  ]);

  const windows = {
    "5m": windowSummary(kinds5, statuses5, 5),
    "1h": windowSummary(kinds60, statuses60, 60),
    "24h": windowSummary(kinds1440, statuses1440, 1440),
  };
  const topEndpoints = endpointRows.map((row) => ({
    route: clean(row.route),
    action: clean(row.action),
    requests: number(row.requests),
    retries: number(row.retries),
    reconnects: number(row.reconnects),
    p50Ms: round(row.p50_ms),
    p95Ms: round(row.p95_ms),
    p99Ms: round(row.p99_ms),
  }));
  const topFirestore = firestoreRows.map((row) => ({
    operation: clean(row.operation),
    resource: clean(row.resource),
    outcome: clean(row.outcome),
    calls: number(row.calls),
    reads: number(row.reads),
    writes: number(row.writes),
    retries: number(row.retries),
    errors: number(row.errors),
    quotaEvents: number(row.quota_events),
    p95Ms: round(row.p95_ms),
  }));

  const health = computeSystemHealth({
    current: windows["5m"],
    baseline: windows["1h"],
    topEndpoint: topEndpoints
      .slice()
      .sort((a, b) => b.p95Ms - a.p95Ms)[0] || null,
  });

  return {
    ok: true,
    generatedAt: new Date().toISOString(),
    cacheSeconds: SNAPSHOT_TTL_MS / 1000,
    health,
    windows,
    topEndpoints,
    topFirestore,
  };
}

async function cachedSnapshot(env) {
  const now = Date.now();
  if (snapshotCache.value && snapshotCache.expiresAtMs > now) {
    return snapshotCache.value;
  }
  if (!snapshotInflight) {
    snapshotInflight = loadSnapshot(env)
      .then((value) => {
        snapshotCache = {
          value,
          expiresAtMs: Date.now() + SNAPSHOT_TTL_MS,
        };
        return value;
      })
      .finally(() => {
        snapshotInflight = null;
      });
  }
  return snapshotInflight;
}

async function canViewSystemHealth(env, decoded) {
  const uid = clean(decoded?.sub);
  if (!uid) return false;
  const cached = accessCache.get(uid);
  const now = Date.now();
  if (cached && cached.expiresAtMs > now) return cached.allowed;

  const db = firestoreClient(env);
  const actorSnap = await db.get(`users/${uid}`);
  const actor = actorSnap.data || {};
  if (actorSnap.exists) {
    assertUserDocumentSessionState(decoded, actor);
  }
  const caps = Array.isArray(actor.capabilities) ? actor.capabilities : [];
  const allowed =
    actorSnap.exists &&
    (
      actor.role === "owner" ||
      (
        actor.adminEnabled === true &&
        caps.includes("viewSystemHealth")
      )
    );
  accessCache.set(uid, {
    allowed,
    expiresAtMs: now + ACCESS_TTL_MS,
  });
  return allowed;
}

export async function systemHealth(request, env) {
  if (request.method !== "GET") {
    return json(request, env, { ok: false, code: "method_not_allowed" }, 405);
  }

  try {
    const decoded = await verifyFirebaseIdToken(request, env, {
      checkUserState: false,
    });
    if (!(await canViewSystemHealth(env, decoded))) {
      return json(request, env, { ok: false, code: "forbidden" }, 403);
    }
    return json(request, env, await cachedSnapshot(env), 200);
  } catch (error) {
    const code = clean(error?.message) || "system_health_failed";
    if (code === "unauthorized") {
      return json(request, env, { ok: false, code }, 401);
    }
    const status = Number(error?.status || 0);
    return json(
      request,
      env,
      {
        ok: false,
        code,
      },
      status >= 400 && status <= 599 ? status : 503,
    );
  }
}
