import { json, readJson } from "./http.js";
import { verifyFirebaseIdToken } from "./firebase-auth.js";
import { firestoreClient } from "./firestore.js";

class ApiError extends Error {
  constructor(code, status = 400) { super(code); this.code = code; this.status = status; }
}
const clean = (v) => String(v ?? "").trim();
const validKey = (v) => /^[A-Za-z0-9_-]{12,160}$/.test(clean(v));
const randomId = (prefix) => `${prefix}_${crypto.randomUUID().replace(/-/g, "")}`;

async function execute(db, actorUid, body) {
  const targetUid = clean(body.targetUid);
  const enabled = body.enabled === true;
  const reason = clean(body.reason);
  const key = clean(body.idempotencyKey);

  for (let attempt = 0; attempt < 3; attempt++) {
    const transaction = await db.beginTransaction();
    try {
      const [actorSnap, opSnap, targetSnap] = await Promise.all([
        db.get(`users/${actorUid}`, transaction),
        db.get(`control_operations/${key}`, transaction),
        db.get(`users/${targetUid}`, transaction),
      ]);

      const actor = actorSnap.data || {};
      if (!actorSnap.exists || actor.adminEnabled !== true || actor.role !== "owner") {
        await db.rollback(transaction);
        throw new ApiError("forbidden", 403);
      }

      if (opSnap.exists) {
        await db.rollback(transaction);
        return { ok: true, code: "duplicate", operationId: key, ...(opSnap.data?.result || {}) };
      }

      if (!targetSnap.exists) {
        await db.rollback(transaction);
        throw new ApiError("not_found", 404);
      }

      const target = targetSnap.data || {};
      if (target.role === "owner") {
        await db.rollback(transaction);
        throw new ApiError("owner_protected", 409);
      }

      const current = Array.isArray(target.capabilities)
        ? target.capabilities.map(String)
        : [];
      const next = enabled
        ? [...new Set([...current, "manageIds"])]
        : current.filter((value) => value !== "manageIds");
      const createdAt = new Date();
      const resultData = { targetUid, enabled };

      const targetFields = {
        capabilities: next,
        updatedAt: createdAt,
        ...(enabled ? { adminEnabled: true } : {}),
      };
      const targetMask = ["capabilities", "updatedAt", ...(enabled ? ["adminEnabled"] : [])];

      await db.commit(transaction, [
        db.writeUpdate(`users/${targetUid}`, targetFields, targetMask),
        db.writeCreate(`admin_audit_logs/${randomId("admin")}`, {
          actorUid,
          action: enabled ? "grantManageIds" : "revokeManageIds",
          targetType: "user",
          targetId: targetUid,
          reason,
          before: { manageIds: current.includes("manageIds") },
          after: { manageIds: enabled },
          operationId: key,
          createdAt,
        }),
        db.writeCreate(`control_operations/${key}`, {
          action: "setIdManagementPermission",
          actorUid,
          targetId: targetUid,
          status: "completed",
          result: resultData,
          createdAt,
        }),
      ]);

      return { ok: true, code: "ok", operationId: key, ...resultData };
    } catch (error) {
      await db.rollback(transaction);
      if (error instanceof ApiError) throw error;
      if ((error?.message === "ABORTED" || error?.status === 409) && attempt < 2) continue;
      throw error;
    }
  }
  throw new ApiError("transaction_failed", 500);
}

export async function setIdManagementPermission(request, env) {
  if (request.method !== "POST") {
    return json(request, env, { ok: false, code: "method_not_allowed" }, 405);
  }
  try {
    const decoded = await verifyFirebaseIdToken(request, env);
    const authAge = Math.floor(Date.now() / 1000) - Number(decoded.auth_time || 0);
    if (!Number.isFinite(authAge) || authAge > 1800) {
      throw new ApiError("recent_auth_required", 401);
    }

    const body = await readJson(request);
    const targetUid = clean(body.targetUid);
    const reason = clean(body.reason);
    const key = clean(body.idempotencyKey);
    if (!targetUid || targetUid === decoded.sub || reason.length < 3 || reason.length > 160 || !validKey(key)) {
      throw new ApiError("invalid_request", 400);
    }

    const result = await execute(firestoreClient(env), decoded.sub, body);
    return json(request, env, result, 200);
  } catch (error) {
    if (error instanceof ApiError) return json(request, env, { ok: false, code: error.code }, error.status);
    const raw = clean(error?.message);
    if (raw === "unauthorized") return json(request, env, { ok: false, code: "unauthorized" }, 401);
    if (raw === "server_not_configured" || raw === "invalid_service_account_json") {
      return json(request, env, { ok: false, code: raw }, 503);
    }
    return json(request, env, { ok: false, code: "server_transaction_failed" }, 500);
  }
}
