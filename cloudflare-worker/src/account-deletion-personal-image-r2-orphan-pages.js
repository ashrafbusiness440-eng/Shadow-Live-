// INTERNAL ONLY: read-only, one bounded R2 prefix per deleting user.
// Personal image folders only. Never LIST a bucket root, a shared room,
// agency or conversation; never GET/HEAD/DELETE bytes, mutate Firestore,
// sign off retention, advance account erasure or remove Firebase Auth.
// Authenticated Owner enforcement is the responsibility of the internal caller.
const clean=v=>String(v??"").trim();
const uidOk=v=>/^[A-Za-z0-9_-]{3,128}$/.test(clean(v));
const reqOk=v=>/^[A-Za-z0-9_-]{12,180}$/.test(clean(v));
const objectOk=v=>/^[a-f0-9]{32}$/.test(clean(v));
const cursorOk=v=>/^[A-Za-z0-9+/_=-]{1,512}$/.test(v);
const held=d=>[
  d?.legalHold,d?.retentionHold,d?.deletionHold,d?.reviewHold,
  d?.evidenceHold,d?.investigationHold,d?.reported,d?.appealPending,
].some(x=>x===true)||
  ["pending","open","under_review"].includes(
    clean(d?.appealStatus).toLowerCase());
const folders=Object.freeze({
  profile:{scope:"profile_image",max:2*1024*1024},
  "profile-animation":{scope:"profile_avatar_animation",max:2*1024*1024},
  covers:{scope:"profile_cover",max:3*1024*1024},
  diaries:{scope:"diary_image",max:3*1024*1024},
});
const mimetypes=Object.freeze({
  jpg:"image/jpeg",png:"image/png",
  webp:"image/webp",gif:"image/gif",
});
export const MAX_PERSONAL_IMAGE_R2_ORPHAN_PAGE=5;
export class PersonalImageR2OrphanError extends Error{
  constructor(code,status=409){super(code);this.code=code;this.status=status;}
}
const reject=(code,status)=>{throw new PersonalImageR2OrphanError(code,status);};

/**
 * One exact R2 prefix with at most five objects, followed by direct Firestore
 * point reads for recognized canonical names only. A missing metadata row
 * is a POSSIBLE orphan, not approval to delete: unindexed/legacy links and
 * legal evidence may still exist.
 */
