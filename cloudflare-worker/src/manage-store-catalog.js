import {json, readJson} from "./http.js";
import {assertUserDocumentSessionState, verifyFirebaseIdToken} from "./firebase-auth.js";
import {firestoreClient, isTransientFirestoreError, firestoreErrorRetryDelayMs} from "./firestore.js";
import {STORE_CATEGORIES, STORE_DURATIONS, validateStoreCatalogUpdate} from "./store-catalog-policy.js";

const clean = (value) => String(value ?? "").trim();
const CONFIG_PATH = "system_config/store_catalog";
const MAX_RETRIES = 3;

class StoreCatalogError extends Error {
  constructor(code, status = 400) { super(code); this.code = code; this.status = status; }
}

export function canManageStoreCatalog(user = {}) {
  if (user.role === "owner") return true;
  return user.adminEnabled === true &&
    (user.role === "admin" || user.role === "super_admin") &&
    Array.isArray(user.capabilities) &&
    user.capabilities.includes("manageStore");
}

async function readActor(db, payload, tx = null) {
  const uid = clean(payload?.sub);
  if (!uid) throw new StoreCatalogError("unauthorized", 401);
  const snap = await db.get("users/" + uid, tx);
  if (!snap.exists) throw new StoreCatalogError("forbidden", 403);
  assertUserDocumentSessionState(payload, snap.data || {});
  if (!canManageStoreCatalog(snap.data || {})) {
    throw new StoreCatalogError("forbidden", 403);
  }
  return uid;
}

async function loadState(db, token) {
  await readActor(db, token);
  const snap = await db.get(CONFIG_PATH);
  return {
    ok: true, revision: Number(snap.data?.revision ?? 0),
    items: Array.isArray(snap.data?.items) ? snap.data.items : [],
    categories: STORE_CATEGORIES,
    durations: STORE_DURATIONS,
    purchasingEnabled: false,
    note: "catalog_preparation_only",
  };
}

async function saveCatalog(db, payload, body) {
  const key = clean(body?.operationId);
  if (!/^[A-Za-z0-9_-]{12,100}$/.test(key)) {
    throw new StoreCatalogError("invalid_operation_id", 400);
  }
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    let tx = null;
    try {
      tx = await db.beginTransaction();
      const [uid, config, previousOperation] = await Promise.all([
        readActor(db, payload, tx),
        db.get(CONFIG_PATH, tx),
        db.get("control_operations/store_catalog_" + key, tx),
      ]);
      if (previousOperation.exists) {
        if (previousOperation.data?.actorUid !== uid) {
          throw new StoreCatalogError("operation_id_conflict", 409);
        }
        await db.rollback(tx);
        tx = null;
        return {ok: true, duplicate: true, ...(previousOperation.data.result || {})};
      }
      let result;
      try {
        result = validateStoreCatalogUpdate(config.data || {}, body.items,
          body.expectedRevision);
      } catch (error) {
        const code = clean(error?.message);
        throw new StoreCatalogError(code, code.includes("conflict") ? 409 : 400);
      }
      const now = new Date();
      const next = {
        revision: result.revision, items: result.items,
        updatedAt: now, updatedBy: uid,
        // Catalog editing never activates paid transactions or entitlements.
        purchasingEnabled: false,
      };
      const configWrite = config.exists
        ? db.writeUpdate(CONFIG_PATH, next,
          ["revision","items","updatedAt","updatedBy","purchasingEnabled"])
        : db.writeCreate(CONFIG_PATH, next);
      const response = {revision: result.revision, items: result.items,
        purchasingEnabled: false};
      await db.commit(tx, [
        configWrite,
        db.writeCreate("admin_audit_logs/store_catalog_" + key, {
          actorId: uid, actorUid: uid, targetType: "store_catalog",
          targetId: "system_config/store_catalog", action: "saveStoreCatalog",
          changedIds: result.changedIds.slice(0,100),
          fromRevision: Number(config.data?.revision ?? 0),
          toRevision: result.revision, createdAt: now,
          timestamp: now, operationId: key,
        }),
        db.writeCreate("control_operations/store_catalog_" + key, {
          actorUid: uid, action: "saveStoreCatalog", status: "completed",
          result: response, createdAt: now,
        }),
      ]);
      tx = null;
      return {ok: true, ...response};
    } catch (error) {
      if (tx) await db.rollback(tx).catch(() => {});
      if (error instanceof StoreCatalogError) throw error;
      if (attempt < MAX_RETRIES - 1 && isTransientFirestoreError(error)) {
        await new Promise(resolve =>
          setTimeout(resolve, firestoreErrorRetryDelayMs(attempt)));
        continue;
      }
      throw error;
    }
  }
  throw new StoreCatalogError("transaction_failed", 500);
}

export async function manageStoreCatalog(request, env) {
  if (request.method !== "POST") {
    return json(request, env, {ok: false, code: "method_not_allowed"}, 405);
  }
  try {
    const token = await verifyFirebaseIdToken(request, env,
      {checkUserState: false});
    const body = await readJson(request);
    const db = firestoreClient(env);
    const action = clean(body?.action);
    if (action === "state") {
      return json(request, env, await loadState(db, token), 200);
    }
    if (action === "save") {
      const age = Math.floor(Date.now() / 1000) - Number(token.auth_time || 0);
      if (!Number.isFinite(age) || age < 0 || age > 1800) {
        throw new StoreCatalogError("recent_auth_required", 401);
      }
      return json(request, env, await saveCatalog(db, token, body), 200);
    }
    throw new StoreCatalogError("invalid_action", 400);
  } catch (error) {
    if (error instanceof StoreCatalogError) {
      return json(request, env, {ok: false, code: error.code}, error.status);
    }
    const code = clean(error?.message);
    if (code === "unauthorized" || code === "forbidden") {
      return json(request, env, {ok: false, code}, code === "unauthorized" ? 401 : 403);
    }
    return json(request, env, {ok: false, code: "store_catalog_server_failed"}, 500);
  }
}

export const storeCatalogInternals = Object.freeze({canManageStoreCatalog, loadState, saveCatalog});
