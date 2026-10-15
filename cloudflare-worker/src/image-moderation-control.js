import { json, readJson, firestoreQuotaResponse } from "./http.js";
import { firestoreClient } from "./firestore.js";
import { verifyFirebaseIdToken, assertUserDocumentSessionState } from "./firebase-auth.js";
import {
  ImageReviewError, listImageReviewCases,
  readImageReviewPreview, rejectImageReview,
} from "./image-moderation-review.js";
import { approveImageReview } from "./image-moderation-approval.js";
import { approvePrivateDiaryImage } from "./image-moderation-diary.js";
import { approvePrivateChatImage } from "./image-moderation-chat.js";
import { setImageEvidenceHold } from "./image-moderation-retention.js";
import { assessImageModerationReadiness } from "./image-moderation-readiness.js";
import {
  IMAGE_MODERATION_PUBLICATION_GATE_READY,
  IMAGE_MODERATION_PATH, IMAGE_MODERATION_PROVIDERS,
  defaultImageModerationPolicy, validateImageModerationPolicy,
  imageModerationProviderReady,
} from "./image-moderation-policy.js";

const clean = (v) => String(v ?? "").trim();
const KEY = /^[A-Za-z0-9_-]{12,180}$/;

// Re-export the same constant used by the upload runtime. Owner settings
// cannot advertise a different publication state from the R2 upload path.
export { IMAGE_MODERATION_PUBLICATION_GATE_READY } from "./image-moderation-policy.js";

class ImageModerationControlError extends Error {
  constructor(code, status = 400) {
    super(code); this.code = code; this.status = status;
  }
}

export async function saveImageModerationConfiguration(db, actorUid, body) {
  const key = clean(body.idempotencyKey);
  const reason = clean(body.reason);
  if (!KEY.test(key) || reason.length < 3 || reason.length > 180) {
    throw new ImageModerationControlError("invalid_request");
  }
  let policy;
  try { policy = validateImageModerationPolicy(body.config); }
  catch {
    throw new ImageModerationControlError("invalid_policy");
  }
  if (policy.enabled && !IMAGE_MODERATION_PUBLICATION_GATE_READY) {
    throw new ImageModerationControlError("publication_gate_not_ready", 409);
  }
  const tx = await db.beginTransaction();
  try {
    const path = "control_operations/" + key;
    const [op, prev] = await Promise.all([
      db.get(path, tx), db.get(IMAGE_MODERATION_PATH, tx),
    ]);
    if (op.exists) {
      if (clean(op.data?.actorUid) !== actorUid ||
          clean(op.data?.action) !== "configureImageModeration") {
        throw new ImageModerationControlError("idempotency_conflict", 409);
      }
      await db.rollback(tx);
      return { ok: true, duplicate: true, config: op.data.result.config };
    }
    const current = Number(prev.data?.version || 0);
    if (current !== Number(body.expectedVersion || 0)) {
      throw new ImageModerationControlError("version_conflict", 409);
    }
    const now = new Date();
    const config = { ...policy, version: current + 1 };
    const writes = [
      prev.exists
        ? db.writeUpdate(IMAGE_MODERATION_PATH, {
            ...config, updatedAt: now, updatedBy: actorUid,
          })
        : db.writeCreate(IMAGE_MODERATION_PATH, {
            ...config, updatedAt: now, updatedBy: actorUid,
          }),
      db.writeCreate("admin_audit_logs/image_moderation_" + key, {
        actorUid, action: "configureImageModeration",
        targetType: "system_config", targetId: "image_moderation",
        reason, beforeVersion: current, afterVersion: current + 1,
        mode: config.mode, provider: config.provider, scope: config.scope,
        beforeEnabled: prev.data?.enabled === true,
        afterEnabled: config.enabled, createdAt: now,
      }),
      db.writeCreate(path, {
        actorUid, action: "configureImageModeration", createdAt: now,
        status: "completed", result: { config },
      }),
    ];
    await db.commit(tx, writes);
    return { ok: true, config };
  } catch (error) {
    await db.rollback(tx).catch(() => {});
    throw error;
  }
}

