import { performance } from "node:perf_hooks";

const base = "https://shadow-live.ashraf-business-440.workers.dev";
const users = 10;
const durationMs = 30_000;
const latencies = [];
const statuses = new Map();
let requests = 0;
let errors = 0;
const deadline = Date.now() + durationMs;

async function vu() {
  while (Date.now() < deadline) {
    const start = performance.now();
    try {
      const res = await fetch(base + "/health", { cache: "no-store" });
      await res.arrayBuffer();
      latencies.push(performance.now() - start);
      requests += 1;
      statuses.set(res.status, (statuses.get(res.status) || 0) + 1);
      if (!res.ok) errors += 1;
    } catch {
      latencies.push(performance.now() - start);
      requests += 1;
      errors += 1;
      statuses.set(0, (statuses.get(0) || 0) + 1);
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
}
function pct(p) {
  const sorted = [...latencies].sort((a,b)=>a-b);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * p) - 1)] || 0;
}
await Promise.all(Array.from({ length: users }, () => vu()));
const result = {
  users,
  durationSec: durationMs / 1000,
  requests,
  rps: Number((requests / (durationMs / 1000)).toFixed(2)),
  errors,
  errorRate: Number((errors / Math.max(1, requests)).toFixed(6)),
  p50Ms: Number(pct(.50).toFixed(1)),
  p95Ms: Number(pct(.95).toFixed(1)),
  p99Ms: Number(pct(.99).toFixed(1)),
  statuses: Object.fromEntries(statuses),
};
console.log("STEP12_LEVEL10 " + JSON.stringify(result));
if (errors > 0) process.exit(1);
