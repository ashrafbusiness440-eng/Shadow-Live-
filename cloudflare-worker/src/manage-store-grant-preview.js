// Administrative Store grant *preview* only.
// Intentionally cannot issue items, create audit/receipt records, or modify Coins.
import {json,readJson,firestoreQuotaResponse} from "./http.js";
import {verifyFirebaseIdToken,assertUserDocumentSessionState} from "./firebase-auth.js";
import {firestoreClient} from "./firestore.js";
import {normalizeStoreCatalogItems} from "./store-catalog-policy.js";
import {loadUserLevelPolicy,userLevelSummaries} from "./user-level-policy.js";
import {effectiveVipLevel} from "./user-level-visibility.js";
import {cleanStoreId,validStoreUid,hasRecentStoreAdminLogin,resolveStoreAdminTarget}
  from "./store-admin-target.js";
import {storeGrantIssuanceEnabled} from "./manage-store-grant-issue.js";

export const STORE_GRANTS_ENABLED=false;

export function canPreviewStoreGrants(user={}) {
  if(user.role==="owner") return true;
  return user.adminEnabled===true &&
    (user.role==="admin" || user.role==="super_admin") &&
    Array.isArray(user.capabilities) &&
    user.capabilities.includes("previewStoreGrants");
}

function reject(code) {throw Error(code);}

export async function previewStoreGrant(db,token,rawTargetId,rawProductId,
  nowMs=Date.now(),issuanceEnabled=false) {
  const actorUid=cleanStoreId(token?.sub);
  if(!validStoreUid(actorUid)) reject("unauthorized");
  const actor=await db.get(`users/${actorUid}`);
  if(!actor.exists) reject("forbidden");
  assertUserDocumentSessionState(token,actor.data||{});
  if(!canPreviewStoreGrants(actor.data||{})) reject("forbidden");
  if(!hasRecentStoreAdminLogin(token,nowMs)) reject("recent_auth_required");
  const productId=cleanStoreId(rawProductId);
  if(!/^[1-9][0-9]{5,8}$/.test(productId)) reject("invalid_store_product_id");
  const {targetUid,searchedId}=await resolveStoreAdminTarget(db,rawTargetId);
  // Inactive or erasing accounts must never receive a new item.
  const target=await db.get(`users/${targetUid}`);
  const status=cleanStoreId(target.data?.accountStatus||"active");
  if(!target.exists || status!=="active" ||
      target.data?.deletionRequestedAt || target.data?.deletedAt ||
      target.data?.authDeleted===true ||
      target.data?.deletionProcessing===true) {
    reject("target_not_active");
  }
  const config=await db.get("system_config/store_catalog");
  const raw=(Array.isArray(config.data?.items)?config.data.items:[])
    .find(item=>String(item?.id)===productId);
  if(!raw) reject("store_product_unavailable");
  let product;
  try {
    product=normalizeStoreCatalogItems([raw])[0];
  } catch (_) {
    reject("store_product_unavailable");
  }
  if(!product.enabled ||
      (product.visibleFromMs!==null && nowMs<product.visibleFromMs) ||
      (product.visibleUntilMs!==null && nowMs>=product.visibleUntilMs)) {
    reject("store_product_unavailable");
  }
  const [asset,entitlement]=await Promise.all([
    db.get(`app_asset_registry/${product.assetKey}`),
    db.get(`user_store_entitlements/${targetUid}/items/${productId}`),
  ]);
  if(!asset.exists || asset.data?.published!==true ||
      typeof asset.data?.rawUrl!=="string" ||
      !/^https:\/\//.test(asset.data.rawUrl.trim())) {
    reject("store_asset_not_published");
  }
  // Levels must be derived from the target's current server-side account and
  // the authoritative Store-wide wealth thresholds. Never accept client levels.
  const vipLevel=effectiveVipLevel(target.data||{});
  let wealthRequirementMet=true;
  if(product.minWealthLevel>0){
    const points=target.data?.wealthPoints ?? 0;
    if(!Number.isSafeInteger(points)||points<0){
      reject("invalid_target_level_data");
    }
    const policy=await loadUserLevelPolicy(db,{useCache:false});
    const wealth=userLevelSummaries(policy,{wealthPoints:points}).wealth;
    if(!Number.isSafeInteger(wealth?.level)||wealth.level<0){
      reject("invalid_target_level_data");
    }
    wealthRequirementMet=wealth.level>=product.minWealthLevel;
  }
  const vipRequirementMet=vipLevel>=product.minVipLevel;
  const meetsExclusiveRequirements=vipRequirementMet && wealthRequirementMet;
  // Only the Owner may confirm issuance and only with the private Worker
  // release setting enabled. Admin preview permission never becomes issuance.
  const grantEnabled=issuanceEnabled===true;
  const canGrant=grantEnabled && actor.data?.role==="owner" &&
    !entitlement.exists && meetsExclusiveRequirements;
  return {
    ok:true, grantEnabled, searchedId,
    product: {
      id:product.id,nameAr:product.nameAr,category:product.category,
      durationDays:product.durationDays,minVipLevel:product.minVipLevel,
      minWealthLevel:product.minWealthLevel,
    },
    alreadyHasProduct:entitlement.exists,
    vipRequirementMet,wealthRequirementMet,meetsExclusiveRequirements,
    exclusiveRequirementsUnverified:false,
    canGrant,
    note:"grant_preview_only",
  };
}

export async function manageStoreGrantPreview(request,env) {
  if(request.method!=="POST") {
    return json(request,env,{ok:false,code:"method_not_allowed"},405);
  }
  // The real grant action is disabled BEFORE any authentication, reads or writes.
  // Future activation requires a distinct, reviewed endpoint and Owner approval.
  try {
    const body=await readJson(request);
    if(body?.action==="grant" || body?.action==="issue" ||
        body?.action==="confirm") {
      return json(request,env,{
        ok:false,code:"store_grants_disabled",grantEnabled:false,
      },423);
    }
    if(body?.action!=="preview") {
      return json(request,env,{ok:false,code:"invalid_action"},400);
    }
    const token=await verifyFirebaseIdToken(request,env,{checkUserState:false});
    return json(request,env,await previewStoreGrant(
      firestoreClient(env),token,body?.targetId,body?.productId,
      Date.now(),storeGrantIssuanceEnabled(env)),
      200,{"Cache-Control":"no-store"});
  } catch(error) {
    const quota=firestoreQuotaResponse(request,env,error);
    if(quota) return quota;
    const code=cleanStoreId(error?.message);
    if(["unauthorized","forbidden","recent_auth_required",
      "invalid_target_id","not_found","invalid_store_product_id",
      "target_not_active","store_product_unavailable",
      "store_asset_not_published","invalid_target_level_data"].includes(code)) {
      const status=code==="forbidden"?403:
        code==="invalid_target_id"||code==="invalid_store_product_id"?400:
        code==="not_found"||code==="store_product_unavailable"?404:
        code==="target_not_active"||code==="store_asset_not_published"||
          code==="invalid_target_level_data"?409:401;
      return json(request,env,{ok:false,code},status);
    }
    return json(request,env,{ok:false,code:"store_grant_preview_unavailable"},503);
  }
}
