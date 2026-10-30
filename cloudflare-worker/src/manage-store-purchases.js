// Read-only Store purchase receipt inspector. Never creates receipts or charges Coins.
import {json,readJson,firestoreQuotaResponse} from "./http.js";
import {verifyFirebaseIdToken,assertUserDocumentSessionState} from "./firebase-auth.js";
import {firestoreClient} from "./firestore.js";
import {STORE_CATEGORIES} from "./store-catalog-policy.js";
import {validateStorePurchaseOperationId}
  from "./store-purchase-policy.js";
import {certifyStorePurchaseEvidenceOffline}
  from "./store-purchase-reconciliation-offline.js";
import {reviewStoreFinancialSourcePage}
  from "./store-financial-source-review.js";
import {reviewStoreGlobalDailyPage}
  from "./store-global-daily-financial-review.js";
import {
  cleanStoreId,validStoreUid,hasRecentStoreAdminLogin,resolveStoreAdminTarget,
} from "./store-admin-target.js";

export function canViewStorePurchases(user={}) {
  if (user.role==="owner") return true;
  return user.adminEnabled===true &&
    (user.role==="admin"||user.role==="super_admin") &&
    Array.isArray(user.capabilities) &&
    user.capabilities.includes("viewStorePurchases");
}

export function projectStorePurchaseReceipt(receipt={},uid,includeOperationId=false) {
  if (!receipt || receipt.buyerUid!==uid ||
      !/^[1-9][0-9]{5,8}$/.test(cleanStoreId(receipt.productId)) ||
      !Object.hasOwn(STORE_CATEGORIES,cleanStoreId(receipt.category)) ||
      !Number.isSafeInteger(receipt.priceCoins) || receipt.priceCoins<=0 ||
      !Number.isSafeInteger(receipt.acquiredAtMs) ||
      receipt.acquiredAtMs<0) return null;
  const name=cleanStoreId(receipt.nameAr);
  if (name.length<2||name.length>70) return null;
  const expiresAtMs=receipt.expiresAtMs ?? null;
  if (expiresAtMs!==null &&
      (!Number.isSafeInteger(expiresAtMs)||expiresAtMs<=receipt.acquiredAtMs)) {
    return null;
  }
  const deliveryStatus=cleanStoreId(receipt.deliveryStatus);
  const refundStatus=cleanStoreId(receipt.refundStatus);
  return {
    productId:cleanStoreId(receipt.productId),
    nameAr:name,
    category:cleanStoreId(receipt.category),
    priceCoins:receipt.priceCoins,
    acquiredAtMs:receipt.acquiredAtMs,
    expiresAtMs,
    deliveryStatus:["delivered","pending","failed"].includes(deliveryStatus)
      ? deliveryStatus:"unknown",
    refundStatus:["none","requested","refunded","rejected"].includes(refundStatus)
      ? refundStatus:"unknown",
    // Operation keys are exposed ONLY to the verified Owner. Regular
    // purchase-history staff retain the unchanged sanitized projection.
    ...(includeOperationId&&
      /^[A-Za-z0-9_-]{12,100}$/.test(cleanStoreId(receipt.operationId))
      ?{operationId:cleanStoreId(receipt.operationId)}:{}),
  };
}

async function authorizedStorePurchaseActor(db,token,{ownerOnly=false}={}) {
  const uid=cleanStoreId(token?.sub);
  if (!validStoreUid(uid)) throw Error("unauthorized");
  const actor=await db.get(`users/${uid}`);
  if (!actor.exists) throw Error("forbidden");
  assertUserDocumentSessionState(token,actor.data||{});
  if (!canViewStorePurchases(actor.data||{}) ||
      (ownerOnly&&actor.data?.role!=="owner")) throw Error("forbidden");
  if (!hasRecentStoreAdminLogin(token)) throw Error("recent_auth_required");
  return actor.data||{};
}

