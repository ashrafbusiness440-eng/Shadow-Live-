// INTERNAL ONLY: bounded Firestore upload-ticket inventory for pending images.
// No R2 access, writes, Auth removal, public route, cron or erasure sign-off.
// The authenticated Owner check belongs to the internal caller.
const clean=v=>String(v??"").trim();
const uidOk=v=>/^[A-Za-z0-9_-]{3,128}$/.test(clean(v));
const requestOk=v=>/^[A-Za-z0-9_-]{12,180}$/.test(clean(v));
const objectOk=v=>/^[a-f0-9]{32}$/.test(clean(v));
const targetOk=v=>/^[A-Za-z0-9_-]{1,180}$/.test(clean(v));
const held=d=>[
  d?.reviewHold,d?.legalHold,d?.retentionHold,d?.deletionHold,
  d?.evidenceHold,d?.investigationHold,d?.reported,d?.appealPending,
].some(x=>x===true)||
  ["pending","open","under_review"].includes(clean(d?.appealStatus).toLowerCase());
const types=Object.freeze({
  profile_image:["profile",2*1024*1024,"personal"],
  profile_avatar_animation:["profile-animation",2*1024*1024,"personal"],
  profile_cover:["covers",3*1024*1024,"personal"],
  diary_image:["diaries",3*1024*1024,"personal"],
  chat_image:["",3*1024*1024,"conversation"],
  room_cover:["covers",3*1024*1024,"room"],
  agency_logo:["logo",2*1024*1024,"agency"],
  agency_background:["background",3*1024*1024,"agency"],
  agency_room_image:["room-image",3*1024*1024,"agency"],
});
const extensions=Object.freeze({
  "image/jpeg":"jpg","image/png":"png",
  "image/webp":"webp","image/gif":"gif",
});
export const MAX_IMAGE_UPLOAD_TICKET_REVIEW_PAGE=5;
export class ImageUploadTicketReviewError extends Error {
  constructor(code,status=409){super(code);this.code=code;this.status=status;}
}
const reject=(code,status)=>{throw new ImageUploadTicketReviewError(code,status);};
function canonicalKey(uid,id,scope,target,mime){
  const config=types[scope],ext=extensions[mime];
  if(!config||!ext||!targetOk(target)||
    (scope==="profile_avatar_animation" ? ext!=="gif" : ext==="gif")) {
    return null;
  }
  const filename=id+"."+ext;
  switch(config[2]){
    case "personal": return "users/"+uid+"/"+config[0]+"/"+filename;
    case "conversation": return "chat/"+target+"/"+uid+"/"+filename;
    case "room": return "rooms/"+target+"/covers/"+filename;
    case "agency": return "agencies/"+target+"/"+config[0]+"/"+filename;
    default:return null;
  }
}
/**
 * Reads <=5 current owner's upload tickets plus one lookahead and exact
 * storage-object/shared-reference documents. Expired, staged, unmatched and
 * apparently orphaned tickets remain unresolved; NOTHING permits deletion.
 */
