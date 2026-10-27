// Policy for safe, revisioned administrative edits to the existing Gift Catalog.
// This does not implement gift sending or change historical ledger entries.
const protectedCategories = new Set(["vip", "cp", "friends"]);
const auditedFields = [
  "nameAr", "priceCoins", "category", "enabled", "featured",
  "minVipLevel", "sortOrder", "assetKey", "effectAssetKey",
  "effectMode", "effectMinQuantity", "effectDurationMs",
  "effectSize", "effectSoundAssetKey", "premiumBannerMinQuantity",
  "affinityBasePoints", "allowedContexts", "visibleFromMs", "visibleUntilMs",
];

export function validateGiftCatalogUpdate(previousConfig, nextGifts, expectedRevision) {
  const previousRevision = Number(previousConfig?.revision ?? 0);
  if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0 ||
      !Number.isSafeInteger(previousRevision) || previousRevision < 0) {
    throw Error("invalid_catalog_revision");
  }
  if (previousRevision !== expectedRevision) throw Error("gift_catalog_conflict");

  const previousGifts = Array.isArray(previousConfig?.gifts)
    ? previousConfig.gifts : [];
  const nextById = new Map(nextGifts.map((gift) => [gift.id, gift]));
  const previousById = new Map(previousGifts.map((gift) => [gift.id, gift]));

  // Old IDs are immutable because bags, feeds, and ledger rows refer to them.
  // To discontinue a gift, disable it instead of deleting or renaming it.
  for (const oldGift of previousGifts) {
    if (!oldGift || !oldGift.id) continue;
    const updated = nextById.get(oldGift.id);
    if (!updated) throw Error("gift_catalog_existing_id_missing");
    if (oldGift.category !== updated.category &&
        (protectedCategories.has(oldGift.category) ||
         protectedCategories.has(updated.category))) {
      throw Error("gift_catalog_restricted_category");
    }
  }

  const changes = [];
  for (const gift of nextGifts) {
    const oldGift = previousById.get(gift.id);
    const modified = {};
    for (const field of auditedFields) {
      const before = oldGift?.[field] ?? null;
      const after = gift[field] ?? null;
      const same = Array.isArray(before) && Array.isArray(after)
        ? before.length === after.length && before.every((value, i) => value === after[i])
        : before === after;
      if (!same) modified[field] = { before, after };
    }
    if (Object.keys(modified).length > 0) {
      changes.push({ giftId: gift.id, fields: modified });
    }
  }
  return { revision: previousRevision + 1, changes };
}
