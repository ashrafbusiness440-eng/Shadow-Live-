// One appeal per held-image decision. The source remains private until a
// human decision; no automatic publication, provider call, or account sanction.
const clean = (v) => String(v ?? "").trim();
const OBJECT_ID = /^[a-f0-9]{32}$/;
const APPEALABLE = new Set(["blocked", "rejected"]);

export class ImageAppealError extends Error {
  constructor(code, status = 400) {
    super(code);
    this.code = code;
    this.status = status;
  }
}

export async function submitImageModerationAppeal(db, actorUid, payload) {
  const objectId = clean(payload?.objectId);
  const explanation = clean(payload?.explanation);
  if (!OBJECT_ID.test(objectId) || explanation.length > 800) {
    throw new ImageAppealError("invalid_image_appeal", 400);
  }
  const imagePath = "storage_objects/" + objectId;
  const appealPath = "image_moderation_appeals/" + objectId;
  const tx = await db.beginTransaction();
  try {
    const [image, appeal] = await Promise.all([
      db.get(imagePath, tx), db.get(appealPath, tx),
    ]);
    // Ownership is checked before revealing the existence of any receipt.
    if (!image.exists || clean(image.data?.ownerUid) !== actorUid) {
      throw new ImageAppealError("image_not_found", 404);
    }
    if (appeal.exists) {
      if (clean(appeal.data?.ownerUid) !== actorUid) {
        throw new ImageAppealError("image_not_found", 404);
      }
      await db.rollback(tx);
      return {
        ok: true, objectId, duplicate: true,
        status: clean(appeal.data?.status) || "under_review",
      };
    }
    if (!APPEALABLE.has(clean(image.data.state)) ||
        clean(image.data?.moderation?.status) === "approved" ||
        !clean(image.data?.etag) ||
        !clean(image.data?.storageKey).startsWith("moderation-staging/")) {
      throw new ImageAppealError("image_not_appealable", 409);
    }
    const now = new Date();
    const sourceState = clean(image.data.state);
    await db.commit(tx, [
      db.writeCreate(appealPath, {
        objectId, ownerUid: actorUid, status: "under_review",
        sourceState, originalReason: clean(image.data.moderation?.reason).slice(0, 120),
        explanation, createdAt: now, updatedAt: now,
      }),
      db.writeUpdate(imagePath, {
        state: "appeal_pending",
        moderation: {
          ...(image.data.moderation || {}),
          reviewStatus: "appeal_pending", appealedAt: now,
          appealExplanation: explanation,
        },
        updatedAt: now,
      }, ["state", "moderation", "updatedAt"]),
      db.writeCreate("storage_audit_logs/image_appeal_" + objectId, {
        action: "requestImageAppeal", objectId, actorUid,
        previousState: sourceState, createdAt: now,
      }),
      db.writeCreate("notifications/image_appeal_received_" + objectId, {
        userId: actorUid, type: "image_moderation", category: "social",
        title: "تم استلام اعتراضك", body: "اعتراضك على الصورة قيد المراجعة.",
        read: false, objectId, reviewStatus: "appeal_pending",
        createdAt: now, updatedAt: now,
      }),
    ]);
    return { ok: true, objectId, status: "under_review" };
  } catch (error) {
    await db.rollback(tx).catch(() => {});
    throw error;
  }
}
