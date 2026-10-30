// Store accounting: one completed UTC-day, ALL buyers, all four independent
// indexed canonical sources and refund proofs. No wallet writes or broad scans.
// This is a strict, 20-operation MAX *reviewed period statement*, not an
// independently settled/certified financial close. Late writes, deleted or
// previously undocumented records, and external chargebacks are not proved.
import {storeGlobalDayBounds} from "./store-global-daily-financial-review.js";
import {inspectStoreFinancialSettlementOffline}
  from "./store-financial-settlement-offline.js";
import {validateStorePurchaseOperationId}
  from "./store-purchase-policy.js";

export const STORE_DAILY_SETTLEMENT_MAX=20;
const SOURCES=Object.freeze({
  receipts:{collection:"store_purchase_receipts",field:"acquiredAtMs"},
  operations:{collection:"store_purchase_operations",field:"createdAt"},
  ledger:{collection:"financial_ledger",field:"createdAt"},
  audit:{collection:"admin_audit_logs",field:"createdAt"},
});
const validUid=x=>typeof x==="string"&&/^[A-Za-z0-9_-]{1,128}$/.test(x);
const validProduct=x=>typeof x==="string"&&/^[1-9][0-9]{5,8}$/.test(x);
function rowIdentity(source,row) {
  const data=row?.data||{};
  const uid=source==="ledger"?data.userId:
    source==="audit"?data.actorUid:data.buyerUid;
  if(!validUid(uid))return null;
  const raw=source==="receipts"?data.operationId:
    source==="operations"?data.result?.operationId:
    source==="audit"?data.operationId:
    typeof data.sourceId==="string"&&data.sourceId.startsWith(uid+"__")
      ?data.sourceId.slice(uid.length+2):null;
  let opId;
  try{opId=validateStorePurchaseOperationId(raw);}
  catch(_){return null;}
  const id=uid+"__"+opId;
  const expected=source==="ledger"?"store_"+id:
    source==="audit"?"store_purchase_"+id:id;
  if(row?.id!==expected)return null;
  return {id,uid,opId};
}
function timestampMs(source,value){
  if(source==="receipts")return Number.isSafeInteger(value)?value:NaN;
  if(value instanceof Date)return value.getTime();
  if(typeof value==="string"){
    const ms=Date.parse(value);
    return Number.isSafeInteger(ms)?ms:NaN;
  }
  return NaN;
}
function sourceMatches(source,row,proof,identity) {
  const x=row.data||{},amount=proof.grossCoins;
  const renewal=proof.kind==="renew";
  if(source==="receipts")return x.priceCoins===amount&&
    x.buyerUid===identity.uid&&x.operationId===identity.opId&&
    x.productId===proof.productId&&
    x.refundStatus===proof.refundStatus&&
    x.deliveryStatus==="delivered"&&x.renewal===renewal;
  if(source==="operations")return x.buyerUid===identity.uid&&
    x.productId===proof.productId&&x.status==="completed"&&
    x.kind===proof.kind&&x.result?.operationId===identity.opId&&
    x.result?.productId===proof.productId&&
    x.result?.priceCoins===amount;
  if(source==="ledger")return x.userId===identity.uid&&
    x.sourceType==="storePurchase"&&
    x.asset==="coins"&&x.reason==="store_item_purchase"&&
    x.delta===-amount&&x.sourceId===identity.id&&
    x.idempotencyKey===identity.id&&x.renewal===renewal;
  if(source==="audit")return x.actorUid===identity.uid&&
    x.targetType==="store_entitlement"&&
    x.targetId==="user_store_entitlements/"+
      identity.uid+"/items/"+proof.productId&&
    x.operationId===identity.opId&&x.priceCoins===amount&&
    x.action===(renewal?"renewStoreItem":"purchaseStoreItem");
  return false;
}
function reportBase(day,counts){
  return {
    ok:true,scope:"all_buyers_one_completed_utc_day_four_source_settlement",
    day,sourceCounts:counts,perSourceLimit:STORE_DAILY_SETTLEMENT_MAX,
    productionFinancialWritesPerformed:false,
    // A zero or successful bounded period result is still not historical
    // completeness, a stable snapshot or evidence of no late refund.
    snapshotIsolationCertified:false,
    historicalDateCoverageCertified:false,
    externalChargebacksCertified:false,
    fullPeriodSettlementCertified:false,
    financialReportComplete:false,
    netRevenueCertified:false,
    refundSettlementCertified:false,
  };
}
function block(day,counts,code){
  return {...reportBase(day,counts),
    inspected:0,verified:0,reviewStatus:"blocked",
    blockingReason:code,periodAmountsAvailable:false};
}
function sumCoins(previous,value){
  if(!Number.isSafeInteger(previous)||!Number.isSafeInteger(value)||
      previous<0||value<0||
      !Number.isSafeInteger(previous+value))
    throw Error("store_daily_statement_overflow");
  return previous+value;
}

