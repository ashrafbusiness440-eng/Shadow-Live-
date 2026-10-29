// Read-only verified Store cosmetics presentation. Never render the catalog
// thumbnail (.icon) as a frame or entrance; Studio must publish a real .visual.
// One owner-scoped equipment document + bounded direct reads; no collection scan.
import {json,firestoreQuotaResponse} from "./http.js";
import {verifyFirebaseIdToken,assertUserDocumentSessionState}
  from "./firebase-auth.js";
import {firestoreClient} from "./firestore.js";
import {readStoreEquipSlots} from "./store-equip.js";
import {validStoreEntitlementDocument}
  from "./store-purchase-policy.js";

const clean=v=>String(v??"").trim();
const validUid=v=>/^[A-Za-z0-9_-]{1,128}$/.test(v);
const VISUAL_CATEGORIES=Object.freeze(["frames","entranceEffects"]);

function isActiveUser(data={}){
  return clean(data.accountStatus||"active")==="active" &&
    !data.deletionRequestedAt && !data.deletedAt &&
    data.deletionProcessing!==true && data.authDeleted!==true;
}

// The same resolver serves Worker REST and the existing Admin-style legacy
// room entrance path. Neither adapter permits arbitrary collection listing.
async function readStoreDocument(db,path){
  if(typeof db?.get==="function")return db.get(path);
  if(typeof db?.doc==="function"){
    const snap=await db.doc(path).get();
    return {exists:snap.exists,data:snap.exists?(snap.data()||{}):null};
  }
  // The deployed legacy Firestore shim provides collection().doc(),
  // not the root db.doc() convenience method of Firebase Admin.
  if(typeof db?.collection==="function"){
    const parts=path.split("/");
    if((parts.length!==2&&parts.length!==4)||
        parts.some(part=>!/^[A-Za-z0-9_.-]+$/.test(part)))
      throw Error("store_visual_reader_unavailable");
    let ref=db.collection(parts[0]).doc(parts[1]);
    for(let index=2;index<parts.length;index+=2)
      ref=ref.collection(parts[index]).doc(parts[index+1]);
    const snap=await ref.get();
    return {exists:snap.exists,data:snap.exists?(snap.data()||{}):null};
  }
  throw Error("store_visual_reader_unavailable");
}

// Null means the slot/entitlement/asset is absent, invalid or expired.
// The positive result is safe to show other users. No private purchase/grant
// markers, actor identity, ledger, user document or raw equipment slots leak.
export async function resolveStoreVisuals(db,uid,nowMs=Date.now()){
  if(!validUid(uid)||!Number.isSafeInteger(nowMs)||nowMs<0)return {};
  const selection=await readStoreDocument(db,"user_store_equipped/"+uid);
  if(!selection.exists)return {};
  let slots;
  try{slots=readStoreEquipSlots(selection,uid);}
  catch(_){return {};}
  const entries=VISUAL_CATEGORIES.filter(category=>slots[category]);
  if(!entries.length)return {};
  const resolved=await Promise.all(entries.map(async category=>{
    const id=slots[category];
    const entitlement=await readStoreDocument(db,
      "user_store_entitlements/"+uid+"/items/"+id);
    if(!entitlement.exists)return null;
    const item=validStoreEntitlementDocument(
      entitlement.data,uid,nowMs);
    if(!item||!item.active||item.category!==category ||
        entitlement.data?.equipped!==true)return null;
    // Product identity and category are server-owned. The published visual
    // is independent of the thumbnail used in Store catalogue listings.
    const visualKey="store.item."+id+".visual";
    const visual=await readStoreDocument(db,"app_asset_registry/"+visualKey);
    const rawUrl=clean(visual.data?.rawUrl);
    if(!visual.exists||visual.data?.published!==true||
        !/^https:\/\//.test(rawUrl))return null;
    return [category,{
      assetKey:visualKey,
      imageUrl:rawUrl,
      expiresAtMs:item.expiresAtMs,
      productId:id,
    }];
  }));
  return Object.fromEntries(resolved.filter(Boolean));
}

export async function storePresentation(request,env){
  if(request.method!=="GET")
    return json(request,env,{ok:false,code:"method_not_allowed"},405);
  try{
    const token=await verifyFirebaseIdToken(request,env,
      {checkUserState:false});
    const viewerUid=clean(token?.sub);
    const requested=clean(new URL(request.url).searchParams.get("uid"));
    const uid=requested||viewerUid;
    if(!validUid(uid)||!validUid(viewerUid))
      return json(request,env,{ok:false,code:"invalid_user_id"},400);
    const db=firestoreClient(env);
    const viewer=await db.get("users/"+viewerUid);
    if(!viewer.exists)
      return json(request,env,{ok:false,code:"unauthorized"},401);
    assertUserDocumentSessionState(token,viewer.data||{});
    if(!isActiveUser(viewer.data))
      return json(request,env,{ok:false,code:"forbidden"},403);
    if(uid!==viewerUid){
      const subject=await db.get("users/"+uid);
      if(!subject.exists||!isActiveUser(subject.data)){
        return json(request,env,{ok:true,visuals:{}},200,
          {"Cache-Control":"private, no-store"});
      }
    }
    const visuals=await resolveStoreVisuals(db,uid);
    return json(request,env,{ok:true,visuals},200,
      {"Cache-Control":"private, no-store"});
  }catch(error){
    const quota=firestoreQuotaResponse(request,env,error);
    if(quota)return quota;
    if(clean(error?.message)==="unauthorized")
      return json(request,env,{ok:false,code:"unauthorized"},401);
    return json(request,env,
      {ok:false,code:"store_visuals_unavailable"},503);
  }
}
