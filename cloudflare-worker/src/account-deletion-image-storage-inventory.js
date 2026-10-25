// INTERNAL, READ-ONLY deletion inventory for image storage metadata.
// Firestore-only. No R2 list, get, head or delete, no route, no scheduler,
// no Auth change, no owner transfer and no erasure completion certificate.
const clean=v=>String(v??"").trim();
const uidOk=v=>/^[A-Za-z0-9_-]{3,128}$/.test(clean(v));
const requestOk=v=>/^[A-Za-z0-9_-]{12,180}$/.test(clean(v));
const targetOk=v=>/^[A-Za-z0-9_-]{1,180}$/.test(clean(v));
const objectOk=v=>/^[a-f0-9]{32}$/.test(clean(v));
const hasHold=d=>[
  d?.legalHold,d?.retentionHold,d?.deletionHold,d?.reviewHold,
  d?.evidenceHold,d?.investigationHold,d?.reported,d?.appealPending,
].some(x=>x===true) ||
 ["pending","open","under_review"].includes(clean(d?.appealStatus).toLowerCase());
const extByMime=Object.freeze({
  "image/jpeg":"jpg","image/png":"png",
  "image/webp":"webp","image/gif":"gif",
});
const subdir=Object.freeze({
  profile_image:"profile",
  profile_avatar_animation:"profile-animation",
  profile_cover:"covers",
  diary_image:"diaries",
  room_cover:"covers",
  agency_logo:"logo",
  agency_background:"background",
  agency_room_image:"room-image",
  chat_image:"",
});
export const MAX_IMAGE_STORAGE_INVENTORY_PAGE=5;
export class AccountImageStorageInventoryError extends Error{
  constructor(code,status=409){super(code);this.code=code;this.status=status;}
}
const reject=(code,status)=>{
  throw new AccountImageStorageInventoryError(code,status);
};
const resourceType=scope=>scope==="room_cover"?"room":
  scope.startsWith("agency_")?"agency":
  scope==="chat_image"?"conversation":
  scope==="diary_image"?"diary":"profile";
function canonicalKey(scope,uid,targetId,id,extension){
  const filename=id+"."+extension;
  switch(resourceType(scope)){
    case "profile":
    case "diary":
      return "users/"+uid+"/"+subdir[scope]+"/"+filename;
    case "room":
      return "rooms/"+targetId+"/covers/"+filename;
    case "agency":
      return "agencies/"+targetId+"/"+subdir[scope]+"/"+filename;
    case "conversation":
      return "chat/"+targetId+"/"+uid+"/"+filename;
    default:return "";
  }
}
/**
 * One ownerUid-indexed query at a time (max five docs + one lookahead);
 * only exact child documents are fetched for resource consistency.
 * A separate caller must authenticate Owner and authorize target access.
 */
