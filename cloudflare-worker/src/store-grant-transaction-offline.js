// OFFLINE CERTIFICATION ONLY. This module is intentionally not imported by any
// public Worker handler or its routes. No grant endpoint is enabled.
// Never connect it to production until the Owner explicitly authorizes launch,
// writes have been independently security-reviewed, and live E2E is signed off.
import {normalizeStoreCatalogItems} from "./store-catalog-policy.js";
import {loadUserLevelPolicy,userLevelSummaries} from "./user-level-policy.js";
import {effectiveVipLevel} from "./user-level-visibility.js";
import {assertUserDocumentSessionState} from "./firebase-auth.js";
import {isTransientFirestoreError,firestoreErrorRetryDelayMs}
  from "./firestore.js";
import {cleanStoreId,validStoreUid,hasRecentStoreAdminLogin}
  from "./store-admin-target.js";

const MAX_RETRIES=3;
const DAY_MS=86400000;

export class OfflineStoreGrantError extends Error {
  constructor(code) {super(code);this.code=code;}
}
const fail=code=>{throw new OfflineStoreGrantError(code);};

function validOperationId(value) {
  const id=cleanStoreId(value);
  if(!/^[A-Za-z0-9_-]{12,100}$/.test(id)) fail("invalid_grant_operation_id");
  return id;
}

async function resolveGrantTargetInTransaction(db,tx,rawId) {
  const input=cleanStoreId(rawId);
  const normalized=input
    .replace(/[٠-٩]/g,ch=>String(ch.charCodeAt(0)-0x0660))
    .replace(/[۰-۹]/g,ch=>String(ch.charCodeAt(0)-0x06F0));
  if(!validStoreUid(normalized)) fail("invalid_target_id");
  const isPublicId=/^[0-9]{3,8}$/.test(normalized);
  let uid=normalized;
  if(isPublicId){
    const registry=await db.get(`public_ids/${normalized}`,tx);
    uid=cleanStoreId(registry.data?.uid);
    if(!registry.exists||!validStoreUid(uid)) fail("target_not_found");
  }
  const target=await db.get(`users/${uid}`,tx);
  if(!target.exists ||
      (isPublicId && cleanStoreId(target.data?.publicId)!==normalized)) {
    fail("target_not_found");
  }
  const data=target.data||{};
  if(cleanStoreId(data.accountStatus||"active")!=="active" ||
      data.deletionRequestedAt||data.deletedAt) fail("target_not_active");
  return {uid,data};
}

function validateGrantItem(catalog,productId,nowMs) {
  const raw=(Array.isArray(catalog?.items)?catalog.items:[])
    .find(x=>String(x?.id)===productId);
  if(!raw) fail("store_product_unavailable");
  let item;
  try {item=normalizeStoreCatalogItems([raw])[0];}
  catch (_) {fail("store_product_unavailable");}
  if(item.enabled!==true ||
      (item.visibleFromMs!==null && nowMs<item.visibleFromMs) ||
      (item.visibleUntilMs!==null && nowMs>=item.visibleUntilMs)) {
    fail("store_product_unavailable");
  }
  return item;
}

