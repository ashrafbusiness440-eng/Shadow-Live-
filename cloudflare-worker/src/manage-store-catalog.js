import {json, readJson} from "./http.js";
import {assertUserDocumentSessionState, verifyFirebaseIdToken} from "./firebase-auth.js";
import {firestoreClient, isTransientFirestoreError, firestoreErrorRetryDelayMs} from "./firestore.js";
import {STORE_CATEGORIES, STORE_DURATIONS, validateStoreCatalogUpdate} from "./store-catalog-policy.js";
import {canViewStoreInventory} from "./manage-store-inventory.js";
import {canViewStoreAudit} from "./manage-store-audit.js";
import {canViewStorePurchases} from "./manage-store-purchases.js";
import {canPreviewStoreGrants} from "./manage-store-grant-preview.js";
import {hasRecentStoreAdminLogin} from "./store-admin-target.js";
import {storeCheckoutIssuanceEnabled} from "./store-entitlements.js";

const clean = (value) => String(value ?? "").trim();
const CONFIG_PATH = "system_config/store_catalog";
const MAX_RETRIES = 3;

class StoreCatalogError extends Error {
  constructor(code, status = 400) { super(code); this.code = code; this.status = status; }
}

export function canManageStoreCatalog(user = {}) {
  if (user.role === "owner") return true;
  return user.adminEnabled === true &&
    (user.role === "admin" || user.role === "super_admin") &&
    Array.isArray(user.capabilities) &&
    user.capabilities.includes("manageStore");
}

export function canViewStoreCatalog(user = {}) {
  if (canManageStoreCatalog(user)) return true;
  return user.adminEnabled === true &&
    (user.role === "admin" || user.role === "super_admin") &&
    Array.isArray(user.capabilities) &&
    user.capabilities.includes("viewStore");
}

async function readActor(db, payload, tx = null) {
  const uid = clean(payload?.sub);
  if (!uid) throw new StoreCatalogError("unauthorized", 401);
  const snap = await db.get("users/" + uid, tx);
  if (!snap.exists) throw new StoreCatalogError("forbidden", 403);
  assertUserDocumentSessionState(payload, snap.data || {});
  const canViewCatalog=canViewStoreCatalog(snap.data || {});
  const canViewInventory=canViewStoreInventory(snap.data || {});
  const canViewAudit=canViewStoreAudit(snap.data || {});
  const canViewPurchases=canViewStorePurchases(snap.data || {});
  const canPreviewGrants=canPreviewStoreGrants(snap.data || {});
  if (!canViewCatalog && !canViewInventory && !canViewAudit &&
      !canViewPurchases && !canPreviewGrants) {
    throw new StoreCatalogError("forbidden", 403);
  }
  return {uid, canEdit:canManageStoreCatalog(snap.data || {}),
    canViewCatalog,canViewInventory,canViewAudit,canViewPurchases,
    canPreviewGrants,canTogglePurchasing:snap.data?.role==="owner"};
}

async function loadState(db, token, env={}) {
  const actor = await readActor(db, token);
  const snap = await db.get(CONFIG_PATH);
  return {
    ok: true, revision: actor.canViewCatalog ? Number(snap.data?.revision ?? 0) : 0,
    items: actor.canViewCatalog && Array.isArray(snap.data?.items)
      ? snap.data.items : [],
    categories: STORE_CATEGORIES,
    durations: STORE_DURATIONS,
    purchasingEnabled: actor.canViewCatalog &&
      snap.data?.purchasingEnabled===true,
    purchaseReleaseReady: actor.canTogglePurchasing &&
      storeCheckoutIssuanceEnabled(env),
    canTogglePurchasing: actor.canTogglePurchasing,
    canEdit: actor.canEdit,
    canViewInventory: actor.canViewInventory,
    canViewAudit: actor.canViewAudit,
    canViewPurchases: actor.canViewPurchases,
    canPreviewGrants: actor.canPreviewGrants,
    canViewCatalog: actor.canViewCatalog,
    note: "catalog_preparation_only",
  };
}

// Only a published, non-empty Studio asset can be made visible. Existing
// visible entries are not revalidated on unrelated edits to avoid breaking
// catalog maintenance when a legacy asset is temporarily unavailable.
async function assertStorePublishableAssets(db, tx, previousItems, nextItems) {
  const before = new Map((previousItems || []).map(item => [String(item.id), item]));
  for (const item of nextItems) {
    if (item.enabled !== true || before.get(item.id)?.enabled === true) continue;
    const asset = await db.get(`app_asset_registry/${item.assetKey}`, tx);
    if (!asset.exists || asset.data?.published !== true ||
        typeof asset.data?.rawUrl !== "string" ||
        !/^https:\/\//.test(asset.data.rawUrl.trim())) {
      throw new StoreCatalogError("store_asset_not_published", 409);
    }
  }
}

