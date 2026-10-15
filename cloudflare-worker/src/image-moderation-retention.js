// Retention for private image-moderation evidence. Reuse the existing hourly
// evidence cron; never enumerate R2 keys or run a background listener.
import { moderatedStagingKey } from "./image-moderation-gate.js";
import { ImageReviewError } from "./image-moderation-review.js";

const clean = value => String(value ?? "").trim();
const OBJECT_ID = /^[a-f0-9]{32}$/;
const OPERATION_KEY = /^[A-Za-z0-9_-]{12,180}$/;
const DAY_MS = 24 * 60 * 60 * 1000;
const RETENTION_MS = 90 * DAY_MS;
const DEFER_MS = 7 * DAY_MS;

export const finalImageEvidenceDeadline = (now = new Date()) =>
  new Date(now.getTime() + RETENTION_MS);

export function imageEvidenceHoldActive(image = {}, appeal = {}) {
  return image.evidenceHold === true ||
    image.legalHold === true || image.investigationHold === true ||
    ["under_review", "approving"].includes(clean(appeal.status));
}

function validPrivateEvidence(image) {
  try {
    return clean(image.storageKey) ===
      moderatedStagingKey(clean(image.publicStorageKey)) &&
      clean(image.etag).length > 0 &&
      Number(image.sizeBytes) > 0 &&
      Number(image.sizeBytes) <= 3 * 1024 * 1024;
  } catch {
    return false;
  }
}

function when(value) {
  return value instanceof Date ? value.getTime() :
    Date.parse(clean(value));
}

// A final human rejection starts the 90-day clock. Staged, blocked, pending,
// reopened and approved images never acquire an automatic deletion deadline.
export function finalImageEvidenceFields(now = new Date()) {
  const due = finalImageEvidenceDeadline(now);
  return {
    evidenceRetentionDueAt: due,
    evidencePurgeAt: due,
    evidenceClosedAt: now,
  };
}

export async function setImageEvidenceHold(db, {
  actorUid, objectId, hold, reason, idempotencyKey,
}) {
  const id = clean(objectId);
  const key = clean(idempotencyKey);
  const note = clean(reason);
  if (!OBJECT_ID.test(id) || !OPERATION_KEY.test(key) ||
      typeof hold !== "boolean" || note.length < 3 || note.length > 200) {
    throw new ImageReviewError("invalid_evidence_hold_request", 400);
  }
  const path = "storage_objects/" + id;
  const receiptPath = "image_evidence_hold_operations/" + key;
  const tx = await db.beginTransaction();
  try {
    const [snapshot, receipt] = await Promise.all([
      db.get(path, tx), db.get(receiptPath, tx),
    ]);
    if (receipt.exists) {
      if (clean(receipt.data.actorUid) !== actorUid ||
          clean(receipt.data.objectId) !== id ||
          receipt.data.hold !== hold) {
        throw new ImageReviewError("idempotency_conflict", 409);
      }
      await db.rollback(tx);
      return { ok: true, duplicate: true, objectId: id, hold };
    }
    if (!snapshot.exists ||
        !["blocked", "rejected", "appeal_pending"].includes(
          clean(snapshot.data.state))) {
      throw new ImageReviewError("image_evidence_not_holdable", 409);
    }
    const now = new Date();
    const fields = {
      evidenceHold: hold, evidenceHoldReason: note,
      evidenceHoldUpdatedBy: actorUid, evidenceHoldUpdatedAt: now,
    };
    if (!hold && snapshot.data.evidenceRetentionDueAt) {
      fields.evidencePurgeAt = snapshot.data.evidenceRetentionDueAt;
    }
    await db.commit(tx, [
      db.writeUpdate(path, fields, Object.keys(fields)),
      db.writeCreate(receiptPath, {
        actorUid, objectId: id, hold,
        reason: note, createdAt: now,
      }),
      db.writeCreate("admin_audit_logs/image_evidence_hold_" + key, {
        action: "setImageEvidenceHold", actorUid,
        objectId: id, hold, reason: note, createdAt: now,
      }),
    ]);
    return { ok: true, objectId: id, hold };
  } catch (error) {
    await db.rollback(tx).catch(() => {});
    throw error;
  }
}

