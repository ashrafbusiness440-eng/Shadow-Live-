const DEFAULT_LEVELS = [
  {
    id: "lv1",
    level: 1,
    thresholdCoins: 100000,
    winProbabilityBps: 3000,
    coinPrizes: [
      { coins: 100, weight: 45 },
      { coins: 300, weight: 30 },
      { coins: 500, weight: 18 },
      { coins: 1000, weight: 7 },
    ],
  },
  {
    id: "lv2",
    level: 2,
    thresholdCoins: 500000,
    winProbabilityBps: 3000,
    coinPrizes: [
      { coins: 500, weight: 40 },
      { coins: 1000, weight: 30 },
      { coins: 2500, weight: 20 },
      { coins: 5000, weight: 10 },
    ],
  },
  {
    id: "lv3",
    level: 3,
    thresholdCoins: 1000000,
    winProbabilityBps: 3000,
    coinPrizes: [
      { coins: 1000, weight: 40 },
      { coins: 3000, weight: 30 },
      { coins: 7000, weight: 20 },
      { coins: 15000, weight: 10 },
    ],
  },
  {
    id: "lv4",
    level: 4,
    thresholdCoins: 5000000,
    winProbabilityBps: 3000,
    coinPrizes: [
      { coins: 5000, weight: 40 },
      { coins: 10000, weight: 30 },
      { coins: 25000, weight: 20 },
      { coins: 50000, weight: 10 },
    ],
  },
];

export function defaultRoomRocketConfig() {
  return {
    enabled: true,
    explosionDurationSeconds: 10,
    winProbabilityBps: 3000,
    topContributorAttempts: 2,
    regularAttempts: 1,
    cosmeticDurationHours: [24, 72, 168],
    cosmeticStackCapHours: 720,
    noWinMessageAr: "حظ أوفر في المرة القادمة",
    rewardTypes: ["coins", "frame", "entrance", "voice_wave", "room_background"],
    vipRewardEnabled: false,
    levels: DEFAULT_LEVELS.map((level) => ({
      ...level,
      coinPrizes: level.coinPrizes.map((item) => ({ ...item })),
      frameRewards: [],
      entranceRewards: [],
      voiceWaveRewards: [],
      roomBackgroundRewards: [],
    })),
  };
}

function clean(value) {
  return String(value ?? "").trim();
}

function integer(value, code, min, max) {
  const n = Number(value);
  if (!Number.isSafeInteger(n) || n < min || n > max) throw Error(code);
  return n;
}

function normalizeCoinPrizes(raw, fallback) {
  const source = Array.isArray(raw) && raw.length ? raw : fallback;
  if (source.length > 50) throw Error("too_many_coin_prizes");
  return source.map((item) => ({
    coins: integer(item?.coins, "invalid_coin_prize", 1, 1000000000),
    weight: integer(item?.weight, "invalid_reward_weight", 1, 1000000),
  }));
}

function normalizeCosmeticRewards(raw, type) {
  if (!Array.isArray(raw)) return [];
  if (raw.length > 100) throw Error("too_many_cosmetic_rewards");
  return raw.map((item) => {
    const id = clean(item?.id);
    if (!/^[A-Za-z0-9_.-]{1,120}$/.test(id)) throw Error("invalid_reward_id");
    return {
      id,
      type,
      durationHours: integer(item?.durationHours, "invalid_reward_duration", 1, 8760),
      weight: integer(item?.weight, "invalid_reward_weight", 1, 1000000),
      overflowCoins: integer(item?.overflowCoins ?? 0, "invalid_overflow_coins", 0, 1000000000),
      nameAr: clean(item?.nameAr),
      assetKey: clean(item?.assetKey),
      imageUrl: clean(item?.imageUrl),
      enabled: item?.enabled !== false,
    };
  });
}

