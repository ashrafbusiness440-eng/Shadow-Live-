import {
  buildStorageObjectKey, storageExtensionForMime,
  storageActivePointerId, replacementDeleteAt,
} from "./user-storage.js";
import { moderatedStagingKey, publishModeratedUpload } from "./image-moderation-gate.js";
import { publicMediaUrl } from "./public-media.js";
import { ImageReviewError } from "./image-moderation-review.js";

const clean = (v) => String(v ?? "").trim();
const ID = /^[a-f0-9]{32}$/;
const KEY = /^[A-Za-z0-9_-]{12,180}$/;
const REPLACEABLE = new Set([
  "profile_image", "profile_avatar_animation", "profile_cover",
  "room_cover", "agency_logo", "agency_background", "agency_room_image",
]);

function validateSource(doc, objectId) {
  const scope = clean(doc.scope);
  const publicKey = clean(doc.publicStorageKey);
  const ownerUid = clean(doc.ownerUid);
  const targetId = clean(doc.targetId);
  const mimeType = clean(doc.mimeType);
  if (!REPLACEABLE.has(scope) || !ownerUid || !targetId) {
    throw new ImageReviewError("approval_requires_linkable_image", 409);
  }
  const expected = buildStorageObjectKey({
    scope, uid: ownerUid, targetId, objectId,
    extension: storageExtensionForMime(mimeType),
  });
  if (publicKey !== expected ||
      clean(doc.storageKey) !== moderatedStagingKey(expected) ||
      !clean(doc.etag) ||
      Number(doc.sizeBytes) < 1 || Number(doc.sizeBytes) > 3 * 1024 * 1024) {
    throw new ImageReviewError("image_integrity_conflict", 409);
  }
  return { scope, publicKey, ownerUid, targetId, mimeType };
}

function pointerPath(doc) {
  return "storage_active_objects/" +
    storageActivePointerId(doc.scope, doc.targetId);
}

async function verifyTarget(db, tx, doc) {
  const scope = clean(doc.scope);
  const targetId = clean(doc.targetId);
  const ownerUid = clean(doc.ownerUid);
  if (scope.startsWith("profile_")) {
    const user = await db.get("users/" + targetId, tx);
    if (!user.exists || targetId !== ownerUid) {
      throw new ImageReviewError("profile_no_longer_available", 409);
    }
    return { user };
  }
  if (scope === "room_cover") {
    const room = await db.get("rooms/" + targetId, tx);
    if (!room.exists ||
        ![clean(room.data?.ownerUid || room.data?.ownerId),
          clean(room.data?.hostUid || room.data?.hostId)].includes(ownerUid)) {
      throw new ImageReviewError("room_ownership_changed", 409);
    }
    return { room };
  }
  const agency = await db.get("agencies/" + targetId, tx);
  if (!agency.exists || clean(agency.data?.ownerUid) !== ownerUid ||
      clean(agency.data?.status) === "closed") {
    throw new ImageReviewError("agency_ownership_changed", 409);
  }
  if (scope === "agency_room_image") {
    const roomId = clean(agency.data.roomId);
    if (/^[A-Za-z0-9_-]{3,180}$/.test(roomId)) {
      const room = await db.get("rooms/" + roomId, tx);
      return { agency, room, roomId };
    }
  }
  return { agency };
}

async function ensurePointer(db, tx, doc) {
  const id = clean(doc.replaceObjectId);
  const p = pointerPath(doc);
  const pointer = await db.get(p, tx);
  const activeId = clean(pointer.data?.objectId);
  if (activeId !== id) throw new ImageReviewError("stale_image_replacement", 409);
  const previous = id ? await db.get("storage_objects/" + id, tx) : null;
  if (id && (!previous?.exists ||
      clean(previous.data?.scope) !== clean(doc.scope) ||
      clean(previous.data?.targetId) !== clean(doc.targetId))) {
    throw new ImageReviewError("stale_image_replacement", 409);
  }
  return {p, id, previous};
}

