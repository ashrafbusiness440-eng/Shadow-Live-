import assert from "node:assert/strict";
import test from "node:test";

import {
  DEFAULT_USER_LEVEL_POLICY,
  USER_LEVEL_CONFIG_PATH,
  levelFromPoints,
  levelMinimumThreshold,
  levelProgress,
  loadUserLevelPolicy,
  normalizeUserLevelPolicy,
  safeAddUserLevelPoints,
  giftLevelPointAwards,
  userLevelSummaries,
} from "../../cloudflare-worker/src/user-level-policy.js";

test("approved level ladders match Trello exactly", () => {
  assert.equal(DEFAULT_USER_LEVEL_POLICY.wealth.thresholds.length, 35);
  assert.equal(DEFAULT_USER_LEVEL_POLICY.attraction.thresholds.length, 35);
  assert.equal(DEFAULT_USER_LEVEL_POLICY.games.thresholds.length, 21);

  assert.deepEqual(DEFAULT_USER_LEVEL_POLICY.wealth.thresholds, [
    0, 10000, 25000, 50000, 100000, 180000, 300000, 500000, 750000,
    1000000, 3000000, 6750000, 10000000, 15000000, 25000000,
    50000000, 92500000, 150000000, 250000000, 400000000, 800000000,
    1540000000, 2500000000, 4000000000, 6000000000, 8000000000,
    9620000000, 15000000000, 22000000000, 30000000000, 40000000000,
    53850000000, 75000000000, 105000000000, 150000000000,
  ]);

  assert.deepEqual(DEFAULT_USER_LEVEL_POLICY.attraction.thresholds, [
    0, 10000, 25000, 50000, 100000, 200000, 350000, 550000, 850000,
    1150000, 3000000, 6750000, 10000000, 15000000, 25000000,
    50000000, 92500000, 150000000, 250000000, 400000000, 800000000,
    1540000000, 2500000000, 4000000000, 6000000000, 8000000000,
    9620000000, 15000000000, 22000000000, 30000000000, 40000000000,
    53850000000, 75000000000, 105000000000, 150000000000,
  ]);

  assert.deepEqual(DEFAULT_USER_LEVEL_POLICY.games.thresholds, [
    200000, 1000000, 3000000, 9620000, 18000000, 32000000, 57700000,
    110000000, 205000000, 385000000, 625000000, 1000000000,
    1635000000, 2450000000, 3650000000, 5385000000, 7300000000,
    9800000000, 13080000000, 17500000000, 23500000000,
  ]);

  assert.equal(DEFAULT_USER_LEVEL_POLICY.games.inactivityGraceDays, 3);
  assert.equal(DEFAULT_USER_LEVEL_POLICY.games.inactivityDecayBpsPerDay, 1000);
});

test("points map to the highest reached level with game level zero below LV1", () => {
  const { wealth, attraction, games } = DEFAULT_USER_LEVEL_POLICY;

  assert.equal(levelFromPoints(wealth, 0), 1);
  assert.equal(levelFromPoints(wealth, 9999), 1);
  assert.equal(levelFromPoints(wealth, 10000), 2);
  assert.equal(levelFromPoints(wealth, 150000000000), 35);
  assert.equal(levelFromPoints(wealth, Number.MAX_SAFE_INTEGER), 35);

  assert.equal(levelFromPoints(attraction, 1149999), 9);
  assert.equal(levelFromPoints(attraction, 1150000), 10);

  assert.equal(levelFromPoints(games, 0), 0);
  assert.equal(levelFromPoints(games, 199999), 0);
  assert.equal(levelFromPoints(games, 200000), 1);
  assert.equal(levelFromPoints(games, 23500000000), 21);
});

test("minimum thresholds and remaining progress stay server-authoritative", () => {
  const wealth = DEFAULT_USER_LEVEL_POLICY.wealth;
  assert.equal(levelMinimumThreshold(wealth, 1), 0);
  assert.equal(levelMinimumThreshold(wealth, 35), 150000000000);
  assert.equal(levelMinimumThreshold(wealth, 36), null);

  assert.deepEqual(levelProgress(wealth, 5000), {
    level: 1,
    maxLevel: 35,
    points: 5000,
    minimumThreshold: 0,
    nextThreshold: 10000,
    remaining: 5000,
    progressBps: 5000,
  });

  const gameBeforeLv1 = levelProgress(
    DEFAULT_USER_LEVEL_POLICY.games,
    100000,
  );
  assert.equal(gameBeforeLv1.level, 0);
  assert.equal(gameBeforeLv1.minimumThreshold, 0);
  assert.equal(gameBeforeLv1.nextThreshold, 200000);
  assert.equal(gameBeforeLv1.remaining, 100000);
  assert.equal(gameBeforeLv1.progressBps, 5000);

  const max = levelProgress(wealth, 200000000000);
  assert.equal(max.level, 35);
  assert.equal(max.remaining, 0);
  assert.equal(max.nextThreshold, null);
  assert.equal(max.progressBps, 10000);
});

