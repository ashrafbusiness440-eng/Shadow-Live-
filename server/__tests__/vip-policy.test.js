import assert from "node:assert/strict";
import test from "node:test";

import {
  DEFAULT_VIP_POLICY,
  VIP_CONFIG_PATH,
  applyVipGrowthCap,
  growthFromPaidRecharge,
  growthFromPurchasedCoins,
  loadVipPolicy,
  normalizeVipPolicy,
  vipDowngradeState,
  vipLevelFromGrowth,
  vipMaintenanceThreshold,
  vipProgress,
  vipThreshold,
  vipValidityDays,
} from "../../cloudflare-worker/src/vip-policy.js";

test("VIP1→VIP10 thresholds and validity match the approved policy", () => {
  assert.deepEqual(DEFAULT_VIP_POLICY.growthThresholds, [
    32308,
    1292308,
    3876923,
    11630769,
    34807692,
    116346154,
    288461538,
    769230769,
    1153846154,
    1923076923,
  ]);
  assert.deepEqual(
    DEFAULT_VIP_POLICY.maintenanceThresholds,
    DEFAULT_VIP_POLICY.growthThresholds,
  );
  assert.deepEqual(DEFAULT_VIP_POLICY.validityDays, [
    30, 30, 30, 30, 30, 30, 60, 60, 60, 60,
  ]);
  assert.equal(DEFAULT_VIP_POLICY.maxGrowthPoints, 2788461538);
});

test("VIP level calculation uses full precise integer thresholds", () => {
  assert.equal(vipLevelFromGrowth(DEFAULT_VIP_POLICY, 0), 0);
  assert.equal(vipLevelFromGrowth(DEFAULT_VIP_POLICY, 32307), 0);
  assert.equal(vipLevelFromGrowth(DEFAULT_VIP_POLICY, 32308), 1);
  assert.equal(vipLevelFromGrowth(DEFAULT_VIP_POLICY, 1292308), 2);
  assert.equal(vipLevelFromGrowth(DEFAULT_VIP_POLICY, 1923076923), 10);
  assert.equal(vipThreshold(DEFAULT_VIP_POLICY, 10), 1923076923);
  assert.equal(vipMaintenanceThreshold(DEFAULT_VIP_POLICY, 8), 769230769);
  assert.equal(vipValidityDays(DEFAULT_VIP_POLICY, 6), 30);
  assert.equal(vipValidityDays(DEFAULT_VIP_POLICY, 7), 60);
});

test("growth sources keep recharge 1:1 and explicit growth purchase 1:3", () => {
  assert.equal(growthFromPaidRecharge(DEFAULT_VIP_POLICY, 10000), 10000);
  assert.equal(growthFromPurchasedCoins(DEFAULT_VIP_POLICY, 10000), 30000);
  assert.equal(growthFromPaidRecharge(DEFAULT_VIP_POLICY, -1), null);
  assert.equal(growthFromPurchasedCoins(DEFAULT_VIP_POLICY, -1), null);
});

test("growth cap is server-side and exact", () => {
  assert.equal(
    applyVipGrowthCap(DEFAULT_VIP_POLICY, 2788461500, 1000),
    2788461538,
  );
});

test("VIP1→VIP3 drop one level; VIP4→VIP10 retain approved progress", () => {
  assert.deepEqual(vipDowngradeState(DEFAULT_VIP_POLICY, 1), {
    level: 0,
    growthPoints: 0,
    retentionBps: 0,
  });
  assert.deepEqual(vipDowngradeState(DEFAULT_VIP_POLICY, 3), {
    level: 2,
    growthPoints: 1292308,
    retentionBps: 0,
  });

  const vip4 = vipDowngradeState(DEFAULT_VIP_POLICY, 4);
  assert.equal(vip4.level, 3);
  assert.equal(vip4.retentionBps, 8800);
  assert.equal(vip4.growthPoints, 10700307);

  const vip8 = vipDowngradeState(DEFAULT_VIP_POLICY, 8);
  assert.equal(vip8.level, 7);
  assert.equal(vip8.retentionBps, 5000);
  assert.equal(vip8.growthPoints, 528846153);

  const vip10 = vipDowngradeState(DEFAULT_VIP_POLICY, 10);
  assert.equal(vip10.level, 9);
  assert.equal(vip10.retentionBps, 4500);
  assert.equal(vip10.growthPoints, 1500000000);
});

test("progress returns next threshold and remaining points without UI math", () => {
  assert.deepEqual(vipProgress(DEFAULT_VIP_POLICY, 32308), {
    level: 1,
    points: 32308,
    currentThreshold: 32308,
    nextThreshold: 1292308,
    remaining: 1260000,
    maxGrowthPoints: 2788461538,
  });
});

test("invalid central config falls back to approved values", () => {
  const policy = normalizeVipPolicy({
    growthThresholds: [1, 2],
    validityDays: [1],
    downgradeRetentionBps: [1],
    maxGrowthPoints: 10,
    paidRechargeGrowthPerCoin: 0,
    purchasedGrowthPerCoin: 0,
  });
  assert.deepEqual(policy.growthThresholds, DEFAULT_VIP_POLICY.growthThresholds);
  assert.deepEqual(policy.validityDays, DEFAULT_VIP_POLICY.validityDays);
  assert.equal(policy.maxGrowthPoints, DEFAULT_VIP_POLICY.maxGrowthPoints);
  assert.equal(policy.paidRechargeGrowthPerCoin, 1);
  assert.equal(policy.purchasedGrowthPerCoin, 3);
});

test("VIP policy loads from one bounded config document", async () => {
  let reads = 0;
  const db = {
    async get(path) {
      reads += 1;
      assert.equal(path, VIP_CONFIG_PATH);
      return { exists: true, data: {} };
    },
  };
  const policy = await loadVipPolicy(db, { useCache: false });
  assert.equal(reads, 1);
  assert.equal(policy.maxLevel, 10);
});