export function normalizeRoomRocketConfig(raw = {}) {
  const defaults = defaultRoomRocketConfig();
  const sourceLevels = Array.isArray(raw.levels) && raw.levels.length === 4
    ? raw.levels
    : defaults.levels;

  const levels = sourceLevels.map((item, index) => {
    const fallback = defaults.levels[index];
    return {
      id: fallback.id,
      level: index + 1,
      thresholdCoins: integer(
        item?.thresholdCoins ?? fallback.thresholdCoins,
        "invalid_rocket_threshold",
        1,
        1000000000000,
      ),
      winProbabilityBps: integer(
        item?.winProbabilityBps ?? raw.winProbabilityBps ?? fallback.winProbabilityBps,
        "invalid_win_probability",
        0,
        10000,
      ),
      coinPrizes: normalizeCoinPrizes(item?.coinPrizes, fallback.coinPrizes),
      frameRewards: normalizeCosmeticRewards(item?.frameRewards, "frame"),
      entranceRewards: normalizeCosmeticRewards(item?.entranceRewards, "entrance"),
      voiceWaveRewards: normalizeCosmeticRewards(item?.voiceWaveRewards, "voice_wave"),
      roomBackgroundRewards: normalizeCosmeticRewards(
        item?.roomBackgroundRewards,
        "room_background",
      ),
    };
  });

  return {
    enabled: raw.enabled !== false,
    explosionDurationSeconds: integer(
      raw.explosionDurationSeconds ?? defaults.explosionDurationSeconds,
      "invalid_explosion_duration",
      1,
      300,
    ),
    winProbabilityBps: integer(
      raw.winProbabilityBps ?? defaults.winProbabilityBps,
      "invalid_win_probability",
      0,
      10000,
    ),
    regularAttempts: 1,
    topContributorAttempts: 2,
    cosmeticDurationHours: Array.isArray(raw.cosmeticDurationHours)
      ? raw.cosmeticDurationHours.map((value) =>
          integer(value, "invalid_reward_duration", 1, 8760))
      : defaults.cosmeticDurationHours,
    cosmeticStackCapHours: integer(
      raw.cosmeticStackCapHours ?? defaults.cosmeticStackCapHours,
      "invalid_stack_cap",
      1,
      8760,
    ),
    noWinMessageAr: clean(raw.noWinMessageAr) || defaults.noWinMessageAr,
    rewardTypes: ["coins", "frame", "entrance", "voice_wave", "room_background"],
    vipRewardEnabled: false,
    levels,
  };
}

function normalizeContributorMap(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const result = {};
  for (const [uid, item] of Object.entries(raw)) {
    if (!uid) continue;
    const coins = Math.max(0, Number(item?.coins || 0));
    if (!Number.isFinite(coins) || coins <= 0) continue;
    result[uid] = {
      uid,
      coins: Math.floor(coins),
      displayName: clean(item?.displayName),
      profileImageUrl: clean(item?.profileImageUrl),
    };
  }
  return result;
}

function sortedContributors(map) {
  return Object.values(map).sort((a, b) => {
    if (b.coins !== a.coins) return b.coins - a.coins;
    return a.uid.localeCompare(b.uid);
  });
}

function addContribution(map, sender, coins) {
  const previous = map[sender.uid] || {
    uid: sender.uid,
    coins: 0,
    displayName: sender.displayName,
    profileImageUrl: sender.profileImageUrl,
  };
  map[sender.uid] = {
    uid: sender.uid,
    coins: previous.coins + coins,
    displayName: sender.displayName || previous.displayName,
    profileImageUrl: sender.profileImageUrl || previous.profileImageUrl,
  };
}

