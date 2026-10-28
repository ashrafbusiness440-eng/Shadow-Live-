import {json, firestoreQuotaResponse} from "./http.js";
import {verifyFirebaseIdToken, assertUserDocumentSessionState} from "./firebase-auth.js";
import {firestoreClient} from "./firestore.js";
import {
  STORE_PURCHASING_ENABLED,
  validStoreEntitlementDocument,
} from "./store-purchase-policy.js";

// Intentionally hard-off even when an admin document says otherwise.
// Do not remove this gate until ledger, balance, eligibility, rollback,
// concurrency tests and the owner's explicit approval are verified.
export async function storePurchase(request, env) {
  if (request.method !== "POST") {
    return json(request, env, {ok:false,code:"method_not_allowed"},405);
  }
  return json(request, env, {
    ok:false, code:"purchasing_disabled",
    purchasingEnabled:STORE_PURCHASING_ENABLED,
  },423);
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
    const nowMs = Date.now();
    const items = docs
      .map(doc => validStoreEntitlementDocument(doc.data, uid, nowMs))
      .filter(Boolean)
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