// Transactionally claim before deleting bytes. A resumed "evidence_purging"
// claim is safe: R2 delete is idempotent and the due timestamp remains indexed
// until metadata confirmation. No appeal/hold can start once claimed.
export async function purgeFinalImageEvidence(db, bucket, objectId,
  now = new Date()) {
  const id = clean(objectId);
  if (!OBJECT_ID.test(id)) throw Error("invalid_object_id");
  const path = "storage_objects/" + id;
  const tx = await db.beginTransaction();
  let image;
  try {
    const snap = await db.get(path, tx);
    if (!snap.exists ||
        !["rejected", "evidence_purging"].includes(clean(snap.data.state))) {
      await db.rollback(tx);
      return "skipped";
    }
    image = snap.data;
    const due = when(image.evidencePurgeAt);
    if (!Number.isFinite(due) || due > now.getTime()) {
      await db.rollback(tx);
      return "skipped";
    }
    if (!validPrivateEvidence(image)) {
      throw Error("invalid_private_image_evidence");
    }
    const appeal = await db.get("image_moderation_appeals/" + id, tx);
    if (imageEvidenceHoldActive(image, appeal.data || {})) {
      if (clean(image.state) === "evidence_purging") {
        throw Error("purge_claim_hold_conflict");
      }
      const nextDate = new Date(now.getTime() + DEFER_MS);
      await db.commit(tx, [
        db.writeUpdate(path, {
          evidencePurgeAt: nextDate, evidenceRetentionDeferredAt: now,
        }, ["evidencePurgeAt", "evidenceRetentionDeferredAt"]),
        db.writeCreate("admin_audit_logs/image_evidence_defer_" +
          crypto.randomUUID(), {
          action: "deferImageEvidenceDeletion", objectId: id,
          reason: "appeal_investigation_or_legal_hold", createdAt: now,
        }),
      ]);
      return "held";
    }
    if (clean(image.state) === "rejected") {
      await db.commit(tx, [
        db.writeUpdate(path, {
          state: "evidence_purging", evidenceClaimedAt: now,
        }, ["state", "evidenceClaimedAt"]),
        db.writeCreate("admin_audit_logs/image_evidence_claim_" + id, {
          action: "claimFinalImageEvidenceDeletion", objectId: id,
          createdAt: now,
        }),
      ]);
    } else {
      await db.rollback(tx);
    }
  } catch (error) {
    await db.rollback(tx).catch(() => {});
    throw error;
  }

  if (typeof bucket?.delete !== "function") {
    throw Error("private_evidence_bucket_missing");
  }
  // Archived diary approvals may have an unlinked protected copy from
  // an interrupted createDiary attempt; remove it with the retained stage.
  const originalKey = clean(image.publicStorageKey);
  if (clean(image.scope) === "diary_image" &&
      /^users\/[^/]+\/diaries\/[a-f0-9]{32}\.(jpg|png|webp|gif)$/.test(originalKey) &&
      originalKey.includes("/" + id + ".")) {
    await bucket.delete("moderated-diary/" + originalKey);
  }
  // On failure leave the claim resumable at the next hourly invocation.
  await bucket.delete(clean(image.storageKey));
  const committedAt = new Date();
  await db.commit(null, [
    db.writeUpdate(path, {
      state: "evidence_purged", storageKey: null,
      etag: null, sizeBytes: 0, evidencePurgeAt: null,
      evidencePurgedAt: committedAt, updatedAt: committedAt,
    }, ["state", "storageKey", "etag", "sizeBytes",
      "evidencePurgeAt", "evidencePurgedAt", "updatedAt"]),
    db.writeCreate("admin_audit_logs/image_evidence_purge_" + id, {
      action: "purgeFinalImageEvidenceAfter90Days",
      objectId: id, createdAt: committedAt,
    }),
  ]);
  return "purged";
}

export async function runDueImageEvidenceCleanup(env, db, {
  nowMs = Date.now(), limit = 12,
} = {}) {
  const cap = Math.max(1, Math.min(12, Math.trunc(Number(limit) || 12)));
  const rows = await db.runQuery("storage_objects", {
    filters: [{ field: "evidencePurgeAt", op: "<=", value: new Date(nowMs) }],
    orderBy: [{ field: "evidencePurgeAt", direction: "asc" }],
    limit: cap,
  });
  const result = { checked: rows.length, purged: 0, held: 0, failed: 0 };
  for (const row of rows) {
    try {
      const out = await purgeFinalImageEvidence(
        db, env?.USER_STORAGE, row.id, new Date(nowMs));
      if (out === "purged") result.purged++;
      if (out === "held") result.held++;
    } catch (error) {
      result.failed++;
      console.error("Image evidence purge failed",
        clean(error?.message || "failed").slice(0, 90));
    }
  }
  return result;
}
