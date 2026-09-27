import assert from "node:assert/strict";
import test from "node:test";

import { computeSystemHealth } from "../../cloudflare-worker/src/system-health.js";

test("System Health is green for healthy pressure", () => {
  const out = computeSystemHealth({
    requests: 100,
    status429: 0,
    status5xx: 0,
    quotaEvents: 0,
    retries: 0,
    reconnects: 0,
    p95Ms: 400,
    p99Ms: 900,
    loadRatio: 1,
  });
  assert.equal(out.score, 100);
  assert.equal(out.level, "green");
});

test("System Health becomes yellow for elevated latency/load", () => {
  const out = computeSystemHealth({
    requests: 100,
    status429: 0,
    status5xx: 0,
    quotaEvents: 0,
    retries: 0,
    reconnects: 0,
    p95Ms: 2300,
    p99Ms: 4500,
    loadRatio: 1.8,
  });
  assert.ok(out.score >= 50 && out.score < 80);
  assert.equal(out.level, "yellow");
});

test("System Health becomes red for quota and rate limiting", () => {
  const out = computeSystemHealth({
    requests: 100,
    status429: 5,
    status5xx: 2,
    quotaEvents: 1,
    retries: 8,
    reconnects: 20,
    p95Ms: 2500,
    p99Ms: 5000,
    loadRatio: 3,
  });
  assert.ok(out.score < 50);
  assert.equal(out.level, "red");
  assert.ok(out.reasons.some((reason) => reason.includes("quota")));
});