test("all approved thresholds remain exact safe integers above 32-bit where needed", () => {
  for (const group of [
    DEFAULT_USER_LEVEL_POLICY.wealth.thresholds,
    DEFAULT_USER_LEVEL_POLICY.attraction.thresholds,
    DEFAULT_USER_LEVEL_POLICY.games.thresholds,
  ]) {
    for (const value of group) {
      assert.equal(Number.isSafeInteger(value), true);
      assert.ok(value >= 0);
    }
  }
  assert.ok(DEFAULT_USER_LEVEL_POLICY.wealth.thresholds.at(-1) > 0x7fffffff);
  assert.ok(DEFAULT_USER_LEVEL_POLICY.games.thresholds.at(-1) > 0x7fffffff);
});

test("invalid Firestore threshold overrides fail closed to approved defaults", () => {
  const policy = normalizeUserLevelPolicy({
    version: 7,
    wealthThresholds: [0, 1],
    attractionThresholds: [
      ...DEFAULT_USER_LEVEL_POLICY.attraction.thresholds.slice(0, 34),
      1,
    ],
    gameThresholds: DEFAULT_USER_LEVEL_POLICY.games.thresholds,
    gameInactivityGraceDays: 0,
    gameInactivityDecayBpsPerDay: 10000,
  });

  assert.deepEqual(
    policy.wealth.thresholds,
    DEFAULT_USER_LEVEL_POLICY.wealth.thresholds,
  );
  assert.deepEqual(
    policy.attraction.thresholds,
    DEFAULT_USER_LEVEL_POLICY.attraction.thresholds,
  );
  assert.deepEqual(
    policy.games.thresholds,
    DEFAULT_USER_LEVEL_POLICY.games.thresholds,
  );
  assert.equal(policy.games.inactivityGraceDays, 1);
  assert.equal(policy.games.inactivityDecayBpsPerDay, 9999);
});

test("Firestore config override loads from one central server document", async () => {
  let reads = 0;
  const override = {
    wealthThresholds: [...DEFAULT_USER_LEVEL_POLICY.wealth.thresholds],
    attractionThresholds: [...DEFAULT_USER_LEVEL_POLICY.attraction.thresholds],
    gameThresholds: [...DEFAULT_USER_LEVEL_POLICY.games.thresholds],
    gameInactivityGraceDays: 3,
    gameInactivityDecayBpsPerDay: 1000,
  };
  override.wealthThresholds[1] = 12000;

  const db = {
    async get(path) {
      reads += 1;
      assert.equal(path, USER_LEVEL_CONFIG_PATH);
      return { exists: true, data: override };
    },
  };

  const policy = await loadUserLevelPolicy(db, { useCache: false });
  assert.equal(reads, 1);
  assert.equal(policy.wealth.thresholds[1], 12000);
});

test("shared summary derives all three sections without Flutter calculations", () => {
  const summary = userLevelSummaries(DEFAULT_USER_LEVEL_POLICY, {
    wealthPoints: 10000,
    attractionPoints: 1150000,
    gamePoints: 3000000,
  });

  assert.equal(summary.wealth.level, 2);
  assert.equal(summary.attraction.level, 10);
  assert.equal(summary.games.level, 3);
});


test("level point accumulation stays non-negative and inside JS safe integer range", () => {
  assert.equal(safeAddUserLevelPoints(undefined, 100), 100);
  assert.equal(safeAddUserLevelPoints(250000, 100000), 350000);
  assert.equal(safeAddUserLevelPoints(-1, 100), null);
  assert.equal(safeAddUserLevelPoints(100, -1), null);
  assert.equal(
    safeAddUserLevelPoints(Number.MAX_SAFE_INTEGER, 1),
    null,
  );
});


test("gift level awards separate paid wealth from nominal attraction value", () => {
  assert.deepEqual(
    giftLevelPointAwards({ nominalCoins: 5000, paidCoins: 5000 }),
    { wealthPoints: 5000, attractionPoints: 5000 },
  );
  assert.deepEqual(
    giftLevelPointAwards({ nominalCoins: 5000, paidCoins: 0 }),
    { wealthPoints: 0, attractionPoints: 5000 },
  );
  assert.equal(
    giftLevelPointAwards({ nominalCoins: 5000, paidCoins: 6000 }),
    null,
  );
});