async function beginImageApproval(db, actorUid, objectId, key, reason) {
  const path="image_moderation_decisions/" + key;
  const tx=await db.beginTransaction();
  try {
    const [snap,operation]=await Promise.all([
      db.get("storage_objects/" + objectId,tx), db.get(path,tx),
    ]);
    if (operation.exists) {
      if (clean(operation.data?.actorUid) !== actorUid ||
          clean(operation.data?.objectId) !== objectId ||
          clean(operation.data?.action) !== "approve") {
        throw new ImageReviewError("idempotency_conflict",409);
      }
      await db.rollback(tx);
      return {complete:clean(operation.data.status)==="completed"};
    }
    if (!snap.exists || clean(snap.data?.state)!=="needs_review") {
      throw new ImageReviewError("image_not_approvable",409);
    }
    const doc=snap.data;
    validateSource(doc,objectId);
    await ensurePointer(db,tx,doc);
    await verifyTarget(db,tx,doc);
    const now=new Date();
    await db.commit(tx,[
      db.writeUpdate("storage_objects/"+objectId,{
        state:"approved_pending_copy",
        moderation:{...(doc.moderation||{}),status:"approved",
          reviewStatus:"approved_pending_copy",reviewedBy:actorUid,
          reviewedAt:now,reviewReason:reason},
        updatedAt:now,
      },["state","moderation","updatedAt"]),
      db.writeCreate(path,{
        action:"approve",actorUid,objectId,ownerUid:clean(doc.ownerUid),
        reason,status:"publishing",createdAt:now,
      }),
      db.writeCreate("admin_audit_logs/image_review_intent_"+key,{
        action:"approvePendingImageIntent",actorUid,objectId,
        scope:clean(doc.scope),reason,createdAt:now,
      }),
    ]);
    return {complete:false};
  } catch (error) {
    await db.rollback(tx).catch(()=>{});
    throw error;
  }
}

function targetWrites(db,doc,objectId,url,now,target) {
  const scope=doc.scope;
  const uid=doc.ownerUid;
  const writes=[];
  if (scope.startsWith("profile_")) {
    const fields= scope==="profile_image"
      ? {profileImageUrl:url,profileImageObjectId:objectId,
          photoUrl:url,avatarUrl:url,profileAvatarAsset:null,updatedAt:now}
      : scope==="profile_cover"
        ? {coverImageUrl:url,coverImageObjectId:objectId,updatedAt:now}
        : {profileAvatarAnimationUrl:url,
            profileAvatarAnimationObjectId:objectId,updatedAt:now};
    writes.push(db.writeUpdate("users/"+uid,fields,Object.keys(fields)));
    // A missing public profile is allowed: no new profile document created.
    if (target.publicProfile?.exists) {
      const publicFields={...fields};
      delete publicFields.photoUrl; delete publicFields.avatarUrl;
      writes.push(db.writeUpdate("public_profiles/"+uid,
        publicFields,Object.keys(publicFields)));
    }
  } else if(scope==="room_cover") {
    writes.push(db.writeUpdate("rooms/"+doc.targetId,{
      coverImageUrl:url,coverImageObjectId:objectId,updatedAt:now,
    },["coverImageUrl","coverImageObjectId","updatedAt"]));
  } else {
    const fields=scope==="agency_logo"
      ? {logoUrl:url,logoObjectId:objectId,updatedAt:now}
      : scope==="agency_background"
        ? {backgroundUrl:url,backgroundObjectId:objectId,
            coverUrl:url,updatedAt:now}
        : {roomImageUrl:url,roomImageObjectId:objectId,updatedAt:now};
    writes.push(db.writeUpdate("agencies/"+doc.targetId,fields,Object.keys(fields)));
    if (scope==="agency_room_image" && target.room?.exists &&
        clean(target.room.data?.agencyId)===clean(doc.targetId)) {
      writes.push(db.writeUpdate("rooms/"+target.roomId,{
        agencyRoomImageUrl:url,agencyRoomImageObjectId:objectId,updatedAt:now,
      },["agencyRoomImageUrl","agencyRoomImageObjectId","updatedAt"]));
    }
  }
  return writes;
}

