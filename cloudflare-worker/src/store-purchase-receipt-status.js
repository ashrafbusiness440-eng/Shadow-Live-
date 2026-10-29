// A read-only, buyer-scoped recovery path for an unknown checkout result.
// The endpoint is available even while purchasing is disabled; it never
// initiates a charge, delivers a product, or reads another user's records.
import {json,readJson,firestoreQuotaResponse} from "./http.js";
import {verifyFirebaseIdToken,assertUserDocumentSessionState}
  from "./firebase-auth.js";
import {firestoreClient} from "./firestore.js";
import {validateStorePurchaseOperationId}
  from "./store-purchase-policy.js";

const clean=v=>String(v??"").trim();
const validUid=v=>/^[A-Za-z0-9_-]{1,128}$/.test(v);
const validProduct=v=>/^[1-9][0-9]{5,8}$/.test(v);
class PurchaseReceiptLookupError extends Error{
  constructor(code,status){super(code);this.code=code;this.status=status;}
}
const fail=(code,status)=>{throw new PurchaseReceiptLookupError(code,status);};

export async function lookupOwnStorePurchaseReceipt(db,token,body){
  const uid=clean(token?.sub);
  if(!validUid(uid))fail("unauthorized",401);
  const productId=clean(body?.productId);
  if(!validProduct(productId))fail("invalid_store_product_id",400);
  let operationId;
  try {operationId=validateStorePurchaseOperationId(body?.operationId);}
  catch(_){fail("invalid_store_purchase_operation_id",400);}
  // Scope is always derived from verified Firebase token, not a request UID.
  const user=await db.get("users/"+uid);
  if(!user.exists)fail("unauthorized",401);
  assertUserDocumentSessionState(token,user.data||{});
  if(user.data?.authDeleted===true||user.data?.deletedAt||
      user.data?.deletionRequestedAt||user.data?.deletionProcessing===true)
    fail("store_buyer_not_eligible",403);
  const key=uid+"__"+operationId;
  const [operation,receipt]=await Promise.all([
    db.get("store_purchase_operations/"+key),
    db.get("store_purchase_receipts/"+key),
  ]);
  if(!operation.exists && !receipt.exists)
    return {ok:true,found:false};
  if(!operation.exists||!receipt.exists)
    fail("store_purchase_receipt_inconsistent",409);
  const op=operation.data||{};
  const r=receipt.data||{};
  if(op.buyerUid!==uid||r.buyerUid!==uid||
      op.productId!==productId||r.productId!==productId||
      r.operationId!==operationId)
    fail("store_purchase_receipt_mismatch",409);
  const result=op.result||{};
  if(op.status!=="completed"||result.operationId!==operationId||
      result.productId!==productId||result.deliveryStatus!=="delivered"||
      r.deliveryStatus!=="delivered"||
      !Number.isSafeInteger(result.priceCoins)||result.priceCoins<=0||
      !Number.isSafeInteger(result.durationDays)||result.durationDays<0||
      !Number.isSafeInteger(result.acquiredAtMs)||result.acquiredAtMs<0||
      (result.expiresAtMs!==null&&
        (!Number.isSafeInteger(result.expiresAtMs)||
          result.expiresAtMs<result.acquiredAtMs))||
      r.priceCoins!==result.priceCoins||
      r.durationDays!==result.durationDays||
      r.acquiredAtMs!==result.acquiredAtMs||
      r.expiresAtMs!==result.expiresAtMs)
    fail("store_purchase_receipt_inconsistent",409);
  // Explicit allowlist: no balance, financial ledger, UID, admin audit,
  // or personal information is returned to the app.
  return {
    ok:true,found:true,
    operationId,productId,
    priceCoins:result.priceCoins,durationDays:result.durationDays,
    acquiredAtMs:result.acquiredAtMs,expiresAtMs:result.expiresAtMs,
    deliveryStatus:"delivered",duplicate:true,
  };
}

export async function storePurchaseReceiptStatus(request,env){
  if(request.method!=="POST")
    return json(request,env,{ok:false,code:"method_not_allowed"},405);
  try{
    const token=await verifyFirebaseIdToken(request,env,
      {checkUserState:false});
    const body=await readJson(request);
    if(body?.action!=="status")
      return json(request,env,{ok:false,code:"invalid_action"},400);
    const result=await lookupOwnStorePurchaseReceipt(
      firestoreClient(env),token,body);
    return json(request,env,result,200,{"Cache-Control":"no-store"});
  }catch(error){
    const quota=firestoreQuotaResponse(request,env,error);
    if(quota)return quota;
    if(error instanceof PurchaseReceiptLookupError)
      return json(request,env,{ok:false,code:error.code},error.status);
    if(clean(error?.message)==="unauthorized")
      return json(request,env,{ok:false,code:"unauthorized"},401);
    return json(request,env,
      {ok:false,code:"store_purchase_receipt_unavailable"},503);
  }
}
