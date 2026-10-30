// Independent three-source Store refund POSTING-day review, all buyers.
// This is NOT the sale-day cohort report. Each page is a bounded comparison
// of indexed refund receipts, refund Coins ledger and Owner approval records.
// No snapshot, period close, chargeback certification or financial writes.
import {storeGlobalDayBounds} from "./store-global-daily-financial-review.js";
import {storeAccountingTimestampMs} from "./store-accounting-time.js";
import {inspectStoreFinancialSettlementOffline}
  from "./store-financial-settlement-offline.js";
import {validateStorePurchaseOperationId}
  from "./store-purchase-policy.js";

export const STORE_REFUND_POSTING_PAGE_SIZE=20;
const SOURCES=Object.freeze({
  receipts:{collection:"store_purchase_receipts",field:"refundedAt",prefix:""},
  ledger:{collection:"financial_ledger",field:"createdAt",
    prefix:"store_refund_"},
  audit:{collection:"admin_audit_logs",field:"createdAt",
    prefix:"store_refund_"},
});
const validUid=x=>typeof x==="string"&&/^[A-Za-z0-9_-]{1,128}$/.test(x);
const validProduct=x=>typeof x==="string"&&/^[1-9][0-9]{5,8}$/.test(x);
function identity(source,row){
  const d=row?.data||{};
  const uid=source==="ledger"?d.userId:d.buyerUid;
  if(!validUid(uid))return null;
  const raw=source==="ledger"?
    typeof d.sourceId==="string"&&d.sourceId.startsWith(uid+"__")
      ?d.sourceId.slice(uid.length+2):null:
    d.operationId;
  let opId;
  try{opId=validateStorePurchaseOperationId(raw);}
  catch(_){return null;}
  const id=uid+"__"+opId;
  if(row?.id!==SOURCES[source].prefix+id)return null;
  return {uid,opId,id};
}
function pageCursor(raw,day,bounds){
  if(raw===null||raw===undefined||raw==="")return null;
  if(typeof raw!=="string"||raw.length>650)
    throw Error("invalid_store_refund_posting_cursor");
  try{
    const x=JSON.parse(atob(raw));
    if(x?.day!==day||!validUid(x?.uid)||
        !Number.isSafeInteger(x?.atMs)||
        x.atMs<bounds.start||x.atMs>=bounds.end)
      throw Error("cursor");
    const opId=validateStorePurchaseOperationId(x.opId);
    if(x.id!==x.uid+"__"+opId)throw Error("cursor");
    return {uid:x.uid,opId,id:x.id,atMs:x.atMs};
  }catch(_){throw Error("invalid_store_refund_posting_cursor");}
}
const makeCursor=(day,item,atMs)=>btoa(JSON.stringify({
  day,uid:item.uid,opId:item.opId,id:item.id,atMs,
}));
function matches(source,data,item,price){
  if(source==="receipts")return data.buyerUid===item.uid&&
    data.operationId===item.opId&&data.refundStatus==="refunded"&&
    validProduct(data.productId)&&data.priceCoins===price&&
    data.refundedCoins===price&&data.refundLedgerId==="store_refund_"+item.id;
  if(source==="ledger")return data.userId===item.uid&&
    data.sourceId===item.id&&data.idempotencyKey==="store_refund_"+item.id&&
    data.asset==="coins"&&data.sourceType==="storePurchaseRefund"&&
    data.reason==="store_item_refund"&&data.delta===price;
  return data.buyerUid===item.uid&&data.operationId===item.opId&&
    data.action==="refundStorePurchase"&&
    data.targetType==="store_purchase_receipt"&&
    data.targetId==="store_purchase_receipts/"+item.id&&
    data.refundedCoins===price&&data.ledgerId==="store_refund_"+item.id;
}
function base(day,counts){
  return {ok:true,scope:"all_buyers_one_utc_refund_posting_day_page",
    day,pageLimit:STORE_REFUND_POSTING_PAGE_SIZE,sourceCounts:counts,
    accountingBasis:"refund_posting_day_cohort",
    productionFinancialWritesPerformed:false,
    perOperationRefundPostingProof:true,
    independentRefundSourceCoverageCertified:false,
    snapshotIsolationCertified:false,cursorSnapshotCertified:false,
    allPagesReviewed:false,historicalDateCoverageCertified:false,
    externalChargebacksCertified:false,fullPeriodSettlementCertified:false,
    financialReportComplete:false,netRevenueCertified:false,
    refundSettlementCertified:false};
}
const blocked=(day,counts,reason)=>({
  ...base(day,counts),reviewStatus:"blocked",blockingReason:reason,
  pageAmountsAvailable:false,inspected:0,verified:0,
  hasMore:false,nextCursor:null,
});
const totalCoins=(a,b)=>{
  if(!Number.isSafeInteger(a)||!Number.isSafeInteger(b)||
      a<0||b<0||!Number.isSafeInteger(a+b))
    throw Error("store_refund_posting_page_overflow");
  return a+b;
};

