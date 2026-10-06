import {
  invalidateConfigCache,
  readThroughConfigCache,
} from "./config-cache.js";

export const VIP_CONFIG_PATH = "system_config/vip";
export const VIP_CONFIG_CACHE_KEY = "config:vip";
export const VIP_POLICY_VERSION = 1;

const VIP_THRESHOLDS = Object.freeze([
  32_308,
  1_292_308,
  3_876_923,
  11_630_769,
  34_807_692,
  116_346_154,
  288_461_538,
  769_230_769,
  1_153_846_154,
  1_923_076_923,
]);

const VIP_VALIDITY_DAYS = Object.freeze([
  30, 30, 30, 30, 30, 30, 60, 60, 60, 60,
]);

// Retention applies only when VIP4→VIP10 fail maintenance.
// Values are basis points (88%=8800 bps).
const VIP_DOWNGRADE_RETENTION_BPS = Object.freeze([
  0, 0, 0, 8800, 8500, 7500, 5900, 5000, 5000, 4500,
]);

export const DEFAULT_VIP_POLICY = Object.freeze({
  version: VIP_POLICY_VERSION,
  maxLevel: 10,
  growthThresholds: VIP_THRESHOLDS,
  maintenanceThresholds: VIP_THRESHOLDS,
  validityDays: VIP_VALIDITY_DAYS,
  downgradeRetentionBps: VIP_DOWNGRADE_RETENTION_BPS,
  maxGrowthPoints: 2_788_461_538,
  paidRechargeGrowthPerCoin: 1,
  purchasedGrowthPerCoin: 3,
  quickPurchaseOffers: Object.freeze([]),
});

function safeNonNegativeInteger(value) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number >= 0 ? number : null;
}

function boundedInteger(value, fallback, min, max) {
  const number = Number(value);
  if (!Number.isSafeInteger(number)) return fallback;
  return Math.max(min, Math.min(max, number));
}

function integerOrDefault(value, fallback, min, max) {
  const number = Number(value);
  if (
    !Number.isSafeInteger(number) ||
    number < min ||
    number > max
  ) {
    return fallback;
  }
  return number;
}

function normalizeAscendingIntegers(raw, fallback, length) {
  if (!Array.isArray(raw) || raw.length !== length) return [...fallback];
  const normalized = [];
  let previous = -1;
  for (const value of raw) {
    const number = safeNonNegativeInteger(value);
    if (number === null || number <= previous) return [...fallback];
    normalized.push(number);
    previous = number;
  }
  return normalized;
}

function normalizePositiveIntegers(raw, fallback, length, min, max) {
  if (!Array.isArray(raw) || raw.length !== length) return [...fallback];
  const normalized = [];
  for (const value of raw) {
    const number = Number(value);
    if (!Number.isSafeInteger(number) || number < min || number > max) {
      return [...fallback];
    }
    normalized.push(number);
  }
  return normalized;
}

function clean(value) {
  return String(value ?? "").trim();
}

export function normalizeVipQuickPurchaseOffers(
  raw,
  purchasedGrowthPerCoin = 3,
) {
  if (!Array.isArray(raw)) return [];
  const ratio = integerOrDefault(purchasedGrowthPerCoin, 3, 1, 100);
  const normalized = [];
  const ids = new Set();
  for (const item of raw.slice(0, 8)) {
    if (!item || typeof item !== "object") continue;
    const id = clean(item.id);
    const growthPoints = safeNonNegativeInteger(item.growthPoints);
    const baseCoinCost = safeNonNegativeInteger(item.baseCoinCost);
    const sortOrder = integerOrDefault(item.sortOrder, normalized.length, 0, 1000);
    if (
      !/^[a-z0-9][a-z0-9_-]{1,39}$/.test(id) ||
      ids.has(id) ||
      growthPoints === null ||
      growthPoints <= 0 ||
      growthPoints % ratio !== 0
    ) {
      continue;
    }
    const finalCoinCost = growthPoints / ratio;
    if (
      !Number.isSafeInteger(finalCoinCost) ||
      finalCoinCost <= 0 ||
      baseCoinCost === null ||
      baseCoinCost < finalCoinCost
    ) {
      continue;
    }
    ids.add(id);
    const discountBps = baseCoinCost === 0
      ? 0
      : Math.max(
          0,
          Math.min(
            10_000,
            Math.floor(((baseCoinCost - finalCoinCost) * 10_000) / baseCoinCost),
          ),
        );
    normalized.push({
      id,
      labelAr: clean(item.labelAr).slice(0, 60),
      growthPoints,
      baseCoinCost,
      finalCoinCost,
      discountBps,
      enabled: item.enabled !== false,
      sortOrder,
    });
  }
  return normalized
    .sort((a, b) => a.sortOrder - b.sortOrder || a.growthPoints - b.growthPoints);
}

