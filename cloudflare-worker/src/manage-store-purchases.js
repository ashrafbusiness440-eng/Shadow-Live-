// Read-only Store purchase receipt inspector. Never creates receipts or charges Coins.
import {json,readJson,firestoreQuotaResponse} from "./http.js";
import {verifyFirebaseIdToken,assertUserDocumentSessionState} from "./firebase-auth.js";
import {firestoreClient} from "./firestore.js";
import {STORE_CATEGORIES} from "./store-catalog-policy.js";
import {validateStorePurchaseOperationId}
  from "./store-purchase-policy.js";
import {certifyStorePurchaseEvidenceOffline}
  from "./store-purchase-reconciliation-offline.js";
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

export async function manageStorePurchases(request,env) {
  if(request.method!=="POST") {
    return json(request,env,{ok:false,code:"method_not_allowed"},405);
  }
  try {
    const token=await verifyFirebaseIdToken(request,env,{checkUserState:false});
    const body=await readJson(request);
    if(body?.action!=="history"&&body?.action!=="verify_operation") {
      return json(request,env,{ok:false,code:"invalid_action"},400);
    }
    const db=firestoreClient(env);
    const targetId=body?.targetId ?? body?.targetUid;
    const result=body.action==="verify_operation"
      ?await verifyStorePurchaseEvidenceForOwner(
        db,token,targetId,body?.operationId,body?.productId)
      :await loadStoreUserPurchases(db,token,targetId,body?.cursor);
    return json(request,env,result,200,{"Cache-Control":"no-store"});
  } catch(error) {
    const quota=firestoreQuotaResponse(request,env,error);
    if(quota) return quota;
    const code=cleanStoreId(error?.message);
    if(["unauthorized","forbidden","recent_auth_required",
        "invalid_target_id","invalid_store_product_id",
        "invalid_store_purchase_operation_id",
        "invalid_store_receipt_cursor","not_found"].includes(code)) {
      return json(request,env,{ok:false,code},
        code==="forbidden"?403:
        (code==="invalid_target_id"||code==="invalid_store_product_id"||
          code==="invalid_store_purchase_operation_id"||
          code==="invalid_store_receipt_cursor")?400:
        code==="not_found"?404:401);
    }
    return json(request,env,{ok:false,code:"store_purchases_unavailable"},503);
  }
}
