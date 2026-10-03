import {
  invalidateConfigCache,
  readThroughConfigCache,
} from "./config-cache.js";

export const USER_LEVEL_CONFIG_PATH = "system_config/user_levels";
export const USER_LEVEL_CONFIG_CACHE_KEY = "config:user_levels";
export const USER_LEVEL_POLICY_VERSION = 1;

const WEALTH_THRESHOLDS = Object.freeze([
  0,
  10_000,
  25_000,
  50_000,
  100_000,
  180_000,
  300_000,
  500_000,
  750_000,
  1_000_000,
  3_000_000,
  6_750_000,
  10_000_000,
  15_000_000,
  25_000_000,
  50_000_000,
  92_500_000,
  150_000_000,
  250_000_000,
  400_000_000,
  800_000_000,
  1_540_000_000,
  2_500_000_000,
  4_000_000_000,
  6_000_000_000,
  8_000_000_000,
  9_620_000_000,
  15_000_000_000,
  22_000_000_000,
  30_000_000_000,
  40_000_000_000,
  53_850_000_000,
  75_000_000_000,
  105_000_000_000,
  150_000_000_000,
]);

const ATTRACTION_THRESHOLDS = Object.freeze([
  0,
  10_000,
  25_000,
  50_000,
  100_000,
  200_000,
  350_000,
  550_000,
  850_000,
  1_150_000,
  3_000_000,
  6_750_000,
  10_000_000,
  15_000_000,
  25_000_000,
  50_000_000,
  92_500_000,
  150_000_000,
  250_000_000,
  400_000_000,
  800_000_000,
  1_540_000_000,
  2_500_000_000,
  4_000_000_000,
  6_000_000_000,
  8_000_000_000,
  9_620_000_000,
  15_000_000_000,
  22_000_000_000,
  30_000_000_000,
  40_000_000_000,
  53_850_000_000,
  75_000_000_000,
  105_000_000_000,
  150_000_000_000,
]);

const GAME_THRESHOLDS = Object.freeze([
  200_000,
  1_000_000,
  3_000_000,
  9_620_000,
  18_000_000,
  32_000_000,
  57_700_000,
  110_000_000,
  205_000_000,
  385_000_000,
  625_000_000,
  1_000_000_000,
  1_635_000_000,
  2_450_000_000,
  3_650_000_000,
  5_385_000_000,
  7_300_000_000,
  9_800_000_000,
  13_080_000_000,
  17_500_000_000,
  23_500_000_000,
]);

export const DEFAULT_USER_LEVEL_POLICY = Object.freeze({
  version: USER_LEVEL_POLICY_VERSION,
  wealth: Object.freeze({
    maxLevel: 35,
    thresholds: WEALTH_THRESHOLDS,
  }),
  attraction: Object.freeze({
    maxLevel: 35,
    thresholds: ATTRACTION_THRESHOLDS,
  }),
  games: Object.freeze({
    maxLevel: 21,
    thresholds: GAME_THRESHOLDS,
    inactivityGraceDays: 3,
    inactivityDecayBpsPerDay: 1000,
  }),
});

function safeNonNegativeInteger(value) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number >= 0 ? number : null;
}

export function safeAddUserLevelPoints(currentPoints, addedPoints) {
  const current = safeNonNegativeInteger(currentPoints ?? 0);
  const added = safeNonNegativeInteger(addedPoints);
  if (current === null || added === null) return null;
  const next = current + added;
  return Number.isSafeInteger(next) && next >= 0 ? next : null;
}

export function giftLevelPointAwards({
  nominalCoins = 0,
  paidCoins = 0,
} = {}) {
  const nominal = safeNonNegativeInteger(nominalCoins);
  const paid = safeNonNegativeInteger(paidCoins);
  if (nominal === null || paid === null || paid > nominal) return null;
  return {
    wealthPoints: paid,
    attractionPoints: nominal,
  };
}

function normalizeThresholds(raw, fallback, expectedLength) {
  if (!Array.isArray(raw) || raw.length !== expectedLength) {
    return [...fallback];
  }

  const normalized = [];
  let previous = -1;
  for (const value of raw) {
    const number = safeNonNegativeInteger(value);
    if (number === null || number <= previous) {
      return [...fallback];
    }
    normalized.push(number);
    previous = number;
  }
  return normalized;
}

function boundedInteger(value, fallback, min, max) {
  const number = Number(value);
  if (!Number.isSafeInteger(number)) return fallback;
  return Math.max(min, Math.min(max, number));
}

