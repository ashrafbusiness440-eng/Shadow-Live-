import fs from "node:fs";

const accountId = String(process.env.CLOUDFLARE_ACCOUNT_ID || "").trim();
const apiToken = String(process.env.CLOUDFLARE_API_TOKEN || "").trim();
const dataset = String(
  process.env.PRESSURE_DATASET || "shadow_live_pressure_v1",
).trim();
const windowMinutes = Math.max(
  5,
  Math.min(10080, Number.parseInt(process.env.WINDOW_MINUTES || "60", 10) || 60),
);

if (!accountId || !apiToken) {
  throw new Error("missing_cloudflare_analytics_credentials");
}
if (!/^[A-Za-z0-9_]+$/.test(dataset)) {
  throw new Error("invalid_analytics_dataset");
}

const endpoint =
  `https://api.cloudflare.com/client/v4/accounts/${accountId}/analytics_engine/sql`;

async function sql(query) {
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      authorization: `Bearer ${apiToken}`,
      "content-type": "text/plain; charset=utf-8",
    },
    body: `${query.trim()}\nFORMAT JSONEachRow`,
  });
  const body = await response.text();
  if (!response.ok) {
    const permissionHint =
      response.status === 403
        ? " (token needs Account | Account Analytics | Read)"
        : "";
    throw new Error(
      `analytics_sql_failed:${response.status}${permissionHint}:${body.slice(0, 600)}`,
    );
  }
  if (!body.trim()) return [];
  return body
    .trim()
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

const timeWhere =
  `timestamp >= NOW() - INTERVAL '${windowMinutes}' MINUTE`;

const [
  endpointRows,
  statusRows,
  minuteRows,
  firestoreRows,
  realtimeRows,
  kindRows,
] = await Promise.all([
  sql(`
    SELECT
      blob2 AS route,
      blob3 AS action,
      SUM(_sample_interval * double1) AS requests,
      SUM(_sample_interval * double5) AS retries,
      SUM(_sample_interval * double8) AS reconnects,
      SUM(_sample_interval * double6) AS errors,
      SUM(_sample_interval * double7) AS quota_events,
      quantileExactWeighted(0.5)(double2, _sample_interval) AS p50_ms,
      quantileExactWeighted(0.95)(double2, _sample_interval) AS p95_ms,
      quantileExactWeighted(0.99)(double2, _sample_interval) AS p99_ms
    FROM ${dataset}
    WHERE ${timeWhere} AND blob1 = 'request'
    GROUP BY route, action
    ORDER BY requests DESC
    LIMIT 500
  `),
  sql(`
    SELECT
      blob2 AS route,
      blob3 AS action,
      blob4 AS status,
      SUM(_sample_interval * double1) AS requests
    FROM ${dataset}
    WHERE ${timeWhere} AND blob1 = 'request'
    GROUP BY route, action, status
    ORDER BY requests DESC
    LIMIT 2000
  `),
  sql(`
    SELECT
      intDiv(toUInt32(timestamp), 60) * 60 AS minute_epoch,
      blob2 AS route,
      blob3 AS action,
      SUM(_sample_interval * double1) AS requests
    FROM ${dataset}
    WHERE ${timeWhere} AND blob1 = 'request'
    GROUP BY minute_epoch, route, action
    ORDER BY minute_epoch DESC, requests DESC
    LIMIT 5000
  `),
  sql(`
    SELECT
      blob2 AS operation,
      blob3 AS action,
      blob4 AS outcome,
      blob7 AS resource,
      SUM(_sample_interval * double1) AS calls,
      SUM(_sample_interval * double3) AS reads,
      SUM(_sample_interval * double4) AS writes,
      SUM(_sample_interval * double5) AS retries,
      SUM(_sample_interval * double6) AS errors,
      SUM(_sample_interval * double7) AS quota_events,
      quantileExactWeighted(0.5)(double2, _sample_interval) AS p50_ms,
      quantileExactWeighted(0.95)(double2, _sample_interval) AS p95_ms,
      quantileExactWeighted(0.99)(double2, _sample_interval) AS p99_ms
    FROM ${dataset}
    WHERE ${timeWhere} AND blob1 = 'firestore'
    GROUP BY operation, action, outcome, resource
    ORDER BY calls DESC
    LIMIT 1000
  `),
  sql(`
    SELECT
      blob3 AS event,
      blob4 AS outcome,
      SUM(_sample_interval * double1) AS events,
      SUM(_sample_interval * double8) AS reconnects,
      SUM(_sample_interval * double10) AS fanout,
      SUM(_sample_interval * double9) / SUM(_sample_interval) AS avg_online,
      quantileExactWeighted(0.5)(double2, _sample_interval) AS p50_ms,
      quantileExactWeighted(0.95)(double2, _sample_interval) AS p95_ms,
      quantileExactWeighted(0.99)(double2, _sample_interval) AS p99_ms
    FROM ${dataset}
    WHERE ${timeWhere} AND blob1 = 'realtime'
    GROUP BY event, outcome
    ORDER BY events DESC
    LIMIT 1000
  `),
  sql(`
    SELECT
      blob1 AS kind,
      blob2 AS primary_key,
      blob3 AS action,
      blob4 AS outcome,
      SUM(_sample_interval * double1) AS events,
      SUM(_sample_interval * double3) AS reads,
      SUM(_sample_interval * double4) AS writes,
      SUM(_sample_interval * double5) AS retries,
      SUM(_sample_interval * double6) AS errors,
      SUM(_sample_interval * double7) AS quota_events,
      SUM(_sample_interval * double8) AS reconnects,
      SUM(_sample_interval * double10) AS fanout
    FROM ${dataset}
    WHERE ${timeWhere}
    GROUP BY kind, primary_key, action, outcome
    ORDER BY events DESC
    LIMIT 3000
  `),
]);

