// Public catalog projection: no administrator metadata, drafts, grants, or Coins mutations.
import {json, firestoreQuotaResponse} from "./http.js";
import {firestoreClient} from "./firestore.js";
import {readThroughConfigCache} from "./config-cache.js";
import {STORE_CATEGORIES, STORE_DURATIONS} from "./store-catalog-policy.js";

const CONFIG_PATH = "system_config/store_catalog";
const clean = (value) => String(value ?? "").trim();
const RARITIES = new Set(["normal", "rare", "epic", "legendary"]);

export function selectPublicStoreItems(items, nowMs = Date.now()) {
  if (!Number.isSafeInteger(nowMs) || nowMs < 0) return [];
  if (!Array.isArray(items)) return [];
  return items.filter((item) => {
    if (!item || typeof item !== "object" || item.enabled !== true) return false;
    const id = clean(item.id);
    return /^[1-9][0-9]{5,8}$/.test(id) &&
      typeof item.nameAr === "string" && item.nameAr.trim().length >= 2 &&
      Object.hasOwn(STORE_CATEGORIES, clean(item.category)) &&
      Number.isSafeInteger(item.priceCoins) && item.priceCoins >= 0 &&
      STORE_DURATIONS.includes(item.durationDays) &&
      RARITIES.has(item.rarity) &&
      Number.isSafeInteger(item.minVipLevel) &&
      item.minVipLevel >= 0 && item.minVipLevel <= 10 &&
      Number.isSafeInteger(item.minWealthLevel ?? 0) &&
      (item.minWealthLevel ?? 0) >= 0 && (item.minWealthLevel ?? 0) <= 35 &&
      (item.visibleFromMs == null || (
        Number.isSafeInteger(item.visibleFromMs) && item.visibleFromMs >= 0 &&
        item.visibleFromMs <= 4_102_444_800_000 &&
        nowMs >= item.visibleFromMs)) &&
      (item.visibleUntilMs == null || (
        Number.isSafeInteger(item.visibleUntilMs) && item.visibleUntilMs >= 0 &&
        item.visibleUntilMs <= 4_102_444_800_000 &&
        nowMs < item.visibleUntilMs)) &&
      !(item.visibleFromMs != null && item.visibleUntilMs != null &&
        item.visibleFromMs >= item.visibleUntilMs) &&
      Number.isSafeInteger(item.sortOrder) &&
      item.assetKey === `store.item.${id}.icon`;
  }).map(item => ({
    id: clean(item.id), nameAr: clean(item.nameAr),
    category: clean(item.category),
    priceCoins: item.priceCoins, durationDays: item.durationDays,
    rarity: item.rarity, minVipLevel: item.minVipLevel,
    minWealthLevel: item.minWealthLevel ?? 0,
    assetKey: item.assetKey, sortOrder: item.sortOrder,
  })).sort((a,b) => a.sortOrder - b.sortOrder || a.id.localeCompare(b.id))
    .slice(0, 100);
}

export async function publicStoreCatalog(request, env) {
  if (request.method !== "GET") {
    return json(request, env, {ok:false,code:"method_not_allowed"}, 405);
  }
  try {
    // Cache the raw snapshot, not a time-filtered result: scheduled items
    // appear/disappear at the exact request boundary even with a warm cache.
    const rawItems = await readThroughConfigCache("store:public-catalog:v2", async () => {
      const snapshot = await firestoreClient(env).get(CONFIG_PATH);
      return snapshot.data?.items ?? [];
    }, {ttlMs:15_000,staleMs:15_000,allowStaleOnError:false});
    const items = selectPublicStoreItems(rawItems, Date.now());
    return json(request, env, {
      ok:true, purchasingEnabled:false,
      categories: STORE_CATEGORIES,
      durations: STORE_DURATIONS,
      items,
    }, 200, {"Cache-Control":"no-store"});
  } catch (error) {
    const quota = firestoreQuotaResponse(request,env,error);
    if (quota) return quota;
    return json(request,env,{ok:false,code:"store_catalog_unavailable"},503);
  }
}
