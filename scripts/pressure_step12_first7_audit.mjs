import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));

function readJson(name) {
  return JSON.parse(fs.readFileSync(path.resolve(name), "utf8"));
}
function read(rel) {
  return fs.readFileSync(path.join(root, rel), "utf8");
}
function yes(value) {
  return value ? "COMPLETE" : "INCOMPLETE";
}

const pressure = readJson(process.argv[2] || "pressure-report.json");
const listeners = readJson(process.argv[3] || "listener-budget.json");

const discovery = read("lib/features/home/services/discovery_service.dart");
const realtime = read("cloudflare-worker/src/room-realtime.js");
const roomGift = read("cloudflare-worker/src/room-gift.js");
const mainControl = read("lib/main_control.dart");
const systemHealth = read("cloudflare-worker/src/system-health.js");
const deploy = read(".github/workflows/deploy-cloudflare-worker.yml");
const access = read("cloudflare-worker/src/manage-user-access.js");
const closureDoc = read("docs/pressure-step12-first7-closure.md");

const endpoint = (predicate) =>
  (pressure.endpoints || []).filter(predicate);
const presence = endpoint(
  (row) => String(row.action || "").toLowerCase() === "presencecounts",
);
const presenceRequests = presence.reduce(
  (sum, row) => sum + Number(row.requests || 0),
  0,
);
const presenceMaxFanout = presence.reduce(
  (max, row) => Math.max(max, Number(row.maxFanout || 0)),
  0,
);
const presenceAverageFanout = presenceRequests > 0
  ? presence.reduce(
      (sum, row) =>
        sum + Number(row.averageFanout || 0) * Number(row.requests || 0),
      0,
    ) / presenceRequests
  : 0;
const presenceP95 = presence.reduce(
  (max, row) => Math.max(max, Number(row.p95Ms || 0)),
  0,
);

const sourceMax60 =
  discovery.includes(".collection('rooms').limit(60).get()") &&
  realtime.includes(".slice(0, 60)");
const sourceBatch12 = realtime.includes("const batchSize = 12");
const maxBatches = sourceMax60 && sourceBatch12 ? 5 : null;
const homeDecision =
  presenceMaxFanout >= 48 && presenceP95 >= 800
    ? "later_improvement_recommended_visible_room_subset_or_active_room_index"
    : "keep_current_bounded_batching_until_later_improvement";

const requiredSubsystems = [
  "room",
  "room_bootstrap",
  "room_realtime",
  "gifts",
  "games",
  "home",
  "rocket",
  "wallet",
];
const subsystemByName = new Map(
  (pressure.subsystems || []).map((row) => [String(row.subsystem || ""), row]),
);
const subsystemLatency = Object.fromEntries(
  requiredSubsystems.map((name) => {
    const row = subsystemByName.get(name) || {};
    return [
      name,
      {
        observedRequests: Number(row.requests || 0),
        p50Ms: Number(row.p50Ms || 0),
        p95Ms: Number(row.p95Ms || 0),
        p99Ms: Number(row.p99Ms || 0),
      },
    ];
  }),
);

const hotByPrimary = new Map(
  (pressure.hotDocuments || []).map((row) => [String(row.primary || ""), row]),
);
const rocketHot = hotByPrimary.get("room_rocket_state") || {};
const roomRootHot = hotByPrimary.get("room_root") || {};
const supportHot = hotByPrimary.get("room_support_periods") || {};
const agencyHot = hotByPrimary.get("agency_support_stats") || {};

const hotSourceVerified =
  roomGift.includes('primary: "room_rocket_state"') &&
  roomGift.includes('primary: "room_root"') &&
  roomGift.includes('outcome: "no_root_write"') &&
  roomGift.includes('primary: "room_support_periods"') &&
  roomGift.includes('primary: "agency_support_stats"');

