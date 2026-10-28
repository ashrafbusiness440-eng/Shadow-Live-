// Store management only: no purchasing, entitlement, grants or currency writes.
// The user-facing store is deliberately NOT activated by this catalog.
export const STORE_CATEGORIES = Object.freeze({
  frames: "الإطارات",
  entranceEffects: "الدخوليات",
  profileCards: "البطاقات التعريفية",
  voiceWaves: "الموجات الصوتية",
  chatBubbles: "فقاعات الدردشة",
  roomFrames: "إطارات الغرف",
  backgrounds: "الخلفيات",
  nameEffects: "تأثيرات الاسم",
});
export const STORE_DURATIONS = Object.freeze([0, 3, 7, 30]);
const RARITIES = new Set(["normal", "rare", "epic", "legendary"]);
const has = (obj, field) => Object.prototype.hasOwnProperty.call(obj, field);
const clean = (value) => String(value ?? "").trim();

export function normalizeStoreCatalogItems(raw) {
  if (!Array.isArray(raw) || raw.length > 100) {
    throw Error("invalid_store_catalog");
  }
  const used = new Set();
  return raw.map((value) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw Error("invalid_store_item");
    }
    const id = clean(value.id);
    const nameAr = clean(value.nameAr);
    const category = clean(value.category);
    const assetKey = clean(value.assetKey);
    const rarity = clean(value.rarity || "normal");
    const priceCoins = value.priceCoins;
    const durationDays = value.durationDays;
    const sortOrder = value.sortOrder;
    if (!/^[1-9][0-9]{5,8}$/.test(id) || used.has(id)) {
      throw Error("invalid_store_item_id");
    }
    used.add(id);
    if (nameAr.length < 2 || nameAr.length > 70 ||
        !has(STORE_CATEGORIES, category)) {
      throw Error("invalid_store_item_details");
    }
    if (!Number.isSafeInteger(priceCoins) || priceCoins < 0 ||
        priceCoins > 2_000_000_000 ||
        !Number.isSafeInteger(durationDays) ||
        !STORE_DURATIONS.includes(durationDays) ||
        !Number.isSafeInteger(sortOrder) || sortOrder < 0 || sortOrder > 10000 ||
        !RARITIES.has(rarity)) {
      throw Error("invalid_store_item_details");
    }
    if (!/^store\.[a-z][A-Za-z0-9]*\.[1-9][0-9]{5,8}\.icon$/.test(assetKey) ||
        assetKey !== `store.${category}.${id}.icon`) {
      throw Error("invalid_store_asset_key");
    }
    if (typeof value.enabled !== "boolean") {
      throw Error("invalid_store_item_details");
    }
    return { id, nameAr, category, priceCoins, durationDays,
      sortOrder, rarity, enabled: value.enabled, assetKey };
  });
}

export function validateStoreCatalogUpdate(previous = {}, proposed = [], expectedRevision) {
  const revision = Number(previous.revision ?? 0);
  if (!Number.isSafeInteger(revision) || revision < 0 ||
      !Number.isSafeInteger(expectedRevision) ||
      expectedRevision !== revision) throw Error("store_catalog_conflict");
  const items = normalizeStoreCatalogItems(proposed);
  const previousItems = Array.isArray(previous.items) ? previous.items : [];
  const nextIds = new Set(items.map((item) => item.id));
  for (const item of previousItems) {
    if (!nextIds.has(String(item.id))) {
      throw Error("store_catalog_existing_id_missing");
    }
  }
  const beforeById = new Map(previousItems.map((item) => [String(item.id), item]));
  const changed = items.filter(item => JSON.stringify(beforeById.get(item.id)) !== JSON.stringify(item));
  return { revision: revision + 1, items, changedIds: changed.map(item => item.id) };
}

export function nextStoreNumericId(raw) {
  const occupied = new Set((raw || []).map(item => String(item.id)));
  for (let id = 200001; id < 1_000_000_000; id++) {
    if (!occupied.has(String(id))) return String(id);
  }
  throw Error("store_id_space_exhausted");
}
