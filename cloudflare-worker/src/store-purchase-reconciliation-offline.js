// 578D: offline-only, read-only financial evidence certification.
// Not imported by a production Worker route; never settles, refunds,
// repairs balances, scans collections, or authorizes checkout.
import {validateStorePurchaseOperationId}
  from "./store-purchase-policy.js";

const validUid=uid=>typeof uid==="string"&&
  /^[A-Za-z0-9_-]{1,128}$/.test(uid);
const validProduct=id=>typeof id==="string"&&
  /^[1-9][0-9]{5,8}$/.test(id);
const money=value=>Number.isSafeInteger(value)&&value>=0;
const validTime=value=>Number.isSafeInteger(value)&&value>=0;
const failure=code=>({ok:false,code});

// Exactly four owner/operation-scoped document reads. The current wallet
// balance and entitlement state are intentionally excluded: a later renewal,
// spend, expiration, or revocation does not rewrite historical evidence.
// This is one-operation evidence certification, NOT full-wallet reconciliation.
export async function certifyStorePurchaseEvidenceOffline(
  db,{buyerUid,operationId}={}){
  if(!validUid(buyerUid))return failure("invalid_buyer");
  let key;
  try{key=validateStorePurchaseOperationId(operationId);}
  catch(_){return failure("invalid_operation");}
  const operationKey=buyerUid+"__"+key;
  const [operation,receipt,ledger,audit]=await Promise.all([
    db.get("store_purchase_operations/"+operationKey),
    db.get("store_purchase_receipts/"+operationKey),
    db.get("financial_ledger/store_"+operationKey),
    db.get("admin_audit_logs/store_purchase_"+operationKey),
  ]);
  const snapshots=[operation,receipt,ledger,audit];
  if(snapshots.every(row=>!row?.exists))return failure("not_found");
  if(snapshots.some(row=>!row?.exists))
    return failure("incomplete_evidence");
  const op=operation.data||{};
  const r=receipt.data||{};
  const l=ledger.data||{};
  const a=audit.data||{};
  const kind=op.kind;
  const renewal=kind==="renew";
  const result=op.result||{};
  const price=result.priceCoins;
  const start=result.acquiredAtMs;
  const expiry=result.expiresAtMs;
  if((kind!=="purchase"&&!renewal)||op.status!=="completed"||
      op.buyerUid!==buyerUid||!validProduct(op.productId)||
      result.operationId!==key||result.productId!==op.productId||
      result.deliveryStatus!=="delivered"||
      result.renewal!==renewal||
      !Number.isSafeInteger(price)||price<=0||
      !Number.isSafeInteger(result.durationDays)||
      result.durationDays<0||!validTime(start)||
      (expiry!==null&&(!validTime(expiry)||expiry<=start))||
      (result.durationDays===0&&expiry!==null)||
      (result.durationDays>0&&expiry===null))
    return failure("operation_mismatch");
  if(r.buyerUid!==buyerUid||r.operationId!==key||
      r.productId!==op.productId||r.priceCoins!==price||
      r.durationDays!==result.durationDays||
      r.acquiredAtMs!==start||r.expiresAtMs!==expiry||
      r.deliveryStatus!=="delivered"||r.renewal!==renewal||
      (renewal&&r.previousExpiresAtMs!==result.previousExpiresAtMs))
    return failure("receipt_mismatch");
  // A refund is not a proven original sale; it requires its own separately
  // certified refund ledger before any net revenue can be stated.
  if(r.refundStatus!=="none")
    return failure("requires_refund_review");
  if(l.userId!==buyerUid||l.asset!=="coins"||
      l.sourceType!=="storePurchase"||
      l.reason!=="store_item_purchase"||
      l.sourceId!==operationKey||l.idempotencyKey!==operationKey||
      l.renewal!==renewal||l.delta!==-price||
      !money(l.openingBalance)||!money(l.closingBalance)||
      l.openingBalance-price!==l.closingBalance)
    return failure("ledger_mismatch");
  if(a.actorUid!==buyerUid||a.targetType!=="store_entitlement"||
      a.targetId!=="user_store_entitlements/"+
        buyerUid+"/items/"+op.productId||
      a.action!==(renewal?"renewStoreItem":"purchaseStoreItem")||
      a.operationId!==key||a.priceCoins!==price)
    return failure("audit_mismatch");
  return {ok:true,kind,certifiedAmountCoins:price};
}
