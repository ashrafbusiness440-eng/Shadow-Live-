import {
  buildStorageObjectKey, storageExtensionForMime,
} from "./user-storage.js";
import { moderatedStagingKey } from "./image-moderation-gate.js";
import { ImageReviewError } from "./image-moderation-review.js";

const clean = (v) => String(v ?? "").trim();
const ID = /^[a-f0-9]{32}$/;
const KEY = /^[A-Za-z0-9_-]{12,180}$/;

// Human approval of a diary image is NOT permission to expose the bytes.
// The author's createDiary operation must link it before public delivery.
// Do not change this to publishModeratedUpload or a public R2 write.
export async function approvePrivateDiaryImage(db, bucket, actorUid, payload) {
  const objectId = clean(payload?.objectId);
  const key = clean(payload?.idempotencyKey);
  const reason = clean(payload?.reason);
  if (!ID.test(objectId) || !KEY.test(key) ||
      reason.length < 3 || reason.length > 200) {
    throw new ImageReviewError("invalid_review_request", 400);
  }
  const path = "storage_objects/" + objectId;
  const receiptPath = "image_moderation_decisions/" + key;
  const tx = await db.beginTransaction();
  try {
    const [image, receipt] = await Promise.all([
      db.get(path, tx), db.get(receiptPath, tx),
    ]);
    if (receipt.exists) {
      if (receipt.data?.action !== "approve_diary_private" ||
          clean(receipt.data?.actorUid) !== actorUid ||
          clean(receipt.data?.objectId) !== objectId) {
        throw new ImageReviewError("idempotency_conflict", 409);
      }
      await db.rollback(tx);
      return {
        ok: true, objectId, duplicate: true,
        status: "approved_pending_diary_link",
      };
    }
    const doc = image.data || {};
    if (!image.exists || !["needs_review", "appeal_pending"].includes(
      clean(doc.state)) || clean(doc.scope) !== "diary_image" ||
        !clean(doc.ownerUid) || clean(doc.ownerUid) !== clean(doc.targetId)) {
      throw new ImageReviewError("diary_image_not_approvable", 409);
    }
    if (doc.evidenceHold === true || doc.legalHold === true ||
        doc.investigationHold === true) {
      throw new ImageReviewError("image_evidence_hold_active", 409);
    }
    const extension = storageExtensionForMime(doc.mimeType);
    const expectedPublic = buildStorageObjectKey({
      scope: "diary_image", uid: doc.ownerUid,
      targetId: doc.targetId, objectId, extension,
    });
    if (!extension || clean(doc.publicStorageKey) !== expectedPublic ||
        clean(doc.storageKey) !== moderatedStagingKey(expectedPublic) ||
        !clean(doc.etag) || Number(doc.sizeBytes) < 1 ||
        Number(doc.sizeBytes) > 3 * 1024 * 1024) {
      throw new ImageReviewError("image_integrity_conflict", 409);
    }
    const user = await db.get("users/" + doc.ownerUid, tx);
    if (!user.exists) throw new ImageReviewError("diary_owner_missing", 409);
    const appeal = clean(doc.state) === "appeal_pending"
      ? await db.get("image_moderation_appeals/" + objectId, tx) : null;
    if (appeal && (!appeal.exists ||
        clean(appeal.data?.ownerUid) !== clean(doc.ownerUid) ||
        clean(appeal.data?.status) !== "under_review")) {
      throw new ImageReviewError("image_appeal_conflict", 409);
    }
    if (typeof bucket?.head !== "function") {
      throw new ImageReviewError("r2_not_configured", 503);
    }
    const stored = await bucket.head(clean(doc.storageKey));
    if (!stored || clean(stored.etag) !== clean(doc.etag) ||
        Number(stored.size) !== Number(doc.sizeBytes)) {
      throw new ImageReviewError("image_integrity_conflict", 409);
    }
    const now = new Date();
    const writes = [
      db.writeUpdate(path, {
        state: "approved_pending_diary_link",
        moderation: {
          ...(doc.moderation || {}),
          status: "approved",
          reviewStatus: "approved_pending_diary_link",
          reviewedBy: actorUid, reviewedAt: now, reviewReason: reason,
        },
        updatedAt: now,
      }, ["state", "moderation", "updatedAt"]),
      db.writeCreate(receiptPath, {
        action: "approve_diary_private", actorUid, objectId,
        ownerUid: doc.ownerUid, status: "completed", reason, createdAt: now,
      }),
      db.writeCreate("admin_audit_logs/image_diary_review_" + key, {
        action: "approvePrivateDiaryImage", actorUid, objectId,
        ownerUid: doc.ownerUid, reason, createdAt: now,
      }),
      // An unlinked approved image expires without holding private bytes
      // indefinitely. The existing storage cleanup cron checks linkage.
      db.writeCreate("storage_delete_queue/" + objectId, {
        objectId, storageKey: clean(doc.storageKey),
        ownerUid: doc.ownerUid, scope: "diary_image",
        targetId: doc.targetId, sizeBytes: Number(doc.sizeBytes),
        deleteAfter: new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000),
        reason: "diary_approved_unlinked", createdAt: now,
      }),
      db.writeCreate("notifications/image_diary_review_" + key, {
        userId: doc.ownerUid, type: "image_moderation",
        title: "تمت الموافقة على صورة اليومية",
        body: "الصورة ما زالت خاصة. يمكنك نشرها فقط عند إنشاء اليومية.",
        category: "social", objectId,
        reviewStatus: "approved_pending_diary_link",
        read: false, createdAt: now, updatedAt: now,
      }),
    ];
    if (appeal) {
      writes.push(db.writeUpdate("image_moderation_appeals/" + objectId, {
        status: "approved", decidedBy: actorUid,
        decisionReason: reason, decidedAt: now, updatedAt: now,
      }, ["status", "decidedBy", "decisionReason", "decidedAt", "updatedAt"]));
    }
    await db.commit(tx, writes);
    return { ok: true, objectId, status: "approved_pending_diary_link" };
  } catch (error) {
    await db.rollback(tx).catch(() => {});
    throw error;
  }
}

