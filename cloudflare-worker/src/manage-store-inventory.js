// Read-only Store inventory inspection. No grants, economy or purchase writes.
import {json, readJson, firestoreQuotaResponse} from "./http.js";
import {verifyFirebaseIdToken, assertUserDocumentSessionState} from "./firebase-auth.js";
import {firestoreClient} from "./firestore.js";
import {validStoreEntitlementDocument} from "./store-purchase-policy.js";

const clean = v => String(v ?? "").trim();
const validUid = v => /^[A-Za-z0-9_-]{1,128}$/.test(clean(v));
const recent = payload => {
  const age = Math.floor(Date.now()/1000) - Number(payload?.auth_time || 0);
  return Number.isFinite(age) && age >= 0 && age <= 1800;
};

export function canViewStoreInventory(user={}) {
  if (user.role === "owner") return true;
  return user.adminEnabled === true &&
    ["admin","super_admin"].includes(user.role) &&
    Array.isArray(user.capabilities) &&
    user.capabilities.includes("viewStoreInventory");
}

export async function loadStoreUserInventory(db, payload, targetUid, nowMs=Date.now()) {
  const actorUid=clean(payload?.sub);
  if (!validUid(actorUid)) {
    const error=new Error("unauthorized");error.status=401;throw error;
  }
  const actor=await db.get(`users/${actorUid}`);
  if (!actor.exists) {
    const error=new Error("forbidden");error.status=403;throw error;
  }
  assertUserDocumentSessionState(payload, actor.data || {});
  if (!canViewStoreInventory(actor.data || {})) {
    const error=new Error("forbidden");error.status=403;throw error;
  }
  // Require recent sign-in before inspecting another account's inventory.
  if (!recent(payload)) {
    const error=new Error("recent_auth_required");error.status=401;throw error;
  }
  const searchedId=clean(targetUid);
  const normalizedId=searchedId
    .replace(/[٠-٩]/g, ch=>String(ch.charCodeAt(0)-0x0660))
    .replace(/[۰-۹]/g, ch=>String(ch.charCodeAt(0)-0x06F0));
  if (!validUid(normalizedId)) {
    const error=new Error("invalid_target_id");error.status=400;throw error;
  }
  let resolvedUid=normalizedId;
  const byPublicId=/^[0-9]{3,8}$/.test(normalizedId);
  if (byPublicId) {
    const registry=await db.get(`public_ids/${normalizedId}`);
    resolvedUid=clean(registry.data?.uid);
    if (!registry.exists || !validUid(resolvedUid)) {
      const error=new Error("not_found");error.status=404;throw error;
    }
  }
  const target=await db.get(`users/${resolvedUid}`);
  // A changed/retired public ID cannot expose another account's inventory.
  if (!target.exists ||
      (byPublicId && clean(target.data?.publicId) !== normalizedId)) {
    const error=new Error("not_found");error.status=404;throw error;
  }
  // Bounded user-scoped collection read. Never scan all users or inventory.
  const docs=await db.list(`user_store_entitlements/${resolvedUid}/items`, 100);
  const items=docs
    .map(doc=>validStoreEntitlementDocument(doc.data,resolvedUid,nowMs))
    .filter(Boolean)
    .sort((a,b)=>b.acquiredAtMs-a.acquiredAtMs || a.productId.localeCompare(b.productId));
  return {
    ok:true, targetUid:resolvedUid, searchedId, items, purchasingEnabled:false,
    resultLimit:100, moreMayExist:docs.length>=100,
  };
}

export async function manageStoreInventory(request, env) {
  if (request.method !== "POST") {
    return json(request,env,{ok:false,code:"method_not_allowed"},405);
  }
  try {
    const token=await verifyFirebaseIdToken(request,env,{checkUserState:false});
    const body=await readJson(request);
    if (body?.action !== "userItems") {
      return json(request,env,{ok:false,code:"invalid_action"},400);
    }
    const output=await loadStoreUserInventory(
      firestoreClient(env),token,clean(body?.targetId ?? body?.targetUid));
    return json(request,env,output,200,{"Cache-Control":"no-store"});
  } catch(error) {
    const quota=firestoreQuotaResponse(request,env,error);
    if (quota) return quota;
    const code=clean(error?.message);
    if (["unauthorized","forbidden","recent_auth_required",
      "invalid_target_id","not_found"].includes(code)) {
      return json(request,env,{ok:false,code},
        code==="forbidden"?403:code==="not_found"?404:
        code==="invalid_target_id"?400:401);
    }
    return json(request,env,{ok:false,code:"store_inventory_unavailable"},503);
  }
}