export async function approveImageReview(db,bucket,request,actorUid,payload) {
  const objectId=clean(payload.objectId);
  const key=clean(payload.idempotencyKey);
  const reason=clean(payload.reason);
  if (!ID.test(objectId) || !KEY.test(key) ||
      reason.length<3 || reason.length>200) {
    throw new ImageReviewError("invalid_review_request",400);
  }
  const begun=await beginImageApproval(db,actorUid,objectId,key,reason);
  if (begun.complete) return {
    ok:true,duplicate:true,objectId,status:"approved",
  };
  const snapshot=await db.get("storage_objects/"+objectId);
  if (!snapshot.exists || clean(snapshot.data.state)!=="approved_pending_copy" ||
      clean(snapshot.data.moderation?.reviewedBy)!==actorUid) {
    throw new ImageReviewError("image_approval_conflict",409);
  }
  const source=validateSource(snapshot.data,objectId);
  if (typeof bucket?.get!=="function"||typeof bucket?.put!=="function") {
    throw new ImageReviewError("r2_not_configured",503);
  }
  // Operator-approved image; it is copied once and still not linked until
  // the final Firestore transaction passes freshness/ownership checks.
  try {
    await publishModeratedUpload(bucket,clean(snapshot.data.storageKey),
      source.publicKey,source.mimeType,clean(snapshot.data.etag));
  } catch(error) {
    if(error instanceof ImageReviewError) throw error;
    throw new ImageReviewError("approved_image_copy_failed",503);
  }

  const tx=await db.beginTransaction();
  try {
    const [fresh,operation]=await Promise.all([
      db.get("storage_objects/"+objectId,tx),
      db.get("image_moderation_decisions/"+key,tx),
    ]);
    if (!fresh.exists||clean(fresh.data.state)!=="approved_pending_copy"||
        !operation.exists||clean(operation.data.status)!=="publishing"||
        clean(operation.data.actorUid)!==actorUid||
        clean(operation.data.objectId)!==objectId) {
      throw new ImageReviewError("image_approval_conflict",409);
    }
    const doc=fresh.data;
    validateSource(doc,objectId);
    const pointer=await ensurePointer(db,tx,doc);
    const target=await verifyTarget(db,tx,doc);
    if (clean(doc.scope).startsWith("profile_")) {
      target.publicProfile=await db.get("public_profiles/"+doc.ownerUid,tx);
    }
    const extension=storageExtensionForMime(doc.mimeType);
    const publicUrl=publicMediaUrl(request,{
      scope:doc.scope,targetId:doc.targetId,objectId,extension,
    });
    if (!publicUrl) throw new ImageReviewError("public_media_url_missing",409);
    const now=new Date();
    const writes=[
      db.writeUpdate("storage_objects/"+objectId,{
        state:"active",storageKey:source.publicKey,
        publicUrl,updatedAt:now,
        moderation:{...(doc.moderation||{}),
          status:"approved",reviewStatus:"approved",
          reviewedBy:actorUid,reviewReason:reason,reviewedAt:now},
      },["state","storageKey","publicUrl","updatedAt","moderation"]),
      db.writeUpdate(pointer.p,{
        objectId,ownerUid:doc.ownerUid,scope:doc.scope,
        targetId:doc.targetId,updatedAt:now,
      }),
      db.writeUpdate("image_moderation_decisions/"+key,{
        status:"completed",completedAt:now,
      },["status","completedAt"]),
      db.writeCreate("admin_audit_logs/image_review_"+key,{
        action:"approvePendingImage",actorUid,objectId,
        ownerUid:doc.ownerUid,scope:doc.scope,reason,createdAt:now,
      }),
      db.writeCreate("notifications/image_review_"+key,{
        userId:doc.ownerUid,type:"image_moderation",category:"social",
        title:"تمت الموافقة على صورتك",body:"تمت مراجعة الصورة وقبول نشرها.",
        read:false,objectId,reviewStatus:"approved",createdAt:now,updatedAt:now,
      }),
      ...targetWrites(db,doc,objectId,publicUrl,now,target),
    ];
    if(pointer.id) {
      const old=pointer.previous.data;
      const deleteAfter=replacementDeleteAt(now.getTime());
      writes.push(
        db.writeUpdate("storage_objects/"+pointer.id,{
          state:"pending_delete",pendingDeleteAt:deleteAfter,
          replacedByObjectId:objectId,updatedAt:now,
        },["state","pendingDeleteAt","replacedByObjectId","updatedAt"]),
        db.writeCreate("storage_delete_queue/"+pointer.id,{
          objectId:pointer.id,storageKey:clean(old.storageKey),
          ownerUid:clean(old.ownerUid),scope:clean(old.scope),
          targetId:clean(old.targetId),sizeBytes:Number(old.sizeBytes||0),
          deleteAfter,reason:"replaced",createdAt:now,
        }),
      );
    }
    await db.commit(tx,writes);
    await bucket.delete(clean(doc.storageKey)).catch(()=>{});
    return {ok:true,objectId,status:"approved",publicUrl};
  } catch(error) {
    await db.rollback(tx).catch(()=>{});
    throw error;
  }
}
