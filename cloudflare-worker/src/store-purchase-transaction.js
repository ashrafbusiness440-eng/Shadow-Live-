// Offline-only Store purchase certification: NOT imported by a Worker route.
// Owner has approved work toward activation; production checkout remains
// gated until atomicity, permissions, CI and live E2E are signed off.
import {prepareStorePurchase,validateStorePurchaseOperationId}
  from "./store-purchase-policy.js";
import {loadUserLevelPolicy,userLevelSummaries} from "./user-level-policy.js";
import {effectiveVipLevel} from "./user-level-visibility.js";
import {assertUserDocumentSessionState} from "./firebase-auth.js";
import {isTransientFirestoreError,firestoreErrorRetryDelayMs}
  from "./firestore.js";

const clean=value=>String(value??"").trim();
const MAX_ATTEMPTS=3;
export class StoreTransactionError extends Error {
  constructor(code){super(code);this.code=code;}
}
const fail=code=>{throw new StoreTransactionError(code);};
const safeBalance=v=>Number.isSafeInteger(v)&&v>=0?v:null;

// Legacy fourth argument is intentionally ignored. The verified BUYER document
// and current Store level policy, not client/handler-supplied levels, determine
// eligibility within the same transaction as the debit.
export async function commitStorePurchaseOffline(
  db,verifiedToken,body,_unusedServerLevels,nowMs=Date.now()){
  const uid=clean(verifiedToken?.sub);
  if(!/^[A-Za-z0-9_-]{1,128}$/.test(uid))fail("unauthorized");
  if(verifiedToken?.firebase?.sign_in_provider==="anonymous")
    fail("account_required");
  const key=validateStorePurchaseOperationId(body?.operationId);
  const productId=clean(body?.productId);
  if(!/^[1-9][0-9]{5,8}$/.test(productId))
    fail("invalid_store_product_id");
  if(!Number.isSafeInteger(nowMs)||nowMs<0)fail("invalid_purchase_time");
  const operationKey=uid+"__"+key;
  const opPath="store_purchase_operations/"+operationKey;
  const walletPath="users/"+uid;
  const entitlementPath="user_store_entitlements/"+uid+"/items/"+productId;
  const ledgerPath="financial_ledger/store_"+operationKey;
  const receiptPath="store_purchase_receipts/"+operationKey;
  for(let attempt=0;attempt<MAX_ATTEMPTS;attempt++){
    let tx=null;
    try{
      tx=await db.beginTransaction();
      const [user,op,catalog,lock]=await Promise.all([
        db.get(walletPath,tx),
        db.get(opPath,tx),
        db.get("system_config/store_catalog",tx),
        db.get("system_config/emergency_lock",tx),
      ]);
      if(!user.exists)fail("unauthorized");
      assertUserDocumentSessionState(verifiedToken,user.data||{});
      if(op.exists){
        if(op.data?.buyerUid!==uid||op.data?.productId!==productId||
            op.data?.status!=="completed")
          fail("store_operation_id_conflict");
        const response=op.data?.result;
        if(!response||response.operationId!==key)
          fail("store_operation_record_invalid");
        await db.rollback(tx);tx=null;
        return {ok:true,duplicate:true,...response};
      }
      if(catalog.data?.purchasingEnabled!==true)
        fail("purchasing_disabled");
      if(lock.data?.enabled===true||lock.data?.economyLocked===true)
        fail("emergency_locked");
      const buyer=user.data||{};
      if(clean(buyer.accountStatus||"active")!=="active"||
          buyer.deletionRequestedAt||buyer.deletedAt||
          buyer.authDeleted===true||buyer.deletionProcessing===true)
        fail("store_buyer_not_eligible");
      // Reject ambiguous legacy mirrors instead of silently changing how a
      // balance is interpreted while a debit is being performed.
      const before=safeBalance(buyer.coins);
      if(before===null)fail("invalid_wallet_state");
      if(buyer.balance!==undefined&&buyer.balance!==null&&
          buyer.balance!==before)fail("invalid_wallet_state");
      const wealthPoints=buyer.wealthPoints??0;
      if(safeBalance(wealthPoints)===null)fail("invalid_store_eligibility");
      const levelPolicy=await loadUserLevelPolicy(db,{
        transaction:tx,useCache:false,
      });
      const wealthLevel=userLevelSummaries(levelPolicy,{
        wealthPoints,
      }).wealth.level;
      const quote=prepareStorePurchase({
        catalog:catalog.data,productId,
        buyer:{uid,accountStatus:"active"},
        vipLevel:effectiveVipLevel(buyer),wealthLevel,nowMs,
      });
      const [asset,entitlement]=await Promise.all([
        db.get("app_asset_registry/"+quote.assetKey,tx),
        db.get(entitlementPath,tx),
      ]);
      if(!asset.exists||asset.data?.published!==true||
          typeof asset.data.rawUrl!=="string"||
          !/^https:\/\//.test(asset.data.rawUrl.trim()))
        fail("store_asset_not_published");
      // No double charge for active, expired, or revoked ownership.
      // Renewal/stacking requires an independently approved policy.
      if(entitlement.exists)fail("store_item_already_owned");
      if(before<quote.priceCoins)fail("insufficient_balance");
      const after=before-quote.priceCoins;
      const createdAt=new Date(nowMs);
      const result={
        operationId:key,productId:quote.productId,priceCoins:quote.priceCoins,
        durationDays:quote.durationDays,acquiredAtMs:nowMs,
        expiresAtMs:quote.expiresAtMs,deliveryStatus:"delivered",
      };
      await db.commit(tx,[
        db.writeUpdate(walletPath,{
          coins:after,walletUpdatedAt:createdAt,
        },["coins","walletUpdatedAt"]),
        db.writeCreate(entitlementPath,{
          ownerUid:uid,productId:quote.productId,nameAr:quote.nameAr,
          category:quote.category,assetKey:quote.assetKey,
          source:"purchase",status:"active",equipped:false,
          acquiredAtMs:nowMs,expiresAtMs:quote.expiresAtMs,
          purchaseOperationId:key,priceCoins:quote.priceCoins,
          updatedAt:createdAt,
        }),
        db.writeCreate(ledgerPath,{
          userId:uid,asset:"coins",delta:-quote.priceCoins,
          openingBalance:before,closingBalance:after,
          reason:"store_item_purchase",sourceType:"storePurchase",
          sourceId:operationKey,idempotencyKey:operationKey,createdAt,
        }),
        db.writeCreate(receiptPath,{
          buyerUid:uid,operationId:key,
          productId:quote.productId,nameAr:quote.nameAr,
          category:quote.category,assetKey:quote.assetKey,
          rarity:quote.rarity,priceCoins:quote.priceCoins,
          durationDays:quote.durationDays,
          acquiredAtMs:nowMs,expiresAtMs:quote.expiresAtMs,
          deliveryStatus:"delivered",refundStatus:"none",createdAt,
        }),
        db.writeCreate(opPath,{
          buyerUid:uid,productId:quote.productId,status:"completed",
          result,createdAt,
        }),
        db.writeCreate("admin_audit_logs/store_purchase_"+operationKey,{
          actorUid:uid,targetType:"store_entitlement",
          targetId:entitlementPath,action:"purchaseStoreItem",
          operationId:key,priceCoins:quote.priceCoins,createdAt,
        }),
      ]);
      tx=null;
      return {ok:true,...result};
    }catch(error){
      if(tx)await db.rollback(tx).catch(()=>{});
      if(error instanceof StoreTransactionError)throw error;
      if(attempt<MAX_ATTEMPTS-1&&isTransientFirestoreError(error)){
        await new Promise(resolve=>setTimeout(resolve,
          firestoreErrorRetryDelayMs(attempt)));
        continue;
      }
      throw error;
    }
  }
  fail("store_transaction_failed");
}
