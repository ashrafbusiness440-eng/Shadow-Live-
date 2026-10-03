import assert from "node:assert/strict";
import test from "node:test";

import {
  DEFAULT_USER_LEVEL_POLICY,
  USER_LEVEL_CONFIG_PATH,
} from "../../cloudflare-worker/src/user-level-policy.js";
import {
  userLevelControlInternals,
} from "../../cloudflare-worker/src/manage-user-level.js";

const {
  canOpenLevelControl,
  canManageMetric,
  searchUsers,
  updateUserLevel,
} = userLevelControlInternals;

function clone(value) {
  return value == null ? value : structuredClone(value);
}

function makeDb(seed = {}) {
  const docs = new Map(
    Object.entries(seed).map(([path, data]) => [path, clone(data)]),
  );
  const calls = {
    gets: [],
    runQueries: [],
    commits: [],
    rollbacks: 0,
  };

  return {
    calls,
    docs,
    async beginTransaction() {
      return "tx_test";
    },
    async rollback() {
      calls.rollbacks += 1;
    },
    async get(path) {
      calls.gets.push(path);
      if (path === USER_LEVEL_CONFIG_PATH) {
        return { exists: true, data: clone(seed[USER_LEVEL_CONFIG_PATH] || {}) };
      }
      if (!docs.has(path)) return { exists: false, data: null };
      return { exists: true, data: clone(docs.get(path)) };
    },
    async runQuery(collectionPath, options = {}) {
      calls.runQueries.push({ collectionPath, options: clone(options) });
      const query = options?.filters?.[0]?.value;
      const rows = [];
      for (const [path, data] of docs.entries()) {
        if (!path.startsWith(collectionPath + "/")) continue;
        const tokens = Array.isArray(data?.searchTokens) ? data.searchTokens : [];
        if (tokens.includes(query)) {
          rows.push({
            id: path.slice(collectionPath.length + 1),
            data: clone(data),
          });
        }
      }
      return rows.slice(0, Number(options.limit || 100));
    },
    writeUpdate(path, fields, fieldPaths = null) {
      return { kind: "update", path, fields: clone(fields), fieldPaths: clone(fieldPaths) };
    },
    writeCreate(path, fields) {
      return { kind: "create", path, fields: clone(fields) };
    },
    async commit(transaction, writes) {
      calls.commits.push({ transaction, writes: clone(writes) });
      for (const write of writes) {
        if (write.kind === "update") {
          const current = clone(docs.get(write.path) || {});
          for (const key of write.fieldPaths || Object.keys(write.fields || {})) {
            current[key] = clone(write.fields[key]);
          }
          docs.set(write.path, current);
        } else if (write.kind === "create") {
          if (docs.has(write.path)) throw new Error("already_exists");
          docs.set(write.path, clone(write.fields));
        }
      }
      return {};
    },
  };
}

function owner(uid = "owner_uid") {
  return {
    uid,
    doc: {
      role: "owner",
      adminEnabled: true,
      accountStatus: "active",
      capabilities: [],
    },
    payload: {
      sub: uid,
      iat: Math.floor(Date.now() / 1000),
    },
  };
}

function admin(uid, capabilities) {
  return {
    uid,
    doc: {
      role: "admin",
      adminEnabled: true,
      accountStatus: "active",
      capabilities,
    },
    payload: {
      sub: uid,
      iat: Math.floor(Date.now() / 1000),
    },
  };
}

function policyOverride() {
  return {
    wealthThresholds: [...DEFAULT_USER_LEVEL_POLICY.wealth.thresholds],
    attractionThresholds: [...DEFAULT_USER_LEVEL_POLICY.attraction.thresholds],
    gameThresholds: [...DEFAULT_USER_LEVEL_POLICY.games.thresholds],
    gameInactivityGraceDays: 3,
    gameInactivityDecayBpsPerDay: 1000,
  };
}

function baseTarget(role = "user") {
  return {
    role,
    accountStatus: "active",
    displayName: "Target User",
    username: "target",
    publicId: "12345678",
    wealthPoints: 5000,
    attractionPoints: 5000,
    gamePoints: 1000000,
  };
}

test("level control capability matrix supports full and partial capabilities", () => {
  assert.equal(canOpenLevelControl({ role: "owner" }), true);
  assert.equal(
    canOpenLevelControl({
      role: "admin",
      adminEnabled: true,
      capabilities: ["manageUserLevels"],
    }),
    true,
  );
  assert.equal(
    canManageMetric({
      role: "admin",
      adminEnabled: true,
      capabilities: ["manageUserLevels"],
    }, "wealth"),
    true,
  );
  assert.equal(
    canManageMetric({
      role: "admin",
      adminEnabled: true,
      capabilities: ["manageWealthLevel"],
    }, "wealth"),
    true,
  );
  assert.equal(
    canManageMetric({
      role: "admin",
      adminEnabled: true,
      capabilities: ["manageAttractionLevel"],
    }, "wealth"),
    false,
  );
  assert.equal(
    canManageMetric({
      role: "admin",
      adminEnabled: true,
      capabilities: ["manageGameLevel"],
    }, "games"),
    true,
  );
});

