import { corsHeaders } from "./http.js";
import { finalImageEvidenceFields } from "./image-moderation-retention.js";
import { moderatedStagingKey } from "./image-moderation-gate.js";

const clean = (value) => String(value ?? "").trim();
const OBJECT_ID = /^[a-f0-9]{32}$/;
const REQUEST_ID = /^[A-Za-z0-9_-]{12,180}$/;
const MAX_PREVIEW_BYTES = 3 * 1024 * 1024;

export class ImageReviewError extends Error {
  constructor(code, status = 400) {
    super(code);
    this.code = code;
    this.status = status;
  }
}

function objectIdOrFail(raw) {
  const id = clean(raw);
  if (!OBJECT_ID.test(id)) throw new ImageReviewError("invalid_object_id");
  return id;
}

function safeImage(doc, id) {
  return {
    objectId: id,
    ownerUid: clean(doc.ownerUid),
    targetId: clean(doc.targetId),
    scope: clean(doc.scope),
    state: clean(doc.state),
    mimeType: clean(doc.mimeType),
    sizeBytes: Number(doc.sizeBytes || 0),
    createdAt: doc.createdAt || null,
    reason: clean(doc.moderation?.reason).slice(0, 100),
    reviewStatus: clean(doc.moderation?.reviewStatus),
    appealExplanation: clean(doc.moderation?.appealExplanation).slice(0, 800),
    evidenceHold: doc.evidenceHold === true || doc.legalHold === true ||
      doc.investigationHold === true,
    evidencePurgeAt: doc.evidencePurgeAt || null,
  };
}

// No unbounded scan: six fixed-size, single-field indexed queries.
export async function listImageReviewCases(db, limit = 12) {
  const cap = Math.max(1, Math.min(12, Math.trunc(Number(limit) || 12)));
  const [pending, blocked, publishing, appeals, rejected, approvedDiary] = await Promise.all([
    db.runQuery("storage_objects", {
      filters: [{ field: "state", op: "==", value: "needs_review" }],
      limit: cap,
    }),
    db.runQuery("storage_objects", {
      filters: [{ field: "state", op: "==", value: "blocked" }],
      limit: cap,
    }),
    db.runQuery("storage_objects", {
      filters: [{ field: "state", op: "==", value: "approved_pending_copy" }],
      limit: cap,
    }),
    db.runQuery("storage_objects", {
      filters: [{ field: "state", op: "==", value: "appeal_pending" }],
      limit: cap,
    }),
    db.runQuery("storage_objects", {
      filters: [{ field: "state", op: "==", value: "rejected" }],
      limit: cap,
    }),
    db.runQuery("storage_objects", {
      filters: [{ field: "state", op: "==", value: "approved_pending_diary_link" }],
      limit: cap,
    }),
  ]);
  return [
    ...appeals.slice(0, cap),
    ...blocked.slice(0, cap),
    ...rejected.slice(0, cap),
    ...approvedDiary.slice(0, cap),
    ...pending.slice(0, cap),
    ...publishing.slice(0, cap),
  ].slice(0, 72).map((row) => safeImage(row.data || {}, row.id))
    .filter((row) => OBJECT_ID.test(row.objectId));
}

export async function readImageReviewPreview(request, env, db, actorUid, objectId) {
  const id = objectIdOrFail(objectId);
  const snap = await db.get("storage_objects/" + id);
  if (!snap.exists || !["needs_review", "blocked", "rejected", "approved_pending_copy", "appeal_pending", "approved_pending_diary_link"].includes(
    clean(snap.data?.state))) throw new ImageReviewError("image_review_not_found", 404);
  const doc = snap.data;
  const mimeType = clean(doc.mimeType);
  if (!["image/jpeg", "image/png", "image/webp", "image/gif"].includes(mimeType) ||
      Number(doc.sizeBytes) < 1 || Number(doc.sizeBytes) > MAX_PREVIEW_BYTES ||
      !clean(doc.etag) ||
      clean(doc.storageKey) !== moderatedStagingKey(clean(doc.publicStorageKey)) ||
      typeof env?.USER_STORAGE?.get !== "function") {
    throw new ImageReviewError("image_preview_unavailable", 409);
  }
  // Record privileged access BEFORE transferring any sensitive image bytes.
  await db.commit(null, [db.writeCreate(
    "admin_audit_logs/image_review_preview_" + crypto.randomUUID(), {
      action: "viewPendingImageEvidence", actorUid,
      objectId: id, ownerUid: clean(doc.ownerUid),
      scope: clean(doc.scope), createdAt: new Date(),
    },
  )]);
  const obj = await env.USER_STORAGE.get(clean(doc.storageKey));
  if (!obj || Number(obj.size) < 1 || Number(obj.size) > MAX_PREVIEW_BYTES ||
      clean(obj.etag) !== clean(doc.etag)) {
    throw new ImageReviewError("image_preview_unavailable", 409);
  }
  const headers = new Headers(corsHeaders(request, env));
  headers.set("Content-Type", mimeType);
  headers.set("Cache-Control", "private, no-store, max-age=0");
  headers.set("X-Content-Type-Options", "nosniff");
  return new Response(obj.body, { status: 200, headers });
}