async function saveCatalog(db, payload, body) {
  const key = clean(body?.operationId);
  if (!/^[A-Za-z0-9_-]{12,100}$/.test(key)) {
    throw new StoreCatalogError("invalid_operation_id", 400);
  }
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    let tx = null;
    try {
      tx = await db.beginTransaction();
      const [actor, config, previousOperation] = await Promise.all([
        readActor(db, payload, tx),
        db.get(CONFIG_PATH, tx),
        db.get("control_operations/store_catalog_" + key, tx),
      ]);
      // A viewer cannot replay a previous editor operation or mutate the catalog.
      if (!actor.canEdit) {
        throw new StoreCatalogError("forbidden", 403);
      }
      const uid = actor.uid;
      if (previousOperation.exists) {
        if (previousOperation.data?.actorUid !== uid) {
          throw new StoreCatalogError("operation_id_conflict", 409);
        }
        await db.rollback(tx);
        tx = null;
        return {ok: true, duplicate: true, ...(previousOperation.data.result || {})};
      }
      let result;
      try {
        result = validateStoreCatalogUpdate(config.data || {}, body.items,
          body.expectedRevision);
      } catch (error) {
        const code = clean(error?.message);
        throw new StoreCatalogError(code, code.includes("conflict") ? 409 : 400);
      }
      await assertStorePublishableAssets(
        db, tx, config.data?.items, result.items);
      const now = new Date();
      const next = {
        revision: result.revision, items: result.items,
        updatedAt: now, updatedBy: uid,
        // Catalog editing never activates paid transactions or entitlements.
        purchasingEnabled: false,
      };
      const configWrite = config.exists
        ? db.writeUpdate(CONFIG_PATH, next,
          ["revision","items","updatedAt","updatedBy","purchasingEnabled"])
        : db.writeCreate(CONFIG_PATH, next);
      const response = {revision: result.revision, items: result.items,
        purchasingEnabled: false};
      await db.commit(tx, [
        configWrite,
        db.writeCreate("admin_audit_logs/store_catalog_" + key, {
          actorId: uid, actorUid: uid, targetType: "store_catalog",
          targetId: "system_config/store_catalog", action: "saveStoreCatalog",
          changedIds: result.changedIds.slice(0,100),
          fromRevision: Number(config.data?.revision ?? 0),
          toRevision: result.revision, createdAt: now,
          timestamp: now, operationId: key,
        }),
        db.writeCreate("control_operations/store_catalog_" + key, {
          actorUid: uid, action: "saveStoreCatalog", status: "completed",
          result: response, createdAt: now,
        }),
      ]);
      tx = null;
      return {ok: true, ...response};
    } catch (error) {
      if (tx) await db.rollback(tx).catch(() => {});
      if (error instanceof StoreCatalogError) throw error;
      if (attempt < MAX_RETRIES - 1 && isTransientFirestoreError(error)) {
        await new Promise(resolve =>
          setTimeout(resolve, firestoreErrorRetryDelayMs(attempt)));
        continue;
      }
      throw error;
    }
  }
  throw new StoreCatalogError("transaction_failed", 500);
}

