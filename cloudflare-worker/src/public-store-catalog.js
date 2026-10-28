// Public catalog projection: no administrator metadata, drafts, grants, or Coins mutations.
import {json, firestoreQuotaResponse} from "./http.js";
import {firestoreClient} from "./firestore.js";
import {readThroughConfigCache} from "./config-cache.js";
import {STORE_CATEGORIES, STORE_DURATIONS} from "./store-catalog-policy.js";

const CONFIG_PATH = "system_config/store_catalog";
const clean = (value) => String(value ?? "").trim();
const RARITIES = new Set(["normal", "rare", "epic", "legendary"]);

export function selectPublicStoreItems(items) {
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
      Number.isSafeInteger(item.sortOrder) &&
      item.assetKey === `store.item.${id}.icon`;
  }).map(item => ({
    id: clean(item.id), nameAr: clean(item.nameAr),
    category: clean(item.category),
    priceCoins: item.priceCoins, durationDays: item.durationDays,
    rarity: item.rarity, minVipLevel: item.minVipLevel,
    assetKey: item.assetKey, sortOrder: item.sortOrder,
  })).sort((a,b) => a.sortOrder - b.sortOrder || a.id.localeCompare(b.id))
    .slice(0, 100);
}

export async function publicStoreCatalog(request, env) {
  if (request.method !== "GET") {
    return json(request, env, {ok:false,code:"method_not_allowed"}, 405);
  }
  try {
    const items = await readThroughConfigCache("store:public-catalog:v1", async () => {
      const snapshot = await firestoreClient(env).get(CONFIG_PATH);
      return selectPublicStoreItems(snapshot.data?.items);
    }, {ttlMs:15_000,staleMs:15_000,allowStaleOnError:false});
    return json(request, env, {
      ok:true, purchasingEnabled:false,
      categories: STORE_CATEGORIES,
      durations: STORE_DURATIONS,
      items,
    }, 200, {"Cache-Control":"public, max-age=15"});
  } catch (error) {
    const quota = firestoreQuotaResponse(request,env,error);
    if (quota) return quota;
    return json(request,env,{ok:false,code:"store_catalog_unavailable"},503);
  }
}