const num = (value) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
};
const round = (value, digits = 2) => {
  const scale = 10 ** digits;
  return Math.round(num(value) * scale) / scale;
};
const keyFor = (row) =>
  `${String(row.route || "")}\u0000${String(row.action || "")}`;

const statusByEndpoint = new Map();
for (const row of statusRows) {
  const key = keyFor(row);
  const current = statusByEndpoint.get(key) || {
    status429: 0,
    status5xx: 0,
    byStatus: {},
  };
  const status = String(row.status || "");
  const count = num(row.requests);
  current.byStatus[status || "unknown"] =
    num(current.byStatus[status || "unknown"]) + count;
  if (status === "429") current.status429 += count;
  if (/^5\d\d$/.test(status)) current.status5xx += count;
  statusByEndpoint.set(key, current);
}

const endpoints = endpointRows.map((row) => {
  const status = statusByEndpoint.get(keyFor(row)) || {
    status429: 0,
    status5xx: 0,
    byStatus: {},
  };
  const requests = num(row.requests);
  return {
    route: String(row.route || ""),
    action: String(row.action || ""),
    requests,
    requestsPerMinute: round(requests / windowMinutes, 3),
    status429: status.status429,
    status5xx: status.status5xx,
    retries: num(row.retries),
    reconnects: num(row.reconnects),
    errors: num(row.errors),
    quotaEvents: num(row.quota_events),
    p50Ms: round(row.p50_ms),
    p95Ms: round(row.p95_ms),
    p99Ms: round(row.p99_ms),
    byStatus: status.byStatus,
  };
});

