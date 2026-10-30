// Owner daily Store financial evidence: ONE UTC date, ONE indexed source,
// ONE <=10-entry page from ALL buyers. Read-only. Not all-time revenue.
// Legacy records lacking the indexed date are OUTSIDE these queries and must
// be separately backfilled/certified before financial completeness is claimed.
import {certifyStorePurchaseEvidenceOffline}
  from "./store-purchase-reconciliation-offline.js";
import {validateStorePurchaseOperationId}
  from "./store-purchase-policy.js";

const PAGE_SIZE=10;
const MAX_HISTORY_DAYS=366;
const sources=Object.freeze({
  receipts:{collection:"store_purchase_receipts",dateField:"acquiredAtMs"},
  operations:{collection:"store_purchase_operations",dateField:"createdAt"},
  ledger:{collection:"financial_ledger",dateField:"createdAt"},
  audit:{collection:"admin_audit_logs",dateField:"createdAt"},
});
const uidPattern=/^[A-Za-z0-9_-]{1,128}$/;
const documentPattern=/^[A-Za-z0-9_-]{1,360}$/;
export function storeGlobalDayBounds(day,nowMs){
  if(typeof day!=="string"||!/^\d{4}-\d{2}-\d{2}$/.test(day))
    throw Error("invalid_store_global_day");
  const start=Date.parse(day+"T00:00:00.000Z");
  if(!Number.isSafeInteger(start)||
      new Date(start).toISOString().slice(0,10)!==day||
      !Number.isSafeInteger(nowMs)||start>=nowMs||
      nowMs-start>MAX_HISTORY_DAYS*86400000||
      start+86400000>nowMs)
    throw Error("invalid_store_global_day");
  return {start,end:start+86400000};
}
function checkTime(source,value,{start,end}){
  if(source==="receipts")
    return Number.isSafeInteger(value)&&value>=start&&value<end;
  const time=typeof value==="string"?Date.parse(value):NaN;
  return Number.isSafeInteger(time)&&time>=start&&time<end;
}
function cursorDecode(raw,day,source,bounds){
  if(raw===null||raw===undefined||raw==="")return [];
  if(typeof raw!=="string"||raw.length>900)
    throw Error("invalid_store_global_cursor");
  try{
    const item=JSON.parse(atob(raw));
    if(item?.day!==day||item?.source!==source||
        typeof item.id!=="string"||!documentPattern.test(item.id)||
        !checkTime(source,item.at,bounds))
      throw Error("cursor");
    const at=source==="receipts"?item.at:new Date(item.at);
    return [at,{referencePath:sources[source].collection+"/"+item.id}];
  }catch(_){throw Error("invalid_store_global_cursor");}
}
function cursorEncode(row,day,source,bounds){
  const field=sources[source].dateField;
  if(typeof row?.id!=="string"||!documentPattern.test(row.id)||
      !checkTime(source,row?.data?.[field],bounds))return null;
  return btoa(JSON.stringify({day,source,id:row.id,at:row.data[field]}));
}
function identity(row,source){
  const data=row?.data||{};
  const uid=source==="ledger"?data.userId:
    source==="audit"?data.actorUid:data.buyerUid;
  if(typeof uid!=="string"||!uidPattern.test(uid))
    return null;
  let opId=source==="receipts"?data.operationId:
    source==="operations"?data.result?.operationId:
    source==="audit"?data.operationId:
      typeof data.sourceId==="string"&&data.sourceId.startsWith(uid+"__")
        ?data.sourceId.slice(uid.length+2):null;
  try{opId=validateStorePurchaseOperationId(opId);}
  catch(_){return null;}
  const idPrefix=source==="ledger"?"store_"+uid+"__":
    source==="audit"?"store_purchase_"+uid+"__":uid+"__";
  if(row?.id!==idPrefix+opId)return null;
  return {uid,opId};
}
function sourceMatches(row,source,uid,opId,proof){
  const x=row?.data||{};
  const amount=proof.certifiedAmountCoins;
  switch(source){
    case "receipts":
      return x.buyerUid===uid&&x.operationId===opId&&
        x.priceCoins===amount&&x.refundStatus==="none"&&
        x.deliveryStatus==="delivered"&&
        x.renewal===(proof.kind==="renew");
    case "operations":
      return x.buyerUid===uid&&x.status==="completed"&&
        x.kind===proof.kind&&x.result?.operationId===opId&&
        x.result?.priceCoins===amount;
    case "ledger":
      return x.userId===uid&&x.sourceType==="storePurchase"&&
        x.asset==="coins"&&x.delta===-amount&&
        x.reason==="store_item_purchase"&&
        x.sourceId===uid+"__"+opId&&
        x.idempotencyKey===uid+"__"+opId&&
        x.renewal===(proof.kind==="renew");
    case "audit":
      return x.actorUid===uid&&x.operationId===opId&&
        x.priceCoins===amount&&x.targetType==="store_entitlement"&&
        x.action===(proof.kind==="renew"?
          "renewStoreItem":"purchaseStoreItem");
    default:return false;
  }
}
export async function reviewStoreGlobalDailyPage(
  db,{day,source,cursor=null,nowMs=Date.now()}={}){
  if(!Object.hasOwn(sources,source))
    throw Error("invalid_store_global_source");
  const bounds=storeGlobalDayBounds(day,nowMs),config=sources[source];
  const stamp=source==="receipts"?{start:bounds.start,end:bounds.end}:
    {start:new Date(bounds.start),end:new Date(bounds.end)};
  const filters=[
    {field:config.dateField,op:">=",value:stamp.start},
    {field:config.dateField,op:"<",value:stamp.end},
    ...(source==="ledger"?[
      {field:"sourceType",op:"==",value:"storePurchase"},
    ]:[]),
    ...(source==="audit"?[
      {field:"action",op:"in",value:[
        "purchaseStoreItem","renewStoreItem",
      ]},
    ]:[]),
  ];
  const docs=await db.runQuery(config.collection,{
    filters,
    orderBy:[
      {field:config.dateField,direction:"desc"},
      {field:"__name__",direction:"desc"},
    ],
    startAfter:cursorDecode(cursor,day,source,bounds),
    limit:PAGE_SIZE+1,
  });
  const page=docs.slice(0,PAGE_SIZE),seen=new Set();
  const evidence=await Promise.all(page.map(async row=>{
    if(typeof row?.id!=="string"||seen.has(row.id)||
        !documentPattern.test(row.id))
      return {verified:false,code:"invalid_or_duplicate_source_key"};
    seen.add(row.id);
    if(!checkTime(source,row?.data?.[config.dateField],bounds))
      return {verified:false,code:"invalid_source_date"};
    const id=identity(row,source);
    if(!id)return {verified:false,code:"invalid_source_identity"};
    const proof=await certifyStorePurchaseEvidenceOffline(db,{
      buyerUid:id.uid,operationId:id.opId,
    });
    if(!proof.ok)
      return {buyerUid:id.uid,operationId:id.opId,
        verified:false,code:proof.code};
    if(!sourceMatches(row,source,id.uid,id.opId,proof))
      return {buyerUid:id.uid,operationId:id.opId,
        verified:false,code:"conflicting_source_snapshot"};
    return {
      buyerUid:id.uid,operationId:id.opId,verified:true,
      kind:proof.kind,certifiedAmountCoins:proof.certifiedAmountCoins,
    };
  }));
  const verified=evidence.filter(row=>row.verified);
  const sum=kind=>verified.filter(row=>row.kind===kind)
    .reduce((total,row)=>total+row.certifiedAmountCoins,0);
  const purchaseCoins=sum("purchase"),renewalCoins=sum("renew");
  if(!Number.isSafeInteger(purchaseCoins)||
      !Number.isSafeInteger(renewalCoins)||
      !Number.isSafeInteger(purchaseCoins+renewalCoins))
    throw Error("store_global_page_amount_overflow");
  const hasMore=docs.length>PAGE_SIZE;
  const nextCursor=hasMore
    ?cursorEncode(page.at(-1),day,source,bounds):null;
  return {
    ok:true,scope:"all_buyers_one_day_one_source_page",day,source,
    pageLimit:PAGE_SIZE,inspected:evidence.length,
    verified:verified.length,needsReview:evidence.length-verified.length,
    verifiedPurchaseCoins:purchaseCoins,verifiedRenewalCoins:renewalCoins,
    hasMore,nextCursor,paginationBlocked:hasMore&&!nextCursor,
    // Field-existence and late-write gap remain open even on final page.
    missingDateFieldsNotCovered:true,
    sourceCompletenessCertified:false,legacyBackfillCertified:false,
    partialEvidenceOnly:true,financialReportComplete:false,
    netRevenueCertified:false,refundSettlementCertified:false,
    evidence,
  };
}
