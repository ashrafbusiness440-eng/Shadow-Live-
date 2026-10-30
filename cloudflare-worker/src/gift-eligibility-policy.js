// Gift send eligibility is authoritative on the server. The picker only
// mirrors it to show a disabled card; it never grants permission to spend.
export const GIFT_WEALTH_MIN_LEVELS = Object.freeze([0, 11, 16, 21, 26, 31]);

export function normalizedGiftWealthMinimum(gift = {}) {
  const level = Number(gift.minWealthLevel ?? 0);
  if (!GIFT_WEALTH_MIN_LEVELS.includes(level)) {
    throw Error("invalid_gift_wealth_level");
  }
  return level;
}

export function normalizedGiftVipMinimum(gift = {}) {
  const level = Number(gift.minVipLevel ?? (gift.category === "vip" ? 4 : 0));
  if (!Number.isSafeInteger(level) || level < 0 || level > 10 ||
      (gift.category === "vip" && level < 4)) {
    throw Error("invalid_gift_vip_level");
  }
  return level;
}

export function validateGiftEligibility(gift = {}) {
  const minVipLevel = normalizedGiftVipMinimum(gift);
  const minWealthLevel = normalizedGiftWealthMinimum(gift);
  if (minVipLevel > 0 && minWealthLevel > 0) {
    throw Error("invalid_gift_eligibility_combination");
  }
  return { minVipLevel, minWealthLevel };
}

export function giftEligibilityFailure(gift, {vipLevel = 0, wealthLevel = 0} = {}) {
  const { minVipLevel, minWealthLevel } = validateGiftEligibility(gift);
  if (minVipLevel > 0 && vipLevel < minVipLevel) return "vip_gift_requires_level";
  if (minWealthLevel > 0 && wealthLevel < minWealthLevel) {
    return "wealth_gift_requires_level";
  }
  return "";
}
