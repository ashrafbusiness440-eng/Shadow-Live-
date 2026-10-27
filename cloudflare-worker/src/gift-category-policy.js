// Category metadata for the existing Gift Catalog. Category IDs are immutable
// because eligibility, historical gifts and client tabs reference them.
export const DEFAULT_GIFT_CATEGORIES = Object.freeze([
  ["general", "هدايا"], ["countries", "دول"], ["celebrities", "مشاهير"],
  ["vip", "امتياز"], ["lucky", "محظوظ"], ["activities", "أنشطة"],
  ["cp", "CP"], ["friends", "أصدقاء"],
].map(([id, nameAr], sortOrder) => ({
  id, nameAr, enabled: true, sortOrder, assetKey: "",
})));

const PROTECTED_IDS = new Set(["vip", "cp", "friends"]);
const CATEGORY_ID = /^[a-z][a-z0-9_]{1,31}$/;
const ASSET_KEY = /^[a-z0-9][a-z0-9._-]{2,119}$/;

export function giftCategoryDefinitions(config = {}) {
  // Old configs only contain a string array; those must keep working.
  if (!Array.isArray(config?.categoryDefinitions)) {
    return DEFAULT_GIFT_CATEGORIES.map((item) => ({ ...item }));
  }
  return config.categoryDefinitions;
}

export function validateGiftCategoryDefinitions(raw, oldConfig = {}, gifts = []) {
  if (!Array.isArray(raw) || raw.length < 1 || raw.length > 30) {
    throw Error("invalid_gift_categories");
  }
  const previous = giftCategoryDefinitions(oldConfig);
  const seen = new Set();
  const definitions = raw.map((entry, index) => {
    const id = String(entry?.id ?? "").trim();
    const nameAr = String(entry?.nameAr ?? "").trim();
    const assetKey = String(entry?.assetKey ?? "").trim();
    if (!CATEGORY_ID.test(id) || seen.has(id)) {
      throw Error("invalid_gift_category_id");
    }
    if (!nameAr || nameAr.length > 64) throw Error("invalid_gift_category_name");
    if (assetKey && !ASSET_KEY.test(assetKey)) throw Error("invalid_gift_category_asset");
    seen.add(id);
    return {
      id, nameAr, assetKey,
      enabled: entry?.enabled !== false,
      sortOrder: index,
    };
  });
  // Existing categories must never silently disappear. This protects older
  // catalog data as well as hard-coded VIP/CP/Friends eligibility policies.
  for (const old of previous) {
    if (!seen.has(old.id)) throw Error("gift_category_missing");
  }
  for (const gift of gifts) {
    if (gift?.category && !seen.has(gift.category)) {
      throw Error("gift_category_in_use");
    }
  }
  for (const id of PROTECTED_IDS) {
    if (!seen.has(id)) throw Error("gift_category_missing");
  }
  return definitions;
}

export function giftCategoryEnabled(config, category) {
  const definitions = giftCategoryDefinitions(config);
  const item = definitions.find((entry) => entry.id === category);
  return item?.enabled === true;
}

export function giftCategoryIdSet(config) {
  return new Set(giftCategoryDefinitions(config).map((entry) => entry.id));
}
