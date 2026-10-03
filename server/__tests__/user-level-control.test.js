import assert from "node:assert/strict";
import test from "node:test";

import {
  userLevelControlInternals,
} from "../../cloudflare-worker/src/manage-user-level.js";
import {
  DEFAULT_USER_LEVEL_POLICY,
} from "../../cloudflare-worker/src/user-level-policy.js";

const {
  canOpenLevelControl,
  canManageMetric,
  searchUsers,
  updateUserLevel,
} = userLevelControlInternals;

const nowSec = () => Math.floor(Date.now() / 1000);
const payload = (sub) => ({ sub, iat: nowSec(), auth_time: nowSec() });

function clone(value) {
  return value == null ? value : structuredClone(value);
}

class FakeDb {
  constructor(seed = {}) {
    this.docs = new Map(
      Object.entries(seed).map(([path, data]) => [path, clone(data)]),
    );
    this.gets = [];
    this.queries = [];
    this.commits = [];
  }

  async beginTransaction() {
    return { active: true };
  }

  async rollback(transaction) {
    if (transaction) transaction.active = false;
  }

  async get(path, transaction = null) {
    this.gets.push({ path, transactional: Boolean(transaction) });
    if (!this.docs.has(path)) return { exists: false, data: null };
    return { exists: true, data: clone(this.docs.get(path)) };
  }

  async runQuery(collectionPath, options = {}) {
    this.queries.push({ collectionPath, options: clone(options) });
    const filters = Array.isArray(options.filters) ? options.filters : [];
    const limit = Math.max(1, Math.min(1000, Number(options.limit || 100)));
    const prefix = collectionPath + "/";
    const rows = [];
    for (const [path, data] of this.docs.entries()) {
      if (!path.startsWith(prefix)) continue;
      const id = path.slice(prefix.length);
      if (!id || id.includes("/")) continue;
      let matches = true;
      for (const filter of filters) {
        if (filter.op === "array-contains") {
          const values = Array.isArray(data?.[filter.field])
            ? data[filter.field]
            : [];
          if (!values.includes(filter.value)) matches = false;
        } else if (data?.[filter.field] !== filter.value) {
          matches = false;
        }
      }
      if (matches) rows.push({ id, path, data: clone(data) });
      if (rows.length >= limit) break;
    }
    return rows;
  }

  writeUpdate(path, fields, fieldPaths = []) {
    return {
      kind: "update",
      path,
      fields: clone(fields),
      fieldPaths: [...fieldPaths],
    };
  }

  writeCreate(path, fields) {
    return { kind: "create", path, fields: clone(fields) };
  }

  async commit(transaction, writes = []) {
    this.commits.push(clone(writes));
    for (const write of writes) {
      if (write.kind === "create") {
        if (this.docs.has(write.path)) {
          const error = new Error("ALREADY_EXISTS");
          error.status = 409;
          throw error;
        }
        this.docs.set(write.path, clone(write.fields));
        continue;
      }
      if (write.kind === "update") {
        const current = this.docs.get(write.path) || {};
        this.docs.set(write.path, {
          ...clone(current),
          ...clone(write.fields),
        });
      }
    }
    if (transaction) transaction.active = false;
  }
}

function user({
  role = "user",
  adminEnabled = false,
  capabilities = [],
  publicId = "",
  displayName = "User",
  wealthPoints = 0,
  attractionPoints = 0,
  gamePoints = 0,
  ...rest
} = {}) {
  return {
    role,
    adminEnabled,
    capabilities,
    accountStatus: "active",
    publicId,
    displayName,
    wealthPoints,
    attractionPoints,
    gamePoints,
    ...rest,
  };
}

function policyOverride({
  wealthThresholds = DEFAULT_USER_LEVEL_POLICY.wealth.thresholds,
  attractionThresholds = DEFAULT_USER_LEVEL_POLICY.attraction.thresholds,
  gameThresholds = DEFAULT_USER_LEVEL_POLICY.games.thresholds,
} = {}) {
  return {
    version: 1,
    wealthThresholds: [...wealthThresholds],
    attractionThresholds: [...attractionThresholds],
    gameThresholds: [...gameThresholds],
    gameInactivityGraceDays: 3,
    gameInactivityDecayBpsPerDay: 1000,
  };
}

