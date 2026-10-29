import {json, readJson, firestoreQuotaResponse} from "./http.js";
import {verifyFirebaseIdToken, assertUserDocumentSessionState} from "./firebase-auth.js";
import {firestoreClient} from "./firestore.js";
import {commitStorePurchaseOffline} from "./store-purchase-transaction.js";
import {readStoreEquipSlots,storeEntitlementEquipped} from "./store-equip.js";
import {
  STORE_PURCHASING_ENABLED,
  validStoreEntitlementDocument,
} from "./store-purchase-policy.js";

// Separate Worker release switch: absent or invalid means checkout is OFF,
// regardless of catalog flags or any request-body property. The Owner has
// approved resuming implementation, not bypassing unverified financial tests.
export const STORE_PURCHASE_RELEASE_VALUE="owner-purchases-v1";
export function storeCheckoutIssuanceEnabled(env){
  return env?.STORE_PURCHASE_ISSUANCE_ENABLED===STORE_PURCHASE_RELEASE_VALUE;
}

// Both actions retain the SAME independent OFF-by-default production gate.
// Renewal terms and entitlement ownership are rechecked by the atomic engine.
export function isConfirmedStorePurchaseAction(body){
  return (body?.action==="purchase"||body?.action==="renew")&&
    body?.confirmation==="confirmed";
}

export async function storePurchase(request, env) {
  if (request.method !== "POST") {
    return json(request, env, {ok:false,code:"method_not_allowed"},405);
  }
  // Production is dormant until explicit Worker flag AND authoritative Store
  // catalog purchasingEnabled are enabled by separately reviewed rollout.
  if(!storeCheckoutIssuanceEnabled(env)){
    return json(request, env, {
      ok:false, code:"purchasing_disabled",
      purchasingEnabled:STORE_PURCHASING_ENABLED,
    },423);
  }
  try{
    const body=await readJson(request);
    if(!isConfirmedStorePurchaseAction(body)){
      return json(request,env,{ok:false,code:"invalid_purchase_confirmation"},400);
    }
    const token=await verifyFirebaseIdToken(request,env,{
      checkUserState:false,
    });
    // The existing transaction reads price, balance, levels, status, product,
    // receipt and emergency lock SERVER-SIDE before a single atomic commit.
    const result=await commitStorePurchaseOffline(
      firestoreClient(env),token,body,null);
    return json(request,env,result,200,{"Cache-Control":"no-store"});
  }catch(error){
    const quota=firestoreQuotaResponse(request,env,error);
    if(quota)return quota;
    const code=String(error?.code||error?.message||"").trim();
    if(code==="purchasing_disabled"){
      return json(request,env,{
        ok:false,code,purchasingEnabled:false,
      },423);
    }
    const allowed=[
      "unauthorized","account_required","store_buyer_not_eligible",
      "invalid_store_purchase_operation_id","invalid_store_product_id",
      "invalid_store_purchase_quote","store_purchase_quote_changed",
      "invalid_purchase_time","invalid_store_wallet",
      "invalid_wallet_state","invalid_store_eligibility",
      "store_product_unavailable","store_product_not_purchasable",
      "store_vip_level_required","store_wealth_level_required",
      "store_asset_not_published","store_item_already_owned",
      "store_renewal_item_not_owned","store_renewal_entitlement_invalid",
      "store_renewal_revoked","store_renewal_permanent",
      "store_renewal_quote_changed","store_renewal_limit",
      "store_renewal_invalid_count",
      "insufficient_balance","emergency_locked",
      "store_operation_id_conflict","store_operation_record_invalid",
      "invalid_store_expiry",
    ];
    if(allowed.includes(code)){
      const status=
        code==="unauthorized"?401:
        code==="account_required"||code==="store_buyer_not_eligible"?403:
        code==="store_product_unavailable"?404:
        code.startsWith("invalid_")?400:409;
      return json(request,env,{ok:false,code},status);
    }
    return json(request,env,{ok:false,code:"store_checkout_unavailable"},503);
  }
}

export async function myStoreItems(request, env) {
  if (request.method !== "GET") {
    return json(request, env, {ok:false,code:"method_not_allowed"},405);
  }
  try {
    const token = await verifyFirebaseIdToken(request, env, {checkUserState:false});
    const uid = String(token?.sub || "").trim();
    if (!/^[A-Za-z0-9_-]{1,128}$/.test(uid)) {
      return json(request, env, {ok:false,code:"unauthorized"},401);
    }
    const db = firestoreClient(env);
    const user = await db.get(`users/${uid}`);
    if (!user.exists) {
      return json(request, env, {ok:false,code:"unauthorized"},401);
    }
    assertUserDocumentSessionState(token, user.data || {});
    const docs = await db.list(`user_store_entitlements/${uid}/items`, 100);
    const selection=await db.get(`user_store_equipped/${uid}`);
    const slots=readStoreEquipSlots(selection,uid);
    const nowMs = Date.now();
    const items = docs
      .map(doc => validStoreEntitlementDocument(doc.data, uid, nowMs))
      .filter(Boolean)
      .map(item=>({...item,equipped:storeEntitlementEquipped(item,slots)}))
      .sort((a, b) => b.acquiredAtMs - a.acquiredAtMs ||
        a.productId.localeCompare(b.productId));
    return json(request, env, {
      ok:true, items, purchasingEnabled:false,
      // 100-item cap is explicit so it cannot look like a complete lifetime list.
      resultLimit:100, moreMayExist:docs.length >= 100,
    },200);
  } catch (error) {
    const quota = firestoreQuotaResponse(request, env, error);
    if (quota) return quota;
    if (String(error?.message).includes("unauthorized")) {
      return json(request, env, {ok:false,code:"unauthorized"},401);
    }
    return json(request, env, {ok:false,code:"store_items_unavailable"},503);
  }
}