// Explicit reviewed rejection only. Account sanctions are never automatic.
// An image stays in the private evidence location for a later appeal.
export async function rejectImageReview(db, actorUid, payload) {
  const id = objectIdOrFail(payload.objectId);
  const key = clean(payload.idempotencyKey);
  const reason = clean(payload.reason);
  if (!REQUEST_ID.test(key) || reason.length < 3 || reason.length > 200) {
    throw new ImageReviewError("invalid_review_request");
  }
  const path = "image_moderation_decisions/" + key;
  const tx = await db.beginTransaction();
  try {
    const [operation, image] = await Promise.all([
      db.get(path, tx), db.get("storage_objects/" + id, tx),
    ]);
    if (operation.exists) {
      if (clean(operation.data?.actorUid) !== actorUid ||
          clean(operation.data?.objectId) !== id ||
          clean(operation.data?.action) !== "reject") {
        throw new ImageReviewError("idempotency_conflict", 409);
      }
      await db.rollback(tx);
      return { ok: true, duplicate: true, objectId: id, status: "rejected" };
    }
    if (!image.exists || !["needs_review", "blocked", "appeal_pending"].includes(
      clean(image.data?.state))) {
      throw new ImageReviewError("image_not_pending_review", 409);
    }
    const appealPending = clean(image.data.state) === "appeal_pending";
    const appeal = appealPending
      ? await db.get("image_moderation_appeals/" + id, tx) : null;
    if (appealPending && (!appeal?.exists ||
        clean(appeal.data.status) !== "under_review" ||
        clean(appeal.data.ownerUid) !== clean(image.data.ownerUid))) {
      throw new ImageReviewError("image_appeal_conflict", 409);
    }
    const now = new Date();
    const ownerUid = clean(image.data.ownerUid);
    const writes = [
      db.writeUpdate("storage_objects/" + id, {
        state: "rejected",
        ...finalImageEvidenceFields(now),
        updatedAt: now,
        moderation: {
          ...(image.data.moderation || {}),
          reviewStatus: "rejected", reviewReason: reason,
          reviewedBy: actorUid, reviewedAt: now,
        },
      }, ["state", "evidenceRetentionDueAt", "evidencePurgeAt",
        "evidenceClosedAt", "updatedAt", "moderation"]),
      db.writeCreate(path, {
        action: "reject", actorUid, objectId: id,
        ownerUid, reason, status: "completed", createdAt: now,
      }),
      db.writeCreate("admin_audit_logs/image_review_" + key, {
        action: "rejectPendingImage", actorUid, objectId: id,
        ownerUid, scope: clean(image.data.scope),
        reason, createdAt: now,
      }),
    ];
    if (appealPending) {
      writes.push(db.writeUpdate("image_moderation_appeals/" + id, {
        status: "rejected", decisionReason: reason,
        decidedBy: actorUid, decidedAt: now, updatedAt: now,
      }, ["status", "decisionReason", "decidedBy", "decidedAt", "updatedAt"]));
    }
    if (/^[A-Za-z0-9_-]{1,180}$/.test(ownerUid)) {
      writes.push(db.writeCreate("notifications/image_review_" + key, {
        userId: ownerUid, type: "image_moderation",
        category: "social", read: false,
        title: "نتيجة مراجعة الصورة",
        body: (appealPending ? "تم رفض الاعتراض على الصورة. السبب: "
          : "تم رفض نشر الصورة بعد المراجعة. السبب: ") + reason,
        objectId: id, reviewStatus: "rejected",
        createdAt: now, updatedAt: now,
      }));
    }
    await db.commit(tx, writes);
    return { ok: true, objectId: id, status: "rejected" };
  } catch (error) {
    await db.rollback(tx).catch(() => {});
    throw error;
  }
}