test("06-A capability matrix supports full and partial level permissions only", () => {
  const full = user({
    role: "admin",
    adminEnabled: true,
    capabilities: ["manageUserLevels"],
  });
  assert.equal(canOpenLevelControl(full), true);
  for (const metric of ["wealth", "attraction", "games"]) {
    assert.equal(canManageMetric(full, metric), true);
  }

  const partials = [
    ["manageWealthLevel", "wealth"],
    ["manageAttractionLevel", "attraction"],
    ["manageGameLevel", "games"],
  ];
  for (const [capability, allowedMetric] of partials) {
    const actor = user({
      role: "admin",
      adminEnabled: true,
      capabilities: [capability],
    });
    assert.equal(canOpenLevelControl(actor), true);
    for (const metric of ["wealth", "attraction", "games"]) {
      assert.equal(canManageMetric(actor, metric), metric === allowedMetric);
    }
  }

  const disabled = user({
    role: "super_admin",
    adminEnabled: false,
    capabilities: ["manageUserLevels"],
  });
  assert.equal(canOpenLevelControl(disabled), false);
  assert.equal(canManageMetric(disabled, "wealth"), false);

  const staleModerator = user({
    role: "moderator",
    adminEnabled: true,
    capabilities: ["manageUserLevels", "manageGameLevel"],
  });
  assert.equal(canOpenLevelControl(staleModerator), false);
  assert.equal(canManageMetric(staleModerator, "games"), false);
});

test("06-A partial capability update rejects every unauthorized metric", async () => {
  const cases = [
    ["manageWealthLevel", "wealth", "attraction"],
    ["manageAttractionLevel", "attraction", "games"],
    ["manageGameLevel", "games", "wealth"],
  ];

  for (let i = 0; i < cases.length; i += 1) {
    const [capability, allowedMetric, deniedMetric] = cases[i];
    const actorUid = "admin_partial_" + i;
    const targetUid = "target_partial_" + i;
    const db = new FakeDb({
      ["users/" + actorUid]: user({
        role: "admin",
        adminEnabled: true,
        capabilities: [capability],
      }),
      ["users/" + targetUid]: user(),
    });

    const ok = await updateUserLevel(db, payload(actorUid), {
      targetUid,
      metric: allowedMetric,
      mode: "setPoints",
      points: 12345 + i,
      reason: "partial capability test",
      idempotencyKey: "partial_ok_000" + i,
    });
    assert.equal(ok.code, "ok");

    await assert.rejects(
      updateUserLevel(db, payload(actorUid), {
        targetUid,
        metric: deniedMetric,
        mode: "setPoints",
        points: 22222 + i,
        reason: "must be rejected",
        idempotencyKey: "partial_no_000" + i,
      }),
      (error) => error?.code === "forbidden" && error?.status === 403,
    );
  }
});

test("06-A owner can edit self while non-owner cannot edit Owner", async () => {
  const ownerUid = "shadow_owner_level";
  const ownerDb = new FakeDb({
    ["users/" + ownerUid]: user({
      role: "owner",
      wealthPoints: 10000,
    }),
  });
  const own = await updateUserLevel(ownerDb, payload(ownerUid), {
    targetUid: ownerUid,
    metric: "wealth",
    mode: "setPoints",
    points: 25000,
    reason: "owner self correction",
    idempotencyKey: "owner_self_0001",
  });
  assert.equal(own.code, "ok");
  assert.equal(ownerDb.docs.get("users/" + ownerUid).wealthPoints, 25000);

  const adminUid = "delegated_level_admin";
  const protectedDb = new FakeDb({
    ["users/" + adminUid]: user({
      role: "super_admin",
      adminEnabled: true,
      capabilities: ["manageUserLevels"],
    }),
    ["users/" + ownerUid]: user({ role: "owner", wealthPoints: 25000 }),
  });
  await assert.rejects(
    updateUserLevel(protectedDb, payload(adminUid), {
      targetUid: ownerUid,
      metric: "wealth",
      mode: "setPoints",
      points: 50000,
      reason: "should not pass",
      idempotencyKey: "owner_guard_0001",
    }),
    (error) => error?.code === "owner_protected" && error?.status === 409,
  );
});

