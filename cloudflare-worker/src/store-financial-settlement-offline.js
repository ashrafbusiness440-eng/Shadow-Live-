// Store financial statement / refund policy — read only.
// Offline / Owner-selected inspection only, NEVER a live refund instruction.
// Each entry is reconciled against four original immutable documents plus
// two independently keyed refund documents, including absence checks.
// This module makes no refund, Coin credit, wallet read or purchase.
import {certifyStorePurchaseEvidenceOffline}
  from "./store-purchase-reconciliation-offline.js";
import {validateStorePurchaseOperationId}
  from "./store-purchase-policy.js";
import {storeAccountingTimestampMs} from "./store-accounting-time.js";

const validUid=x=>typeof x==="string"&&/^[A-Za-z0-9_-]{1,128}$/.test(x);
const validProduct=x=>typeof x==="string"&&/^[1-9][0-9]{5,8}$/.test(x);
const coin=x=>Number.isSafeInteger(x)&&x>=0;
const failure=(code)=>({verified:false,code});
const PREFIX="store_refund_";
function checkRefundPair(ledger,audit,{uid,key,price,postingAtMs}){
  const id=uid+"__"+key;
  const l=ledger?.data||{},a=audit?.data||{};
  // All three independently persisted posting timestamps must match exactly.
  // A matching per-operation posting date is NOT complete global coverage.
  if(postingAtMs===null||
      storeAccountingTimestampMs(l.createdAt)!==postingAtMs||
      storeAccountingTimestampMs(a.createdAt)!==postingAtMs)
    return "refund_posting_time_mismatch";
  // Full refunds only. Partial, multiple, chargeback and wallet-credit cases
  // must be independently specified/tested rather than treated as net revenue.
  if(l.userId!==uid||l.asset!=="coins"||
      l.sourceType!=="storePurchaseRefund"||
      l.reason!=="store_item_refund"||
      l.sourceId!==id||l.idempotencyKey!==PREFIX+id||
      l.delta!==price||!coin(l.openingBalance)||
      !coin(l.closingBalance)||
      !Number.isSafeInteger(l.openingBalance+price)||
      l.openingBalance+price!==l.closingBalance)
    return "refund_ledger_mismatch";
  if(a.action!=="refundStorePurchase"||
      !validUid(a.actorUid)||a.actorUid===uid||
      a.targetType!=="store_purchase_receipt"||
      a.targetId!=="store_purchase_receipts/"+id||
      a.buyerUid!==uid||a.operationId!==key||
      a.refundedCoins!==price||
      a.ledgerId!==PREFIX+id)
    return "refund_audit_mismatch";
  return null;
}

export async function inspectStoreFinancialSettlementOffline(
  db,{buyerUid,operationId,expectedProductId}={}){
  if(!validUid(buyerUid)||!validProduct(expectedProductId))
    return failure("invalid_refund_target");
  let key;
  try{key=validateStorePurchaseOperationId(operationId);}
  catch(_){return failure("invalid_refund_operation");}
  const id=buyerUid+"__"+key;
  // 6 exact reads in total (4 sales + 2 refund documents), with no list.
  const proof=await certifyStorePurchaseEvidenceOffline(db,{
    buyerUid,operationId:key,expectedProductId,
    allowRefundedForSettlement:true,
  });
  if(!proof.ok)return failure(proof.code);
  const [ledger,audit]=await Promise.all([
    db.get("financial_ledger/"+PREFIX+id),
    db.get("admin_audit_logs/"+PREFIX+id),
  ]);
  if(!ledger||!audit||typeof ledger.exists!=="boolean"||
      typeof audit.exists!=="boolean")
    return failure("refund_evidence_unavailable");
  const status=proof.refundStatus;
  if(status==="none"){
    if(ledger.exists||audit.exists)
      return failure("unexpected_refund_credit");
    return {
      verified:true,kind:proof.kind,refundStatus:"none",
      grossCoins:proof.certifiedAmountCoins,refundedCoins:0,
      netCoins:proof.certifiedAmountCoins,
    };
  }
  if(status!=="refunded")return failure("requires_refund_review");
  if(!ledger.exists||!audit.exists)
    return failure("incomplete_refund_evidence");
  const code=checkRefundPair(ledger,audit,{
    uid:buyerUid,key,price:proof.certifiedAmountCoins,
    postingAtMs:proof.refundPostingAtMs,
  });
  if(code)return failure(code);
  return {
    verified:true,kind:proof.kind,refundStatus:"refunded",
    grossCoins:proof.certifiedAmountCoins,
    refundedCoins:proof.certifiedAmountCoins,netCoins:0,
  };
}

// Exact operator-selected evidence, not a financial report for all users
// or even all operations of one user. Fail closed for ANY row mismatch.
// In particular, invalid rows cannot silently disappear from gross/net totals.
export async function compileStoreSelectedSettlementStatement(
  db,{buyerUid,operations}={}){
  if(!validUid(buyerUid)||!Array.isArray(operations)||
      operations.length<1||operations.length>5)
    throw Error("invalid_store_settlement_selection");
  const seen=new Set();
  const items=operations.map(row=>{
    if(!row||typeof row!=="object"||Array.isArray(row)||
        !validProduct(row.productId))
      throw Error("invalid_store_settlement_selection");
    let id;
    try{id=validateStorePurchaseOperationId(row.operationId);}
    catch(_){throw Error("invalid_store_settlement_selection");}
    if(seen.has(id))throw Error("invalid_store_settlement_selection");
    seen.add(id);
    return {operationId:id,productId:row.productId};
  });
  const evidence=await Promise.all(items.map(async row=>{
    const proof=await inspectStoreFinancialSettlementOffline(db,{
      buyerUid,operationId:row.operationId,
      expectedProductId:row.productId,
    });
    return {operationId:row.operationId,...proof};
  }));
  const allVerified=evidence.every(x=>x.verified===true);
  const totals=(field)=>{
    let total=0;
    for(const row of evidence){
      if(!row.verified)continue;
      if(!coin(row[field])||
          !Number.isSafeInteger(total+row[field]))
        throw Error("store_settlement_amount_overflow");
      total+=row[field];
    }
    return total;
  };
  const gross=totals("grossCoins");
  const refunded=totals("refundedCoins");
  const net=totals("netCoins");
  if(!Number.isSafeInteger(gross-refunded)||gross-refunded!==net)
    throw Error("store_settlement_balance_mismatch");
  return {
    ok:true,scope:"selected_buyer_operations_settlement",
    inspected:evidence.length,
    verified:evidence.filter(x=>x.verified).length,
    needsReview:evidence.filter(x=>!x.verified).length,
    fullSelectionVerified:allVerified,
    // If any proof fails, suppress all statement totals, not just that row.
    ...(allVerified?{
      selectedGrossCoins:gross,
      selectedRefundedCoins:refunded,
      selectedNetCoins:net,
      selectedPurchaseCoins:evidence.filter(x=>x.kind==="purchase")
        .reduce((n,x)=>n+x.netCoins,0),
      selectedRenewalCoins:evidence.filter(x=>x.kind==="renew")
        .reduce((n,x)=>n+x.netCoins,0),
    }:{}),
    evidence,
    requiresWholeHistoryReview:true,
    partialEvidenceOnly:true,
    financialReportComplete:false,netRevenueCertified:false,
    refundSettlementCertified:false,
    financialWritesPerformed:false,
  };
}
