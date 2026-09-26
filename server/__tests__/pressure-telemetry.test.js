import assert from "node:assert/strict";
import test from "node:test";

import {
  PRESSURE_LOG_SCHEMA,
  annotatePressureRequest,
  pressureRequestContext,
  recordFirestoreTelemetry,
  recordRequestTelemetry,
  writePressureDataPoint,
} from "../../cloudflare-worker/src/pressure-telemetry.js";

async function captureLogs(callback) {
  const logs = [];
  const errors = [];
  const originalLog = console.log;
  const originalError = console.error;
  console.log = (value) => logs.push(value);
  console.error = (value) => errors.push(value);
  try {
    await callback();
  } finally {
    console.log = originalLog;
    console.error = originalError;
  }
  return { logs, errors };
}

test("pressure log schema stays stable and privacy-safe", () => {
  assert.deepEqual(PRESSURE_LOG_SCHEMA, [
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
  const serialized = JSON.stringify(PRESSURE_LOG_SCHEMA);
  for (const forbidden of [
    "uid",
    "roomId",
    "displayName",
    "profileImageUrl",
    "idempotencyKey",
    "coins",
    "diamonds",
    "authorization",
  ]) {
    assert.equal(serialized.includes(forbidden), false);
  }
});

test("request telemetry context merges action fanout and reconnect attempt", () => {
  const request = new Request("https://example.test/api/room-realtime", {
    method: "POST",
  });
  annotatePressureRequest(request, {
    route: "/api/room-realtime",
    action: "ticket",
  });
  annotatePressureRequest(request, {
    reconnectAttempt: 2,
    fanout: 12,
  });
  assert.deepEqual(pressureRequestContext(request), {
    route: "/api/room-realtime",
    action: "ticket",
    reconnectAttempt: 2,
    fanout: 12,
  });
});

test("pressure telemetry emits structured Workers Logs fields", async () => {
  const { logs } = await captureLogs(() => {
    const event = writePressureDataPoint({}, {
      kind: "request",
      primary: "/api/room-realtime",
      action: "presenceCounts",
      outcome: "200",
      method: "POST",
      durationMs: 25,
      fanout: 24,
    });
    assert.equal(event.kind, "shadow_pressure");
  });

  assert.equal(logs.length, 1);
  assert.deepEqual(logs[0], {
    kind: "shadow_pressure",
    pressureKind: "request",
    primary: "/api/room-realtime",
    action: "presenceCounts",
    outcome: "200",
    method: "POST",
    colo: "",
    durationMs: 25,
    firestoreReadsEstimate: 0,
    firestoreWritesEstimate: 0,
    retries: 0,
    errorFlag: 0,
    quotaFlag: 0,
    reconnectFlag: 0,
    onlineCount: 0,
    fanout: 24,
  });
});

test("Firestore telemetry maps logical read write retry and quota metrics", async () => {
  const { logs } = await captureLogs(() => {
    recordFirestoreTelemetry({}, {
      operation: "run_query",
      status: 429,
      durationMs: 1200,
      reads: 7,
      writes: 0,
      attempts: 2,
      quota: true,
      circuitOpen: true,
      error: true,
    });
  });

  assert.equal(logs.length, 1);
  assert.equal(logs[0].pressureKind, "firestore");
  assert.equal(logs[0].primary, "run_query");
  assert.equal(logs[0].action, "circuit_open");
  assert.equal(logs[0].outcome, "429");
  assert.equal(logs[0].firestoreReadsEstimate, 7);
  assert.equal(logs[0].firestoreWritesEstimate, 0);
  assert.equal(logs[0].retries, 1);
  assert.equal(logs[0].errorFlag, 1);
  assert.equal(logs[0].quotaFlag, 1);
});

test("normalized Firestore quota context is counted on HTTP 503", async () => {
  const request = new Request("https://example.test/api/app-assets");
  annotatePressureRequest(request, {
    route: "/api/app-assets",
    action: "list",
    quota: true,
  });

  const { logs, errors } = await captureLogs(() => {
    recordRequestTelemetry(
      request,
      {},
      new Response("quota", { status: 503 }),
      Date.now() - 10,
    );
  });

  assert.equal(logs.length, 1);
  assert.equal(logs[0].outcome, "503");
  assert.equal(logs[0].quotaFlag, 1);
  assert.equal(logs[0].errorFlag, 1);
  assert.equal(errors.length, 1);
  assert.equal(errors[0].kind, "shadow_request_error");
});

test("telemetry remains safe when console logging throws", () => {
  const originalLog = console.log;
  console.log = () => {
    throw new Error("log_failed");
  };
  try {
    assert.equal(
      writePressureDataPoint({}, {
        kind: "request",
        primary: "/api/test",
        durationMs: 10,
      }),
      null,
    );
  } finally {
    console.log = originalLog;
  }
});
