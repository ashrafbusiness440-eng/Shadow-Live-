import fs from "node:fs";
import path from "node:path";

function walk(dir) {
  const out = [];
  for (const name of fs.readdirSync(dir)) {
    const file = path.join(dir, name);
    const stat = fs.statSync(file);
    if (stat.isDirectory()) out.push(...walk(file));
    else if (/step12-rt-shard-\d+\.json$/.test(name)) out.push(file);
  }
  return out;
}
function pct(values, p) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[
    Math.min(
      sorted.length - 1,
      Math.max(0, Math.ceil(sorted.length * p) - 1),
    )
  ] || 0;
}

const root = process.argv[2] || "step12-rt-artifacts";
const files = walk(root);
if (!files.length) throw new Error("no_realtime_shard_results");
const shards = files.map((file) => JSON.parse(fs.readFileSync(file, "utf8")));
const statuses = {};
const latencies = [];
const diagnostics = [];
let requests = 0;
let errors = 0;
let networkErrors = 0;
let semanticErrors = 0;
let users = 0;
let estimatedDoReads = 0;

for (const shard of shards) {
  requests += Number(shard.requests || 0);
  errors += Number(shard.errors || 0);
  networkErrors += Number(shard.networkErrors || 0);
  semanticErrors += Number(shard.semanticErrors || 0);
  users += Number(shard.users || 0);
  estimatedDoReads += Number(shard.requests || 0) * Number(shard.roomsPerRequest || 0);
  latencies.push(...(shard.latencies || []));
  for (const [key, value] of Object.entries(shard.statuses || {})) {
    statuses[key] = (statuses[key] || 0) + Number(value || 0);
  }
  diagnostics.push(
    ...(shard.diagnostics || []).slice(0, 3).map((item) => ({
      shard: shard.shardIndex,
      ...item,
    })),
  );
}

const totalWindowSec = Math.max(
  ...shards.map(
    (shard) => Number(shard.durationSec || 0) + Number(shard.rampSec || 0),
  ),
);
const result = {
  kind: "realtime_presence_counts",
  users,
  shards: shards.length,
  totalWindowSec,
  requests,
  rps: Number((requests / Math.max(1, totalWindowSec)).toFixed(2)),
  estimatedDoReads,
  estimatedDoReadsPerSec: Number(
    (estimatedDoReads / Math.max(1, totalWindowSec)).toFixed(2),
  ),
  errors,
  networkErrors,
  semanticErrors,
  errorRate: Number((errors / Math.max(1, requests)).toFixed(6)),
  p50Ms: Number(pct(latencies, 0.50).toFixed(1)),
  p95Ms: Number(pct(latencies, 0.95).toFixed(1)),
  p99Ms: Number(pct(latencies, 0.99).toFixed(1)),
  statuses,
  diagnostics: diagnostics.slice(0, 20),
};
console.log("STEP12_REALTIME_LEVEL5000 " + JSON.stringify(result));
fs.writeFileSync("step12-realtime-level5000-summary.json", JSON.stringify(result, null, 2));

if (users !== 5000 || shards.length !== 10) process.exitCode = 2;
if (errors > 0) process.exitCode = 1;
