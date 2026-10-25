// INTERNAL ONLY: read-only R2 HEAD for ONE account-owned image.
// No public route, scheduler, R2 listing/download/deletion, Firestore writes,
// ownership transfer, legal signoff, Auth deletion or erasure certificate.
// The caller MUST separately authenticate Owner: actor.owner is only a hint.
const clean = v => String(v ?? "").trim();
const uidOk = v => /^[A-Za-z0-9_-]{3,128}$/.test(clean(v));
const requestOk = v => /^[A-Za-z0-9_-]{12,180}$/.test(clean(v));
const targetOk = v => /^[A-Za-z0-9_-]{1,180}$/.test(clean(v));
const objectOk = v => /^[a-f0-9]{32}$/.test(clean(v));
const held = d => [
  d?.legalHold, d?.retentionHold, d?.deletionHold, d?.reviewHold,
  d?.evidenceHold, d?.investigationHold, d?.reported, d?.appealPending,
].some(v => v === true) ||
  ["pending", "open", "under_review"].includes(
    clean(d?.appealStatus).toLowerCase());
const extensions = Object.freeze({
  "image/jpeg": "jpg", "image/png": "png",
  "image/webp": "webp", "image/gif": "gif",
});
const scopes = Object.freeze({
  profile_image: {type:"profile", folder:"profile", max:2*1024*1024},
  profile_avatar_animation: {type:"profile", folder:"profile-animation", max:2*1024*1024},
  profile_cover: {type:"profile", folder:"covers", max:3*1024*1024},
  diary_image: {type:"diary", folder:"diaries", max:3*1024*1024},
  chat_image: {type:"conversation", folder:"", max:3*1024*1024},
  room_cover: {type:"room", folder:"covers", max:3*1024*1024},
  agency_logo: {type:"agency", folder:"logo", max:2*1024*1024},
  agency_background: {type:"agency", folder:"background", max:3*1024*1024},
  agency_room_image: {type:"agency", folder:"room-image", max:3*1024*1024},
});
export class AccountImageR2HeadError extends Error {
  constructor(code, status=409) {
    super(code); this.code=code; this.status=status;
  }
}
const reject = (code,status) => {throw new AccountImageR2HeadError(code,status);};

function canonicalKey(scope,uid,target,id,extension,definition) {
  const name=id+"."+extension;
  if(definition.type==="profile" || definition.type==="diary") {
    return "users/"+uid+"/"+definition.folder+"/"+name;
  }
  if(definition.type==="conversation") {
    return "chat/"+target+"/"+uid+"/"+name;
  }
  if(definition.type==="room") return "rooms/"+target+"/covers/"+name;
  if(definition.type==="agency") {
    return "agencies/"+target+"/"+definition.folder+"/"+name;
  }
  reject("image_r2_scope_review_required");
}

/**
 * Single exact HEAD only after live deletion request, object ownership,
 * canonical key, upload-ticket, reference and legal/appeal checks.
 * HEAD validates presence and metadata; it NEVER proves safe erasure.
 */