export function advanceRoomRocket({
  state = {},
  config = {},
  roomId,
  sender,
  contributionCoins,
  nowMs = Date.now(),
  operationId = "",
}) {
  const policy = normalizeRoomRocketConfig(config);
  if (!policy.enabled) {
    return {
      nextState: {
        cycleNumber: Math.max(1, Number(state?.cycleNumber || 1)),
        levelIndex: Math.min(3, Math.max(0, Number(state?.levelIndex || 0))),
        progressCoins: Math.max(0, Number(state?.progressCoins || 0)),
        levelContributors: normalizeContributorMap(state?.levelContributors),
        queueAvailableAtMs: Math.max(0, Number(state?.queueAvailableAtMs || 0)),
      },
      explosions: [],
    };
  }

  const contribution = integer(
    contributionCoins,
    "invalid_rocket_contribution",
    1,
    1000000000000,
  );
  if (!sender?.uid) throw Error("invalid_rocket_sender");

  let cycleNumber = Math.max(1, Math.floor(Number(state?.cycleNumber || 1)));
  let levelIndex = Math.min(3, Math.max(0, Math.floor(Number(state?.levelIndex || 0))));
  let progressCoins = Math.max(0, Math.floor(Number(state?.progressCoins || 0)));
  let contributors = normalizeContributorMap(state?.levelContributors);
  let queueAvailableAtMs = Math.max(nowMs, Math.floor(Number(state?.queueAvailableAtMs || 0)));
  let remaining = contribution;
  const explosions = [];
  let sequence = Math.max(0, Math.floor(Number(state?.explosionSequence || 0)));

  while (remaining > 0) {
    const level = policy.levels[levelIndex];
    if (progressCoins >= level.thresholdCoins) progressCoins = 0;
    const needed = level.thresholdCoins - progressCoins;
    const consumed = Math.min(remaining, needed);
    addContribution(contributors, sender, consumed);
    progressCoins += consumed;
    remaining -= consumed;

    if (progressCoins < level.thresholdCoins) break;

    sequence += 1;
    const ranked = sortedContributors(contributors);
    const startAtMs = queueAvailableAtMs;
    const endAtMs = startAtMs + policy.explosionDurationSeconds * 1000;
    const operationToken = clean(operationId).slice(0, 200);
    const explosionId = operationToken
      ? operationToken + "_rocket_" + sequence
      : "rocket_" + String(nowMs) + "_" + sequence;

    explosions.push({
      explosionId,
      roomId: clean(roomId),
      cycleNumber,
      level: levelIndex + 1,
      thresholdCoins: level.thresholdCoins,
      startsAtMs: startAtMs,
      endsAtMs: endAtMs,
      durationSeconds: policy.explosionDurationSeconds,
      winProbabilityBps: level.winProbabilityBps,
      triggerUid: sender.uid,
      triggerDisplayName: clean(sender.displayName),
      triggerProfileImageUrl: clean(sender.profileImageUrl),
      contributors: ranked,
      contributorIds: ranked.map((item) => item.uid),
      top3: ranked.slice(0, 3),
      rewardTypes: policy.rewardTypes,
      rewardPool: {
        coinPrizes: level.coinPrizes.map((item) => ({ ...item })),
        frameRewards: level.frameRewards.map((item) => ({ ...item })),
        entranceRewards: level.entranceRewards.map((item) => ({ ...item })),
        voiceWaveRewards: level.voiceWaveRewards.map((item) => ({ ...item })),
        roomBackgroundRewards: level.roomBackgroundRewards.map((item) => ({ ...item })),
      },
      cosmeticStackCapHours: policy.cosmeticStackCapHours,
      noWinMessageAr: policy.noWinMessageAr,
      regularAttempts: 1,
      topContributorAttempts: 2,
      vipRewardEnabled: false,
      status: "queued",
    });

    queueAvailableAtMs = endAtMs;
    progressCoins = 0;
    contributors = {};
    levelIndex += 1;
    if (levelIndex >= policy.levels.length) {
      levelIndex = 0;
      cycleNumber += 1;
    }
  }

  return {
    nextState: {
      cycleNumber,
      levelIndex,
      currentLevel: levelIndex + 1,
      progressCoins,
      levelThresholdCoins: policy.levels[levelIndex].thresholdCoins,
      levelContributors: contributors,
      queueAvailableAtMs,
      explosionSequence: sequence,
    },
    explosions,
  };
}