export function normalizeVipPolicy(raw = {}) {
  const data = raw && typeof raw === "object" ? raw : {};
  const growthThresholds = normalizeAscendingIntegers(
    data.growthThresholds,
    VIP_THRESHOLDS,
    10,
  );
  const maintenanceThresholds = normalizeAscendingIntegers(
    data.maintenanceThresholds,
    growthThresholds,
    10,
  );
  return {
    version: boundedInteger(
      data.version,
      VIP_POLICY_VERSION,
      1,
      Number.MAX_SAFE_INTEGER,
    ),
    maxLevel: 10,
    growthThresholds,
    maintenanceThresholds,
    validityDays: normalizePositiveIntegers(
      data.validityDays,
      VIP_VALIDITY_DAYS,
      10,
      1,
      365,
    ),
    downgradeRetentionBps: normalizePositiveIntegers(
      data.downgradeRetentionBps,
      VIP_DOWNGRADE_RETENTION_BPS,
      10,
      0,
      10_000,
    ),
    maxGrowthPoints: integerOrDefault(
      data.maxGrowthPoints,
      DEFAULT_VIP_POLICY.maxGrowthPoints,
      growthThresholds.at(-1),
      Number.MAX_SAFE_INTEGER,
    ),
    paidRechargeGrowthPerCoin: integerOrDefault(
      data.paidRechargeGrowthPerCoin,
      1,
      1,
      100,
    ),
    purchasedGrowthPerCoin: integerOrDefault(
      data.purchasedGrowthPerCoin,
      3,
      1,
      100,
    ),
    quickPurchaseOffers: normalizeVipQuickPurchaseOffers(
      data.quickPurchaseOffers,
      integerOrDefault(data.purchasedGrowthPerCoin, 3, 1, 100),
    ),
  };
}

export function vipLevelFromGrowth(policy, points) {
  const thresholds = Array.isArray(policy?.growthThresholds)
    ? policy.growthThresholds
    : [];
  const normalizedPoints = safeNonNegativeInteger(points) ?? 0;
  let low = 0;
  let high = thresholds.length - 1;
  let best = -1;
  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    if (thresholds[mid] <= normalizedPoints) {
      best = mid;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }
  return best + 1;
}

export function vipThreshold(policy, level) {
  const target = Number(level);
  if (!Number.isSafeInteger(target) || target < 1 || target > 10) return null;
  return policy.growthThresholds[target - 1] ?? null;
}

export function vipMaintenanceThreshold(policy, level) {
  const target = Number(level);
  if (!Number.isSafeInteger(target) || target < 1 || target > 10) return null;
  return policy.maintenanceThresholds[target - 1] ?? null;
}

export function vipValidityDays(policy, level) {
  const target = Number(level);
  if (!Number.isSafeInteger(target) || target < 1 || target > 10) return null;
  return policy.validityDays[target - 1] ?? null;
}

export function growthFromPaidRecharge(policy, paidBaseCoins) {
  const coins = safeNonNegativeInteger(paidBaseCoins);
  if (coins === null) return null;
  const multiplier = boundedInteger(policy?.paidRechargeGrowthPerCoin, 1, 1, 100);
  const value = coins * multiplier;
  return Number.isSafeInteger(value) ? value : null;
}

