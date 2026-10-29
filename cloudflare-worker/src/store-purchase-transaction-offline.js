// Offline-only certification of the Store purchase/Coins transaction.
// No production route imports this module. Launch requires independent CI,
// safety review and real-account end-to-end acceptance, even with Owner approval.
import {prepareStorePurchase,validateStorePurchaseOperationId}
  from "./store-purchase-policy.js";
import {loadUserLevelPolicy,userLevelSummaries} from "./user-level-policy.js";
import {effectiveVipLevel} from "./user-level-visibility.js";
import {assertUserDocumentSessionState} from "./firebase-auth.js";
import {isTransientFirestoreError,firestoreErrorRetryDelayMs}
  from "./firestore.js";

export class OfflineStorePurchaseError extends Error {
  constructor(code){super(code);this.code=code;}
}
const fail=code=>{throw new OfflineStorePurchaseError(code);};
const clean=v=>String(v??"").trim();
const validUid=v=>/^[A-Za-z0-9_-]{1,128}$/.test(v);
const productPattern=/^[1-9][0-9]{5,8}$/;
const retryLimit=3;

// Buyer identity, price, eligibility, item availability and balance are all
// validated *within the same Firestore read/write transaction*.
export async function commitStorePurchaseOffline(db,verifiedBuyerToken,body,
  nowMs=Date.now()){
  const buyerUid=clean(verifiedBuyerToken?.sub);
  if(!validUid(buyerUid))fail("unauthorized");
  if(verifiedBuyerToken?.firebase?.sign_in_provider==="anonymous")
    fail("account_required");
  let operationId;
  try{operationId=validateStorePurchaseOperationId(body?.operationId);}
  catch(_){fail("invalid_store_purchase_operation_id");}
  const productId=clean(body?.productId);
  if(!productPattern.test(productId))fail("invalid_store_product_id");
  if(!Number.isSafeInteger(nowMs)||nowMs<0)fail("invalid_purchase_time");
  const key=buyerUid+"__"+operationId;
  const operationPath="store_purchase_operations/"+key;
  for(let attempt=0;attempt<retryLimit;attempt++){
    let tx=null;
    try{
      tx=await db.beginTransaction();
      const [buyerSnap,prior,lockSnap]=await Promise.all([
        db.get("users/"+buyerUid,tx),
        db.get(operationPath,tx),
        db.get("system_config/emergency_lock",tx),
      ]);
      if(!buyerSnap.exists)fail("store_buyer_not_eligible");
      const buyer=buyerSnap.data||{};
      assertUserDocumentSessionState(verifiedBuyerToken,buyer);
      if(prior.exists){
        const op=prior.data||{};
        if(op.buyerUid!==buyerUid||op.productId!==productId||
            op.status!=="completed"||!op.result)
          fail("store_purchase_operation_id_conflict");
        await db.rollback(tx);tx=null;
        return {ok:true,duplicate:true,...op.result};
      }
      if(lockSnap.data?.enabled===true||lockSnap.data?.economyLocked===true)
        fail("emergency_locked");
      if(clean(buyer.accountStatus||"active")!=="active"||
          buyer.deletionRequestedAt||buyer.deletedAt||
          buyer.authDeleted===true||buyer.deletionProcessing===true)
        fail("store_buyer_not_eligible");
      // Never silently migrate legacy balance fields in a purchase transaction.
      // Missing/inconsistent wallet values require a separate reconciliation.
      if(!Number.isSafeInteger(buyer.coins)||buyer.coins<0)
        fail("invalid_store_wallet");
      if(buyer.balance!==undefined&&buyer.balance!==null&&
          buyer.balance!==buyer.coins)fail("invalid_store_wallet");
      const catalog=await db.get("system_config/store_catalog",tx);
      const raw=(Array.isArray(catalog.data?.items)?catalog.data.items:[])
        .find(item=>String(item?.id)===productId);
      if(!raw)fail("store_product_unavailable");
      const wealthPoints=buyer.wealthPoints??0;
      if(!Number.isSafeInteger(wealthPoints)||wealthPoints<0)
        fail("invalid_store_eligibility");
      const policy=await loadUserLevelPolicy(db,{
        transaction:tx,useCache:false,
      });
      const wealthLevel=userLevelSummaries(policy,{
        wealthPoints,
      }).wealth.level;
      const quote=prepareStorePurchase({
        catalog:catalog.data,productId,
        buyer:{uid:buyerUid,accountStatus:"active"},
        vipLevel:effectiveVipLevel(buyer),wealthLevel,nowMs,
      });
      const entitlementPath="user_store_entitlements/"+buyerUid+
        "/items/"+productId;
      const [asset,owned]=await Promise.all([
        db.get("app_asset_registry/"+quote.assetKey,tx),
        db.get(entitlementPath,tx),
      ]);
      if(!asset.exists||asset.data?.published!==true||
          typeof asset.data.rawUrl!=="string"||
          !/^https:\/\//.test(asset.data.rawUrl.trim()))
        fail("store_asset_not_published");
      // Replacement, renewal, and stacking are separate policy decisions.
      // Never charge again while an active/expired/revoked record exists.
      if(owned.exists)fail("store_item_already_owned");
      if(buyer.coins<quote.priceCoins)fail("insufficient_balance");
      const closingBalance=buyer.coins-quote.priceCoins;
      const result={
        buyerUid,productId,operationId,priceCoins:quote.priceCoins,
        openingBalance:buyer.coins,closingBalance,
        acquiredAtMs:nowMs,expiresAtMs:quote.expiresAtMs,
        deliveryStatus:"delivered",
      };
      const createdAt=new Date(nowMs);
      await db.commit(tx,[
        db.writeUpdate("users/"+buyerUid,{coins:closingBalance},["coins"]),
        db.writeCreate(entitlementPath,{
          ownerUid:buyerUid,productId,nameAr:quote.nameAr,
          category:quote.category,assetKey:quote.assetKey,
          source:"purchase",status:"active",equipped:false,
          acquiredAtMs:nowMs,expiresAtMs:quote.expiresAtMs,
          purchaseOperationId:operationId,priceCoins:quote.priceCoins,
          updatedAt:createdAt,
        }),
        db.writeCreate("financial_ledger/store_purchase_"+key,{
          userId:buyerUid,asset:"coins",delta:-quote.priceCoins,
          openingBalance:buyer.coins,closingBalance,
          sourceType:"storePurchase",sourceId:key,
          idempotencyKey:key,createdAt,
        }),
        db.writeCreate("store_purchase_receipts/"+key,{
          ...result,status:"completed",createdAt,
        }),
        db.writeCreate(operationPath,{
          buyerUid,productId,status:"completed",result,createdAt,
        }),
        db.writeCreate("admin_audit_logs/store_purchase_"+key,{
          actorUid:buyerUid,targetType:"store_entitlement",
          targetId:entitlementPath,action:"purchaseStoreItem",
          operationId,priceCoins:quote.priceCoins,createdAt,
        }),
      ]);
      tx=null;
      return {ok:true,...result};
    }catch(error){
      if(tx)await db.rollback(tx).catch(()=>{});
      if(error instanceof OfflineStorePurchaseError)throw error;
      if(attempt<retryLimit-1&&isTransientFirestoreError(error)){
        await new Promise(resolve=>setTimeout(resolve,
          firestoreErrorRetryDelayMs(attempt)));
        continue;
      }
      throw error;
    }
  }
  fail("store_purchase_transaction_failed");
}