// A stable server-ordered cursor. acquiredAtMs exists on all valid historic
// receipts; older receipts may lack createdAt. Base64 is transport, not auth:
// user/target permissions and buyerUid equality are checked on EVERY page.
const RECEIPT_PAGE_SIZE=50;
const receiptIdValid=id=>/^[A-Za-z0-9_-]{1,128}__[A-Za-z0-9_-]{12,100}$/.test(id);
function decodeReceiptCursor(value,uid){
  if(value===undefined||value===null||value==="")return [];
  if(typeof value!=="string"||value.length>600)
    throw Error("invalid_store_receipt_cursor");
  try{
    const cursor=JSON.parse(atob(value));
    if(cursor?.uid!==uid||!Number.isSafeInteger(cursor.at)||
        cursor.at<0||!receiptIdValid(cursor.id)||
        !cursor.id.startsWith(uid+"__"))
      throw Error("invalid_store_receipt_cursor");
    return [cursor.at,{referencePath:"store_purchase_receipts/"+cursor.id}];
  }catch(_){throw Error("invalid_store_receipt_cursor");}
}
function encodeReceiptCursor(doc,uid){
  if(!Number.isSafeInteger(doc?.data?.acquiredAtMs)||
      doc.data.acquiredAtMs<0||!receiptIdValid(doc?.id)||
      !doc.id.startsWith(uid+"__"))return null;
  return btoa(JSON.stringify({uid,at:doc.data.acquiredAtMs,id:doc.id}));
}
export async function loadStoreUserPurchases(db,token,rawTargetId,rawCursor=null) {
  const actor=await authorizedStorePurchaseActor(db,token);
  const isOwner=actor.role==="owner";
  // Delegated history viewers cannot navigate a cursor carrying encoded
  // financial receipt document IDs, even when submitted by hand.
  if(!isOwner&&rawCursor!==null&&rawCursor!==undefined&&rawCursor!=="")
    throw Error("forbidden");
  const {targetUid,searchedId}=await resolveStoreAdminTarget(db,rawTargetId);
  const startAfter=decodeReceiptCursor(rawCursor,targetUid);
  // Indexed bounded query: order BEFORE limit, with document-ID tie breaker.
  // acquiredAtMs (not optional createdAt) includes older valid receipts.
  // The extra row determines if another page exists; invalid rows are omitted
  // from projection rather than invented as successful purchases.
  const docs=await db.runQuery("store_purchase_receipts",{
    filters:[{field:"buyerUid",op:"==",value:targetUid}],
    orderBy:[{field:"acquiredAtMs",direction:"desc"},
      {field:"__name__",direction:"desc"}],
    startAfter,limit:RECEIPT_PAGE_SIZE+1,
  });
  const page=docs.slice(0,RECEIPT_PAGE_SIZE);
  const receipts=page
    .map(row=>projectStorePurchaseReceipt(row.data,targetUid,isOwner))
    .filter(Boolean);
  const hasNextPage=docs.length>RECEIPT_PAGE_SIZE;
  // A cursor embeds the receipt document ID (and thus operationId).
  // Do not expose even base64-encoded financial operation IDs to delegated
  // viewers. Owner can page; delegated staff retain their bounded sample.
  const nextCursor=hasNextPage&&isOwner
    ?encodeReceiptCursor(page[page.length-1],targetUid):null;
  return {
    ok:true,searchedId,targetUid,receipts,
    resultLimit:RECEIPT_PAGE_SIZE,moreMayExist:hasNextPage,
    nextCursor,hasNextPage:hasNextPage&&nextCursor!==null,
    purchasingEnabled:false,canVerifyReceipts:isOwner,
  };
}
// Read-only verification of ONE explicitly selected operation. This reuses
// the existing four-document financial evidence checker and target resolver;
// it is not a settlement, revenue aggregate, wallet scan or repair.
export async function verifyStorePurchaseEvidenceForOwner(
  db,token,rawTargetId,rawOperationId,rawProductId){
  await authorizedStorePurchaseActor(db,token,{ownerOnly:true});
  const operationId=validateStorePurchaseOperationId(rawOperationId);
  const productId=cleanStoreId(rawProductId);
  if(!/^[1-9][0-9]{5,8}$/.test(productId))
    throw Error("invalid_store_product_id");
  const {targetUid}=await resolveStoreAdminTarget(db,rawTargetId);
  const result=await certifyStorePurchaseEvidenceOffline(
    db,{buyerUid:targetUid,operationId,expectedProductId:productId});
  return {
    ok:true,operationId,verified:result.ok,
    ...(result.ok
      ?{kind:result.kind,certifiedAmountCoins:result.certifiedAmountCoins}
      :{code:result.code}),
  };
}