const systemHealthVerified =
  mainControl.includes("const SystemHealthCard()") &&
  systemHealth.includes("PRESSURE_ANALYTICS_READ_TOKEN") &&
  systemHealth.includes('caps.includes("viewSystemHealth")') &&
  systemHealth.includes("SNAPSHOT_TTL_MS = 15_000") &&
  deploy.includes("PRESSURE_ANALYTICS_READ_TOKEN") &&
  access.includes('"viewSystemHealth"');

const items = {
  requestsAndErrors: {
    state: yes(
      Array.isArray(pressure.endpoints) &&
      Array.isArray(pressure.firestore) &&
      Array.isArray(pressure.realtime),
    ),
    endpointGroups: (pressure.endpoints || []).length,
    firestoreGroups: (pressure.firestore || []).length,
    realtimeGroups: (pressure.realtime || []).length,
    totals: {
      requests: (pressure.endpoints || []).reduce(
        (sum, row) => sum + Number(row.requests || 0),
        0,
      ),
      status429: (pressure.endpoints || []).reduce(
        (sum, row) => sum + Number(row.status429 || 0),
        0,
      ),
      status5xx: (pressure.endpoints || []).reduce(
        (sum, row) => sum + Number(row.status5xx || 0),
        0,
      ),
      firestoreReads: (pressure.firestore || []).reduce(
        (sum, row) => sum + Number(row.reads || 0),
        0,
      ),
      firestoreWrites: (pressure.firestore || []).reduce(
        (sum, row) => sum + Number(row.writes || 0),
        0,
      ),
      firestoreRetries: (pressure.firestore || []).reduce(
        (sum, row) => sum + Number(row.retries || 0),
        0,
      ),
      realtimeReconnects: (pressure.realtime || []).reduce(
        (sum, row) => sum + Number(row.reconnects || 0),
        0,
      ),
    },
  },
  subsystemLatency: {
    state: yes(Array.isArray(pressure.subsystems)),
    subsystems: subsystemLatency,
  },
  homePresenceFanout: {
    state: yes(sourceMax60 && sourceBatch12),
    sourceMaxRooms: sourceMax60 ? 60 : null,
    batchSize: sourceBatch12 ? 12 : null,
    maxBatches,
    observedRequests: presenceRequests,
    observedAverageFanout: Number(presenceAverageFanout.toFixed(2)),
    observedMaxFanout: presenceMaxFanout,
    observedP95Ms: presenceP95,
    decision: homeDecision,
  },
  hotDocuments: {
    state: yes(hotSourceVerified),
    measured: {
      roomRocketState: rocketHot,
      roomRoot: roomRootHot,
      roomSupportPeriods: supportHot,
      agencySupportStats: agencyHot,
    },
    deterministicWriteTopologyPerGift: {
      roomRootWrites: 0,
      roomRocketStateReads: 1,
      roomRocketStateWrites: 1,
      roomSupportPeriodWrites: 3,
      agencySupportPeriodWritesWhenAgencyReceiver: 3,
      agencySettlementAccrualWritesWhenAgencyReceiver: 1,
    },
  },
  listenerBudget: {
    state: yes(Boolean(listeners?.totals)),
    totals: listeners.totals || {},
    duplicateSignals: listeners.duplicateSignals || {},
    files: listeners.files || [],
  },
  beforeAfter: {
    state: yes(
      closureDoc.includes("Before → After") &&
      closureDoc.includes("Semantics explicitly preserved"),
    ),
    document: "docs/pressure-step12-first7-closure.md",
  },
  systemHealth: {
    state: yes(systemHealthVerified),
    endpoint: "/api/system-health",
    refreshSeconds: 15,
    capability: "viewSystemHealth",
    ownerImplicitAccess: true,
    windows: ["5m", "1h", "24h"],
    colors: ["green", "yellow", "red"],
  },
};