export async function inspectAccountImageR2Object(db,bucket,{
  uid,requestId,objectId,actor,
}={}) {
  uid=clean(uid);requestId=clean(requestId);objectId=clean(objectId);
  if(!actor?.owner || !uidOk(actor.uid)) reject("owner_required",403);
  if(!uidOk(uid)||!requestOk(requestId)||!objectOk(objectId)) {
    reject("invalid_image_r2_target",400);
  }
  const [request,checkpoint,user,object]=await Promise.all([
    db.get("account_deletion_requests/"+uid),
    db.get("account_deletion_erasure_checkpoints/"+uid),
    db.get("users/"+uid),
    db.get("storage_objects/"+objectId),
  ]);
  if(!request.exists||!checkpoint.exists||!user.exists||
    clean(request.data?.uid)!==uid ||
    clean(request.data?.requestId)!==requestId ||
    clean(checkpoint.data?.uid)!==uid ||
    clean(checkpoint.data?.requestId)!==requestId ||
    !["review_ready","processing"].includes(clean(request.data?.status)) ||
    clean(user.data?.role)==="owner" || user.data?.authDeleted===true ||
    held(request.data)||held(checkpoint.data)||held(user.data)) {
    reject("image_r2_review_blocked");
  }
  if(!object.exists) reject("image_r2_metadata_missing");
  const m=object.data||{};
  if(clean(m.ownerUid)!==uid||clean(m.objectId)!==objectId) {
    reject("image_r2_owner_conflict");
  }
  const scope=clean(m.scope);
  const definition=scopes[scope],target=clean(m.targetId);
  const mime=clean(m.mimeType).toLowerCase(),extension=extensions[mime];
  const size=m.sizeBytes;
  if(!definition||!targetOk(target)||!extension||
    (scope==="profile_avatar_animation"?extension!=="gif":extension==="gif")||
    !Number.isSafeInteger(size)||size<1||size>definition.max||
    clean(m.bucket)!=="shadow-live-storage"||
    clean(m.state)!=="active"||
    held(m)||
    (m.moderation && !["", "approved"].includes(
      clean(m.moderation.status).toLowerCase()))) {
    reject("image_r2_metadata_review_required");
  }
  const canonical=canonicalKey(scope,uid,target,objectId,extension,definition);
  // Staged, legacy and arbitrary paths are manual-review only. HEAD must
  // never be issued for a path merely because it appears in Firestore.
  if(clean(m.storageKey)!==canonical ||
    (clean(m.publicStorageKey)&&clean(m.publicStorageKey)!==canonical)||
    ((definition.type==="profile"||definition.type==="diary")&&target!==uid)) {
    reject("image_r2_path_review_required");
  }
  // Exact document lookups only; no collection queries or scans.
  const relatedPath=definition.type==="diary"?"diary_image_links/"+objectId:
    definition.type==="conversation"?"conversations/"+target:
    definition.type==="room"?"rooms/"+target:
    definition.type==="agency"?"agencies/"+target:null;
  const pointerPath=definition.type!=="diary"&&
    definition.type!=="conversation"?
    "storage_active_objects/"+scope+"__"+target:null;
  const [ticket,linked,pointer]=await Promise.all([
    db.get("storage_upload_tickets/"+objectId),
    relatedPath?db.get(relatedPath):Promise.resolve(null),
    pointerPath?db.get(pointerPath):Promise.resolve(null),
  ]);
  if(ticket.exists||held(ticket.data)||held(linked?.data)||
     held(pointer?.data)) reject("image_r2_reference_review_required");
  if(definition.type==="diary") {
    if(!linked?.exists||
      clean(linked.data?.ownerUid)!==uid||
      clean(linked.data?.state)!=="linked"||
      !targetOk(linked.data?.diaryId)) {
      reject("image_r2_diary_review_required");
    }
  } else if(definition.type==="conversation") {
    const p=linked?.data?.participants;
    if(!linked?.exists||!Array.isArray(p)||p.length!==2||
      new Set(p).size!==2||!p.includes(uid)||!p.every(uidOk)) {
      reject("image_r2_shared_reference_review_required");
    }
  } else if(definition.type==="room"||definition.type==="agency") {
    if(!linked?.exists||clean(linked.data?.ownerUid)!==uid) {
      reject("image_r2_shared_reference_review_required");
    }
  }
  // A missing pointer may be an old schema and remains review-required.
  // A conflicting pointer is a reason to STOP before any storage access.
  if(pointer?.exists && (
    clean(pointer.data?.ownerUid)!==uid ||
    clean(pointer.data?.scope)!==scope ||
    clean(pointer.data?.targetId)!==target ||
    clean(pointer.data?.objectId)!==objectId)) {
    reject("image_r2_pointer_conflict");
  }
  if(typeof bucket?.head!=="function") reject("r2_head_unavailable",503);
  let head;
  try {
    head=await bucket.head(canonical);
  } catch (_error) {
    // Provider errors may include secret R2 paths: never forward them.
    reject("r2_head_unavailable",503);
  }
  if(head!=null&&(!Number.isSafeInteger(head.size)||head.size<0)) {
    reject("r2_head_invalid_response",503);
  }
  const storagePresent=head!=null;
  const sizeMatches=storagePresent&&head.size===size;
  const mimeMatches=storagePresent&&
    clean(head.httpMetadata?.contentType).toLowerCase()===mime;
  return {
    ok:true,objectId,scope,
    storagePresent,sizeMatches,mimeMatches,
    activePointerPresent:Boolean(pointer?.exists),
    sharedAssetReview:["conversation","room","agency"].includes(definition.type),
    needsReview:true,
    // Even a perfect HEAD is not evidence of exclusive ownership, legal
    // clearance, absence of older objects or permission to delete.
    exhaustive:false,mediaRetentionCertified:false,
    completionVerified:false,erasureAllowed:false,
  };
}