export async function inspectAccountImageUploadTicketPage(db,{
  uid,requestId,actor,cursor=null,
  limit=MAX_IMAGE_UPLOAD_TICKET_REVIEW_PAGE,nowMs=Date.now(),
}={}){
  uid=clean(uid);requestId=clean(requestId);
  if(!actor?.owner||!uidOk(actor.uid))reject("owner_required",403);
  if(!uidOk(uid)||!requestOk(requestId)||
    !Number.isSafeInteger(limit)||limit<1||
    limit>MAX_IMAGE_UPLOAD_TICKET_REVIEW_PAGE||
    !Number.isSafeInteger(nowMs)||nowMs<0||
    (cursor!==null&&(typeof cursor!=="string"||!objectOk(cursor)))) {
    reject("invalid_image_upload_ticket_review",400);
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
    held(request.data)||held(checkpoint.data)||held(user.data)) {
    reject("image_upload_ticket_review_blocked");
  }
  const rows=await db.runQuery("storage_upload_tickets",{
    filters:[{field:"ownerUid",op:"==",value:uid}],
    orderBy:[{field:"__name__",direction:"asc"}],
    startAfter:cursor?[{referencePath:"storage_upload_tickets/"+cursor}]:[],
    limit:limit+1,
  });
  if(!Array.isArray(rows)||rows.length>limit+1||
    rows.some(x=>!objectOk(x?.id)||!x?.data)||
    new Set(rows.map(x=>x.id)).size!==rows.length) {
    reject("image_upload_ticket_invalid_page",503);
  }
  const page=rows.slice(0,limit),items=[];
  for(const row of page){
    const t=row.data;
    if(clean(t.ownerUid)!==uid||clean(t.objectId)!==row.id)
      reject("image_upload_ticket_owner_conflict");
    const scope=clean(t.scope),target=clean(t.targetId);
    const config=types[scope],mime=clean(t.mimeType).toLowerCase();
    const canonical=canonicalKey(uid,row.id,scope,target,mime);
    const shared=Boolean(config&&config[2]!=="personal");
    const pathValid=canonical!==null&&
      [canonical,"moderation-staging/"+canonical].includes(clean(t.storageKey))&&
      (!clean(t.publicStorageKey)||clean(t.publicStorageKey)===canonical);
    const ticketValid=Boolean(config)&&
      (config[2]!=="personal"||target===uid)&&
      pathValid&&clean(t.bucket)==="shadow-live-storage"&&
      Number.isSafeInteger(t.expectedSizeBytes)&&
      t.expectedSizeBytes>0&&t.expectedSizeBytes<=config[1];
    const metadata=await db.get("storage_objects/"+row.id);
    const m=metadata.data||{};
    if(metadata.exists&&(clean(m.ownerUid)!==uid||
      clean(m.objectId)!==row.id))reject("image_upload_ticket_owner_conflict");
    let reference=null;
    if(shared&&targetOk(target)){
      const collection=config[2]==="conversation"?"conversations":
        config[2]==="room"?"rooms":"agencies";
      reference=await db.get(collection+"/"+target);
    }
    const related=reference?.data||{};
    const participants=related.participants;
    const sharedReferenceConsistent=!shared||Boolean(reference?.exists&&(
      config[2]==="conversation"
        ?Array.isArray(participants)&&participants.length===2&&
          new Set(participants).size===2&&participants.includes(uid)&&
          participants.every(uidOk)
        :config[2]==="room"
          ?[related.ownerUid,related.hostUid,related.ownerId,related.hostId]
            .some(v=>clean(v)===uid)
          :clean(related.ownerUid)===uid
    ));
    const metadataConsistent=!metadata.exists||(
      clean(m.scope)===scope&&clean(m.targetId)===target&&
      clean(m.mimeType).toLowerCase()===mime&&
      clean(m.bucket)==="shadow-live-storage"&&
      !held(m)
    );
    const expiry=t.expiresAt;
    const expiresMs=expiry instanceof Date?expiry.getTime():
      typeof expiry?.toDate==="function"?expiry.toDate().getTime():
      typeof expiry==="string"?Date.parse(expiry):NaN;
    items.push({
      objectId:row.id,scope:Object.hasOwn(types,scope)?scope:"unknown_or_invalid",
      ticketSchemaConsistent:Boolean(ticketValid&&metadataConsistent),
      metadataPresent:metadata.exists,
      sharedAssetReview:shared,
      sharedReferenceConsistent,
      legalOrAppealHold:held(t)||held(m)||held(related),
      ticketExpired:Number.isFinite(expiresMs)&&expiresMs<=nowMs,
      uploadFinalizationUnresolved:true,needsReview:true,
    });
  }
  return {
    ok:true,checked:items.length,items,hasMore:rows.length>limit,
    nextCursor:rows.length>limit&&page.length?page[page.length-1].id:null,
    // A missing ticket is NOT proof of missing media or complete storage.
    exhaustive:false,mediaRetentionCertified:false,
    sharedOwnershipCleared:false,erasureAllowed:false,
    completionVerified:false,
  };
}
