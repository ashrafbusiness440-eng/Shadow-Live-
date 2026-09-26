import fs from "node:fs";
import path from "node:path";

function walk(dir) {
  const out = [];
  for (const name of fs.readdirSync(dir)) {
    const p = path.join(dir, name);
    const s = fs.statSync(p);
    if (s.isDirectory()) out.push(...walk(p));
    else if (/step12-shard-\d+\.json$/.test(name)) out.push(p);
  }
  return out;
}
function pct(values, p) {
  const sorted = [...values].sort((a,b)=>a-b);
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * p) - 1))] || 0;
}
const root = process.argv[2] || "step12-artifacts";
const files = walk(root);
if (!files.length) throw new Error("no_shard_results");
const shards = files.map((f)=>JSON.parse(fs.readFileSync(f,"utf8")));
const statuses = {};
const latencies = [];
const diagnostics = [];
let requests=0, errors=0, networkErrors=0, users=0;
for (const s of shards) {
  requests += Number(s.requests||0);
  errors += Number(s.errors||0);
  networkErrors += Number(s.networkErrors||0);
  users += Number(s.users||0);
  latencies.push(...(s.latencies||[]));
  for (const [k,v] of Object.entries(s.statuses||{})) statuses[k]=(statuses[k]||0)+Number(v||0);
  diagnostics.push(...(s.diagnostics||[]).slice(0,3).map((d)=>({shard:s.shardIndex,...d})));
}
const totalWindowSec = Math.max(...shards.map((s)=>Number(s.durationSec||0) + Number(s.rampSec||0)));
const result = {
  users,
  shards: shards.length,
  totalWindowSec,
  requests,
  rps: Number((requests / Math.max(1,totalWindowSec)).toFixed(2)),
  errors,
  networkErrors,
  errorRate: Number((errors / Math.max(1,requests)).toFixed(6)),
  p50Ms: Number(pct(latencies,.50).toFixed(1)),
  p95Ms: Number(pct(latencies,.95).toFixed(1)),
  p99Ms: Number(pct(latencies,.99).toFixed(1)),
  statuses,
  diagnostics: diagnostics.slice(0,20),
};
console.log("STEP12_LEVEL5000_SHARDED " + JSON.stringify(result));
fs.writeFileSync("step12-level5000-summary.json", JSON.stringify(result,null,2));
if (users !== 5000 || shards !== 10) process.exitCode=2;
if (errors > 0) process.exitCode=1;