const report = {
  generatedAt: new Date().toISOString(),
  dataset,
  windowMinutes,
  endpoints,
  requestsByMinute: minuteRows.map((row) => ({
    minuteEpoch: num(row.minute_epoch),
    route: String(row.route || ""),
    action: String(row.action || ""),
    requests: num(row.requests),
  })),
  firestore: firestoreRows.map((row) => ({
    operation: String(row.operation || ""),
    action: String(row.action || ""),
    outcome: String(row.outcome || ""),
    resource: String(row.resource || ""),
    calls: num(row.calls),
    reads: num(row.reads),
    writes: num(row.writes),
    retries: num(row.retries),
    errors: num(row.errors),
    quotaEvents: num(row.quota_events),
    p50Ms: round(row.p50_ms),
    p95Ms: round(row.p95_ms),
    p99Ms: round(row.p99_ms),
  })),
  realtime: realtimeRows.map((row) => ({
    event: String(row.event || ""),
    outcome: String(row.outcome || ""),
    events: num(row.events),
    reconnects: num(row.reconnects),
    fanout: num(row.fanout),
    avgOnline: round(row.avg_online),
    p50Ms: round(row.p50_ms),
    p95Ms: round(row.p95_ms),
    p99Ms: round(row.p99_ms),
  })),
  allKinds: kindRows,
};

fs.writeFileSync(
  "pressure-report.json",
  JSON.stringify(report, null, 2) + "\n",
);

function table(headers, rows) {
  const esc = (value) => String(value ?? "").replaceAll("|", "\\|");
  return [
    `| ${headers.join(" | ")} |`,
    `| ${headers.map(() => "---").join(" | ")} |`,
    ...rows.map((row) => `| ${row.map(esc).join(" | ")} |`),
  ].join("\n");
}

const md = [
  "# Shadow Live Pressure Measurement",
  "",
  `Generated: ${report.generatedAt}`,
  `Window: last ${windowMinutes} minutes`,
  `Dataset: \`${dataset}\``,
  "",
  "## HTTP endpoints",
  "",
  table(
    ["Route", "Action", "Requests", "Req/min", "429", "5xx", "Retries", "Reconnects", "p50 ms", "p95 ms", "p99 ms"],
    endpoints.slice(0, 60).map((row) => [
      row.route,
      row.action,
      row.requests,
      row.requestsPerMinute,
      row.status429,
      row.status5xx,
      row.retries,
      row.reconnects,
      row.p50Ms,
      row.p95Ms,
      row.p99Ms,
    ]),
  ),
  "",
  "## Firestore operations",
  "",
  table(
    ["Operation", "Resource", "Action", "Outcome", "Calls", "Reads", "Writes", "Retries", "Quota", "p50 ms", "p95 ms", "p99 ms"],
    report.firestore.slice(0, 60).map((row) => [
      row.operation,
      row.resource,
      row.action,
      row.outcome,
      row.calls,
      row.reads,
      row.writes,
      row.retries,
      row.quotaEvents,
      row.p50Ms,
      row.p95Ms,
      row.p99Ms,
    ]),
  ),
  "",
  "## Realtime",
  "",
  table(
    ["Event", "Outcome", "Events", "Reconnects", "Fanout", "Avg online", "p50 ms", "p95 ms", "p99 ms"],
    report.realtime.slice(0, 60).map((row) => [
      row.event,
      row.outcome,
      row.events,
      row.reconnects,
      row.fanout,
      row.avgOnline,
      row.p50Ms,
      row.p95Ms,
      row.p99Ms,
    ]),
  ),
  "",
].join("\n");

fs.writeFileSync("pressure-report.md", md);

console.log(
  JSON.stringify(
    {
      ok: true,
      generatedAt: report.generatedAt,
      windowMinutes,
      endpointCount: endpoints.length,
      firestoreGroupCount: report.firestore.length,
      realtimeGroupCount: report.realtime.length,
      totalRequests: endpoints.reduce((sum, row) => sum + row.requests, 0),
      total429: endpoints.reduce((sum, row) => sum + row.status429, 0),
      total5xx: endpoints.reduce((sum, row) => sum + row.status5xx, 0),
      firestoreReads: report.firestore.reduce((sum, row) => sum + row.reads, 0),
      firestoreWrites: report.firestore.reduce((sum, row) => sum + row.writes, 0),
      firestoreRetries: report.firestore.reduce((sum, row) => sum + row.retries, 0),
      realtimeReconnects: report.realtime.reduce((sum, row) => sum + row.reconnects, 0),
    },
    null,
    2,
  ),
);
