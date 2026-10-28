// Shared server-side purchase preflight. No currency or entitlement writes.
// This policy is not wired into the active checkout until explicit owner launch.
import {normalizeStoreCatalogItems} from "./store-catalog-policy.js";

const DAY_MS = 86_400_000;
const clean = v => String(v ?? "").trim();
export const STORE_PURCHASING_ENABLED = false;

export function validateStorePurchaseOperationId(id) {
  const key = clean(id);
  if (!/^[a-zA-Z0-9_-]{12,100}$/.test(key)) {
    throw Error("invalid_store_purchase_operation_id");
  }
  return key;
}

function integer(value, min = 0, max = Number.MAX_SAFE_INTEGER) {
  return Number.isSafeInteger(value) && value >= min && value <= max;
}

// Never trust a client's price, category, level, visibility or duration.
export function prepareStorePurchase({
  catalog,
  productId,
  buyer,
  vipLevel,
  wealthLevel,
  nowMs,
} = {}) {
  const uid = clean(buyer?.uid);
  if (!/^[a-zA-Z0-9_-]{1,128}$/.test(uid) || buyer?.accountStatus !== "active") {
    throw Error("store_buyer_not_eligible");
  }
  const now = nowMs;
  if (!integer(now, 0) || !integer(vipLevel, 0, 10) ||
      !integer(wealthLevel, 0, 35)) {
    throw Error("invalid_store_eligibility");
  }
  const id = clean(productId);
  if (!/^[1-9][0-9]{5,8}$/.test(id)) throw Error("invalid_store_product_id");
  const raw = (Array.isArray(catalog?.items) ? catalog.items : [])
    .find(item => String(item?.id) === id);
  if (!raw) throw Error("store_product_unavailable");
  // Catalog normalization rejects tampered price, ID, asset key and durations.
  const item = normalizeStoreCatalogItems([raw])[0];
  if (!item.enabled) throw Error("store_product_unavailable");
  if (item.priceCoins <= 0) throw Error("store_product_not_purchasable");
  if (vipLevel < item.minVipLevel) throw Error("store_vip_level_required");
  // Wealth gating is enabled once the store schema adds a trusted minWealthLevel.
  // Reject any unrecognized requirement rather than silently bypassing it.
  if (raw.minWealthLevel !== undefined && raw.minWealthLevel !== 0) {
    throw Error("store_wealth_policy_not_ready");
  }
  const expiresAtMs = item.durationDays === 0
    ? null
    : now + item.durationDays * DAY_MS;
  if (expiresAtMs !== null && !integer(expiresAtMs, now)) {
    throw Error("invalid_store_expiry");
  }
  return Object.freeze({
    buyerUid: uid,
    productId: item.id,
    nameAr: item.nameAr,
    category: item.category,
    assetKey: item.assetKey,
    priceCoins: item.priceCoins,
    durationDays: item.durationDays,
    expiresAtMs,
    rarity: item.rarity,
    purchasedAtMs: now,
    minVipLevel: item.minVipLevel,
  });
}

export function validStoreEntitlementDocument(value, uid, nowMs = Date.now()) {
  const data = value || {};
  const ownedBy = clean(data.ownerUid);
  if (ownedBy !== uid || !/^[1-9][0-9]{5,8}$/.test(clean(data.productId))) {
    return null;
  }
  if (!["purchase", "admin_grant", "reward"].includes(data.source) ||
      !["active", "revoked"].includes(data.status) ||
      typeof data.assetKey !== "string" ||
      data.assetKey !== `store.item.${data.productId}.icon`) return null;
  if (data.expiresAtMs !== null && !integer(data.expiresAtMs, 0)) return null;
  if (!integer(data.acquiredAtMs, 0) || !integer(nowMs, 0)) return null;
  // Return a strict allowlist: never disclose actor, issuer, operation or audit IDs.
  return {
    productId: clean(data.productId),
    nameAr: clean(data.nameAr).slice(0, 70),
    category: clean(data.category),
    assetKey: data.assetKey,
    source: data.source,
    acquiredAtMs: data.acquiredAtMs,
    expiresAtMs: data.expiresAtMs,
    active: data.status === "active" &&
      (data.expiresAtMs === null || data.expiresAtMs > nowMs),
    expired: data.expiresAtMs !== null && data.expiresAtMs <= nowMs,
  };
}
