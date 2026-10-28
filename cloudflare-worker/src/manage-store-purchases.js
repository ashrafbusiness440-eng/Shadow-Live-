// Read-only Store purchase receipt inspector. Never creates receipts or charges Coins.
import {json,readJson,firestoreQuotaResponse} from "./http.js";
import {verifyFirebaseIdToken,assertUserDocumentSessionState} from "./firebase-auth.js";
import {firestoreClient} from "./firestore.js";
import {STORE_CATEGORIES} from "./store-catalog-policy.js";
import {
  cleanStoreId,validStoreUid,hasRecentStoreAdminLogin,resolveStoreAdminTarget,
} from "./store-admin-target.js";

export function canViewStorePurchases(user={}) {
  if (user.role==="owner") return true;
  return user.adminEnabled===true &&
    (user.role==="admin"||user.role==="super_admin") &&
    Array.isArray(user.capabilities) &&
    user.capabilities.includes("viewStorePurchases");
}

export function projectStorePurchaseReceipt(receipt={},uid) {
  if (!receipt || receipt.buyerUid!==uid ||
      !/^[1-9][0-9]{5,8}$/.test(cleanStoreId(receipt.productId)) ||
      !Object.hasOwn(STORE_CATEGORIES,cleanStoreId(receipt.category)) ||
      !Number.isSafeInteger(receipt.priceCoins) || receipt.priceCoins<=0 ||
      !Number.isSafeInteger(receipt.acquiredAtMs) ||
      receipt.acquiredAtMs<0) return null;
  const name=cleanStoreId(receipt.nameAr);
  if (name.length<2||name.length>70) return null;
  const expiresAtMs=receipt.expiresAtMs ?? null;
  if (expiresAtMs!==null &&
      (!Number.isSafeInteger(expiresAtMs)||expiresAtMs<=receipt.acquiredAtMs)) {
    return null;
  }
  const deliveryStatus=cleanStoreId(receipt.deliveryStatus);
  const refundStatus=cleanStoreId(receipt.refundStatus);
  return {
    productId:cleanStoreId(receipt.productId),
    nameAr:name,
    category:cleanStoreId(receipt.category),
    priceCoins:receipt.priceCoins,
    acquiredAtMs:receipt.acquiredAtMs,
    expiresAtMs,
    deliveryStatus:["delivered","pending","failed"].includes(deliveryStatus)
      ? deliveryStatus:"unknown",
    refundStatus:["none","requested","refunded","rejected"].includes(refundStatus)
      ? refundStatus:"unknown",
  };
}

export async function loadStoreUserPurchases(db,token,rawTargetId) {
  const uid=cleanStoreId(token?.sub);
  if (!validStoreUid(uid)) throw Error("unauthorized");
  const actor=await db.get(`users/${uid}`);
  if (!actor.exists) throw Error("forbidden");
  assertUserDocumentSessionState(token,actor.data||{});
  if (!canViewStorePurchases(actor.data||{})) throw Error("forbidden");
  if (!hasRecentStoreAdminLogin(token)) throw Error("recent_auth_required");
  const {targetUid,searchedId}=await resolveStoreAdminTarget(db,rawTargetId);
  // Narrow equality query by authenticated target: never read all receipts.
  // There are no real paid receipts while the purchase gate remains disabled.
  const docs=await db.runQuery("store_purchase_receipts",{
    filters:[{field:"buyerUid",op:"==",value:targetUid}],limit:50,
  });
  const receipts=docs
    .map(row=>projectStorePurchaseReceipt(row.data,targetUid))
    .filter(Boolean)
    .sort((a,b)=>b.acquiredAtMs-a.acquiredAtMs ||
      a.productId.localeCompare(b.productId));
  return {
    ok:true,searchedId,targetUid,receipts,
    resultLimit:50,moreMayExist:docs.length>=50,purchasingEnabled:false,
  };
}
export async function manageStorePurchases(request,env) {
  if(request.method!=="POST") {
    return json(request,env,{ok:false,code:"method_not_allowed"},405);
  }
  try {
    const token=await verifyFirebaseIdToken(request,env,{checkUserState:false});
    const body=await readJson(request);
    if(body?.action!=="history") {
      return json(request,env,{ok:false,code:"invalid_action"},400);
    }
    return json(request,env,await loadStoreUserPurchases(
      firestoreClient(env),token,body?.targetId ?? body?.targetUid),
      200,{"Cache-Control":"no-store"});
  } catch(error) {
    const quota=firestoreQuotaResponse(request,env,error);
    if(quota) return quota;
    const code=cleanStoreId(error?.message);
    if(["unauthorized","forbidden","recent_auth_required",
        "invalid_target_id","not_found"].includes(code)) {
      return json(request,env,{ok:false,code},
        code==="forbidden"?403:code==="invalid_target_id"?400:
        code==="not_found"?404:401);
    }
    return json(request,env,{ok:false,code:"store_purchases_unavailable"},503);
  }
}
