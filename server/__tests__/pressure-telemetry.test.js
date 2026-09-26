import assert from "node:assert/strict";
import test from "node:test";

import {
  PRESSURE_ANALYTICS_SCHEMA,
  annotatePressureRequest,
  pressureRequestContext,
  recordFirestoreTelemetry,
  recordRequestTelemetry,
  writePressureDataPoint,
} from "../../cloudflare-worker/src/pressure-telemetry.js";

function analyticsEnv() {
  const points = [];
  return {
    points,
    env: {
      PRESSURE_ANALYTICS: {
        writeDataPoint(point) {
          points.push(point);
        },
      },
    },
  };
}

test("pressure telemetry schema stays stable and privacy-safe", () => {
  assert.deepEqual(PRESSURE_ANALYTICS_SCHEMA.blobs, [
    "kind",
    "primary",
    "action",
    "outcome",
    "method",
    "colo",
  ]);
  assert.deepEqual(PRESSURE_ANALYTICS_SCHEMA.doubles, [
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
  ]);
  const serialized = JSON.stringify(PRESSURE_ANALYTICS_SCHEMA);
  for (const forbidden of [
    "uid",
    "roomId",
    "displayName",
    "profileImageUrl",
    "idempotencyKey",
    "coins",
    "diamonds",
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

test("request telemetry writes one non-blocking analytics point", () => {
  const { env, points } = analyticsEnv();
  const request = new Request("https://example.test/api/room-realtime", {
    method: "POST",
  });
  annotatePressureRequest(request, {
    route: "/api/room-realtime",
    action: "presenceCounts",
    reconnectAttempt: 0,
    fanout: 24,
  });

  recordRequestTelemetry(
    request,
    env,
    new Response("ok", { status: 200 }),
    Date.now() - 25,
  );

  assert.equal(points.length, 1);
  assert.equal(points[0].blobs[0], "request");
  assert.equal(points[0].blobs[1], "/api/room-realtime");
  assert.equal(points[0].blobs[2], "presenceCounts");
  assert.equal(points[0].blobs[3], "200");
  assert.equal(points[0].doubles[0], 1);
  assert.ok(points[0].doubles[1] >= 0);
  assert.equal(points[0].doubles[7], 0);
  assert.equal(points[0].doubles[9], 24);
  assert.equal(points[0].indexes.length, 1);
});

test("Firestore telemetry maps logical read write retry and quota metrics", () => {
  const { env, points } = analyticsEnv();

  recordFirestoreTelemetry(env, {
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

  assert.equal(points.length, 1);
  assert.equal(points[0].blobs[0], "firestore");
  assert.equal(points[0].blobs[1], "run_query");
  assert.equal(points[0].blobs[2], "circuit_open");
  assert.equal(points[0].blobs[3], "429");
  assert.equal(points[0].doubles[2], 7);
  assert.equal(points[0].doubles[3], 0);
  assert.equal(points[0].doubles[4], 1);
  assert.equal(points[0].doubles[5], 1);
  assert.equal(points[0].doubles[6], 1);
});

test("missing Analytics Engine binding is a safe no-op", () => {
  assert.equal(
    writePressureDataPoint({}, {
      kind: "request",
      primary: "/api/test",
      durationMs: 10,
    }),
    false,
  );
});

test("normalized Firestore quota context is counted on HTTP 503", () => {
  const { env, points } = analyticsEnv();
  const request = new Request("https://example.test/api/app-assets");
  annotatePressureRequest(request, {
    route: "/api/app-assets",
    action: "list",
    quota: true,
  });
  recordRequestTelemetry(
    request,
    env,
    new Response("quota", { status: 503 }),
    Date.now() - 10,
  );
  assert.equal(points.length, 1);
  assert.equal(points[0].blobs[3], "503");
  assert.equal(points[0].doubles[6], 1);
});