// Financial evidence workbench: at most FIVE explicitly selected historical
// operations for ONE target. This is never a financial revenue/settlement report.
export async function reviewStorePurchaseEvidenceBatchForOwner(
  db,token,rawTargetId,rawEntries){
  await authorizedStorePurchaseActor(db,token,{ownerOnly:true});
  if(!Array.isArray(rawEntries)||rawEntries.length<1||rawEntries.length>5)
    throw Error("invalid_store_review_selection");
  const seen=new Set();
  const entries=rawEntries.map(row=>{
    if(!row||typeof row!=="object"||Array.isArray(row))
      throw Error("invalid_store_review_selection");
    const operationId=validateStorePurchaseOperationId(row.operationId);
    const productId=cleanStoreId(row.productId);
    if(!/^[1-9][0-9]{5,8}$/.test(productId)||
        seen.has(operationId)) throw Error("invalid_store_review_selection");
    seen.add(operationId);
    return {operationId,productId};
  });
  const {targetUid}=await resolveStoreAdminTarget(db,rawTargetId);
  // Reuse the certified four-document engine. No wallet reads, scans,
  // time-range sums, refunds, or balance repairs; max 20 exact reads.
  const evidence=await Promise.all(entries.map(async row=>{
    const result=await certifyStorePurchaseEvidenceOffline(db,{
      buyerUid:targetUid,operationId:row.operationId,
      expectedProductId:row.productId,
    });
    return {operationId:row.operationId,verified:result.ok,
      ...(result.ok?{
        kind:result.kind,certifiedAmountCoins:result.certifiedAmountCoins,
      }:{code:result.code})};
  }));
  return {
    ok:true,scope:"selected_operations_only",inspected:evidence.length,
    verified:evidence.filter(row=>row.verified).length,
    verifiedPurchases:evidence.filter(row=>
      row.verified&&row.kind==="purchase").length,
    verifiedRenewals:evidence.filter(row=>
      row.verified&&row.kind==="renew").length,
    needsReview:evidence.filter(row=>!row.verified).length,
    requiresRefundReview:evidence.filter(row=>
      row.code==="requires_refund_review").length,
    incompleteEvidence:evidence.filter(row=>
      row.code==="not_found"||row.code==="incomplete_evidence").length,
    conflictingEvidence:evidence.filter(row=>!row.verified&&
      !["not_found","incomplete_evidence","requires_refund_review"]
        .includes(row.code)).length,
    financialReportComplete:false,netRevenueCertified:false,
    evidence,
  };
}