const allComplete = Object.values(items).every(
  (item) => item.state === "COMPLETE",
);
const report = {
  generatedAt: new Date().toISOString(),
  analyticsWindowMinutes: Number(pressure.windowMinutes || 0),
  allComplete,
  items,
};

fs.writeFileSync(
  "step12-first7-closure.json",
  JSON.stringify(report, null, 2) + "\n",
);

const md = [
  "# Step 12 — First Seven Closure",
  "",
  `Generated: ${report.generatedAt}`,
  `Analytics window: ${report.analyticsWindowMinutes} minutes`,
  `Overall: **${allComplete ? "COMPLETE" : "INCOMPLETE"}**`,
  "",
  "## 1. Requests / Firestore / errors / retries",
  "",
  `State: **${items.requestsAndErrors.state}**`,
  `Requests: ${items.requestsAndErrors.totals.requests}`,
  `429: ${items.requestsAndErrors.totals.status429}`,
  `5xx: ${items.requestsAndErrors.totals.status5xx}`,
  `Firestore reads: ${items.requestsAndErrors.totals.firestoreReads}`,
  `Firestore writes: ${items.requestsAndErrors.totals.firestoreWrites}`,
  `Firestore retries: ${items.requestsAndErrors.totals.firestoreRetries}`,
  `Realtime reconnects: ${items.requestsAndErrors.totals.realtimeReconnects}`,
  "",
  "## 2. p50 / p95 / p99 by subsystem",
  "",
  `State: **${items.subsystemLatency.state}**`,
  ...Object.entries(subsystemLatency).map(
    ([name, row]) =>
      `- ${name}: requests=${row.observedRequests}, p50=${row.p50Ms}ms, p95=${row.p95Ms}ms, p99=${row.p99Ms}ms`,
  ),
  "",
  "## 3. Home presenceCounts fan-out",
  "",
  `State: **${items.homePresenceFanout.state}**`,
  `Bound: ${items.homePresenceFanout.sourceMaxRooms} rooms, batch=${items.homePresenceFanout.batchSize}, max batches=${items.homePresenceFanout.maxBatches}`,
  `Observed: requests=${presenceRequests}, avg fanout=${items.homePresenceFanout.observedAverageFanout}, max fanout=${presenceMaxFanout}, p95=${presenceP95}ms`,
  `Decision: ${homeDecision}`,
  "",
  "## 4. Hot documents",
  "",
  `State: **${items.hotDocuments.state}**`,
  `room root writes per gift: 0`,
  `room_rocket_state: 1 read + 1 write per committed gift`,
  `room support period docs: 3 writes per gift`,
  `agency support period docs: 3 writes per agency gift + 1 settlement accrual write`,
  "",
  "## 5. Listener budget",
  "",
  `State: **${items.listenerBudget.state}**`,
  `Total snapshots() call sites: ${items.listenerBudget.totals.all || 0}`,
  `Room: ${items.listenerBudget.totals.room || 0}`,
  `Conversations: ${items.listenerBudget.totals.conversations || 0}`,
  `users/{uid}: ${items.listenerBudget.totals.current_user || 0}`,
  `Rocket: ${items.listenerBudget.totals.rocket || 0}`,
  `Profile: ${items.listenerBudget.totals.profile || 0}`,
  `Wallet: ${items.listenerBudget.totals.wallet || 0}`,
  "",
  "## 6. Before / After",
  "",
  `State: **${items.beforeAfter.state}** — ${items.beforeAfter.document}`,
  "",
  "## 7. Shadow Control System Health",
  "",
  `State: **${items.systemHealth.state}**`,
  `Endpoint: ${items.systemHealth.endpoint}`,
  `Refresh: ${items.systemHealth.refreshSeconds}s`,
  `Capability: ${items.systemHealth.capability}`,
  "",
].join("\n");

fs.writeFileSync("step12-first7-closure.md", md);
console.log(JSON.stringify(report, null, 2));
if (!allComplete) process.exitCode = 1;
