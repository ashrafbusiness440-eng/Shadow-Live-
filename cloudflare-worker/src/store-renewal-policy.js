// Offline Store renewal policy. Not a purchase route or release toggle.
// Only a trusted, existing paid entitlement can be extended.
import {validStoreEntitlementDocument}
  from "./store-purchase-policy.js";

const DAY_MS=86_400_000;
const MAX_EXPIRY_MS=4_102_444_800_000; // Strict 2100-01-01 ceiling.

export function prepareStoreRenewal({
  entitlement,uid,quote,expectedExpiresAtMs,nowMs,
}={}){
  const current=validStoreEntitlementDocument(entitlement,uid,nowMs);
  if(!current || current.productId!==quote?.productId ||
      current.category!==quote?.category ||
      current.assetKey!==quote?.assetKey ||
      current.source!=="purchase"){
    throw Error("store_renewal_entitlement_invalid");
  }
  if(current.lifecycleState==="revoked")throw Error("store_renewal_revoked");
  if(current.expiresAtMs===null || quote.durationDays===0)
    throw Error("store_renewal_permanent");
  if(!Number.isSafeInteger(expectedExpiresAtMs) ||
      expectedExpiresAtMs!==current.expiresAtMs)
    throw Error("store_renewal_quote_changed");
  const previousExpiresAtMs=current.expiresAtMs;
  const baseMs=Math.max(nowMs,previousExpiresAtMs);
  const expiresAtMs=baseMs+quote.durationDays*DAY_MS;
  if(!Number.isSafeInteger(expiresAtMs) || expiresAtMs>MAX_EXPIRY_MS)
    throw Error("store_renewal_limit");
  const renewalCount=entitlement.renewalCount??0;
  if(!Number.isSafeInteger(renewalCount) || renewalCount<0 ||
      renewalCount>=100000)throw Error("store_renewal_invalid_count");
  return Object.freeze({
    previousExpiresAtMs,
    expiresAtMs,
    acquiredAtMs:current.acquiredAtMs,
    renewalCount:renewalCount+1,
  });
}