export async function imageModerationControl(request, env) {
  if (request.method !== "POST")
    return json(request, env, { ok: false, code: "method_not_allowed" }, 405);
  try {
    const decoded = await verifyFirebaseIdToken(request, env);
    const uid = clean(decoded?.sub);
    if (!uid) throw new ImageModerationControlError("unauthorized", 401);
    const db = firestoreClient(env);
    const user = await db.get("users/" + uid);
    if (!user.exists || clean(user.data?.role) !== "owner" ||
        user.data?.adminEnabled !== true) {
      throw new ImageModerationControlError("owner_required", 403);
    }
    assertUserDocumentSessionState(decoded, user.data);
    const body = await readJson(request);
    const action = clean(body.action);
    if (action === "read") {
      const state = await db.get(IMAGE_MODERATION_PATH);
      const config = state.exists
        ? { ...defaultImageModerationPolicy(), ...(state.data || {}) }
        : defaultImageModerationPolicy();
      // Only the selected provider's UTC-day aggregate is read; there is no
      // storage scan and no externally inferred billing balance.
      const day = new Date().toISOString().slice(0, 10).replaceAll("-", "");
      const stats = await db.get(
        "image_moderation_usage/" + day + "_" + config.provider);
      const counts = stats.data || {};
      const usage = {
        day, provider: config.provider,
        attempted: Number(counts.attempted || 0),
        approved: Number(counts.approved || 0),
        needsReview: Number(counts.needsReview || 0),
        blocked: Number(counts.blocked || 0),
        limit: Number(config.dailyLimit || 0),
        remaining: Math.max(0, Number(config.dailyLimit || 0) -
          Number(counts.attempted || 0)),
        source: "internal_attempts_not_provider_billing",
      };
      return json(request, env, {
        ok: true, config, usage,
        publicationGateReady: IMAGE_MODERATION_PUBLICATION_GATE_READY,
        providerConfigured: imageModerationProviderReady(env, config.provider),
        readiness: assessImageModerationReadiness({
          policy: config, env,
          providerConfigured: imageModerationProviderReady(env, config.provider),
          publicationGateReady: IMAGE_MODERATION_PUBLICATION_GATE_READY,
        }),
        providers: Object.fromEntries(Object.entries(IMAGE_MODERATION_PROVIDERS)
          .map(([id, spec]) => [id, {
            mode: spec.mode, label: spec.label,
            configured: imageModerationProviderReady(env, id),
            billingUrl: spec.billingUrl,
          }])),
      });
    }
    if (action === "list_images") {
      const images = await listImageReviewCases(db, body.limit);
      return json(request, env, { ok: true, images });
    }
    if (!["save", "preview_image", "reject_image", "approve_image", "approve_diary_private", "approve_chat_private", "hold_image_evidence"].includes(action))
      throw new ImageModerationControlError("unsupported_action");
    const authAge = Math.floor(Date.now() / 1000) - Number(decoded.auth_time);
    if (!Number.isFinite(authAge) || authAge < 0 || authAge > 1800)
      throw new ImageModerationControlError("recent_auth_required", 401);
    if (action === "preview_image") {
      return readImageReviewPreview(request, env, db, uid, body.objectId);
    }
    if (action === "reject_image") {
      const result = await rejectImageReview(db, uid, body);
      return json(request, env, result);
    }
    if (action === "approve_image") {
      const result = await approveImageReview(
        db, env.USER_STORAGE, request, uid, body);
      return json(request, env, result);
    }
    if (action === "approve_diary_private") {
      const result = await approvePrivateDiaryImage(db, env.USER_STORAGE, uid, body);
      return json(request, env, result);
    }
    if (action === "approve_chat_private") {
      const result = await approvePrivateChatImage(
        db, env.USER_STORAGE, uid, body);
      return json(request, env, result);
    }
    if (action === "hold_image_evidence") {
      const result = await setImageEvidenceHold(db, {
        actorUid: uid, objectId: body.objectId,
        hold: body.hold, reason: body.reason,
        idempotencyKey: body.idempotencyKey,
      });
      return json(request, env, result);
    }
    const result = await saveImageModerationConfiguration(db, uid, body);
    return json(request, env, result);
  } catch (error) {
    const quota = firestoreQuotaResponse(request, env, error);
    if (quota) return quota;
    const controlled = error instanceof ImageModerationControlError ||
      error instanceof ImageReviewError;
    const status = controlled
      ? error.status : clean(error?.message) === "unauthorized" ? 401 : 500;
    const code = controlled
      ? error.code : status === 401 ? "unauthorized" : "moderation_control_failed";
    return json(request, env, { ok: false, code }, status);
  }
}