test("06-A Set Level uses the central policy minimum threshold, not a client constant", async () => {
  const thresholds = [...DEFAULT_USER_LEVEL_POLICY.wealth.thresholds];
  thresholds[1] = 12000;
  const actorUid = "owner_threshold";
  const targetUid = "target_threshold";
  const db = new FakeDb({
    ["users/" + actorUid]: user({ role: "owner" }),
    ["users/" + targetUid]: user({ wealthPoints: 0 }),
    "system_config/user_levels": policyOverride({
      wealthThresholds: thresholds,
    }),
  });

  const result = await updateUserLevel(db, payload(actorUid), {
    targetUid,
    metric: "wealth",
    mode: "setLevel",
    level: 2,
    reason: "policy threshold test",
    idempotencyKey: "threshold_set_0001",
  });

  assert.equal(result.code, "ok");
  assert.equal(result.newPoints, 12000);
  assert.equal(result.newLevel, 2);
  assert.equal(db.docs.get("users/" + targetUid).wealthPoints, 12000);
});

test("06-A Set Points is idempotent and Audit stores old/new points and levels", async () => {
  const actorUid = "owner_audit";
  const targetUid = "target_audit";
  const key = "audit_level_0001";
  const db = new FakeDb({
    ["users/" + actorUid]: user({ role: "owner" }),
    ["users/" + targetUid]: user({ wealthPoints: 10000 }),
  });

  const body = {
    targetUid,
    metric: "wealth",
    mode: "setPoints",
    points: 25000,
    reason: "correct imported points",
    idempotencyKey: key,
  };
  const first = await updateUserLevel(db, payload(actorUid), body);
  const duplicate = await updateUserLevel(db, payload(actorUid), body);

  assert.equal(first.code, "ok");
  assert.equal(first.oldPoints, 10000);
  assert.equal(first.oldLevel, 2);
  assert.equal(first.newPoints, 25000);
  assert.equal(first.newLevel, 3);
  assert.equal(duplicate.code, "duplicate");
  assert.equal(db.commits.length, 1);

  const audit = db.docs.get("admin_audit_logs/level_" + key);
  assert.equal(audit.actorUid, actorUid);
  assert.equal(audit.targetUid, targetUid);
  assert.equal(audit.metric, "wealth");
  assert.equal(audit.oldPoints, 10000);
  assert.equal(audit.oldLevel, 2);
  assert.equal(audit.newPoints, 25000);
  assert.equal(audit.newLevel, 3);
  assert.deepEqual(audit.before, {
    metric: "wealth",
    points: 10000,
    level: 2,
  });
  assert.deepEqual(audit.after, {
    metric: "wealth",
    points: 25000,
    level: 3,
  });
});

test("06-A search is bounded for UID, Public ID and name with no collection scan", async () => {
  const actorUid = "owner_search";
  const seed = {
    ["users/" + actorUid]: user({ role: "owner", displayName: "Owner" }),
    "users/user_uid_match": user({
      publicId: "55500001",
      displayName: "UID Match",
      wealthPoints: 10000,
    }),
    "users/user_public_match": user({
      publicId: "55500002",
      displayName: "Public Match",
      attractionPoints: 25000,
    }),
    "public_ids/55500002": { uid: "user_public_match" },
  };
  for (let i = 0; i < 25; i += 1) {
    const uid = "name_match_" + String(i).padStart(2, "0");
    seed["users/" + uid] = user({
      publicId: String(60000000 + i),
      displayName: "Ali " + i,
    });
    seed["public_profiles/" + uid] = {
      searchTokens: ["ali"],
    };
  }
  const db = new FakeDb(seed);

  const uidResult = await searchUsers(db, payload(actorUid), {
    query: "user_uid_match",
  });
  assert.equal(uidResult.results.some((row) => row.uid === "user_uid_match"), true);

  const publicResult = await searchUsers(db, payload(actorUid), {
    query: "55500002",
  });
  assert.equal(
    publicResult.results.some((row) => row.uid === "user_public_match"),
    true,
  );

  const nameResult = await searchUsers(db, payload(actorUid), {
    query: "Ali",
  });
  assert.equal(nameResult.results.length, 20);

  assert.ok(db.queries.length >= 3);
  for (const query of db.queries) {
    assert.equal(query.collectionPath, "public_profiles");
    assert.equal(query.options.limit, 20);
    assert.deepEqual(query.options.filters, [
      { field: "searchTokens", op: "array-contains", value: query.options.filters[0].value },
    ]);
  }
  assert.equal(
    db.queries.some((query) => query.collectionPath === "users"),
    false,
  );
  assert.equal(
    db.queries.some((query) => Number(query.options.limit) > 20),
    false,
  );
});

