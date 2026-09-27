import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { computeSystemHealth } from "../../cloudflare-worker/src/system-health-score.js";

test("System Health stays green for a clean low-latency window", () => {
  const health = computeSystemHealth({
    current: {
      requests: 100,
      requestsPerMinute: 20,
      status429: 0,
      status5xx: 0,
      quotaEvents: 0,
      retries: 0,
      reconnects: 1,
      p95Ms: 220,
      p99Ms: 500,
    },
    baseline: { requestsPerMinute: 18 },
  });
  assert.equal(health.state, "green");
  assert.ok(health.score >= 80);
});

test("System Health turns yellow for elevated latency without quota errors", () => {
  const health = computeSystemHealth({
    current: {
      requests: 100,
      requestsPerMinute: 20,
      status429: 0,
      status5xx: 0,
      quotaEvents: 0,
      retries: 2,
      reconnects: 2,
      p95Ms: 1800,
      p99Ms: 3000,
    },
    baseline: { requestsPerMinute: 18 },
  });
  assert.equal(health.state, "yellow");
  assert.ok(health.score >= 50 && health.score < 80);
});

test("429 or Firestore quota forces red state", () => {
  for (const current of [
    { requests: 40, requestsPerMinute: 8, status429: 1, quotaEvents: 0 },
    { requests: 40, requestsPerMinute: 8, status429: 0, quotaEvents: 1 },
  ]) {
    const health = computeSystemHealth({
      current: {
        p95Ms: 100,
        p99Ms: 200,
        retries: 0,
        reconnects: 0,
        status5xx: 0,
        ...current,
      },
      baseline: { requestsPerMinute: 8 },
    });
    assert.equal(health.state, "red");
    assert.ok(health.score < 50);
  }
});

test("System Health includes Firestore read/write rate deviation", () => {
  const health = computeSystemHealth({
    current: {
      requests: 40,
      requestsPerMinute: 8,
      firestoreReadsPerMinute: 35,
      firestoreWritesPerMinute: 18,
      status429: 0,
      status5xx: 0,
      quotaEvents: 0,
      retries: 0,
      reconnects: 0,
      p95Ms: 100,
      p99Ms: 200,
    },
    baseline: {
      requestsPerMinute: 8,
      firestoreReadsPerMinute: 10,
      firestoreWritesPerMinute: 5,
    },
  });
  assert.ok(health.score < 100);
  assert.equal(
    health.reasons.some((reason) => reason.includes("Firestore reads")),
    true,
  );
  assert.equal(
    health.reasons.some((reason) => reason.includes("Firestore writes")),
    true,
  );
});

test("System Health backend remains protected and server-side", () => {
  const source = readFileSync(
    new URL("../../cloudflare-worker/src/system-health.js", import.meta.url),
    "utf8",
  );
  assert.equal(source.includes('caps.includes("viewSystemHealth")'), true);
  assert.equal(source.includes('actor.role === "owner"'), true);
  assert.equal(source.includes("PRESSURE_ANALYTICS_READ_TOKEN"), true);
  assert.equal(source.includes("PRESSURE_ANALYTICS_ACCOUNT_ID"), true);
  assert.equal(source.includes("SNAPSHOT_TTL_MS = 15_000"), true);
  assert.equal(source.includes("setInterval"), false);
  assert.equal(source.includes("FirebaseFirestore"), false);
});
