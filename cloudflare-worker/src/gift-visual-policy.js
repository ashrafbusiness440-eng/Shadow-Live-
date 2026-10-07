const clean = (value) => String(value ?? "").trim();

function safeInteger(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : fallback;
}

export function giftVisualPolicy(gift = {}, quantity = 1) {
  const count = safeInteger(quantity, 1);
  const effectMode = clean(gift.effectMode || "none");
  const effectMinQuantity = Math.max(
    0,
    safeInteger(gift.effectMinQuantity, 0),
  );
  const premiumBannerMinQuantity = Math.max(
    0,
    safeInteger(gift.premiumBannerMinQuantity, 0),
  );
  const effectEligible =
    count > 0 &&
    effectMinQuantity > 0 &&
    count >= effectMinQuantity &&
    (effectMode === "seat" || effectMode === "cinematic");
  const premiumEligible =
    count > 0 &&
    premiumBannerMinQuantity > 0 &&
    count >= premiumBannerMinQuantity;

  return {
    isAnimated: gift.isAnimated === true,
    roomEffect: effectEligible
      ? {
          mode: effectMode,
          assetKey: clean(
            gift.effectAssetKey ||
              gift.assetKey ||
              "gifts.placeholder.default",
          ),
          soundAssetKey: clean(gift.effectSoundAssetKey),
          durationMs: Math.max(
            300,
            Math.min(12000, safeInteger(gift.effectDurationMs, 2200)),
          ),
          minQuantity: effectMinQuantity,
        }
      : null,
    premiumBanner: premiumEligible
      ? {
          minQuantity: premiumBannerMinQuantity,
          assetKey: clean(
            gift.effectAssetKey ||
              gift.assetKey ||
              "gifts.placeholder.default",
          ),
        }
      : null,
  };
}

export function premiumGiftCelebrationEvent({
  operationId,
  gift,
  quantity,
  totalCost,
  sender = {},
  receiver = {},
  roomId = "",
  nowMs = Date.now(),
} = {}) {
  const policy = giftVisualPolicy(gift, quantity);
  if (!policy.premiumBanner) return null;
  const id = clean(operationId);
  if (!id) return null;

  const startsAtMs = Math.max(1, safeInteger(nowMs, Date.now()));
  const endsAtMs = startsAtMs + 6500;
  return {
    eventId: "premium_gift_" + id,
    kind: "premium_gift",
    startsAtMs,
    endsAtMs,
    uid: clean(sender.uid),
    displayName: clean(sender.displayName) || "مستخدم Shadow Live",
    profileImageUrl: clean(sender.profileImageUrl),
    publicId: clean(sender.publicId),
    secondaryUid: clean(receiver.uid),
    secondaryDisplayName: clean(receiver.displayName),
    secondaryProfileImageUrl: clean(receiver.profileImageUrl),
    giftId: clean(gift.id),
    giftName: clean(gift.nameAr || "هدية فاخرة"),
    giftQuantity: safeInteger(quantity, 1),
    giftTotalCoins: Math.max(0, safeInteger(totalCost, 0)),
    assetKey: policy.premiumBanner.assetKey,
    roomId: clean(roomId),
  };
}