export async function inspectPersonalImageR2OrphanPage(db,bucket,{
  uid,requestId,folder,actor,cursor=null,
  limit=MAX_PERSONAL_IMAGE_R2_ORPHAN_PAGE,
}={}){
  uid=clean(uid);requestId=clean(requestId);
  // Do not trim/normalize folder: reject any strange prefix outright.
  if(!actor?.owner||!uidOk(actor.uid))reject("owner_required",403);
  if(!uidOk(uid)||!reqOk(requestId)||
    typeof folder!=="string"||!Object.hasOwn(folders,folder)||
    !Number.isSafeInteger(limit)||limit<1||
    limit>MAX_PERSONAL_IMAGE_R2_ORPHAN_PAGE||
    (cursor!==null&&(typeof cursor!=="string"||!cursorOk(cursor)))){
    reject("invalid_personal_image_orphan_scope",400);
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
    held(request.data)||held(checkpoint.data)||held(user.data)){
    reject("personal_image_orphan_review_blocked");
  }
  if(typeof bucket?.list!=="function")reject("r2_listing_unavailable",503);
  const prefix="users/"+uid+"/"+folder+"/";
  let listing;
  try {
    listing=await bucket.list({
      prefix,limit,...(cursor===null?{}:{cursor}),
    });
  }catch(_error){
    reject("r2_listing_unavailable",503);
  }
  if(!listing||!Array.isArray(listing.objects)||
    listing.objects.length>limit||typeof listing.truncated!=="boolean"||
    (listing.truncated&&(
      listing.objects.length===0||typeof listing.cursor!=="string"||
      !cursorOk(listing.cursor)||listing.cursor===cursor))){
    reject("personal_image_orphan_invalid_listing",503);
  }
  const seen=new Set();
  const seenIds=new Set();
  const selected=listing.objects.map(entry=>{
    const key=clean(entry?.key);
    if(!key.startsWith(prefix))reject("personal_image_orphan_prefix_violation",503);
    if(seen.has(key))reject("personal_image_orphan_duplicate_object",503);
    seen.add(key);
    const file=key.slice(prefix.length);
    const match=/^([a-f0-9]{32})\.(jpg|png|webp|gif)$/.exec(file);
    const formatValid=Boolean(match)&&
      (folder==="profile-animation"?match[2]==="gif":match[2]!=="gif");
    if(formatValid){
      if(seenIds.has(match[1]))reject("personal_image_orphan_duplicate_id",503);
      seenIds.add(match[1]);
    }
    return {key,id:formatValid?match[1]:null,
      ext:formatValid?match[2]:null};
  });
  const definition=folders[folder];
  const items=[];
  // Sequential point reads cap worst-case pressure; no indexed query, scan,
  // listener, timer or cross-account enumeration.
  for(const row of selected){
    if(!row.id){
      items.push({objectId:null,recognizedFormat:false,
        metadataPresent:false,uploadTicketPresent:false,
        possibleOrphan:false,referenceConsistent:false,needsReview:true});
      continue;
    }
    const [metadata,ticket,link,pointer]=await Promise.all([
      db.get("storage_objects/"+row.id),
      db.get("storage_upload_tickets/"+row.id),
      folder==="diaries"?db.get("diary_image_links/"+row.id):
        Promise.resolve(null),
      folder!=="diaries"?
        db.get("storage_active_objects/"+definition.scope+"__"+uid):
        Promise.resolve(null),
    ]);
    const m=metadata?.data||{},t=ticket?.data||{};
    if((metadata.exists&&(
      clean(m.ownerUid)!==uid||clean(m.objectId)!==row.id))||
      (ticket.exists&&(
        clean(t.ownerUid)!==uid||clean(t.objectId)!==row.id))||
      (link?.exists&&clean(link.data?.ownerUid)!==uid)||
      (pointer?.exists&&clean(pointer.data?.ownerUid)!==uid)){
      reject("personal_image_orphan_owner_conflict");
    }
    const expectedMime=mimetypes[row.ext];
    const consistent=metadata.exists&&
      clean(m.scope)===definition.scope&&
      clean(m.targetId)===uid&&
      clean(m.storageKey)===row.key&&
      (!clean(m.publicStorageKey)||clean(m.publicStorageKey)===row.key)&&
      clean(m.bucket)==="shadow-live-storage"&&
      clean(m.mimeType).toLowerCase()===expectedMime&&
      Number.isSafeInteger(m.sizeBytes)&&m.sizeBytes>0&&
      m.sizeBytes<=definition.max&&
      clean(m.state)==="active"&&
      !held(m)&&!held(t)&&!held(link?.data)&&!held(pointer?.data)&&
      (folder!=="diaries"||(
        link?.exists&&clean(link.data?.state)==="linked"&&
        Boolean(clean(link.data?.diaryId))));
    const pointerConsistent=!pointer?.exists||(
      clean(pointer.data?.scope)===definition.scope&&
      clean(pointer.data?.targetId)===uid&&
      clean(pointer.data?.objectId)===row.id);
    items.push({
      objectId:row.id,recognizedFormat:true,
      metadataPresent:metadata.exists,
      uploadTicketPresent:ticket.exists,
      referenceConsistent:Boolean(consistent&&pointerConsistent&&!ticket.exists),
      // An absent metadata document might also be an in-flight upload.
      // Neither this flag nor any positive reference is a deletion permit.
      possibleOrphan:!metadata.exists&&!ticket.exists,
      needsReview:true,
    });
  }
  return {
    ok:true,checked:items.length,items,
    hasMore:listing.truncated,
    nextCursor:listing.truncated?listing.cursor:null,
    // A scoped R2 prefix cannot prove all images were discovered.
    exhaustive:false,sharedOwnershipCleared:false,
    mediaRetentionCertified:false,completionVerified:false,
    erasureAllowed:false,
  };
}
