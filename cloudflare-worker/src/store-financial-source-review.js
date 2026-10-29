// Store Owner audit parity: independently inspect non-receipt sources for
// orphan purchase operations, debits, or audit entries. Finance-only domain.
// This module does NOT authorize callers: the Store handler MUST verify Owner,
// recent login and target before calling. NO money movements, global scans,
// cleanup, settlement, refunds, or all-time financial certifications.
import {validateStorePurchaseOperationId}
  from "./store-purchase-policy.js";
import {certifyStorePurchaseEvidenceOffline}
  from "./store-purchase-reconciliation-offline.js";

const PAGE_SIZE=10;
const UID_RE=/^[A-Za-z0-9_-]{1,128}$/;
const productIdValid=id=>typeof id==="string"&&/^[1-9][0-9]{5,8}$/.test(id);
const sources=Object.freeze({
  operations:{
    collection:"store_purchase_operations",
    keyPrefix:uid=>uid+"__",
    filters:uid=>[{field:"buyerUid",op:"==",value:uid}],
  },
  ledger:{
    collection:"financial_ledger",
    keyPrefix:uid=>"store_"+uid+"__",
    filters:uid=>[
      {field:"userId",op:"==",value:uid},
      {field:"sourceType",op:"==",value:"storePurchase"},
    ],
  },
  audit:{
    collection:"admin_audit_logs",
    keyPrefix:uid=>"store_purchase_"+uid+"__",
    filters:uid=>[
      {field:"actorUid",op:"==",value:uid},
      {field:"action",op:"in",value:["purchaseStoreItem","renewStoreItem"]},
    ],
  },
});
function parseCursor(cursor,uid,source,prefix){
  if(cursor===null||cursor===undefined||cursor==="")return [];
  if(typeof cursor!=="string"||cursor.length>600)
    throw Error("invalid_store_financial_source_cursor");
  try{
    const value=JSON.parse(atob(cursor));
    if(value?.uid!==uid||value?.source!==source||
        typeof value.id!=="string"||
        !value.id.startsWith(prefix))throw Error("cursor");
    validateStorePurchaseOperationId(value.id.slice(prefix.length));
    return [{referencePath:sources[source].collection+"/"+value.id}];
  }catch(_){throw Error("invalid_store_financial_source_cursor");}
}
function makeCursor(row,uid,source,prefix){
  if(typeof row?.id!=="string"||!row.id.startsWith(prefix))
    return null;
  try{validateStorePurchaseOperationId(row.id.slice(prefix.length));}
  catch(_){return null;}
  return btoa(JSON.stringify({uid,source,id:row.id}));
}
function rowMatchesSource(source,row,uid,key,certified){
  const data=row?.data||{};
  const operationKey=uid+"__"+key;
  const price=certified.certifiedAmountCoins;
  switch(source){
  case "operations":
    return data.buyerUid===uid&&productIdValid(data.productId)&&
      data.status==="completed"&&data.kind===certified.kind&&
      data.result?.operationId===key&&
      data.result?.priceCoins===price;
  case "ledger":
    return data.userId===uid&&data.sourceType==="storePurchase"&&
      data.sourceId===operationKey&&
      data.idempotencyKey===operationKey&&
      data.reason==="store_item_purchase"&&data.delta===-price&&
      data.renewal===(certified.kind==="renew");
  case "audit":
    return data.actorUid===uid&&
      data.targetType==="store_entitlement"&&
      data.operationId===key&&data.priceCoins===price&&
      data.action===(certified.kind==="renew"
        ?"renewStoreItem":"purchaseStoreItem");
  default:return false;
  }
}

// Exactly one indexed source query of <=11 rows, plus <=10*4 exact proof
// reads, for ONE verified target. No operation count is inferred from receipt
// pages, and no source can hide its own orphan just because a receipt is absent.
export async function reviewStoreFinancialSourcePage(
  db,{buyerUid,source,cursor=null}={}){
  if(!UID_RE.test(buyerUid||""))throw Error("invalid_target_id");
  if(!Object.hasOwn(sources,source))
    throw Error("invalid_store_financial_source");
  const config=sources[source];
  const prefix=config.keyPrefix(buyerUid);
  const docs=await db.runQuery(config.collection,{
    filters:config.filters(buyerUid),
    orderBy:[{field:"__name__",direction:"desc"}],
    startAfter:parseCursor(cursor,buyerUid,source,prefix),
    limit:PAGE_SIZE+1,
  });
  const page=docs.slice(0,PAGE_SIZE);
  const seen=new Set();
  const evidence=await Promise.all(page.map(async row=>{
    const id=row?.id;
    if(typeof id!=="string"||seen.has(id)||!id.startsWith(prefix))
      return {verified:false,code:"invalid_or_duplicate_source_key"};
    seen.add(id);
    const operationId=id.slice(prefix.length);
    try{validateStorePurchaseOperationId(operationId);}
    catch(_){return {verified:false,code:"invalid_source_operation"};}
    const certified=await certifyStorePurchaseEvidenceOffline(db,{
      buyerUid,operationId,
    });
    if(!certified.ok)
      return {operationId,verified:false,code:certified.code};
    if(!rowMatchesSource(source,row,buyerUid,operationId,certified))
      return {operationId,verified:false,code:"conflicting_source_snapshot"};
    return {operationId,verified:true,kind:certified.kind,
      certifiedAmountCoins:certified.certifiedAmountCoins};
  }));
  const verifiedRows=evidence.filter(x=>x.verified);
  const total=kind=>verifiedRows.filter(x=>x.kind===kind)
    .reduce((acc,x)=>acc+x.certifiedAmountCoins,0);
  const verifiedPurchaseCoins=total("purchase");
  const verifiedRenewalCoins=total("renew");
  if(!Number.isSafeInteger(verifiedPurchaseCoins)||
     !Number.isSafeInteger(verifiedRenewalCoins)||
     !Number.isSafeInteger(verifiedPurchaseCoins+verifiedRenewalCoins))
    throw Error("store_evidence_total_overflow");
  const hasMore=docs.length>PAGE_SIZE;
  const nextCursor=hasMore
    ?makeCursor(page.at(-1),buyerUid,source,prefix):null;
  return {
    ok:true,scope:"one_buyer_source_page",source,
    pageLimit:PAGE_SIZE,inspected:evidence.length,
    verified:verifiedRows.length,needsReview:evidence.length-verifiedRows.length,
    verifiedPurchases:verifiedRows.filter(x=>x.kind==="purchase").length,
    verifiedRenewals:verifiedRows.filter(x=>x.kind==="renew").length,
    verifiedPurchaseCoins,verifiedRenewalCoins,
    orphanOrConflicting:evidence.filter(x=>!x.verified).length,
    hasMore,nextCursor,paginationBlocked:hasMore&&nextCursor===null,
    // Each source is an independent window with possible backdated rows.
    // No all-time or global cross-source completeness is ever inferred.
    partialEvidenceOnly:true,financialReportComplete:false,
    netRevenueCertified:false,refundSettlementCertified:false,
    evidence,
  };
}