// A distinct protected prefix prevents legacy diary URLs from exposing images.
export function moderatedDiaryProtectedKey(publicKey) {
  const value = clean(publicKey);
  if (!/^users\/[^/]+\/diaries\/[a-f0-9]{32}\.(jpg|png|webp|gif)$/.test(value)) {
    throw new ImageReviewError("invalid_diary_storage_key", 409);
  }
  return "moderated-diary/" + value;
}

export async function prepareApprovedDiaryPublication(bucket, image, objectId) {
  const doc = image || {};
  const uid = clean(doc.ownerUid);
  const extension = storageExtensionForMime(doc.mimeType);
  if (!ID.test(clean(objectId)) || !uid || uid !== clean(doc.targetId) ||
      clean(doc.scope) !== "diary_image" ||
      clean(doc.state) !== "approved_pending_diary_link" ||
      clean(doc.moderation?.status) !== "approved" || !extension ||
      doc.evidenceHold === true || doc.legalHold === true ||
      doc.investigationHold === true) {
    throw new ImageReviewError("diary_approval_required", 409);
  }
  const originalPublicKey = buildStorageObjectKey({
    scope: "diary_image", uid, targetId: uid, objectId, extension,
  });
  const sourceKey = moderatedStagingKey(originalPublicKey);
  if (clean(doc.storageKey) !== sourceKey ||
      clean(doc.publicStorageKey) !== originalPublicKey ||
      !clean(doc.etag) || Number(doc.sizeBytes) < 1 ||
      Number(doc.sizeBytes) > 3 * 1024 * 1024 ||
      typeof bucket?.get !== "function" ||
      typeof bucket?.put !== "function") {
    throw new ImageReviewError("diary_image_integrity_conflict", 409);
  }
  const object = await bucket.get(sourceKey);
  if (!object || clean(object.etag) !== clean(doc.etag) ||
      Number(object.size) !== Number(doc.sizeBytes)) {
    throw new ImageReviewError("diary_image_integrity_conflict", 409);
  }
  const protectedKey = moderatedDiaryProtectedKey(originalPublicKey);
  await bucket.put(protectedKey, object.body, {
    httpMetadata: { contentType: clean(doc.mimeType) },
  });
  return {
    sourceKey, protectedKey, reviewedEtag: clean(doc.etag),
    extension, publicScope: "moderated_diary_image",
  };
}