// Never combine totals across cursor calls: data can change between pages.
// A missing timestamp in any source is NOT covered by these indexed ranges.
export async function reviewStoreRefundPostingDayPage(
  db,{day,cursor=null,nowMs=Date.now()}={}){
  const bounds=storeGlobalDayBounds(day,nowMs);
  const decoded=pageCursor(cursor,day,bounds);
  const counts={receipts:0,ledger:0,audit:0},maps={},sentinels={},more={};
  for(const [source,config] of Object.entries(SOURCES)){
    const rows=await db.runQuery(config.collection,{
      filters:[
        {field:config.field,op:">=",value:new Date(bounds.start)},
        {field:config.field,op:"<",value:new Date(bounds.end)},
        ...(source==="ledger"?[
          {field:"sourceType",op:"==",value:"storePurchaseRefund"}]:[]),
        ...(source==="audit"?[
          {field:"action",op:"==",value:"refundStorePurchase"}]:[]),
      ],
      orderBy:[{field:config.field,direction:"desc"},
        {field:"__name__",direction:"desc"}],
      limit:STORE_REFUND_POSTING_PAGE_SIZE+1,
      startAfter:decoded?[new Date(decoded.atMs),{
        referencePath:config.collection+"/"+config.prefix+decoded.id,
      }]:[],
    });
    if(!Array.isArray(rows)||
        rows.length>STORE_REFUND_POSTING_PAGE_SIZE+1)
      throw Error("invalid_store_refund_posting_query");
    counts[source]=rows.length;
    more[source]=rows.length>STORE_REFUND_POSTING_PAGE_SIZE;
    const map=new Map();
    for(const row of rows.slice(0,STORE_REFUND_POSTING_PAGE_SIZE)){
      const item=identity(source,row);
      const atMs=storeAccountingTimestampMs(row?.data?.[config.field]);
      if(!item||atMs===null||atMs<bounds.start||atMs>=bounds.end||
          map.has(item.id))
        return blocked(day,counts,"invalid_refund_source_identity");
      map.set(item.id,{item,row,atMs});
    }
    maps[source]=map;
    if(more[source]){
      const row=rows[STORE_REFUND_POSTING_PAGE_SIZE];
      const item=identity(source,row);
      const atMs=storeAccountingTimestampMs(row?.data?.[config.field]);
      if(!item||atMs===null||atMs<bounds.start||atMs>=bounds.end)
        return blocked(day,counts,"invalid_refund_source_sentinel");
      sentinels[source]={id:item.id,atMs};
    }
  }
  const firstMore=more.receipts;
  if(Object.values(more).some(x=>x!==firstMore))
    return blocked(day,counts,"refund_source_boundary_mismatch");
  if(firstMore){
    const sentinel=sentinels.receipts;
    if(Object.values(sentinels).some(x=>
        x.id!==sentinel.id||x.atMs!==sentinel.atMs))
      return blocked(day,counts,"refund_source_boundary_mismatch");
  }
  const receiptEntries=[...maps.receipts.entries()];
  for(const source of Object.keys(SOURCES)){
    const entries=[...maps[source].entries()];
    if(entries.length!==receiptEntries.length||
        entries.some(([id,row],index)=>id!==receiptEntries[index][0]||
          row.atMs!==receiptEntries[index][1].atMs))
      return blocked(day,counts,"refund_source_order_or_time_mismatch");
  }
  let pageRefundedCoins=0;
  for(const [,entry] of receiptEntries){
    const {item,row}=entry;
    if(!validProduct(row.data.productId))
      return blocked(day,counts,"invalid_refund_receipt_product");
    // The existing six-document offline verifier also checks independent
    // credit arithmetic, approval actor, exact source and refund status.
    const proof=await inspectStoreFinancialSettlementOffline(db,{
      buyerUid:item.uid,operationId:item.opId,
      expectedProductId:row.data.productId,
    });
    if(proof.verified!==true||proof.refundStatus!=="refunded"||
        proof.grossCoins!==proof.refundedCoins||proof.netCoins!==0)
      return blocked(day,counts,"refund_proof_failed");
    for(const source of Object.keys(SOURCES)){
      const value=maps[source].get(item.id);
      if(!matches(source,value.row.data||{},item,proof.refundedCoins))
        return blocked(day,counts,"refund_source_proof_conflict");
    }
    pageRefundedCoins=totalCoins(pageRefundedCoins,proof.refundedCoins);
  }
  const last=receiptEntries.at(-1)?.[1];
  const nextCursor=firstMore&&last
    ?makeCursor(day,last.item,last.atMs):null;
  if(firstMore&&!nextCursor)
    return blocked(day,counts,"invalid_refund_page_boundary");
  return {...base(day,counts),reviewStatus:"reviewed",
    pageAmountsAvailable:true,inspected:receiptEntries.length,
    verified:receiptEntries.length,pageRefundedCoins,
    hasMore:firstMore,nextCursor};
}
