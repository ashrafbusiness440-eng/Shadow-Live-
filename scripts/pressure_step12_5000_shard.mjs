import { performance } from "node:perf_hooks";
import fs from "node:fs";

const base = process.env.SHADOW_WORKER_URL || "https://shadow-live.ashraf-business-440.workers.dev";
const shardIndex = Number(process.env.SHARD_INDEX || 0);
const shardCount = Number(process.env.SHARD_COUNT || 10);
const users = Number(process.env.VUS_PER_SHARD || 500);
const durationMs = Number(process.env.DURATION_MS || 30000);
const rampMs = Number(process.env.RAMP_MS || 10000);
const latencies = [];
const statuses = new Map();
const diagnostics = [];
let requests = 0;
let errors = 0;
let networkErrors = 0;
const startedAt = Date.now();
const deadline = startedAt + rampMs + durationMs;

function sleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }

async function vu(vuIndex) {
  const globalVu = shardIndex * users + vuIndex;
  const offset = users <= 1 ? 0 : Math.floor((vuIndex / (users - 1)) * rampMs);
  await sleep(offset);
  while (Date.now() < deadline) {
    const start = performance.now();
    try {
      const res = await fetch(base + "/health?pressure_step12=5000&vu=" + globalVu, {
        cache: "no-store",
        headers: {
          "Accept": "application/json",
          "User-Agent": "ShadowLive-Step12-LoadTest/1.0",
        },
      });
      const body = await res.text();
      const latency = performance.now() - start;
      latencies.push(latency);
      requests += 1;
      statuses.set(res.status, (statuses.get(res.status) || 0) + 1);
      if (!res.ok) {
        errors += 1;
        if (diagnostics.length < 12) {
          diagnostics.push({
            type: "http",
            status: res.status,
            cfRay: res.headers.get("cf-ray") || "",
            server: res.headers.get("server") || "",
            body: body.slice(0, 240),
          });
        }
      }
    } catch (error) {
      const latency = performance.now() - start;
      latencies.push(latency);
      requests += 1;
      errors += 1;
      networkErrors += 1;
      statuses.set(0, (statuses.get(0) || 0) + 1);
      if (diagnostics.length < 12) {
        diagnostics.push({
          type: "network",
          name: String(error?.name || ""),
          message: String(error?.message || error || "").slice(0, 240),
          cause: String(error?.cause?.code || error?.cause?.message || "").slice(0, 240),
        });
      }
    }
    await sleep(1000);
  }
}

function pct(values, p) {
  const sorted = [...values].sort((a,b)=>a-b);
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * p) - 1))] || 0;
}

await Promise.all(Array.from({ length: users }, (_, i) => vu(i)));

const result = {
  shardIndex,
  shardCount,
  users,
  rampSec: rampMs / 1000,
  durationSec: durationMs / 1000,
  requests,
  errors,
  networkErrors,
  errorRate: Number((errors / Math.max(1, requests)).toFixed(6)),
  p50Ms: Number(pct(latencies, .50).toFixed(1)),
  p95Ms: Number(pct(latencies, .95).toFixed(1)),
  p99Ms: Number(pct(latencies, .99).toFixed(1)),
  statuses: Object.fromEntries(statuses),
  diagnostics,
  latencies: latencies.map((v) => Number(v.toFixed(1))),
};
fs.writeFileSync(`step12-shard-${shardIndex}.json`, JSON.stringify(result));
console.log("STEP12_5000_SHARD " + JSON.stringify({...result, latencies: undefined}));