// Only used by offline regression tests. No endpoint imports or invokes it.
// The grant produces NO Coins, wealth points, receipts, wallet or ledger writes.
// Exactly one entitlement, one operation marker and one audit record are written
// atomically; an ambiguous commit retry replays the original operation marker.
export async function commitStoreGrantOffline(db,verifiedOwnerToken,body,
  nowMs=Date.now()) {
  const ownerUid=cleanStoreId(verifiedOwnerToken?.sub);
  const operationId=validOperationId(body?.operationId);
  const productId=cleanStoreId(body?.productId);
  if(!validStoreUid(ownerUid)) fail("unauthorized");
  if(!/^[1-9][0-9]{5,8}$/.test(productId)) fail("invalid_store_product_id");
  if(!Number.isSafeInteger(nowMs)||nowMs<0) fail("invalid_grant_time");
  const reason=cleanStoreId(body?.reason);
  if(reason.length<5||reason.length>200) fail("invalid_grant_reason");
  const opPath=`store_grant_operations/${ownerUid}__${operationId}`;
  for(let attempt=0;attempt<MAX_RETRIES;attempt++){
    let tx=null;
    try{
      tx=await db.beginTransaction();
      const [actor,prior]=await Promise.all([
        db.get(`users/${ownerUid}`,tx),
        db.get(opPath,tx),
      ]);
      if(!actor.exists) fail("forbidden");
      assertUserDocumentSessionState(verifiedOwnerToken,actor.data||{});
      // Production admins cannot issue items; even previewStoreGrants is not
      // an issuance permission. Only the single Owner may pass certification.
      if(actor.data?.role!=="owner") fail("forbidden");
      if(!hasRecentStoreAdminLogin(verifiedOwnerToken,nowMs))
        fail("recent_auth_required");
      // An operation ID can never be reused for a different user/product.
      const searched=cleanStoreId(body?.targetId);
      if(prior.exists){
        const op=prior.data||{};
        if(op.actorUid!==ownerUid || op.targetId!==searched ||
            op.productId!==productId || op.reason!==reason ||
            op.status!=="completed" || !op.result){
          fail("grant_operation_id_conflict");
        }
        await db.rollback(tx);
        tx=null;
        return {ok:true,duplicate:true,...op.result};
      }
      const {uid:targetUid,data:target}=await resolveGrantTargetInTransaction(
        db,tx,searched);
      const catalog=await db.get("system_config/store_catalog",tx);
      const item=validateGrantItem(catalog.data,productId,nowMs);
      if(effectiveVipLevel(target)<item.minVipLevel) {
        fail("store_vip_level_required");
      }
      if(item.minWealthLevel>0){
        if(!Number.isSafeInteger(target.wealthPoints??0) ||
            (target.wealthPoints??0)<0) fail("invalid_target_level_data");
        const policy=await loadUserLevelPolicy(db,{transaction:tx,useCache:false});
        const wealth=userLevelSummaries(policy,{
          wealthPoints:target.wealthPoints??0,
        }).wealth;
        if(!Number.isSafeInteger(wealth?.level) ||
            wealth.level<item.minWealthLevel) fail("store_wealth_level_required");
      }
      const entitlementPath=`user_store_entitlements/${targetUid}/items/${productId}`;
      const [asset,existing]=await Promise.all([
        db.get(`app_asset_registry/${item.assetKey}`,tx),
        db.get(entitlementPath,tx),
      ]);
      if(!asset.exists||asset.data?.published!==true||
          typeof asset.data?.rawUrl!=="string" ||
          !/^https:\/\//.test(asset.data.rawUrl.trim())) {
        fail("store_asset_not_published");
      }
      // All existing entitlements, including expired/revoked, reject here;
      // renewal/stacking needs a separately approved policy.
      if(existing.exists) fail("store_item_already_owned");
      const expiresAtMs=item.durationDays===0
        ?null:nowMs+item.durationDays*DAY_MS;
      if(expiresAtMs!==null && !Number.isSafeInteger(expiresAtMs))
        fail("invalid_grant_expiry");
      const result={
        targetUid,productId,operationId,deliveryStatus:"delivered",
        acquiredAtMs:nowMs,expiresAtMs,
      };
      const now=new Date(nowMs);
      await db.commit(tx,[
        db.writeCreate(entitlementPath,{
          ownerUid:targetUid,productId,nameAr:item.nameAr,
          category:item.category,assetKey:item.assetKey,
          source:"admin_grant",status:"active",equipped:false,
          acquiredAtMs:nowMs,expiresAtMs,grantedByUid:ownerUid,
          grantOperationId:operationId,updatedAt:now,
        }),
        db.writeCreate(opPath,{
          actorUid:ownerUid,targetId:searched,targetUid,productId,
          reason,status:"completed",result,createdAt:now,
        }),
        db.writeCreate(`admin_audit_logs/store_grant_${ownerUid}__${operationId}`,{
          actorUid:ownerUid,targetType:"store_entitlement",
          targetId:entitlementPath,action:"grantStoreItem",
          operationId,reason,createdAt:now,
        }),
      ]);
      tx=null;
      return {ok:true,...result};
    }catch(error){
      if(tx) await db.rollback(tx).catch(()=>{});
      if(error instanceof OfflineStoreGrantError) throw error;
      if(attempt<MAX_RETRIES-1&&isTransientFirestoreError(error)){
        await new Promise(resolve=>setTimeout(resolve,
          firestoreErrorRetryDelayMs(attempt)));
        continue;
      }
      throw error;
    }
  }
  fail("grant_transaction_failed");
}
