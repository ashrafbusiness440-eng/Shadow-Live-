import { json, readJson, firestoreQuotaResponse } from "./http.js";
import { firestoreClient } from "./firestore.js";
import { verifyFirebaseIdToken, assertUserDocumentSessionState } from "./firebase-auth.js";
import {
  IMAGE_MODERATION_PATH, IMAGE_MODERATION_PROVIDERS,
  defaultImageModerationPolicy, validateImageModerationPolicy,
  imageModerationProviderReady,
} from "./image-moderation-policy.js";

const clean = (v) => String(v ?? "").trim();
const KEY = /^[A-Za-z0-9_-]{12,180}$/;

// U6-L1 provisions real provider adapters and an owner configuration UI.
// U6-L2 must install the pre-publication R2 gate FIRST. Until then it is
// intentionally impossible to switch scanning on (no false 'protected' UI).
export const IMAGE_MODERATION_PUBLICATION_GATE_READY = false;

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
      return json(request, env, {
        ok: true, config,
        publicationGateReady: IMAGE_MODERATION_PUBLICATION_GATE_READY,
        providerConfigured: imageModerationProviderReady(env, config.provider),
        providers: Object.fromEntries(Object.entries(IMAGE_MODERATION_PROVIDERS)
          .map(([id, spec]) => [id, {
            mode: spec.mode, label: spec.label,
            configured: imageModerationProviderReady(env, id),
            billingUrl: spec.billingUrl,
          }])),
      });
    }
    if (action !== "save")
      throw new ImageModerationControlError("unsupported_action");
    const authAge = Math.floor(Date.now() / 1000) - Number(decoded.auth_time);
    if (!Number.isFinite(authAge) || authAge < 0 || authAge > 1800)
      throw new ImageModerationControlError("recent_auth_required", 401);
    const result = await saveImageModerationConfiguration(db, uid, body);
    return json(request, env, result);
  } catch (error) {
    const quota = firestoreQuotaResponse(request, env, error);
    if (quota) return quota;
    const status = error instanceof ImageModerationControlError
      ? error.status : clean(error?.message) === "unauthorized" ? 401 : 500;
    const code = error instanceof ImageModerationControlError
      ? error.code : status === 401 ? "unauthorized" : "moderation_control_failed";
    return json(request, env, { ok: false, code }, status);
  }
}
