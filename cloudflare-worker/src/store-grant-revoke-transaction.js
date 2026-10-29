// Offline-certified Store administrative grant revocation. No currency
// writes, new grant issuance or product purchase. The route is independently
// release-gated and OFF by default.
import {assertUserDocumentSessionState} from "./firebase-auth.js";
import {hasRecentStoreAdminLogin,validStoreUid}
  from "./store-admin-target.js";
import {readStoreEquipSlots} from "./store-equip.js";
import {STORE_CATEGORIES} from "./store-catalog-policy.js";
import {isTransientFirestoreError,firestoreErrorRetryDelayMs}
  from "./firestore.js";

const clean=value=>String(value??"").trim();
const MAX_ATTEMPTS=3;
const validProduct=id=>/^[1-9][0-9]{5,8}$/.test(id);
const validOperation=id=>/^[A-Za-z0-9_-]{12,100}$/.test(id);
const own=(obj,key)=>Object.prototype.hasOwnProperty.call(obj,key);

export class StoreGrantRevokeError extends Error {
  constructor(code){super(code);this.code=code;}
}
const fail=code=>{throw new StoreGrantRevokeError(code);};

export async function commitStoreGrantRevokeOffline(
  db,ownerToken,body,nowMs=Date.now()){
  const actorUid=clean(ownerToken?.sub);
  const targetUid=clean(body?.targetUid);
  const productId=clean(body?.productId);
  const operationId=clean(body?.operationId);
  const reason=clean(body?.reason);
  if(!validStoreUid(actorUid))fail("unauthorized");
  if(!validStoreUid(targetUid))fail("invalid_target_id");
  if(!validProduct(productId))fail("invalid_store_product_id");
  if(!validOperation(operationId))fail("invalid_revocation_operation_id");
  if(reason.length<5||reason.length>200)fail("invalid_revocation_reason");
  if(!Number.isSafeInteger(nowMs)||nowMs<0)fail("invalid_revocation_time");
  const actorPath="users/"+actorUid;
  const targetPath="users/"+targetUid;
  const entitlementPath=
    `user_store_entitlements/${targetUid}/items/${productId}`;
  const selectionPath="user_store_equipped/"+targetUid;
  const operationPath=
    `store_grant_revocation_operations/${actorUid}__${operationId}`;
  for(let attempt=0;attempt<MAX_ATTEMPTS;attempt++){
    let tx=null;
    try{
      tx=await db.beginTransaction();
      const [actor,operation]=await Promise.all([
        db.get(actorPath,tx),db.get(operationPath,tx),
      ]);
      if(!actor.exists||actor.data?.role!=="owner")fail("forbidden");
      assertUserDocumentSessionState(ownerToken,actor.data||{});
      if(!hasRecentStoreAdminLogin(ownerToken,nowMs))
        fail("recent_auth_required");
      // Idempotency is checked before reading the entitlement. A lost
      // acknowledgment of a committed revocation must never run it again.
      if(operation.exists){
        const op=operation.data||{};
        if(op.actorUid!==actorUid||op.targetUid!==targetUid||
            op.productId!==productId||op.reason!==reason||
            op.status!=="completed"||!op.result)
          fail("revocation_operation_id_conflict");
        await db.rollback(tx);tx=null;
        return {ok:true,duplicate:true,...op.result};
      }
      const [target,entitlement,selection]=await Promise.all([
        db.get(targetPath,tx),
        db.get(entitlementPath,tx),
        db.get(selectionPath,tx),
      ]);
      if(!target.exists)fail("target_not_found");
      if(!entitlement.exists)fail("store_entitlement_not_found");
      const existing=entitlement.data||{};
      if(existing.ownerUid!==targetUid||existing.productId!==productId||
          existing.source!=="admin_grant"||existing.status!=="active"||
          !own(STORE_CATEGORIES,clean(existing.category))||
          existing.assetKey!==`store.item.${productId}.icon`||
          existing.equipped!==true&&existing.equipped!==false)
        fail("store_entitlement_not_revocable");
      const slots=readStoreEquipSlots(selection,targetUid);
      const category=existing.category;
      const actuallySelected=slots[category]===productId;
      if(actuallySelected!==existing.equipped)
        fail("store_equipment_conflict");
      const newSlots={...slots};
      if(actuallySelected)delete newSlots[category];
      const timestamp=new Date(nowMs);
      const result={
        targetUid,productId,category,operationId,
        revoked:true,wasEquipped:actuallySelected,
      };
      const writes=[
        db.writeUpdate(entitlementPath,{
          status:"revoked",equipped:false,
          revokedAtMs:nowMs,updatedAt:timestamp,
        },["status","equipped","revokedAtMs","updatedAt"]),
      ];
      if(actuallySelected)writes.push(db.writeUpdate(selectionPath,{
        ownerUid:targetUid,slots:newSlots,updatedAt:timestamp,
      },["ownerUid","slots","updatedAt"]));
      writes.push(
        db.writeCreate(operationPath,{
          actorUid,targetUid,productId,reason,status:"completed",
          result,createdAt:timestamp,
        }),
        db.writeCreate(
          `admin_audit_logs/store_grant_revoke_${actorUid}__${operationId}`,
          {
            actorUid,targetType:"store_entitlement",
            targetId:entitlementPath,action:"revokeStoreGrant",
            operationId,reason,createdAt:timestamp,
          },
        ),
      );
      await db.commit(tx,writes);tx=null;
      return {ok:true,...result};
    }catch(error){
      if(tx)await db.rollback(tx).catch(()=>{});
      if(error instanceof StoreGrantRevokeError)throw error;
      if(attempt<MAX_ATTEMPTS-1&&isTransientFirestoreError(error)){
        await new Promise(resolve=>setTimeout(resolve,
          firestoreErrorRetryDelayMs(attempt)));
        continue;
      }
      throw error;
    }
  }
  fail("store_grant_revocation_unavailable");
}