export async function reviewStoreDailySettlement(
  db,{day,nowMs=Date.now()}={}){
  const bounds=storeGlobalDayBounds(day,nowMs);
  const collections={};
  const counts={};
  // Four independent index-bounded sources, never just receipts. Limit+1
  // both rejects large days and establishes page completeness within index.
  for(const [source,config] of Object.entries(SOURCES)){
    const start=source==="receipts"?bounds.start:new Date(bounds.start);
    const end=source==="receipts"?bounds.end:new Date(bounds.end);
    const rows=await db.runQuery(config.collection,{
      filters:[
        {field:config.field,op:">=",value:start},
        {field:config.field,op:"<",value:end},
        ...(source==="ledger"
          ?[{field:"sourceType",op:"==",value:"storePurchase"}]:[]),
        ...(source==="audit"
          ?[{field:"action",op:"in",value:[
            "purchaseStoreItem","renewStoreItem",
          ]}]:[]),
      ],
      orderBy:[
        {field:config.field,direction:"desc"},
        {field:"__name__",direction:"desc"},
      ],
      limit:STORE_DAILY_SETTLEMENT_MAX+1,
    });
    if(!Array.isArray(rows)||
        rows.length>STORE_DAILY_SETTLEMENT_MAX+1)
      throw Error("store_daily_statement_bad_query");
    counts[source]=rows.length;
    if(rows.length>STORE_DAILY_SETTLEMENT_MAX)
      return block(day,counts,"day_exceeds_safe_operation_limit");
    const map=new Map();
    for(const row of rows){
      const identity=rowIdentity(source,row);
      const time=timestampMs(source,row?.data?.[config.field]);
      if(!identity||!Number.isSafeInteger(time)||
          time<bounds.start||time>=bounds.end||map.has(identity.id))
        return block(day,counts,"invalid_or_duplicate_source_identity");
      map.set(identity.id,{row,identity});
    }
    collections[source]=map;
  }
  // Identity parity, NOT mere aggregate count equality. Refund ledger/audit
  // entries are checked per purchase via exact reads below.
  const receiptIds=[...collections.receipts.keys()];
  if(Object.values(collections).some(map=>map.size!==receiptIds.length||
      receiptIds.some(id=>!map.has(id))))
    return block(day,counts,"source_operation_ids_mismatch");
  let gross=0,refunded=0,net=0,purchases=0,renewals=0;
  for(const id of receiptIds){
    const receipt=collections.receipts.get(id);
    const x=receipt.row.data||{};
    if(!validProduct(x.productId))
      return block(day,counts,"invalid_receipt_product");
    // Six exact reads per purchase; includes an independent refund ledger
    // and refund approval audit; no current balance or whole-user data.
    const proof=await inspectStoreFinancialSettlementOffline(db,{
      buyerUid:receipt.identity.uid,
      operationId:receipt.identity.opId,
      expectedProductId:x.productId,
    });
    if(!proof.verified)
      return block(day,counts,"operation_or_refund_proof_failed");
    for(const source of Object.keys(SOURCES)){
      if(!sourceMatches(source,collections[source].get(id).row,
          {...proof,productId:x.productId},
          collections[source].get(id).identity))
        return block(day,counts,"source_snapshot_conflict");
    }
    gross=sumCoins(gross,proof.grossCoins);
    refunded=sumCoins(refunded,proof.refundedCoins);
    net=sumCoins(net,proof.netCoins);
    if(proof.kind==="purchase")purchases++;
    else if(proof.kind==="renew")renewals++;
    else return block(day,counts,"unknown_purchase_kind");
  }
  if(gross-refunded!==net)
    throw Error("store_daily_statement_amount_mismatch");
  return {...reportBase(day,counts),
    inspected:receiptIds.length,verified:receiptIds.length,
    reviewStatus:"reviewed",periodAmountsAvailable:true,
    reviewedGrossCoins:gross,reviewedRefundedCoins:refunded,
    reviewedNetCoins:net,
    reviewedPurchases:purchases,reviewedRenewals:renewals,
    // Deliberately no "certified revenue" or "closed financial period".
  };
}