// Owner-only indexed evidence report for ONE buyer and ONE bounded page.
// It deliberately does NOT claim complete user history, global revenue,
// refund/chargeback settlement, or current wallet reconciliation. Queries are
// ordered by the already READY 579F buyerUid/acquiredAtMs/__name__ index.
// Each valid receipt is checked against the immutable four-document proof.
const FINANCIAL_EVIDENCE_PAGE_SIZE=10;
export async function loadStoreUserFinancialEvidencePage(
  db,token,rawTargetId,rawCursor=null){
  await authorizedStorePurchaseActor(db,token,{ownerOnly:true});
  const {targetUid,searchedId}=await resolveStoreAdminTarget(db,rawTargetId);
  const startAfter=decodeReceiptCursor(rawCursor,targetUid);
  const docs=await db.runQuery("store_purchase_receipts",{
    filters:[{field:"buyerUid",op:"==",value:targetUid}],
    orderBy:[{field:"acquiredAtMs",direction:"desc"},
      {field:"__name__",direction:"desc"}],
    startAfter,limit:FINANCIAL_EVIDENCE_PAGE_SIZE+1,
  });
  const page=docs.slice(0,FINANCIAL_EVIDENCE_PAGE_SIZE);
  const seenReceiptIds=new Set();
  const evidence=await Promise.all(page.map(async row=>{
    const documentId=row?.id;
    if(typeof documentId!=="string"||seenReceiptIds.has(documentId))
      return {verified:false,code:"invalid_or_duplicate_receipt_key"};
    seenReceiptIds.add(documentId);
    const receipt=row?.data||{};
    const opKey=cleanStoreId(receipt.operationId);
    const productId=cleanStoreId(receipt.productId);
    const validKey=typeof documentId==="string"&&
      documentId===targetUid+"__"+opKey;
    try{validateStorePurchaseOperationId(opKey);}
    catch(_){return {verified:false,code:"invalid_receipt_identity"};}
    if(!validKey||receipt.buyerUid!==targetUid||
      !/^[1-9][0-9]{5,8}$/.test(productId)||
      !Number.isSafeInteger(receipt.acquiredAtMs)||
      receipt.acquiredAtMs<0)
      return {verified:false,code:"invalid_receipt_identity"};
    // The indexed query and four exact reads are not a single Firestore
    // snapshot. Reject a refund/incomplete status observed in EITHER read:
    // never certify on an older or contradictory receipt view.
    if(receipt.refundStatus!=="none")
      return {operationId:opKey,productId,verified:false,
        code:"requires_refund_review"};
    if(receipt.deliveryStatus!=="delivered"||
        !Number.isSafeInteger(receipt.priceCoins)||
        receipt.priceCoins<=0||typeof receipt.renewal!=="boolean")
      return {operationId:opKey,productId,verified:false,
        code:"invalid_receipt_financial_state"};
    const check=await certifyStorePurchaseEvidenceOffline(db,{
      buyerUid:targetUid,operationId:opKey,expectedProductId:productId,
    });
    if(check.ok&&(check.certifiedAmountCoins!==receipt.priceCoins||
        (check.kind==="renew")!==receipt.renewal))
      return {operationId:opKey,productId,verified:false,
        code:"conflicting_receipt_snapshot"};
    return {
      operationId:opKey,productId,verified:check.ok,
      ...(check.ok?{
        kind:check.kind,certifiedAmountCoins:check.certifiedAmountCoins,
      }:{code:check.code}),
    };
  }));
  const verified=evidence.filter(row=>row.verified);
  const totalFor=kind=>verified.filter(row=>row.kind===kind)
    .reduce((n,row)=>n+row.certifiedAmountCoins,0);
  const verifiedPurchaseCoins=totalFor("purchase");
  const verifiedRenewalCoins=totalFor("renew");
  if(!Number.isSafeInteger(verifiedPurchaseCoins)||
    !Number.isSafeInteger(verifiedRenewalCoins)||
    !Number.isSafeInteger(verifiedPurchaseCoins+verifiedRenewalCoins))
    throw Error("store_evidence_total_overflow");
  const hasMore=docs.length>FINANCIAL_EVIDENCE_PAGE_SIZE;
  const nextCursor=hasMore
    ?encodeReceiptCursor(page[page.length-1],targetUid):null;
  // If an invalid last receipt lacks the stable document key, never
  // claim pagination ended cleanly or silently skip the bad evidence.
  return {
    ok:true,searchedId,targetUid,scope:"one_buyer_one_page",
    pageLimit:FINANCIAL_EVIDENCE_PAGE_SIZE,inspected:evidence.length,
    verified:verified.length,needsReview:evidence.length-verified.length,
    verifiedPurchases:verified.filter(row=>row.kind==="purchase").length,
    verifiedRenewals:verified.filter(row=>row.kind==="renew").length,
    verifiedPurchaseCoins,verifiedRenewalCoins,
    refundReview:evidence.filter(row=>
      row.code==="requires_refund_review").length,
    hasMore,nextCursor,
    paginationBlocked:hasMore&&nextCursor===null,
    // Never silently promote bounded, receipt-driven evidence into a
    // financial aggregate, even when this query returns fewer than 10.
    partialEvidenceOnly:true,financialReportComplete:false,
    netRevenueCertified:false,refundSettlementCertified:false,
    evidence,
  };
}

// Same verified Owner/recent-session/target gate as the existing receipt
// report; the source engine deliberately has no independent authorization.
export async function loadStoreFinancialSourcePageForOwner(
  db,token,rawTargetId,rawSource,rawCursor=null){
  await authorizedStorePurchaseActor(db,token,{ownerOnly:true});
  if(!["operations","ledger","audit"].includes(rawSource))
    throw Error("invalid_store_financial_source");
  const {targetUid,searchedId}=await resolveStoreAdminTarget(db,rawTargetId);
  return {
    searchedId,targetUid,
    ...await reviewStoreFinancialSourcePage(db,{
      buyerUid:targetUid,source:rawSource,cursor:rawCursor,
    }),
  };
}

