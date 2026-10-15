import { buildStorageObjectKey, storageExtensionForMime } from "./user-storage.js";
import { moderatedStagingKey, publishModeratedUpload } from "./image-moderation-gate.js";
import { ImageReviewError } from "./image-moderation-review.js";

const clean = value => String(value ?? "").trim();
const ID = /^[a-f0-9]{32}$/;
const KEY = /^[A-Za-z0-9_-]{12,180}$/;

// Exactly one sent message may link an image to its intended conversation.
// Never use the author-supplied recipient or a public media URL as authority.
export async function verifyPrivateChatImageMessage(db, image, objectId) {
  const conversationId = clean(image?.targetId);
  const ownerUid = clean(image?.ownerUid);
  if (!ID.test(clean(objectId)) || !conversationId ||
      conversationId.length > 180 || conversationId.includes("/") || !ownerUid) {
    throw new ImageReviewError("invalid_chat_image_reference", 409);
  }
  const conversation = await db.get("conversations/" + conversationId);
  const participants = Array.isArray(conversation.data?.participants)
    ? [...new Set(conversation.data.participants.map(clean).filter(Boolean))]
    : [];
  if (!conversation.exists || participants.length !== 2 ||
      !participants.includes(ownerUid)) {
    throw new ImageReviewError("chat_image_conversation_unavailable", 409);
  }
  const recipient = participants.find(uid => uid !== ownerUid);
  const messages = await db.runQuery("conversations/" + conversationId + "/messages", {
    filters: [{ field: "storageObjectId", op: "==", value: objectId }],
    limit: 2,
  });
  if (messages.length !== 1 ||
      clean(messages[0]?.data?.senderId) !== ownerUid ||
      clean(messages[0]?.data?.receiverId) !== recipient ||
      clean(messages[0]?.data?.type) !== "image") {
    throw new ImageReviewError("chat_image_message_unavailable", 409);
  }
  return { conversationId, recipientUid: recipient, messageId: messages[0].id };
}

