// Offline-only, unexposed Store full-refund transaction.
// NO Worker route, flag or automatic processor. Explicit future release required.
// All reads and writes use ONE Firestore transaction; selected operation is
// exact, idempotently keyed and cannot credit Coins twice.
import {assertUserDocumentSessionState} from "./firebase-auth.js";
import {hasRecentStoreAdminLogin,validStoreUid}
  from "./store-admin-target.js";
import {readStoreEquipSlots} from "./store-equip.js";
import {certifyStorePurchaseEvidenceOffline}
  from "./store-purchase-reconciliation-offline.js";
import {inspectStoreFinancialSettlementOffline}
  from "./store-financial-settlement-offline.js";
import {validateStorePurchaseOperationId}
  from "./store-purchase-policy.js";
import {isTransientFirestoreError,firestoreErrorRetryDelayMs}
  from "./firestore.js";

export class StoreFullRefundError extends Error {
  constructor(code){super(code);this.code=code;}
}
const fail=code=>{throw new StoreFullRefundError(code);};
const safe=x=>Number.isSafeInteger(x)&&x>=0;
const product=x=>typeof x==="string"&&/^[1-9][0-9]{5,8}$/.test(x);
const MAX_ATTEMPTS=3;

export async function commitStoreFullRefundOffline(
  db,ownerToken,body,nowMs=Date.now()){
  const actorUid=ownerToken?.sub;
  const buyerUid=body?.buyerUid,productId=body?.productId;
  const reason=body?.reason;
  if(!validStoreUid(actorUid))fail("unauthorized");
  if(!validStoreUid(buyerUid))fail("invalid_refund_buyer");
  if(actorUid===buyerUid)fail("self_refund_forbidden");
  // This engine only supports an exact, full original-price refund.
  // No client-supplied partial amount or alternate Coins value is accepted.
  if(body&&["refundedCoins","amountCoins","partial","priceCoins"]
      .some(field=>Object.hasOwn(body,field)))
    fail("invalid_refund_amount_override");
  if(!product(productId))fail("invalid_store_product_id");
  if(typeof reason!=="string"||reason.trim().length<5||
      reason.trim().length>200||body?.confirmation!=="confirmed")
    fail("invalid_refund_approval");
  if(!safe(nowMs))fail("invalid_refund_time");
  let operationId;
  try{operationId=validateStorePurchaseOperationId(body?.operationId);}
  catch(_){fail("invalid_store_purchase_operation_id");}
  const key=buyerUid+"__"+operationId;
  const receiptPath="store_purchase_receipts/"+key;
  const ledgerPath="financial_ledger/store_refund_"+key;
  const auditPath="admin_audit_logs/store_refund_"+key;
  const userPath="users/"+buyerUid;
  const itemPath="user_store_entitlements/"+buyerUid+
    "/items/"+productId;
  const selectionPath="user_store_equipped/"+buyerUid;
  const normalizedReason=reason.trim();
  for(let attempt=0;attempt<MAX_ATTEMPTS;attempt++){
    let tx=null;
    try{
      tx=await db.beginTransaction();
      const get=(path)=>db.get(path,tx);
      const [actor,receipt,refundLedger,refundAudit]=await Promise.all([
        get("users/"+actorUid),
        get(receiptPath),
        get(ledgerPath),
        get(auditPath),
      ]);
      if(!actor.exists||actor.data?.role!=="owner"||
          actor.data?.accountStatus!=="active")
        fail("forbidden");
      assertUserDocumentSessionState(ownerToken,actor.data||{});
      if(!hasRecentStoreAdminLogin(ownerToken,nowMs))
        fail("recent_auth_required");
      const status=receipt?.data?.refundStatus;
      // Only after validating Owner identity do we return any evidence.
      if(status==="refunded"){
        const result=await inspectStoreFinancialSettlementOffline(
          {get},{buyerUid,operationId,expectedProductId:productId});
        if(!result.verified||result.refundStatus!=="refunded"||
            !refundAudit.exists||
            refundAudit.data?.actorUid!==actorUid||
            refundAudit.data?.reason!==normalizedReason)
          fail("refund_operation_conflict");
        await db.rollback(tx);tx=null;
        return {ok:true,duplicate:true,operationId,buyerUid,
          productId,refundedCoins:result.refundedCoins};
      }
      if(status!=="none"||!receipt?.exists)
        fail("refund_state_not_eligible");
      if(refundLedger.exists||refundAudit.exists)
        fail("refund_operation_conflict");
      // Reuse the immutable four-document certificate WITHIN the same tx.
      // No refund for a partial/malformed or previously renewed purchase.
      const certified=await certifyStorePurchaseEvidenceOffline(
        {get},{buyerUid,operationId,expectedProductId:productId});
      if(!certified.ok)fail("invalid_purchase_evidence");
      if(certified.kind!=="purchase")
        fail("renewal_refund_requires_separate_policy");
      const [buyer,item,selection,lock]=await Promise.all([
        get(userPath),get(itemPath),get(selectionPath),
        get("system_config/emergency_lock"),
      ]);
      if(!buyer.exists||buyer.data?.accountStatus!=="active"||
          buyer.data?.deletionRequestedAt||buyer.data?.deletedAt||
          buyer.data?.deletionProcessing===true||
          buyer.data?.authDeleted===true)
        fail("refund_buyer_unavailable");
      if(lock.data?.enabled===true||lock.data?.economyLocked===true)
        fail("emergency_locked");
      const x=buyer.data||{},before=x.coins;
      const price=certified.certifiedAmountCoins;
      if(!safe(before)||!safe(price)||price<=0||
          !safe(before+price))
        fail("refund_balance_invalid");
      const mirror=x.balance!==undefined&&x.balance!==null;
      if(mirror&&x.balance!==before)
        fail("refund_balance_invalid");
      const entitlement=item?.data||{};
      if(!item?.exists||
          entitlement.ownerUid!==buyerUid||
          entitlement.productId!==productId||
          entitlement.source!=="purchase"||
          entitlement.status!=="active"||
          entitlement.purchaseOperationId!==operationId||
          entitlement.lastRenewalOperationId!==undefined||
          typeof entitlement.equipped!=="boolean")
        fail("refund_entitlement_conflict");
      let slots;
      try{slots=readStoreEquipSlots(selection,buyerUid);}
      catch(_){fail("refund_equipped_state_invalid");}
      const selected=slots[entitlement.category]===productId;
      if(selected!==entitlement.equipped)
        fail("refund_equipped_state_invalid");
      const nextSlots={...slots};
      if(selected)delete nextSlots[entitlement.category];
      const timestamp=new Date(nowMs);
      const nextCoins=before+price;
      const result={operationId,buyerUid,productId,refundedCoins:price};
      const writes=[
        db.writeUpdate(userPath,{
          coins:nextCoins,
          ...(mirror?{balance:nextCoins}:{}),
          walletUpdatedAt:timestamp,
        },["coins",...(mirror?["balance"]:[]),"walletUpdatedAt"]),
        db.writeUpdate(receiptPath,{
          refundStatus:"refunded",refundedCoins:price,
          refundedAt:timestamp,refundReason:normalizedReason,
          refundLedgerId:"store_refund_"+key,
          updatedAt:timestamp,
        },["refundStatus","refundedCoins","refundedAt",
          "refundReason","refundLedgerId","updatedAt"]),
        db.writeUpdate(itemPath,{
          status:"revoked",equipped:false,
          revokedAtMs:nowMs,updatedAt:timestamp,
        },["status","equipped","revokedAtMs","updatedAt"]),
      ];
      if(selected)writes.push(db.writeUpdate(selectionPath,{
        ownerUid:buyerUid,slots:nextSlots,updatedAt:timestamp,
      },["ownerUid","slots","updatedAt"]));
      writes.push(
        db.writeCreate(ledgerPath,{
          userId:buyerUid,asset:"coins",delta:price,
          openingBalance:before,closingBalance:nextCoins,
          reason:"store_item_refund",
          sourceType:"storePurchaseRefund",
          sourceId:key,idempotencyKey:"store_refund_"+key,
          createdAt:timestamp,
        }),
        db.writeCreate(auditPath,{
          actorUid,buyerUid,operationId,reason:normalizedReason,
          action:"refundStorePurchase",
          targetType:"store_purchase_receipt",targetId:receiptPath,
          refundedCoins:price,ledgerId:"store_refund_"+key,
          createdAt:timestamp,
        }),
      );
      await db.commit(tx,writes);tx=null;
      return {ok:true,...result};
    }catch(error){
      if(tx)await db.rollback(tx).catch(()=>{});
      if(error instanceof StoreFullRefundError)throw error;
      if(attempt<MAX_ATTEMPTS-1&&isTransientFirestoreError(error)){
        await new Promise(resolve=>setTimeout(resolve,
          firestoreErrorRetryDelayMs(attempt)));
        continue;
      }
      throw error;
    }
  }
  fail("refund_unavailable");
}
