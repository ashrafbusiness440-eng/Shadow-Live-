import assert from "node:assert/strict";
import test from "node:test";

import {
  buildUserLevelSummary,
  materializeUserLevelSummary,
} from "../../cloudflare-worker/src/user-level-summary.js";
import { DEFAULT_USER_LEVEL_POLICY } from "../../cloudflare-worker/src/user-level-policy.js";

test("profile level summary is server-derived with exactly bounded user/config reads", async () => {
  const day = 24 * 60 * 60 * 1000;
  const nowMs = Date.UTC(2026, 9, 3, 12, 0, 0);
  const reads = [];

  const db = {
    async get(path) {
      reads.push(path);
      if (path === "users/user_1") {
        return {
          exists: true,
          data: {
            wealthPoints: 25000,
            attractionPoints: 1150000,
            gamePoints: 1000000,
            lastGameActivityAtMs: nowMs - (4 * day),
            gameInactivityDecayAppliedDays: 0,
          },
        };
      }
      if (path === "system_config/user_levels") {
        return {
          exists: true,
          data: {
            version: 1,
            wealthThresholds: DEFAULT_USER_LEVEL_POLICY.wealth.thresholds,
            attractionThresholds:
              DEFAULT_USER_LEVEL_POLICY.attraction.thresholds,
            gameThresholds: DEFAULT_USER_LEVEL_POLICY.games.thresholds,
            gameInactivityGraceDays: 3,
            gameInactivityDecayBpsPerDay: 1000,
          },
        };
      }
      throw new Error("unexpected_read:" + path);
    },
  };

  const summary = await buildUserLevelSummary(db, "user_1", {
    nowMs,
    usePolicyCache: false,
  });

  assert.deepEqual(reads.sort(), [
    "system_config/user_levels",
    "users/user_1",
  ]);
  assert.equal(summary.wealth.level, 3);
  assert.equal(summary.wealth.points, 25000);
  assert.equal(summary.attraction.level, 10);
  assert.equal(summary.attraction.points, 1150000);

  assert.equal(summary.games.storedPoints, 1000000);
  assert.equal(summary.games.pendingDecayDays, 2);
  assert.equal(summary.games.pendingDecayPoints, 190000);
  assert.equal(summary.games.points, 810000);
  assert.equal(summary.games.level, 1);
  assert.equal(summary.games.remaining, 190000);
});

test("profile level summary treats a user with no game activity as undecayed", async () => {
  const db = {
    async get(path) {
      if (path === "users/user_2") {
        return {
          exists: true,
          data: {
            wealthPoints: 0,
            attractionPoints: 0,
            gamePoints: 199999,
          },
        };
      }
      if (path === "system_config/user_levels") {
        return { exists: false, data: null };
      }
      throw new Error("unexpected_read:" + path);
    },
  };

  const summary = await buildUserLevelSummary(db, "user_2", {
    nowMs: Date.UTC(2026, 9, 3),
    usePolicyCache: false,
  });

  assert.equal(summary.games.points, 199999);
  assert.equal(summary.games.level, 0);
  assert.equal(summary.games.pendingDecayPoints, 0);
  assert.equal(summary.games.pendingDecayDays, 0);
});


test("materialized profile level summary writes only due game decay once", async () => {
  const day = 24 * 60 * 60 * 1000;
  const nowMs = Date.UTC(2026, 9, 3, 12, 0, 0);
  let gamePoints = 1000000;
  let appliedDays = 0;
  let userReads = 0;
  let commits = 0;

  const db = {
    async get(path, transaction = null) {
      if (path === "system_config/user_levels") {
        return {
          exists: true,
          data: {
            gameInactivityGraceDays: 3,
            gameInactivityDecayBpsPerDay: 1000,
          },
        };
      }
      if (path === "users/user_3") {
        assert.ok(transaction);
        userReads += 1;
        return {
          exists: true,
          data: {
            wealthPoints: 10000,
            attractionPoints: 25000,
            gamePoints,
            lastGameActivityAtMs: nowMs - (4 * day),
            gameInactivityDecayAppliedDays: appliedDays,
          },
        };
      }
      throw new Error("unexpected_read:" + path);
    },
    async beginTransaction() {
      return "tx_" + String(userReads + 1);
    },
    writeUpdate(path, fields, fieldPaths) {
      return { path, fields, fieldPaths };
    },
    async commit(transaction, writes) {
      assert.ok(transaction);
      assert.equal(writes.length, 1);
      assert.equal(writes[0].path, "users/user_3");
      assert.deepEqual(writes[0].fieldPaths, [
        "gamePoints",
        "gameInactivityDecayAppliedDays",
      ]);
      gamePoints = writes[0].fields.gamePoints;
      appliedDays = writes[0].fields.gameInactivityDecayAppliedDays;
      commits += 1;
    },
    async rollback() {},
  };

  const first = await materializeUserLevelSummary(db, "user_3", {
    nowMs,
    usePolicyCache: false,
  });
  assert.equal(first.games.points, 810000);
  assert.equal(first.games.storedPoints, 810000);
  assert.equal(first.games.pendingDecayDays, 0);
  assert.equal(first.games.decayAppliedDays, 2);
  assert.equal(first.games.decayAppliedPoints, 190000);
  assert.equal(commits, 1);

  const second = await materializeUserLevelSummary(db, "user_3", {
    nowMs,
    usePolicyCache: false,
  });
  assert.equal(second.games.points, 810000);
  assert.equal(second.games.decayAppliedDays, 0);
  assert.equal(commits, 1);
  assert.equal(userReads, 2);
});
