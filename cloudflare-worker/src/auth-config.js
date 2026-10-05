import { firestoreQuotaResponse, json, readJson } from "./http.js";
import {
  assertUserDocumentSessionState,
  verifyFirebaseIdToken,
} from "./firebase-auth.js";
import { firestoreClient } from "./firestore.js";
import {
  invalidateConfigCache,
  primeConfigCache,
  readThroughConfigCache,
} from "./config-cache.js";

const CONFIG_PATH = "system_config/auth_login";
const CACHE_KEY = "config:auth_login";
const PROVIDER_KEYS = Object.freeze([
  "email",
  "google",
  "guest",
  "phone",
  "facebook",
  "apple",
]);

export const AUTH_LOGIN_DEFAULTS = Object.freeze({
  providers: Object.freeze({
    email: true,
    google: true,
    guest: true,
    phone: false,
    facebook: false,
    apple: false,
  }),
  optionalAccountLinking: false,
});

const clean = (value) => String(value ?? "").trim();

class ApiError extends Error {
  constructor(code, status = 400) {
    super(code);
    this.code = code;
    this.status = status;
  }
}

function normalizeConfig(source = {}) {
  const rawProviders =
    source.providers && typeof source.providers === "object"
      ? source.providers
      : {};
  const providers = {};
  for (const key of PROVIDER_KEYS) {
    providers[key] =
      typeof rawProviders[key] === "boolean"
        ? rawProviders[key]
        : AUTH_LOGIN_DEFAULTS.providers[key];
  }
  return {
    providers,
    optionalAccountLinking:
      typeof source.optionalAccountLinking === "boolean"
        ? source.optionalAccountLinking
        : AUTH_LOGIN_DEFAULTS.optionalAccountLinking,
  };
}

function validateConfigInput(source = {}) {
  if (!source || typeof source !== "object") {
    throw new ApiError("invalid_request", 400);
  }
  const providers = source.providers;
  if (!providers || typeof providers !== "object") {
    throw new ApiError("invalid_request", 400);
  }
  for (const key of PROVIDER_KEYS) {
    if (typeof providers[key] !== "boolean") {
      throw new ApiError("invalid_request", 400);
    }
  }
  if (typeof source.optionalAccountLinking !== "boolean") {
    throw new ApiError("invalid_request", 400);
  }
  if (!PROVIDER_KEYS.some((key) => providers[key] === true)) {
    throw new ApiError("at_least_one_provider_required", 409);
  }
  return normalizeConfig(source);
}

async function loadConfig(db, { useCache = true } = {}) {
  const loader = async () => {
    const snap = await db.get(CONFIG_PATH);
    return normalizeConfig(snap.exists ? snap.data || {} : {});
  };
  return useCache
    ? readThroughConfigCache(CACHE_KEY, loader, {
        ttlMs: 30_000,
        staleMs: 5 * 60_000,
      })
    : loader();
}

function canManageAuthConfig(actor = {}) {
  if (actor.role === "owner") return true;
  if (actor.adminEnabled !== true) return false;
  const capabilities = Array.isArray(actor.capabilities)
    ? actor.capabilities.map(clean)
    : [];
  return capabilities.includes("manageSystem");
}

function validOperationKey(value) {
  return /^[A-Za-z0-9_-]{12,180}$/.test(clean(value));
}

async function updateConfig(request, env, db) {
  const decoded = await verifyFirebaseIdToken(request, env, {
    checkUserState: false,
  });
  const authAge =
    Math.floor(Date.now() / 1000) - Number(decoded.auth_time || 0);
  if (!Number.isFinite(authAge) || authAge > 1800) {
    throw new ApiError("recent_auth_required", 401);
  }

  const actorSnap = await db.get(`users/${decoded.sub}`);
  if (!actorSnap.exists) throw new ApiError("forbidden", 403);
  const actor = actorSnap.data || {};
  assertUserDocumentSessionState(decoded, actor);
  if (!canManageAuthConfig(actor)) throw new ApiError("forbidden", 403);

  const body = await readJson(request);
  const reason = clean(body.reason);
  const operationId = clean(body.idempotencyKey);
  if (
    clean(body.action) !== "update" ||
    reason.length < 3 ||
    reason.length > 180 ||
    !validOperationKey(operationId)
  ) {
    throw new ApiError("invalid_request", 400);
  }

  const operationPath = `control_operations/${operationId}`;
  const duplicate = await db.get(operationPath);
  if (duplicate.exists) {
    return {
      ok: true,
      code: "duplicate",
      ...(duplicate.data?.result || {}),
    };
  }

  const next = validateConfigInput(body.config);
  const current = await loadConfig(db, { useCache: false });
  const now = new Date();
  const result = {
    config: next,
    updatedAt: now,
  };

  await db.commit(null, [
    db.writeUpdate(CONFIG_PATH, {
      ...next,
      updatedBy: decoded.sub,
      updatedAt: now,
    }),
    db.writeCreate(`admin_audit_logs/auth_login_${operationId}`, {
      actorUid: decoded.sub,
      action: "updateAuthLoginConfig",
      targetType: "system_config",
      targetId: "auth_login",
      reason,
      before: current,
      after: next,
      operationId,
      createdAt: now,
    }),
    db.writeCreate(operationPath, {
      action: "updateAuthLoginConfig",
      actorUid: decoded.sub,
      targetId: "auth_login",
      status: "completed",
      result,
      createdAt: now,
    }),
  ]);

  invalidateConfigCache(CACHE_KEY);
  primeConfigCache(CACHE_KEY, next, {
    ttlMs: 30_000,
    staleMs: 5 * 60_000,
  });

  return { ok: true, code: "ok", ...result };
}

export async function authConfig(request, env) {
  if (!["GET", "POST"].includes(request.method)) {
    return json(request, env, { ok: false, code: "method_not_allowed" }, 405);
  }

  try {
    const db = firestoreClient(env);
    if (request.method === "GET") {
      const config = await loadConfig(db);
      return json(
        request,
        env,
        { ok: true, config },
        200,
        { "Cache-Control": "public, max-age=30, s-maxage=60" },
      );
    }

    const result = await updateConfig(request, env, db);
    return json(request, env, result, 200);
  } catch (error) {
    if (error instanceof ApiError) {
      return json(request, env, { ok: false, code: error.code }, error.status);
    }
    const quota = firestoreQuotaResponse(request, env, error);
    if (quota) return quota;
    const raw = clean(error?.message);
    if (raw === "unauthorized") {
      return json(request, env, { ok: false, code: "unauthorized" }, 401);
    }
    if (
      raw === "server_not_configured" ||
      raw === "invalid_service_account_json"
    ) {
      return json(request, env, { ok: false, code: raw }, 503);
    }
    return json(request, env, { ok: false, code: "auth_config_failed" }, 500);
  }
}

export const authConfigInternals = Object.freeze({
  normalizeConfig,
  validateConfigInput,
  canManageAuthConfig,
  loadConfig,
});