// Owner-only Store purchasing switch. Never set from catalog edits, product
// visibility, delegated admin capabilities, or a client-controlled flag.
// A Worker release flag is additionally required for enabling the checkout;
// disabling remains possible even if the Worker rollout has been shut off.
async function setStorePurchasing(db,payload,body,env){
  const operationId=clean(body?.operationId);
  if(!/^[A-Za-z0-9_-]{12,100}$/.test(operationId))
    throw new StoreCatalogError("invalid_operation_id",400);
  if(typeof body?.enabled!=="boolean" ||
      body?.confirmation!=="confirmed" ||
      !Number.isSafeInteger(body?.expectedRevision) ||
      body.expectedRevision<0)
    throw new StoreCatalogError("invalid_purchase_rollout_request",400);
  for(let attempt=0;attempt<MAX_RETRIES;attempt++){
    let tx=null;
    try{
      tx=await db.beginTransaction();
      const uid=clean(payload?.sub);
      if(!/^[A-Za-z0-9_-]{1,128}$/.test(uid))
        throw new StoreCatalogError("unauthorized",401);
      const operationPath="control_operations/store_purchase_rollout_"+operationId;
      const [actor,config,lock,prior]=await Promise.all([
        db.get("users/"+uid,tx),
        db.get(CONFIG_PATH,tx),
        db.get("system_config/emergency_lock",tx),
        db.get(operationPath,tx),
      ]);
      if(!actor.exists)throw new StoreCatalogError("forbidden",403);
      assertUserDocumentSessionState(payload,actor.data||{});
      if(actor.data?.role!=="owner" ||
          clean(actor.data?.accountStatus||"active")!=="active")
        throw new StoreCatalogError("forbidden",403);
      if(!hasRecentStoreAdminLogin(payload))
        throw new StoreCatalogError("recent_auth_required",401);
      // Replay only the exact Owner operation; never let a different command
      // or a later administrator reuse the same rollout operation marker.
      if(prior.exists){
        if(prior.data?.actorUid!==uid ||
            prior.data?.enabled!==body.enabled ||
            prior.data?.status!=="completed" || !prior.data?.result)
          throw new StoreCatalogError("operation_id_conflict",409);
        if(config.data?.revision!==prior.data.result.revision ||
            (config.data?.purchasingEnabled===true)!==prior.data.enabled)
          throw new StoreCatalogError("store_rollout_state_changed",409);
        await db.rollback(tx);tx=null;
        return {ok:true,duplicate:true,...prior.data.result};
      }
      if(!config.exists)
        throw new StoreCatalogError("store_catalog_not_found",404);
      if(config.data?.revision!==body.expectedRevision)
        throw new StoreCatalogError("store_catalog_conflict",409);
      if(body.enabled){
        if(!storeCheckoutIssuanceEnabled(env))
          throw new StoreCatalogError("purchase_release_not_ready",423);
        if(lock.data?.enabled===true||lock.data?.economyLocked===true)
          throw new StoreCatalogError("emergency_locked",409);
        if(!Array.isArray(config.data?.items) ||
            !config.data.items.some(item=>
              item?.enabled===true && Number.isSafeInteger(item.priceCoins) &&
              item.priceCoins>0))
          throw new StoreCatalogError("store_purchasable_items_missing",409);
      }
      const revision=body.expectedRevision+1;
      if(!Number.isSafeInteger(revision))
        throw new StoreCatalogError("store_catalog_conflict",409);
      const now=new Date();
      const result={purchasingEnabled:body.enabled,revision};
      await db.commit(tx,[
        db.writeUpdate(CONFIG_PATH,{
          purchasingEnabled:body.enabled,revision,updatedAt:now,updatedBy:uid,
        },["purchasingEnabled","revision","updatedAt","updatedBy"]),
        db.writeCreate("admin_audit_logs/store_purchase_rollout_"+operationId,{
          actorUid:uid,targetType:"store_catalog",
          targetId:CONFIG_PATH,action:"setStorePurchasing",
          before:{purchasingEnabled:config.data?.purchasingEnabled===true},
          after:{purchasingEnabled:body.enabled},
          operationId,createdAt:now,
        }),
        db.writeCreate(operationPath,{
          actorUid:uid,enabled:body.enabled,status:"completed",
          result,createdAt:now,
        }),
      ]);
      tx=null;
      return {ok:true,...result};
    }catch(error){
      if(tx)await db.rollback(tx).catch(()=>{});
      if(error instanceof StoreCatalogError)throw error;
      if(attempt<MAX_RETRIES-1&&isTransientFirestoreError(error)){
        await new Promise(resolve=>setTimeout(resolve,
          firestoreErrorRetryDelayMs(attempt)));
        continue;
      }
      throw error;
    }
  }
  throw new StoreCatalogError("transaction_failed",500);
}

export async function manageStoreCatalog(request, env) {
  if (request.method !== "POST") {
    return json(request, env, {ok: false, code: "method_not_allowed"}, 405);
  }
  try {
    const token = await verifyFirebaseIdToken(request, env,
      {checkUserState: false});
    const body = await readJson(request);
    const db = firestoreClient(env);
    const action = clean(body?.action);
    if (action === "state") {
      return json(request, env, await loadState(db, token, env), 200);
    }
    if(action==="purchasing") {
      return json(request,env,
        await setStorePurchasing(db,token,body,env),200);
    }
    if (action === "save") {
      const age = Math.floor(Date.now() / 1000) - Number(token.auth_time || 0);
      if (!Number.isFinite(age) || age < 0 || age > 1800) {
        throw new StoreCatalogError("recent_auth_required", 401);
      }
      return json(request, env, await saveCatalog(db, token, body), 200);
    }
    throw new StoreCatalogError("invalid_action", 400);
  } catch (error) {
    if (error instanceof StoreCatalogError) {
      return json(request, env, {ok: false, code: error.code}, error.status);
    }
    const code = clean(error?.message);
    if (code === "unauthorized" || code === "forbidden") {
      return json(request, env, {ok: false, code}, code === "unauthorized" ? 401 : 403);
    }
    return json(request, env, {ok: false, code: "store_catalog_server_failed"}, 500);
  }
}

export const storeCatalogInternals = Object.freeze({canManageStoreCatalog, canViewStoreCatalog, loadState, saveCatalog, setStorePurchasing, assertStorePublishableAssets});