export function normalizeUserLevelPolicy(raw = {}) {
  const data = raw && typeof raw === "object" ? raw : {};
  return {
    version: boundedInteger(
      data.version,
      USER_LEVEL_POLICY_VERSION,
      1,
      Number.MAX_SAFE_INTEGER,
    ),
    wealth: {
      maxLevel: 35,
      thresholds: normalizeThresholds(
        data.wealthThresholds,
        WEALTH_THRESHOLDS,
        35,
      ),
    },
    attraction: {
      maxLevel: 35,
      thresholds: normalizeThresholds(
        data.attractionThresholds,
        ATTRACTION_THRESHOLDS,
        35,
      ),
    },
    games: {
      maxLevel: 21,
      thresholds: normalizeThresholds(
        data.gameThresholds,
        GAME_THRESHOLDS,
        21,
      ),
      inactivityGraceDays: boundedInteger(
        data.gameInactivityGraceDays,
        3,
        1,
        30,
      ),
      inactivityDecayBpsPerDay: boundedInteger(
        data.gameInactivityDecayBpsPerDay,
        1000,
        1,
        9999,
      ),
    },
  };
}

export function levelMinimumThreshold(policy, level) {
  const thresholds = Array.isArray(policy?.thresholds)
    ? policy.thresholds
    : [];
  const targetLevel = Number(level);
  if (
    !Number.isSafeInteger(targetLevel) ||
    targetLevel < 1 ||
    targetLevel > thresholds.length
  ) {
    return null;
  }
  return thresholds[targetLevel - 1];
}

export function levelFromPoints(policy, points) {
  const thresholds = Array.isArray(policy?.thresholds)
    ? policy.thresholds
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

export function levelProgress(policy, points) {
  const thresholds = Array.isArray(policy?.thresholds)
    ? policy.thresholds
    : [];
  const maxLevel = thresholds.length;
  const normalizedPoints = safeNonNegativeInteger(points) ?? 0;
  const level = levelFromPoints({ thresholds }, normalizedPoints);

  if (!maxLevel) {
    return {
      level: 0,
      maxLevel: 0,
      points: normalizedPoints,
      minimumThreshold: 0,
      nextThreshold: null,
      remaining: 0,
      progressBps: 0,
    };
  }

  if (level >= maxLevel) {
    const minimumThreshold = thresholds[maxLevel - 1];
    return {
      level: maxLevel,
      maxLevel,
      points: normalizedPoints,
      minimumThreshold,
      nextThreshold: null,
      remaining: 0,
      progressBps: 10000,
    };
  }

  const minimumThreshold = level > 0 ? thresholds[level - 1] : 0;
  const nextThreshold = thresholds[level];
  const span = Math.max(1, nextThreshold - minimumThreshold);
  const gained = Math.max(
    0,
    Math.min(span, normalizedPoints - minimumThreshold),
  );
  const progressBps = Math.max(
    0,
    Math.min(10000, Math.floor((gained * 10000) / span)),
  );

  return {
    level,
    maxLevel,
    points: normalizedPoints,
    minimumThreshold,
    nextThreshold,
    remaining: Math.max(0, nextThreshold - normalizedPoints),
    progressBps,
  };
}

export function userLevelSummaries(policy, {
  wealthPoints = 0,
  attractionPoints = 0,
  gamePoints = 0,
} = {}) {
  const normalized = normalizeUserLevelPolicy({
    version: policy?.version,
    wealthThresholds: policy?.wealth?.thresholds,
    attractionThresholds: policy?.attraction?.thresholds,
    gameThresholds: policy?.games?.thresholds,
    gameInactivityGraceDays: policy?.games?.inactivityGraceDays,
    gameInactivityDecayBpsPerDay: policy?.games?.inactivityDecayBpsPerDay,
  });
  return {
    wealth: levelProgress(normalized.wealth, wealthPoints),
    attraction: levelProgress(normalized.attraction, attractionPoints),
    games: levelProgress(normalized.games, gamePoints),
  };
}

async function loadPolicyDirect(db, transaction = null) {
  const doc = await db.get(USER_LEVEL_CONFIG_PATH, transaction);
  return normalizeUserLevelPolicy(doc.exists ? doc.data : {});
}

export async function loadUserLevelPolicy(
  db,
  { transaction = null, useCache = transaction == null } = {},
) {
  if (transaction || useCache === false) {
    return loadPolicyDirect(db, transaction);
  }
  return readThroughConfigCache(
    USER_LEVEL_CONFIG_CACHE_KEY,
    () => loadPolicyDirect(db),
    { ttlMs: 60_000, staleMs: 5 * 60_000 },
  );
}

export function invalidateUserLevelPolicyCache() {
  invalidateConfigCache(USER_LEVEL_CONFIG_CACHE_KEY);
}