export async function inspectAccountImageStoragePage(db,{
  uid,requestId,actor,cursor=null,limit=MAX_IMAGE_STORAGE_INVENTORY_PAGE,
}={}){
  uid=clean(uid);requestId=clean(requestId);
  if(!actor?.owner||!uidOk(actor.uid))reject("owner_required",403);
  if(!uidOk(uid)||!requestOk(requestId)||
     !Number.isSafeInteger(limit)||limit<1||
     limit>MAX_IMAGE_STORAGE_INVENTORY_PAGE||
     (cursor!==null&&(typeof cursor!=="string"||!objectOk(cursor)))){
    reject("invalid_image_inventory_target",400);
  }
  const [request,checkpoint,user]=await Promise.all([
    db.get("account_deletion_requests/"+uid),
    db.get("account_deletion_erasure_checkpoints/"+uid),
    db.get("users/"+uid),
  ]);
  if(!request.exists||!checkpoint.exists||!user.exists||
     clean(request.data?.uid)!==uid||
     clean(request.data?.requestId)!==requestId||
     clean(checkpoint.data?.uid)!==uid||
     clean(checkpoint.data?.requestId)!==requestId||
     !["review_ready","processing"].includes(clean(request.data?.status))||
     clean(user.data?.role)==="owner"||user.data?.authDeleted===true||
     hasHold(request.data)||hasHold(checkpoint.data)||hasHold(user.data)){
    reject("image_inventory_review_blocked");
  }
  const rows=await db.runQuery("storage_objects",{
    filters:[{field:"ownerUid",op:"==",value:uid}],
    orderBy:[{field:"__name__",direction:"asc"}],
    startAfter:cursor?[{referencePath:"storage_objects/"+cursor}]:[],
    limit:limit+1,
  });
  if(!Array.isArray(rows)||rows.length>limit+1||
     rows.some(row=>!objectOk(row?.id)||!row?.data)||
     new Set(rows.map(row=>row.id)).size!==rows.length){
    reject("image_inventory_invalid_page",503);
  }
  const page=rows.slice(0,limit);
  const items=await Promise.all(page.map(async row=>{
    const d=row.data||{};
    if(clean(d.ownerUid)!==uid||clean(d.objectId)!==row.id){
      reject("image_inventory_owner_conflict");
    }
    const scope=clean(d.scope);
    const targetId=clean(d.targetId);
    const type=resourceType(scope);
    const ext=extByMime[clean(d.mimeType).toLowerCase()];
    const recognized=Object.hasOwn(subdir,scope)&&targetOk(targetId)&&
      Boolean(ext)&&(scope==="profile_avatar_animation" ?
        ext==="gif":ext!=="gif")&&
      Number.isSafeInteger(d.sizeBytes)&&d.sizeBytes>0&&
      d.sizeBytes<=(
        scope==="profile_image"||scope==="profile_avatar_animation"||
        scope==="agency_logo" ? 2*1024*1024 : 3*1024*1024
      );
    if(!recognized){
      return {id:row.id,scope:"unknown_or_invalid",
        schemaConsistent:false,linkedReferencePresent:false,
        linkedOwnershipConsistent:false,moderationOrLegalHold:true,
        sharedAssetReview:true,needsReview:true};
    }
    const canonical=canonicalKey(scope,uid,targetId,row.id,ext);
    const publicKey=clean(d.publicStorageKey);
    const observedKey=clean(d.storageKey);
    const stagingKey="moderation-staging/"+canonical;
    const storagePathValid=(observedKey===canonical||observedKey===stagingKey)&&
      (!publicKey||publicKey===canonical);
    const personal=type==="profile"||type==="diary";
    const targetValid=!personal||targetId===uid;
    let linkedReferencePresent=false;
    let linkedOwnershipConsistent=false;
    let linkedHold=false;
    if(type==="diary"){
      const link=await db.get("diary_image_links/"+row.id);
      linkedReferencePresent=link.exists;
      linkedOwnershipConsistent=link.exists &&
        clean(link.data?.ownerUid)===uid &&
        clean(link.data?.state)==="linked" &&
        Boolean(clean(link.data?.diaryId));
      linkedHold=link.exists&&hasHold(link.data);
    }else if(type==="room"||type==="agency"||type==="conversation"){
      const collection=type==="room"?"rooms":
        type==="agency"?"agencies":"conversations";
      const source=await db.get(collection+"/"+targetId);
      linkedReferencePresent=source.exists;
      const data=source.data||{};
      linkedOwnershipConsistent=source.exists&&(
        type==="conversation"
          ? Array.isArray(data.participants)&&
            data.participants.length===2&&
            new Set(data.participants).size===2&&
            data.participants.includes(uid)&&
            data.participants.every(uidOk)
          : clean(data.ownerUid)===uid);
      linkedHold=source.exists&&hasHold(data);
    }else{
      // A profile can have a replaced active pointer, so never infer
      // that this image is the sole live asset merely from user existence.
      linkedReferencePresent=user.exists;
      linkedOwnershipConsistent=targetId===uid;
    }
    const legalOrModeration=hasHold(d)||linkedHold||
      ["blocked","needs_review","appeal_pending","rejected",
        "evidence_purging"].includes(clean(d.state))||
      ["blocked","needs_review","rejected","appeal_pending"].includes(
        clean(d.moderation?.status));
    const shared=type==="room"||type==="agency"||type==="conversation";
    const consistent=storagePathValid&&targetValid&&linkedOwnershipConsistent;
    return {
      id:row.id,scope,
      schemaConsistent:consistent,
      linkedReferencePresent,
      linkedOwnershipConsistent,
      moderationOrLegalHold:Boolean(legalOrModeration),
      sharedAssetReview:shared,
      // Even valid personal photos may have pending appeals, original
      // R2 uploads, historic references or retained evidence elsewhere.
      needsReview:true,
    };
  }));
  return {
    ok:true,checked:items.length,items,hasMore:rows.length>limit,
    nextCursor:rows.length>limit&&page.length?page[page.length-1].id:null,
    exhaustive:false,sharedOwnershipCleared:false,
    mediaRetentionCertified:false,erasureAllowed:false,
    completionVerified:false,
  };
}
