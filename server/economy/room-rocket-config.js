export const DEFAULT_ROOM_ROCKET_POLICY = Object.freeze({
  enabled: true,
  thresholds: [100000, 500000, 1000000, 5000000],
  burstDelaySeconds: 10,
  rewardWindowSeconds: 60,
  contributorWeightMultiplierBps: 25000,
  excludeLuckyGifts: true,
  rewardTypes: ["coins", "profile_frame", "entrance_effect"],
  vipRewardsEnabled: false,
});

export function validateRoomRocketPolicy(raw = {}) {
  const thresholds = Array.isArray(raw.thresholds) ? raw.thresholds.map(Number) : [...DEFAULT_ROOM_ROCKET_POLICY.thresholds];
  if (thresholds.length !== 4 || thresholds.some((v) => !Number.isSafeInteger(v) || v <= 0)) {
    throw Error("rocket_requires_four_valid_levels");
  }
  for (let i = 1; i < thresholds.length; i += 1) {
    if (thresholds[i] <= thresholds[i - 1]) throw Error("invalid_rocket_threshold_order");
  }
  return {
    ...DEFAULT_ROOM_ROCKET_POLICY,
    ...raw,
    thresholds,
    excludeLuckyGifts: true,
    rewardTypes: ["coins", "profile_frame", "entrance_effect"],
    vipRewardsEnabled: false,
  };
}

export function rocketEligibility({ presentAtBurst, joinedDuringRewardWindow }) {
  return presentAtBurst === true || joinedDuringRewardWindow === true;
}

export function rocketRewardWeightBps({ contributionCoins = 0, totalContributionCoins = 0, contributorWeightMultiplierBps = 25000 }) {
  if (contributionCoins <= 0 || totalContributionCoins <= 0) return 10000;
  const shareBps = Math.min(10000, Math.floor((contributionCoins * 10000) / totalContributionCoins));
  return 10000 + Math.floor((shareBps * contributorWeightMultiplierBps) / 10000);
}
// The Room Rocket is filled by room gifts, carries overflow across levels,
// and is independent from Lucky Gifts. Reward distribution is server-side.
