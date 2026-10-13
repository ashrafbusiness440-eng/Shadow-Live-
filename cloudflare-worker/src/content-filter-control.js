import { firestoreQuotaResponse, json, readJson } from "./http.js";
import {
  verifyFirebaseIdToken,
  assertUserDocumentSessionState,
} from "./firebase-auth.js";
import { firestoreClient } from "./firestore.js";
import {
  CONTENT_FILTER_PATH, defaultFilterConfig, validateFilterConfig,
  loadContentFilter, applyContentFilter, primeContentFilter,
} from "./content-filter.js";

const clean = (value) => String(value ?? "").trim();
const OP_KEY = /^[A-Za-z0-9_-]{12,180}$/;

class FilterControlError extends Error {
  constructor(code, status = 400) {
    super(code); this.code = code; this.status = status;
  }
}

async function requireManager(request, env, db) {
  const decoded = await verifyFirebaseIdToken(request, env);
  const uid = clean(decoded?.sub);
  if (!uid) throw new FilterControlError("unauthorized", 401);
  const snapshot = await db.get(`users/${uid}`);
  const actor = snapshot.data || {};
  if (!snapshot.exists) throw new FilterControlError("forbidden", 403);
  assertUserDocumentSessionState(decoded, actor);
  const allowed = actor.role === "owner" ||
    (actor.adminEnabled === true &&
      Array.isArray(actor.capabilities) &&
      actor.capabilities.includes("manageSystem"));
  if (!allowed) throw new FilterControlError("forbidden", 403);
  return { uid, decoded };
}

async function savePolicy(db, actorUid, body) {
  const key = clean(body.idempotencyKey);
  const reason = clean(body.reason);
  if (!OP_KEY.test(key) || reason.length < 3 || reason.length > 180)
    throw new FilterControlError("invalid_request");
  let next;
  try { next = validateFilterConfig(body.config); }
  catch (error) {
    throw new FilterControlError(clean(error?.message) === "duplicate_filter_rule"
      ? "duplicate_filter_rule" : "invalid_filter_config");
  }
  const tx = await db.beginTransaction();
  try {
    const operationPath = `control_operations/${key}`;
    const [operation, existing] = await Promise.all([
      db.get(operationPath, tx), db.get(CONTENT_FILTER_PATH, tx),
    ]);
    if (operation.exists) {
      await db.rollback(tx);
      if (operation.data?.action !== "updateContentFilter" ||
          operation.data?.actorUid !== actorUid) {
        throw new FilterControlError("idempotency_conflict", 409);
      }
      return { ok: true, code: "duplicate", config: operation.data.result.config };
    }
    const currentVersion = Number(existing.data?.version || 0);
    if (currentVersion !== Number(body.expectedVersion || 0)) {
      throw new FilterControlError("filter_conflict", 409);
    }
    const version = currentVersion + 1;
    const config = { ...next, version };
    const now = new Date();
    const writes = [
      existing.exists
        ? db.writeUpdate(CONTENT_FILTER_PATH, {
            ...config, updatedBy: actorUid, updatedAt: now,
          })
        : db.writeCreate(CONTENT_FILTER_PATH, {
            ...config, updatedBy: actorUid, updatedAt: now,
          }),
      db.writeCreate(`admin_audit_logs/content_filter_${key}`, {
        action: "updateContentFilter", actorUid,
        targetType: "system_config", targetId: "content_filter",
        beforeVersion: currentVersion, afterVersion: version,
        beforeEnabled: existing.data?.enabled === true,
        afterEnabled: config.enabled,
        beforeCount: Array.isArray(existing.data?.rules) ? existing.data.rules.length : 0,
        afterCount: config.rules.length, reason, createdAt: now,
      }),
      db.writeCreate(operationPath, {
        action: "updateContentFilter", actorUid, status: "completed",
        result: { config }, createdAt: now,
      }),
    ];
    await db.commit(tx, writes);
    primeContentFilter(config);
    return { ok: true, code: "ok", config };
  } catch (error) {
    await db.rollback(tx).catch(() => {});
    throw error;
  }
}

export async function contentFilterControl(request, env) {
  if (request.method !== "POST") {
    return json(request, env, { ok: false, code: "method_not_allowed" }, 405);
  }
  try {
    const db = firestoreClient(env);
    const actor = await requireManager(request, env, db);
    const body = await readJson(request);
    switch (clean(body.action)) {
      case "load":
        return json(request, env, {
          ok: true,
          config: await loadContentFilter(db, { fresh: true }),
        });
      case "preview": {
        const source = clean(body.text).slice(0, 2000);
        const surface = clean(body.surface);
        if (!["private_chat", "room_chat", "diary_post", "diary_comment"].includes(surface))
          throw new FilterControlError("invalid_request");
        // Preview the same submitted policy *before* saving any changes.
        let config;
        try { config = validateFilterConfig(body.config); }
        catch { throw new FilterControlError("invalid_filter_config"); }
        const result = applyContentFilter(source, config, surface);
        return json(request, env, { ok: true, result });
      }
      case "save":
        return json(request, env, await savePolicy(db, actor.uid, body));
      default:
        throw new FilterControlError("invalid_action");
    }
  } catch (error) {
    if (error instanceof FilterControlError)
      return json(request, env, { ok: false, code: error.code }, error.status);
    const quota = firestoreQuotaResponse(request, env, error);
    if (quota) return quota;
    if (clean(error?.message) === "unauthorized")
      return json(request, env, { ok: false, code: "unauthorized" }, 401);
    return json(request, env, { ok: false, code: "content_filter_failed" }, 500);
  }
}

export const contentFilterControlInternals = Object.freeze({
  savePolicy,
});
