const REQUEST_CONTEXT = new WeakMap();

const clean = (value, fallback = "") =>
  String(value ?? fallback).trim().slice(0, 160);

function finite(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

export const PRESSURE_LOG_SCHEMA = Object.freeze([
  "kind",
  "pressureKind",
  "primary",
  "action",
  "outcome",
  "method",
  "colo",
  "durationMs",
  "firestoreReadsEstimate",
  "firestoreWritesEstimate",
  "retries",
  "errorFlag",
  "quotaFlag",
  "reconnectFlag",
  "onlineCount",
  "fanout",
]);

export function annotatePressureRequest(request, patch = {}) {
  if (!request || typeof request !== "object") return {};
  const current = REQUEST_CONTEXT.get(request) || {};
  const next = { ...current, ...patch };
  REQUEST_CONTEXT.set(request, next);
  return next;
}

export function pressureRequestContext(request) {
  return REQUEST_CONTEXT.get(request) || {};
}

export function writePressureDataPoint(_env, {
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
  const event = {
    kind: "shadow_pressure",
    pressureKind: clean(kind, "event") || "event",
    primary: clean(primary, "unknown") || "unknown",
    action: clean(action),
    outcome: clean(outcome),
    method: clean(method),
    colo: clean(colo),
    durationMs: Math.max(0, finite(durationMs)),
    firestoreReadsEstimate: Math.max(0, finite(reads)),
    firestoreWritesEstimate: Math.max(0, finite(writes)),
    retries: Math.max(0, finite(retries)),
    errorFlag: error ? 1 : 0,
    quotaFlag: quota ? 1 : 0,
    reconnectFlag: reconnect ? 1 : 0,
    onlineCount: Math.max(0, finite(onlineCount)),
    fanout: Math.max(0, finite(fanout)),
  };

  try {
    console.log(event);
    return event;
  } catch {
    // Observability must never affect the product path.
    return null;
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
    context.quota === true ||
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
    console.error({
      kind: "shadow_request_error",
      requestId: clean(request.headers.get("cf-ray")),
      route,
      action,
      method: request.method,
      status,
      durationMs,
      code: clean(error?.code || error?.message || ""),
    });
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
  writePressureDataPoint(env, {
    kind: "firestore",
    primary: clean(operation, "unknown"),
    action: circuitOpen ? "circuit_open" : "",
    outcome: status ? String(status) : (error ? "error" : "ok"),
    durationMs,
    reads,
    writes,
    retries: Math.max(0, Number(attempts || 1) - 1),
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
