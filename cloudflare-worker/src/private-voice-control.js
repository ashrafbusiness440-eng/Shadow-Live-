import { firestoreQuotaResponse, json, readJson } from "./http.js";
import {
  verifyFirebaseIdToken, assertUserDocumentSessionState,
} from "./firebase-auth.js";
import { firestoreClient } from "./firestore.js";

const CONFIG = "system_config/messaging";
const clean = value => String(value ?? "").trim();
const KEY_PATTERN = /^[A-Za-z0-9_-]{12,180}$/;

class ControlError extends Error {
  constructor(code, status = 400) {
    super(code);
    this.code = code;
    this.status = status;
  }
}

export function voiceConfigState(source = {}, env = {}) {
  return {
    voiceNotesEnabled: source.voiceNotesEnabled === true,
    privateCallsEnabled: source.privateCallsEnabled === true,
    version: Number.isSafeInteger(Number(source.voiceControlVersion)) &&
      Number(source.voiceControlVersion) >= 0
      ? Number(source.voiceControlVersion) : 0,
    callsLaunchReady: env.PRIVATE_CALL_MEDIA_READY === "true",
  };
}

export function validateVoiceChange(input, current, env) {
  if (!input || typeof input !== "object" ||
      typeof input.voiceNotesEnabled !== "boolean" ||
      typeof input.privateCallsEnabled !== "boolean") {
    throw new ControlError("invalid_voice_config");
  }
  // Even an authorized owner cannot enable calls before the backend
  // media readiness gate is explicitly set in the deployment environment.
  if (input.privateCallsEnabled === true &&
      current.privateCallsEnabled !== true &&
      env.PRIVATE_CALL_MEDIA_READY !== "true") {
    throw new ControlError("private_calls_not_ready", 409);
  }
  return {
    voiceNotesEnabled: input.voiceNotesEnabled,
    privateCallsEnabled: input.privateCallsEnabled,
  };
}

async function checkManager(request, env, db) {
  const decoded = await verifyFirebaseIdToken(request, env);
  const uid = clean(decoded?.sub);
  if (!uid) throw new ControlError("unauthorized", 401);
  const actorDoc = await db.get("users/" + uid);
  if (!actorDoc.exists) throw new ControlError("forbidden", 403);
  const actor = actorDoc.data || {};
  assertUserDocumentSessionState(decoded, actor);
  const allowed = actor.role === "owner" ||
    (actor.adminEnabled === true &&
      Array.isArray(actor.capabilities) &&
      actor.capabilities.includes("manageSystem"));
  if (!allowed) throw new ControlError("forbidden", 403);
  return {
    uid,
    authTime: Number(decoded.auth_time || 0),
  };
}

export async function writeVoiceConfig(db, actorUid, body, env) {
  if (!body || clean(body.action) !== "save" ||
      !KEY_PATTERN.test(clean(body.idempotencyKey)) ||
      clean(body.reason).length < 3 ||
      clean(body.reason).length > 180 ||
      !Number.isSafeInteger(body.expectedVersion) ||
      body.expectedVersion < 0) {
    throw new ControlError("invalid_request");
  }
  const key = clean(body.idempotencyKey);
  const tx = await db.beginTransaction();
  try {
    const [op, doc] = await Promise.all([
      db.get("control_operations/" + key, tx),
      db.get(CONFIG, tx),
    ]);
    if (op.exists) {
      await db.rollback(tx);
      if (op.data?.actorUid !== actorUid ||
          op.data?.action !== "updatePrivateVoiceConfig") {
        throw new ControlError("idempotency_conflict", 409);
      }
      return { ok: true, code: "duplicate", ...op.data.result };
    }
    const current = voiceConfigState(doc.data || {}, env);
    if (current.version !== body.expectedVersion) {
      throw new ControlError("voice_config_conflict", 409);
    }
    const values = validateVoiceChange(body.config, current, env);
    const version = current.version + 1;
    const now = new Date();
    const result = {
      config: voiceConfigState({
        ...values, voiceControlVersion: version,
      }, env),
    };
    await db.commit(tx, [
      (doc.exists ? db.writeUpdate : db.writeCreate).call(db, CONFIG, {
        ...values, voiceControlVersion: version,
        voiceControlUpdatedBy: actorUid, voiceControlUpdatedAt: now,
      }),
      db.writeCreate("admin_audit_logs/private_voice_" + key, {
        actorUid, action: "updatePrivateVoiceConfig", targetType: "system_config",
        targetId: "messaging", reason: clean(body.reason),
        before: {
          voiceNotesEnabled: current.voiceNotesEnabled,
          privateCallsEnabled: current.privateCallsEnabled,
        },
        after: values, version, createdAt: now,
      }),
      db.writeCreate("control_operations/" + key, {
        actorUid, action: "updatePrivateVoiceConfig",
        status: "completed", result, createdAt: now,
      }),
    ]);
    return { ok: true, code: "ok", ...result };
  } catch (error) {
    await db.rollback(tx).catch(() => {});
    throw error;
  }
}

export async function privateVoiceControl(request, env) {
  if (request.method !== "POST") {
    return json(request, env, { ok: false, code: "method_not_allowed" }, 405);
  }
  try {
    const db = firestoreClient(env);
    const actor = await checkManager(request, env, db);
    const body = await readJson(request);
    if (body?.action === "load") {
      const snap = await db.get(CONFIG);
      return json(request, env, {
        ok: true, config: voiceConfigState(snap.data || {}, env),
      });
    }
    if (body?.action === "save") {
      // Viewing a policy should stay easy; sensitive changes still require
      // recent authentication so a long-lived admin tab cannot silently save.
      const age = Math.floor(Date.now() / 1000) - actor.authTime;
      if (!Number.isFinite(age) || age < 0 || age > 1800) {
        throw new ControlError("recent_auth_required", 401);
      }
      const result = await writeVoiceConfig(db, actor.uid, body, env);
      return json(request, env, result);
    }
    throw new ControlError("invalid_action");
  } catch (error) {
    if (error instanceof ControlError) {
      return json(request, env, { ok: false, code: error.code }, error.status);
    }
    const quota = firestoreQuotaResponse(request, env, error);
    if (quota) return quota;
    if (clean(error?.message) === "unauthorized") {
      return json(request, env, { ok: false, code: "unauthorized" }, 401);
    }
    return json(request, env, { ok: false, code: "private_voice_control_failed" }, 500);
  }
}
