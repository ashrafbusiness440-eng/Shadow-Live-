// Store equipment authority. This endpoint cannot mint items or move Coins.
// The single owner-scoped slot document is the source of truth; renderers must
// validate current entitlement and expiry before displaying any equipped asset.
import {json,readJson,firestoreQuotaResponse} from "./http.js";
import {verifyFirebaseIdToken,assertUserDocumentSessionState}
  from "./firebase-auth.js";
import {firestoreClient,isTransientFirestoreError,firestoreErrorRetryDelayMs}
  from "./firestore.js";
import {STORE_CATEGORIES} from "./store-catalog-policy.js";
import {validStoreEntitlementDocument} from "./store-purchase-policy.js";

const clean=value=>String(value??"").trim();
const validUid=value=>/^[A-Za-z0-9_-]{1,128}$/.test(value);
const validProduct=value=>/^[1-9][0-9]{5,8}$/.test(value);
const validCategory=value=>Object.prototype.hasOwnProperty.call(
  STORE_CATEGORIES,value);
const MAX_ATTEMPTS=3;

export class StoreEquipError extends Error{
  constructor(code){super(code);this.code=code;}
}
const fail=code=>{throw new StoreEquipError(code);};

// Fail closed on malformed persisted slot data instead of treating it as
// a user's legitimate equipment, even if a client forges a category.
export function readStoreEquipSlots(doc,uid){
  if(!doc?.exists)return {};
  const data=doc.data||{};
  if(data.ownerUid!==uid||!data.slots||
      typeof data.slots!=="object"||Array.isArray(data.slots))
    fail("store_equipment_invalid");
  const slots={};
  for(const [category,productId] of Object.entries(data.slots)){
    if(!validCategory(category)||!validProduct(productId))
      fail("store_equipment_invalid");
    slots[category]=productId;
  }
  return slots;
}

export function storeEntitlementEquipped(item,slots){
  return item?.active===true &&
    validCategory(item.category) &&
    slots?.[item.category]===item.productId;
}

export async function commitStoreEquip(db,token,body,nowMs=Date.now()){
  const uid=clean(token?.sub);
  if(!validUid(uid))fail("unauthorized");
  const action=body?.action;
  if(action!=="equip"&&action!=="unequip")fail("invalid_store_equip_action");
  const productId=clean(body?.productId);
  const category=clean(body?.category);
  if(action==="equip"&&!validProduct(productId))
    fail("invalid_store_product_id");
  if(action==="unequip"&&!validCategory(category))
    fail("invalid_store_category");
  if(!Number.isSafeInteger(nowMs)||nowMs<0)fail("invalid_store_equip_time");
  const selectionPath="user_store_equipped/"+uid;
  for(let attempt=0;attempt<MAX_ATTEMPTS;attempt++){
    let tx=null;
    try{
      tx=await db.beginTransaction();
      const [user,selection]=await Promise.all([
        db.get("users/"+uid,tx),db.get(selectionPath,tx),
      ]);
      if(!user.exists)fail("unauthorized");
      assertUserDocumentSessionState(token,user.data||{});
      const account=user.data||{};
      if(clean(account.accountStatus||"active")!=="active" ||
          account.deletionRequestedAt||account.deletedAt||
          account.deletionProcessing===true||account.authDeleted===true)
        fail("store_equipment_account_inactive");
      const slots=readStoreEquipSlots(selection,uid);
      let targetCategory=category;
      let target=null;
      if(action==="equip"){
        const snapshot=await db.get(
          "user_store_entitlements/"+uid+"/items/"+productId,tx);
        const item=validStoreEntitlementDocument(
          snapshot.data,uid,nowMs);
        if(!snapshot.exists||!item||item.lifecycleState!=="active"||
            !validCategory(item.category))
          fail("store_entitlement_not_usable");
        targetCategory=item.category;
        target={path:"user_store_entitlements/"+uid+"/items/"+productId};
        const asset=await db.get("app_asset_registry/"+item.assetKey,tx);
        if(!asset.exists||asset.data?.published!==true||
            typeof asset.data?.rawUrl!=="string"||
            !/^https:\/\//.test(asset.data.rawUrl.trim()))
          fail("store_asset_not_published");
      }
      const priorId=slots[targetCategory]||null;
      const nextId=action==="equip"?productId:null;
      if(priorId===nextId){
        await db.rollback(tx);tx=null;
        return {ok:true,changed:false,category:targetCategory,
          productId:nextId};
      }
      let prior=null;
      if(priorId){
        const path="user_store_entitlements/"+uid+"/items/"+priorId;
        const doc=await db.get(path,tx);
        if(doc.exists){
          if(doc.data?.ownerUid!==uid||doc.data?.productId!==priorId)
            fail("store_equipment_invalid");
          prior={path};
        }
      }
      const nextSlots={...slots};
      if(nextId)nextSlots[targetCategory]=nextId;
      else delete nextSlots[targetCategory];
      const time=new Date(nowMs);
      const writes=[
        selection.exists
          ?db.writeUpdate(selectionPath,{
            ownerUid:uid,slots:nextSlots,updatedAt:time,
          },["ownerUid","slots","updatedAt"])
          :db.writeCreate(selectionPath,{
            ownerUid:uid,slots:nextSlots,updatedAt:time,
          }),
      ];
      if(prior)writes.push(db.writeUpdate(prior.path,{
        equipped:false,updatedAt:time,
      },["equipped","updatedAt"]));
      if(target)writes.push(db.writeUpdate(target.path,{
        equipped:true,updatedAt:time,
      },["equipped","updatedAt"]));
      await db.commit(tx,writes);tx=null;
      return {ok:true,changed:true,category:targetCategory,
        productId:nextId};
    }catch(error){
      if(tx)await db.rollback(tx).catch(()=>{});
      if(error instanceof StoreEquipError)throw error;
      if(attempt<MAX_ATTEMPTS-1&&isTransientFirestoreError(error)){
        await new Promise(resolve=>setTimeout(resolve,
          firestoreErrorRetryDelayMs(attempt)));
        continue;
      }
      throw error;
    }
  }
  fail("store_equipment_unavailable");
}

export async function storeEquip(request,env){
  if(request.method!=="POST")
    return json(request,env,{ok:false,code:"method_not_allowed"},405);
  try{
    const token=await verifyFirebaseIdToken(request,env,{
      checkUserState:false,
    });
    const body=await readJson(request);
    const result=await commitStoreEquip(firestoreClient(env),token,body);
    return json(request,env,result,200,{"Cache-Control":"no-store"});
  }catch(error){
    const quota=firestoreQuotaResponse(request,env,error);
    if(quota)return quota;
    const code=clean(error?.code||error?.message);
    const supported=[
      "unauthorized","invalid_store_equip_action","invalid_store_product_id",
      "invalid_store_category","invalid_store_equip_time",
      "store_equipment_account_inactive","store_equipment_invalid",
      "store_entitlement_not_usable","store_asset_not_published",
    ];
    if(supported.includes(code)){
      const status=code==="unauthorized"?401:
        code.startsWith("invalid_")?400:
        code==="store_equipment_account_inactive"?403:409;
      return json(request,env,{ok:false,code},status);
    }
    return json(request,env,
      {ok:false,code:"store_equipment_unavailable"},503);
  }
}
