const REQUEST_CONTEXT = new WeakMap();

const clean = (value, fallback = "") =>
  String(value ?? fallback).trim().slice(0, 160);

function finite(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function statusClass(status) {
  const value = Math.max(0, Math.trunc(finite(status)));
  if (value >= 500) return "5xx";
  if (value >= 400) return "4xx";
  if (value >= 300) return "3xx";
  if (value >= 200) return "2xx";
  if (value >= 100) return "1xx";
  return "unknown";
}

export function annotatePressureRequest(request, patch = {}) {
  if (!request || typeof request !== "object") return {};
  const current = REQUEST_CONTEXT.get(request) || {};
  const next = {
    ...current,
    ...patch,
  };
  REQUEST_CONTEXT.set(request, next);
  return next;
}

export function pressureRequestContext(request) {
  return REQUEST_CONTEXT.get(request) || {};
}

export function writePressureDataPoint(env, {
  kind = "event",
  primary = "",
  action = "",
  outcome = "",
  method = "",
  colo = "",
  durationMs = 0,
  reads = 0,
  writes = 0,
  retries = 0,
  error = 0,
  quota = 0,
  reconnect = 0,
  onlineCount = 0,
  fanout = 0,
} = {}) {
  const binding = env?.PRESSURE_ANALYTICS;
  if (!binding || typeof binding.writeDataPoint !== "function") return false;

  const safeKind = clean(kind, "event") || "event";
  const safePrimary = clean(primary, "unknown") || "unknown";
  const safeAction = clean(action);
  const safeOutcome = clean(outcome);
  const safeMethod = clean(method);
  const safeColo = clean(colo);
  const samplingKey = clean(
    [safeKind, safePrimary, safeAction].filter(Boolean).join(":"),
    safeKind,
  ).slice(0, 96);

  try {
    binding.writeDataPoint({
      blobs: [
        safeKind,
        safePrimary,
        safeAction,
        safeOutcome,
        safeMethod,
        safeColo,
      ],
      doubles: [
        1,
        Math.max(0, finite(durationMs)),
        Math.max(0, finite(reads)),
        Math.max(0, finite(writes)),
        Math.max(0, finite(retries)),
        error ? 1 : 0,
        quota ? 1 : 0,
        reconnect ? 1 : 0,
        Math.max(0, finite(onlineCount)),
        Math.max(0, finite(fanout)),
      ],
      indexes: [samplingKey],
    });
    return true;
  } catch {
    // Telemetry must never affect the product path.
    return false;
  }
}

export function recordRequestTelemetry(
  request,
  env,
  response,
  startedAtMs = Date.now(),
  error = null,
) {
  const url = new URL(request.url);
  const context = pressureRequestContext(request);
  const status = Number(response?.status || error?.status || 0);
  const route = clean(context.route || url.pathname, "unknown");
  const action = clean(context.action);
  const durationMs = Math.max(0, Date.now() - Number(startedAtMs || Date.now()));
  const quota =
    status === 429 ||
    clean(error?.code || error?.message).includes("firestore_quota_exhausted");
  const isError = Boolean(error) || status >= 500;

  writePressureDataPoint(env, {
    kind: "request",
    primary: route,
    action,
    outcome: status ? String(status) : "threw",
    method: request.method,
    colo: clean(request?.cf?.colo),
    durationMs,
    error: isError,
    quota,
    reconnect: Number(context.reconnectAttempt || 0) > 0,
    fanout: Math.max(0, Number(context.fanout || 0)),
  });

  if (isError || status === 429) {
    const requestId = clean(request.headers.get("cf-ray"));
    console.error(JSON.stringify({
      kind: "shadow_request_error",
      requestId,
      route,
      action,
      method: request.method,
      status,
      durationMs,
      code: clean(error?.code || error?.message || ""),
    }));
  }
}

export function recordFirestoreTelemetry(env, {
  operation = "unknown",
  status = 0,
  durationMs = 0,
  reads = 0,
  writes = 0,
  attempts = 1,
  quota = false,
  circuitOpen = false,
  error = false,
} = {}) {
  const retries = Math.max(0, Number(attempts || 1) - 1);
  writePressureDataPoint(env, {
    kind: "firestore",
    primary: clean(operation, "unknown"),
    action: circuitOpen ? "circuit_open" : "",
    outcome: status ? String(status) : (error ? "error" : "ok"),
    method: "",
    durationMs,
    reads,
    writes,
    retries,
    error,
    quota,
  });
}

export function recordRealtimeTelemetry(env, {
  event = "unknown",
  outcome = "ok",
  durationMs = 0,
  reconnect = false,
  onlineCount = 0,
  fanout = 0,
  error = false,
} = {}) {
  writePressureDataPoint(env, {
    kind: "realtime",
    primary: "room_do",
    action: clean(event, "unknown"),
    outcome: clean(outcome),
    durationMs,
    reconnect,
    onlineCount,
    fanout,
    error,
  });
}

export const PRESSURE_ANALYTICS_SCHEMA = Object.freeze({
  blobs: [
    "kind",
    "primary",
    "action",
    "outcome",
    "method",
    "colo",
  ],
  doubles: [
    "count",
    "duration_ms",
    "firestore_reads_estimate",
    "firestore_writes_estimate",
    "retries",
    "error_flag",
    "quota_flag",
    "reconnect_flag",
    "online_count",
    "fanout",
  ],
});