test("06-A admin Game correction preserves inactivity clock and decay cursor", async () => {
  const day = 24 * 60 * 60 * 1000;
  const actorUid = "owner_game_admin";
  const targetUid = "target_game_admin";
  const lastActivityAtMs = Date.now() - (4 * day);
  const originalActivityDate = new Date(lastActivityAtMs);
  const db = new FakeDb({
    ["users/" + actorUid]: user({ role: "owner" }),
    ["users/" + targetUid]: user({
      gamePoints: 1000000,
      lastGameActivityAt: originalActivityDate,
      lastGameActivityAtMs,
      gameInactivityDecayAppliedDays: 1,
    }),
  });

  const result = await updateUserLevel(db, payload(actorUid), {
    targetUid,
    metric: "games",
    mode: "setPoints",
    points: 2000000,
    reason: "administrative game correction",
    idempotencyKey: "game_admin_0001",
  });

  assert.equal(result.code, "ok");
  const stored = db.docs.get("users/" + targetUid);
  assert.equal(stored.gamePoints, 2000000);
  assert.equal(stored.lastGameActivityAtMs, lastActivityAtMs);
  assert.equal(
    stored.lastGameActivityAt.getTime(),
    originalActivityDate.getTime(),
  );
  assert.equal(stored.gameInactivityDecayAppliedDays, 1);

  const userWrite = db.commits[0].find(
    (write) => write.kind === "update" && write.path === "users/" + targetUid,
  );
  assert.deepEqual(userWrite.fieldPaths.sort(), ["gamePoints", "updatedAt"].sort());
  assert.equal("lastGameActivityAt" in userWrite.fields, false);
  assert.equal("lastGameActivityAtMs" in userWrite.fields, false);
  assert.equal("gameInactivityDecayAppliedDays" in userWrite.fields, false);

  // With one decay day already materialized and four full inactive days elapsed,
  // the corrected balance still has one naturally pending lazy-decay day.
  assert.equal(result.summary.games.pendingDecayDays, 1);
  assert.equal(result.summary.games.storedPoints, 2000000);
  assert.equal(result.summary.games.points, 1800000);
});

test("06-C Set Level rejects LV0; zero points remain a Set Points operation", async () => {
  const actorUid = "owner_level_range";
  const targetUid = "target_level_range";
  const db = new FakeDb({
    ["users/" + actorUid]: user({ role: "owner" }),
    ["users/" + targetUid]: user({ gamePoints: 0 }),
  });

  await assert.rejects(
    updateUserLevel(db, payload(actorUid), {
      targetUid,
      metric: "games",
      mode: "setLevel",
      level: 0,
      reason: "invalid level boundary",
      idempotencyKey: "level_zero_guard_0001",
    }),
    (error) => error?.code === "invalid_level" && error?.status === 400,
  );

  const zeroPoints = await updateUserLevel(db, payload(actorUid), {
    targetUid,
    metric: "games",
    mode: "setPoints",
    points: 0,
    reason: "zero points correction",
    idempotencyKey: "points_zero_ok_0001",
  });
  assert.equal(zeroPoints.code, "ok");
  assert.equal(zeroPoints.newPoints, 0);
});