export function growthFromPurchasedCoins(policy, spentCoins) {
  const coins = safeNonNegativeInteger(spentCoins);
  if (coins === null) return null;
  const multiplier = boundedInteger(policy?.purchasedGrowthPerCoin, 3, 1, 100);
  const value = coins * multiplier;
  return Number.isSafeInteger(value) ? value : null;
}

export function applyVipGrowthCap(policy, currentPoints, addedPoints) {
  const current = safeNonNegativeInteger(currentPoints);
  const added = safeNonNegativeInteger(addedPoints);
  const cap = safeNonNegativeInteger(policy?.maxGrowthPoints);
  if (current === null || added === null || cap === null) return null;
  return Math.min(cap, current + added);
}

export function vipDowngradeState(policy, currentLevel) {
  const level = Number(currentLevel);
  if (!Number.isSafeInteger(level) || level < 1 || level > 10) return null;

  if (level === 1) {
    return { level: 0, growthPoints: 0, retentionBps: 0 };
  }

  const lowerLevel = level - 1;
  const lowerThreshold = vipThreshold(policy, lowerLevel);
  const currentThreshold = vipThreshold(policy, level);
  if (lowerThreshold === null || currentThreshold === null) return null;

  // VIP2/VIP3 simply drop one level. VIP4+ retain approved progress
  // inside the lower level toward the lost level.
  if (level <= 3) {
    return {
      level: lowerLevel,
      growthPoints: lowerThreshold,
      retentionBps: 0,
    };
  }

  const rawRetention = policy.downgradeRetentionBps[level - 1];
  const retentionBps = boundedInteger(rawRetention, 0, 0, 10_000);
  const span = BigInt(currentThreshold - lowerThreshold);
  const retained = (span * BigInt(retentionBps)) / 10_000n;
  const growthPoints = Number(BigInt(lowerThreshold) + retained);

  return { level: lowerLevel, growthPoints, retentionBps };
}

export function vipProgress(policy, points) {
  const normalizedPoints = Math.min(
    safeNonNegativeInteger(points) ?? 0,
    policy.maxGrowthPoints,
  );
  const level = vipLevelFromGrowth(policy, normalizedPoints);
  const currentThreshold = level > 0 ? vipThreshold(policy, level) ?? 0 : 0;
  const nextThreshold = level < 10 ? vipThreshold(policy, level + 1) : null;
  const remaining = nextThreshold === null
    ? 0
    : Math.max(0, nextThreshold - normalizedPoints);
  return {
    level,
    points: normalizedPoints,
    currentThreshold,
    nextThreshold,
    remaining,
    maxGrowthPoints: policy.maxGrowthPoints,
  };
}

async function loadPolicyDirect(db, transaction = null) {
  if (typeof db?.get === "function") {
    const doc = await db.get(VIP_CONFIG_PATH, transaction);
    return normalizeVipPolicy(doc.exists ? doc.data : {});
  }
  if (typeof db?.collection === "function") {
    const ref = db.collection("system_config").doc("vip");
    const doc = transaction && typeof transaction.get === "function"
      ? await transaction.get(ref)
      : await ref.get();
    const data = doc.exists
      ? (typeof doc.data === "function" ? doc.data() : doc.data)
      : {};
    return normalizeVipPolicy(data || {});
  }
  throw new Error("unsupported_vip_policy_store");
}

export async function loadVipPolicy(
  db,
  { transaction = null, useCache = transaction == null } = {},
) {
  if (transaction || useCache === false) {
    return loadPolicyDirect(db, transaction);
  }
  return readThroughConfigCache(
    VIP_CONFIG_CACHE_KEY,
    () => loadPolicyDirect(db),
    { ttlMs: 60_000, staleMs: 5 * 60_000 },
  );
}

export function invalidateVipPolicyCache() {
  invalidateConfigCache(VIP_CONFIG_CACHE_KEY);
}
