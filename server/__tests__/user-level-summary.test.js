import assert from "node:assert/strict";
import test from "node:test";

import { buildUserLevelSummary } from "../../cloudflare-worker/src/user-level-summary.js";
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