for (const [capability, allowedMetric, deniedMetric] of [
  ["manageWealthLevel", "wealth", "attraction"],
  ["manageAttractionLevel", "attraction", "games"],
  ["manageGameLevel", "games", "wealth"],
]) {
  test(capability + " only allows its own level section", async () => {
    const actor = admin("admin_" + capability, [capability]);
    const db = makeDb({
      [USER_LEVEL_CONFIG_PATH]: policyOverride(),
      ["users/" + actor.uid]: actor.doc,
      "users/target_uid": baseTarget(),
    });

    const ok = await updateUserLevel(db, actor.payload, {
      targetUid: "target_uid",
      metric: allowedMetric,
      mode: "setPoints",
      points: 250000,
      reason: "admin correction",
      idempotencyKey: "level_" + capability + "_allowed",
    });
    assert.equal(ok.code, "ok");

    await assert.rejects(
      updateUserLevel(db, actor.payload, {
        targetUid: "target_uid",
        metric: deniedMetric,
        mode: "setPoints",
        points: 300000,
        reason: "admin correction",
        idempotencyKey: "level_" + capability + "_denied",
      }),
      (error) => error?.code === "forbidden" && error?.status === 403,
    );
  });
}

test("manageUserLevels can update all three sections", async () => {
  const actor = admin("full_admin", ["manageUserLevels"]);
  const db = makeDb({
    [USER_LEVEL_CONFIG_PATH]: policyOverride(),
    ["users/" + actor.uid]: actor.doc,
    "users/target_uid": baseTarget(),
  });

  for (const [index, metric] of ["wealth", "attraction", "games"].entries()) {
    const result = await updateUserLevel(db, actor.payload, {
      targetUid: "target_uid",
      metric,
      mode: "setPoints",
      points: 700000 + index,
      reason: "full access correction",
      idempotencyKey: "level_full_" + metric + "_001",
    });
    assert.equal(result.code, "ok");
    assert.equal(result.metric, metric);
  }
});

test("owner can edit self while non-owner cannot edit Owner", async () => {
  const own = owner();
  const selfDb = makeDb({
    [USER_LEVEL_CONFIG_PATH]: policyOverride(),
    ["users/" + own.uid]: { ...own.doc, ...baseTarget("owner") },
  });
  const selfResult = await updateUserLevel(selfDb, own.payload, {
    targetUid: own.uid,
    metric: "wealth",
    mode: "setPoints",
    points: 42000,
    reason: "owner self correction",
    idempotencyKey: "level_owner_self_001",
  });
  assert.equal(selfResult.code, "ok");
  assert.equal(selfResult.newPoints, 42000);

  const actor = admin("partial_admin", ["manageUserLevels"]);
  const blockedDb = makeDb({
    [USER_LEVEL_CONFIG_PATH]: policyOverride(),
    ["users/" + actor.uid]: actor.doc,
    "users/owner_uid": baseTarget("owner"),
  });
  await assert.rejects(
    updateUserLevel(blockedDb, actor.payload, {
      targetUid: "owner_uid",
      metric: "wealth",
      mode: "setPoints",
      points: 1,
      reason: "must be blocked",
      idempotencyKey: "level_owner_block_001",
    }),
    (error) => error?.code === "owner_protected" && error?.status === 409,
  );
});

test("setLevel uses the central policy minimum threshold", async () => {
  const own = owner();
  const override = policyOverride();
  override.wealthThresholds[1] = 12345;
  const db = makeDb({
    [USER_LEVEL_CONFIG_PATH]: override,
    ["users/" + own.uid]: own.doc,
    "users/target_uid": baseTarget(),
  });

  const result = await updateUserLevel(db, own.payload, {
    targetUid: "target_uid",
    metric: "wealth",
    mode: "setLevel",
    level: 2,
    reason: "set approved level",
    idempotencyKey: "level_threshold_001",
  });

  assert.equal(result.newPoints, 12345);
  assert.equal(db.docs.get("users/target_uid").wealthPoints, 12345);
});

test("setPoints persists exact points and Audit stores old/new points and levels", async () => {
  const own = owner();
  const db = makeDb({
    [USER_LEVEL_CONFIG_PATH]: policyOverride(),
    ["users/" + own.uid]: own.doc,
    "users/target_uid": {
      ...baseTarget(),
      wealthPoints: 10000,
    },
  });

  const result = await updateUserLevel(db, own.payload, {
    targetUid: "target_uid",
    metric: "wealth",
    mode: "setPoints",
    points: 50000,
    reason: "manual correction",
    idempotencyKey: "level_audit_001",
  });

  assert.equal(result.oldPoints, 10000);
  assert.equal(result.oldLevel, 2);
  assert.equal(result.newPoints, 50000);
  assert.equal(result.newLevel, 4);

  const audit = db.docs.get("admin_audit_logs/level_level_audit_001");
  assert.equal(audit.actorUid, own.uid);
  assert.equal(audit.targetUid, "target_uid");
  assert.equal(audit.oldPoints, 10000);
  assert.equal(audit.oldLevel, 2);
  assert.equal(audit.newPoints, 50000);
  assert.equal(audit.newLevel, 4);
});

