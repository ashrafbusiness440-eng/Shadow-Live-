// Offline Store term policy. Production checkout remains behind two OFF gates.
// Repeated purchases of the SAME owned item extend time, never create a
// second entitlement. Revoked/foreign/malformed/permanent ownership fails shut.
const DAY_MS=86_400_000;
const safeMs=value=>Number.isSafeInteger(value)&&value>=0;
const clean=value=>String(value??"").trim();

export function prepareStoreRenewal({
  existing,uid,quote,nowMs,
}){
  if(!safeMs(nowMs)||!Number.isSafeInteger(quote?.durationDays)||
      quote.durationDays<0||!clean(quote.productId)){
    throw Error("invalid_store_renewal");
  }
  if(!existing){
    return {
      renewal:false,expiresAtMs:quote.expiresAtMs,
      equipped:false,renewalCount:0,originalAcquiredAtMs:nowMs,
      previousExpiresAtMs:null,
    };
  }
  // A corrupted entitlement can never be silently redeemed using Coins.
  if(clean(existing.ownerUid)!==uid||
      clean(existing.productId)!==clean(quote.productId)||
      clean(existing.category)!==clean(quote.category)||
      clean(existing.assetKey)!==clean(quote.assetKey)||
      !["purchase","admin_grant","reward"].includes(clean(existing.source))||
      !safeMs(existing.acquiredAtMs)||
      !["active","expired","revoked"].includes(clean(existing.status))||
      !safeMs(existing.renewalCount??0)){
    throw Error("store_item_already_owned");
  }
  if(existing.status==="revoked")throw Error("store_item_already_owned");
  if(existing.expiresAtMs===null){
    throw Error("store_item_already_owned"); // permanent, no time to extend
  }
  if(!safeMs(existing.expiresAtMs) || existing.expiresAtMs<=0){
    throw Error("store_item_already_owned");
  }
  const base=Math.max(nowMs,existing.expiresAtMs);
  const expiresAtMs=quote.durationDays===0
    ?null
    :base+quote.durationDays*DAY_MS;
  if(expiresAtMs!==null&&!safeMs(expiresAtMs)){
    throw Error("invalid_store_expiry");
  }
  const renewalCount=Number(existing.renewalCount??0)+1;
  if(!Number.isSafeInteger(renewalCount))throw Error("invalid_store_renewal");
  return {
    renewal:true,expiresAtMs,renewalCount,
    originalAcquiredAtMs:existing.acquiredAtMs,
    previousExpiresAtMs:existing.expiresAtMs,
    // Expired/revoked cosmetics never equip themselves on renewal.
    equipped:existing.status==="active"&&existing.expiresAtMs>nowMs&&
      existing.equipped===true,
  };
}