// One-account, index-only COUNT parity among the four receipt/operation/
// debit/audit sources. This is NOT individual proof or a revenue report.
// Reuse the exact same Owner + recent-login + target gate as financial pages.
export async function loadStoreFinancialCoverageForOwner(
  db,token,rawTargetId){
  await authorizedStorePurchaseActor(db,token,{ownerOnly:true});
  const {targetUid,searchedId}=await resolveStoreAdminTarget(db,rawTargetId);
  const coverage=await db.readStoreFinancialCoverageCounts(targetUid);
  return {searchedId,targetUid,...coverage};
}

// All-buyer financial evidence is a strictly read-only, one-UTC-day
// Owner report. Never substitute for all-time gross/net revenue or settlement.
export async function loadStoreGlobalDailyPageForOwner(
  db,token,day,source,cursor=null){
  await authorizedStorePurchaseActor(db,token,{ownerOnly:true});
  return reviewStoreGlobalDailyPage(db,{day,source,cursor});
}

// Owner-only bounded index cardinality comparison for ONE completed UTC day.
// Equal counts do not certify amounts, operation IDs, or legacy coverage.
export async function loadStoreGlobalDailyCoverageForOwner(db,token,day){
  await authorizedStorePurchaseActor(db,token,{ownerOnly:true});
  return db.readStoreGlobalDailyCoverageCounts(day);
}

export async function manageStorePurchases(request,env) {
  if(request.method!=="POST") {
    return json(request,env,{ok:false,code:"method_not_allowed"},405);
  }
  try {
    const token=await verifyFirebaseIdToken(request,env,{checkUserState:false});
    const body=await readJson(request);
    if(body?.action!=="history"&&body?.action!=="verify_operation"&&
        body?.action!=="review_selected"&&
        body?.action!=="financial_page"&&
        body?.action!=="financial_source_page"&&
        body?.action!=="financial_coverage"&&
        body?.action!=="global_financial_day_page"&&
        body?.action!=="global_financial_day_coverage") {
      return json(request,env,{ok:false,code:"invalid_action"},400);
    }
    const db=firestoreClient(env);
    const targetId=body?.targetId ?? body?.targetUid;
    const result=body.action==="verify_operation"
      ?await verifyStorePurchaseEvidenceForOwner(
        db,token,targetId,body?.operationId,body?.productId)
      :body.action==="review_selected"
        ?await reviewStorePurchaseEvidenceBatchForOwner(
          db,token,targetId,body?.operations)
        :body.action==="financial_page"
          ?await loadStoreUserFinancialEvidencePage(
            db,token,targetId,body?.cursor)
          :body.action==="financial_source_page"
            ?await loadStoreFinancialSourcePageForOwner(
              db,token,targetId,body?.source,body?.cursor)
            :body.action==="financial_coverage"
              ?await loadStoreFinancialCoverageForOwner(db,token,targetId)
              :body.action==="global_financial_day_page"
                ?await loadStoreGlobalDailyPageForOwner(
                  db,token,body?.day,body?.source,body?.cursor)
                :body.action==="global_financial_day_coverage"
                  ?await loadStoreGlobalDailyCoverageForOwner(
                    db,token,body?.day)
                  :await loadStoreUserPurchases(db,token,targetId,body?.cursor);
    return json(request,env,result,200,{"Cache-Control":"no-store"});
  } catch(error) {
    const quota=firestoreQuotaResponse(request,env,error);
    if(quota) return quota;
    const code=cleanStoreId(error?.message);
    if(["unauthorized","forbidden","recent_auth_required",
        "invalid_target_id","invalid_store_product_id",
        "invalid_store_purchase_operation_id",
        "invalid_store_receipt_cursor","invalid_store_review_selection",
        "invalid_store_financial_source","invalid_store_financial_source_cursor",
        "invalid_store_global_day","invalid_store_global_source",
        "invalid_store_global_cursor",
        "not_found"].includes(code)) {
      return json(request,env,{ok:false,code},
        code==="forbidden"?403:
        (code==="invalid_target_id"||code==="invalid_store_product_id"||
          code==="invalid_store_purchase_operation_id"||
          code==="invalid_store_receipt_cursor"||
          code==="invalid_store_review_selection"||
          code==="invalid_store_financial_source"||
          code==="invalid_store_financial_source_cursor"||
          code==="invalid_store_global_day"||
          code==="invalid_store_global_source"||
          code==="invalid_store_global_cursor")?400:
        code==="not_found"?404:401);
    }
    return json(request,env,{ok:false,code:"store_purchases_unavailable"},503);
  }
}