test("idempotency returns the stored result and never commits a second mutation", async () => {
  const own = owner();
  const db = makeDb({
    [USER_LEVEL_CONFIG_PATH]: policyOverride(),
    ["users/" + own.uid]: own.doc,
    "users/target_uid": baseTarget(),
  });

  const body = {
    targetUid: "target_uid",
    metric: "attraction",
    mode: "setPoints",
    points: 99000,
    reason: "idempotent correction",
    idempotencyKey: "level_idempotent_001",
  };
  const first = await updateUserLevel(db, own.payload, body);
  const commitsAfterFirst = db.calls.commits.length;
  const second = await updateUserLevel(db, own.payload, body);

  assert.equal(first.code, "ok");
  assert.equal(second.code, "duplicate");
  assert.equal(second.newPoints, first.newPoints);
  assert.equal(db.calls.commits.length, commitsAfterFirst);
});

test("search stays bounded for UID, Public ID, and name token without scans", async () => {
  const own = owner();
  const seed = {
    [USER_LEVEL_CONFIG_PATH]: policyOverride(),
    ["users/" + own.uid]: own.doc,
    "users/direct_uid_123": {
      ...baseTarget(),
      displayName: "Direct",
      publicId: "33333333",
    },
    "users/public_uid": {
      ...baseTarget(),
      displayName: "Public ID",
      publicId: "76543210",
    },
    "users/name_uid": {
      ...baseTarget(),
      displayName: "Ashraf",
      publicId: "22222222",
    },
    "public_ids/76543210": { uid: "public_uid" },
    "public_profiles/name_uid": {
      searchTokens: ["ashraf"],
    },
  };

  const uidDb = makeDb(seed);
  const uidResult = await searchUsers(uidDb, own.payload, {
    query: "direct_uid_123",
  });
  assert.equal(uidResult.results.some((item) => item.uid === "direct_uid_123"), true);

  const publicDb = makeDb(seed);
  const publicResult = await searchUsers(publicDb, own.payload, {
    query: "76543210",
  });
  assert.equal(publicResult.results.some((item) => item.uid === "public_uid"), true);

  const nameDb = makeDb(seed);
  const nameResult = await searchUsers(nameDb, own.payload, {
    query: "Ashraf",
  });
  assert.equal(nameResult.results.some((item) => item.uid === "name_uid"), true);

  for (const db of [uidDb, publicDb, nameDb]) {
    assert.equal(db.calls.runQueries.length, 1);
    assert.equal(db.calls.runQueries[0].collectionPath, "public_profiles");
    assert.equal(db.calls.runQueries[0].options.limit, 20);
    assert.equal(
      db.calls.runQueries[0].options.filters[0].op,
      "array-contains",
    );
    assert.equal(
      db.calls.gets.some((path) => path === "users" || path === "public_profiles"),
      false,
    );
  }
});

test("admin Game Points correction preserves inactivity activity/cursor fields", async () => {
  const own = owner();
  const lastActivity = Date.UTC(2026, 9, 1, 0, 0, 0);
  const db = makeDb({
    [USER_LEVEL_CONFIG_PATH]: policyOverride(),
    ["users/" + own.uid]: own.doc,
    "users/target_uid": {
      ...baseTarget(),
      gamePoints: 1000000,
      lastGameActivityAt: new Date(lastActivity),
      lastGameActivityAtMs: lastActivity,
      gameInactivityDecayAppliedDays: 1,
    },
  });

  const before = clone(db.docs.get("users/target_uid"));
  const result = await updateUserLevel(db, own.payload, {
    targetUid: "target_uid",
    metric: "games",
    mode: "setPoints",
    points: 3000000,
    reason: "administrative game correction",
    idempotencyKey: "level_game_decay_001",
  });
  const after = db.docs.get("users/target_uid");

  assert.equal(result.code, "ok");
  assert.equal(after.gamePoints, 3000000);
  assert.deepEqual(after.lastGameActivityAt, before.lastGameActivityAt);
  assert.equal(after.lastGameActivityAtMs, before.lastGameActivityAtMs);
  assert.equal(
    after.gameInactivityDecayAppliedDays,
    before.gameInactivityDecayAppliedDays,
  );

  const userWrite = db.calls.commits[0].writes.find(
    (write) => write.kind === "update" && write.path === "users/target_uid",
  );
  assert.deepEqual(userWrite.fieldPaths, ["gamePoints", "updatedAt"]);
  assert.equal("lastGameActivityAt" in userWrite.fields, false);
  assert.equal("lastGameActivityAtMs" in userWrite.fields, false);
  assert.equal("gameInactivityDecayAppliedDays" in userWrite.fields, false);
});
