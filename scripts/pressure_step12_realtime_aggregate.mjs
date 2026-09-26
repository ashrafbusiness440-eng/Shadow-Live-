import fs from "node:fs";
import path from "node:path";

function walk(dir) {
  const out = [];
  for (const name of fs.readdirSync(dir)) {
    const p = path.join(dir, name);
    const s = fs.statSync(p);
    if (s.isDirectory()) out.push(...walk(p));
    else if (/step12-realtime-shard-\d+\.json$/.test(name)) out.push(p);
  }
  return out;
}

function pct(values, p) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * p) - 1))] || 0;
}

const root = process.argv[2] || "step12-realtime-artifacts";
const files = walk(root);
if (!files.length) throw new Error("no_realtime_shard_results");
const shards = files.map((f) => JSON.parse(fs.readFileSync(f, "utf8")));

let users = 0;
let uniqueAuthUsers = 0;
let uniqueAuthUsers = 0;
let readyConnections = 0;
let successfulUsers = 0;
let failedUsers = 0;
let earlyCloses = 0;
let pingFailures = 0;
let presenceFailures = 0;
let presenceMismatches = 0;
const ticketStatuses = {};
const ticketLatencies = [];
const connectLatencies = [];
const activeEvents = [];
const diagnostics = [];
const fatalErrors = [];

for (const shard of shards) {
  users += Number(shard.users || 0);
  uniqueAuthUsers += Number(shard.uniqueAuthUsers || 0);
  uniqueAuthUsers += Number(shard.uniqueAuthUsers || 0);
  readyConnections += Number(shard.readyConnections || 0);
  successfulUsers += Number(shard.successfulUsers || 0);
  failedUsers += Number(shard.failedUsers || 0);
  earlyCloses += Number(shard.earlyCloses || 0);
  pingFailures += Number(shard.pingFailures || 0);
  presenceFailures += Number(shard.presenceFailures || 0);
  presenceMismatches += Number(shard.presenceMismatches || 0);
  ticketLatencies.push(...(shard.ticketLatencies || []));
  connectLatencies.push(...(shard.connectLatencies || []));
  activeEvents.push(...(shard.activeEvents || []));
  if (shard.fatalError) fatalErrors.push({ shard: shard.shardIndex, error: shard.fatalError });
  for (const [status, count] of Object.entries(shard.ticketStatuses || {})) {
    ticketStatuses[status] = (ticketStatuses[status] || 0) + Number(count || 0);
  }
  diagnostics.push(...(shard.diagnostics || []).slice(0, 4).map((d) => ({ shard: shard.shardIndex, ...d })));
}

activeEvents.sort((a, b) => Number(a[0]) - Number(b[0]) || Number(b[1]) - Number(a[1]));
let active = 0;
let globalPeakSockets = 0;
for (const [, delta] of activeEvents) {
  active += Number(delta || 0);
  if (active > globalPeakSockets) globalPeakSockets = active;
}

const result = {
  users,
  shards: shards.length,
  uniqueAuthUsers,
  uniqueAuthUsers,
  readyConnections,
  successfulUsers,
  failedUsers,
  globalPeakSockets,
  earlyCloses,
  pingFailures,
  presenceFailures,
  presenceMismatches,
  ticketStatuses,
  ticketP50Ms: Number(pct(ticketLatencies, .50).toFixed(1)),
  ticketP95Ms: Number(pct(ticketLatencies, .95).toFixed(1)),
  ticketP99Ms: Number(pct(ticketLatencies, .99).toFixed(1)),
  connectP50Ms: Number(pct(connectLatencies, .50).toFixed(1)),
  connectP95Ms: Number(pct(connectLatencies, .95).toFixed(1)),
  connectP99Ms: Number(pct(connectLatencies, .99).toFixed(1)),
  fatalErrors,
  diagnostics: diagnostics.slice(0, 30),
};

console.log("STEP12_REALTIME_LEVEL5000 " + JSON.stringify(result));
fs.writeFileSync("step12-realtime-level5000-summary.json", JSON.stringify(result, null, 2));

const pass =
  shards.length === 10 &&
  users === 5000 &&
  uniqueAuthUsers === 5000 &&
  uniqueAuthUsers === 5000 &&
  readyConnections === 5000 &&
  successfulUsers === 5000 &&
  failedUsers === 0 &&
  globalPeakSockets === 5000 &&
  earlyCloses === 0 &&
  pingFailures === 0 &&
  presenceFailures === 0 &&
  presenceMismatches === 0 &&
  fatalErrors.length === 0;

if (!pass) process.exitCode = 1;