// Publication means private R2 bytes can be read only by current conversation
// participants through authenticated prepareRead. No public-media URL exists.
export async function approvePrivateChatImage(db, bucket, actorUid, payload) {
  const objectId = clean(payload?.objectId);
  const key = clean(payload?.idempotencyKey);
  const reason = clean(payload?.reason);
  if (!ID.test(objectId) || !KEY.test(key) ||
      reason.length < 3 || reason.length > 200) {
    throw new ImageReviewError("invalid_review_request", 400);
  }
  const imagePath = "storage_objects/" + objectId;
  const receiptPath = "image_moderation_decisions/" + key;

  // Find the sender-created message before locking the review. Its ownership,
  // conversation membership and exact object reference are rechecked below.
  const initial = await db.get(imagePath);
  if (!initial.exists || clean(initial.data?.scope) !== "chat_image") {
    throw new ImageReviewError("chat_image_not_approvable", 409);
  }
  await verifyPrivateChatImageMessage(db, initial.data, objectId);
  const tx = await db.beginTransaction();
  let doc;
  try {
    const [snap, operation] = await Promise.all([
      db.get(imagePath, tx), db.get(receiptPath, tx),
    ]);
    if (operation.exists) {
      if (clean(operation.data?.actorUid) !== actorUid ||
          clean(operation.data?.objectId) !== objectId ||
          clean(operation.data?.action) !== "approve_chat_private") {
        throw new ImageReviewError("idempotency_conflict", 409);
      }
      const completed = clean(operation.data?.status) === "completed";
      await db.rollback(tx);
      if (completed) return {
        ok: true, duplicate: true, objectId, status: "approved",
      };
      doc = snap.data || {};
      if (!snap.exists || clean(doc.state) !== "chat_approval_publishing" ||
          clean(doc.moderation?.reviewedBy) !== actorUid) {
        throw new ImageReviewError("chat_image_approval_conflict", 409);
      }
    } else {
      doc = snap.data || {};
      if (!snap.exists || !["needs_review", "appeal_pending"].includes(
        clean(doc.state)) || clean(doc.scope) !== "chat_image" ||
          doc.evidenceHold === true || doc.legalHold === true ||
          doc.investigationHold === true) {
        throw new ImageReviewError("chat_image_not_approvable", 409);
      }
      const appeal = clean(doc.state) === "appeal_pending"
        ? await db.get("image_moderation_appeals/" + objectId, tx) : null;
      if (appeal && (!appeal.exists ||
          clean(appeal.data?.ownerUid) !== clean(doc.ownerUid) ||
          clean(appeal.data?.status) !== "under_review")) {
        throw new ImageReviewError("image_appeal_conflict", 409);
      }
      const now = new Date();
      const writes = [
        db.writeUpdate(imagePath, {
          state: "chat_approval_publishing",
          moderation: {
            ...(doc.moderation || {}), status: "approved",
            reviewStatus: "chat_approval_publishing",
            reviewedBy: actorUid, reviewedAt: now,
            reviewReason: reason,
          },
          updatedAt: now,
        }, ["state", "moderation", "updatedAt"]),
        db.writeCreate(receiptPath, {
          action: "approve_chat_private", actorUid, objectId,
          ownerUid: clean(doc.ownerUid), status: "publishing",
          reason, createdAt: now,
        }),
        db.writeCreate("admin_audit_logs/image_chat_intent_" + key, {
          action: "approvePrivateChatImageIntent", actorUid, objectId,
          reason, createdAt: now,
        }),
      ];
      if (appeal) {
        writes.push(db.writeUpdate("image_moderation_appeals/" + objectId, {
          status: "approving", reviewedBy: actorUid, updatedAt: now,
        }, ["status", "reviewedBy", "updatedAt"]));
      }
      await db.commit(tx, writes);
    }
  } catch (error) {
    await db.rollback(tx).catch(() => {});
    throw error;
  }

  const extension = storageExtensionForMime(doc.mimeType);
  if (!extension || !clean(doc.ownerUid) || !clean(doc.targetId)) {
    throw new ImageReviewError("chat_image_integrity_conflict", 409);
  }
  const targetKey = buildStorageObjectKey({
    scope: "chat_image", uid: doc.ownerUid,
    targetId: doc.targetId, objectId, extension,
  });
  const sourceKey = moderatedStagingKey(targetKey);
  if (clean(doc.storageKey) !== sourceKey ||
      clean(doc.publicStorageKey) !== targetKey ||
      !clean(doc.etag) || Number(doc.sizeBytes) < 1 ||
      Number(doc.sizeBytes) > 3 * 1024 * 1024) {
    throw new ImageReviewError("chat_image_integrity_conflict", 409);
  }
  if (typeof bucket?.get !== "function" || typeof bucket?.put !== "function") {
    throw new ImageReviewError("r2_not_configured", 503);
  }
  try {
    await publishModeratedUpload(bucket, sourceKey, targetKey,
      clean(doc.mimeType), clean(doc.etag));
  } catch {
    throw new ImageReviewError("chat_image_copy_failed", 503);
  }

  const finish = await db.beginTransaction();
  try {
    const [snap, receipt] = await Promise.all([
      db.get(imagePath, finish), db.get(receiptPath, finish),
    ]);
    if (!snap.exists || clean(snap.data?.state) !== "chat_approval_publishing" ||
        !receipt.exists || clean(receipt.data?.status) !== "publishing" ||
        clean(receipt.data?.actorUid) !== actorUid ||
        clean(receipt.data?.objectId) !== objectId ||
        clean(snap.data?.storageKey) !== sourceKey ||
        clean(snap.data?.etag) !== clean(doc.etag)) {
      throw new ImageReviewError("chat_image_approval_conflict", 409);
    }
    const association = await verifyPrivateChatImageMessage(db, snap.data, objectId);
    const now = new Date();
    const appeal = await db.get("image_moderation_appeals/" + objectId, finish);
    if (appeal.exists && (clean(appeal.data?.status) !== "approving" ||
        clean(appeal.data?.reviewedBy) !== actorUid)) {
      throw new ImageReviewError("image_appeal_conflict", 409);
    }
    await db.commit(finish, [
      db.writeUpdate(imagePath, {
        state: "active", storageKey: targetKey, updatedAt: now,
        moderation: {
          ...(snap.data?.moderation || {}),
          status: "approved", reviewStatus: "approved",
        },
      }, ["state", "storageKey", "updatedAt", "moderation"]),
      db.writeUpdate(receiptPath, {
        status: "completed", completedAt: now,
      }, ["status", "completedAt"]),
      db.writeCreate("admin_audit_logs/image_chat_review_" + key, {
        action: "approvePrivateChatImage", actorUid, objectId,
        conversationId: association.conversationId,
        messageId: association.messageId, createdAt: now,
      }),
      db.writeCreate("notifications/image_chat_review_" + key, {
        userId: clean(doc.ownerUid), type: "image_moderation",
        title: "تم اعتماد صورة المحادثة",
        body: "تمت الموافقة على الصورة داخل المحادثة الخاصة.",
        category: "social", objectId, reviewStatus: "approved",
        read: false, createdAt: now, updatedAt: now,
      }),
      ...(appeal.exists ? [db.writeUpdate(
        "image_moderation_appeals/" + objectId, {
          status: "approved", decidedBy: actorUid,
          decisionReason: reason, decidedAt: now, updatedAt: now,
        }, ["status", "decidedBy", "decisionReason", "decidedAt", "updatedAt"],
      )] : []),
    ]);
    await bucket.delete(sourceKey).catch(() => {});
    return { ok: true, objectId, status: "approved" };
  } catch (error) {
    await db.rollback(finish).catch(() => {});
    throw error;
  }
}
