export const DEFAULT_LUCKY_GIFT_POLICY = Object.freeze({
  enabled: true,
  rewardAsset: "coins",
  maxRewardCoins: 50000000,
  allowedPrices: [100,200,500,600,1000,2500,5000,6000,10000,25000,50000],
  outcomes: [
    { multiplierBps: 0, probabilityBps: 5900 },
    { multiplierBps: 5000, probabilityBps: 1800 },
    { multiplierBps: 10000, probabilityBps: 1100 },
    { multiplierBps: 20000, probabilityBps: 800 },
    { multiplierBps: 50000, probabilityBps: 300 },
    { multiplierBps: 100000, probabilityBps: 80 },
    { multiplierBps: 500000, probabilityBps: 18 },
    { multiplierBps: 1000000, probabilityBps: 2 },
  ],
});

export function luckyRtpBps(outcomes = DEFAULT_LUCKY_GIFT_POLICY.outcomes) {
  return Math.round(outcomes.reduce(
    (sum, item) => sum + Number(item.multiplierBps || 0) * Number(item.probabilityBps || 0),
    0,
  ) / 10000);
}

export function validateLuckyGiftPolicy(raw = {}) {
  const outcomes = Array.isArray(raw.outcomes) ? raw.outcomes : DEFAULT_LUCKY_GIFT_POLICY.outcomes;
  if (outcomes.length < 2 || outcomes.length > 20) throw Error("invalid_lucky_outcomes");
  const probabilityTotal = outcomes.reduce((sum, item) => sum + Number(item.probabilityBps || 0), 0);
  if (probabilityTotal !== 10000) throw Error("lucky_probability_total_must_equal_10000");
  return {
    ...DEFAULT_LUCKY_GIFT_POLICY,
    ...raw,
    rewardAsset: "coins",
    outcomes,
    actualRtpBps: luckyRtpBps(outcomes),
  };
}
// Lucky Gifts are independent from the Room Rocket. They never fill the rocket pool.
