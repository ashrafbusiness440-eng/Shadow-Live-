import { json, readJson } from "./http.js";
import { verifyFirebaseIdToken } from "./firebase-auth.js";
import { firestoreClient } from "./firestore.js";

class ApiError extends Error {
  constructor(code, status = 400) {
    super(code);
    this.code = code;
    this.status = status;
  }
}

function clean(value) {
  return String(value ?? "").trim();
}

function randomId(prefix = "audit") {
  return `${prefix}_${crypto.randomUUID().replace(/-/g, "")}`;
}

function isRetryable(error) {
  return error?.message === "ABORTED" || error?.status === 409;
}

async function runAdjustment(db, actorUid, body) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const transaction = await db.beginTransaction();
    try {
      const targetId = clean(body.targetId);
      const asset = clean(body.asset);
      const reason = clean(body.reason);
      const key = clean(body.idempotencyKey);
      const delta = Number(body.delta);

      const [actorSnap, opSnap, userSnap, lockSnap] = await Promise.all([
        db.get(`users/${actorUid}`, transaction),
        db.get(`control_operations/${key}`, transaction),
        db.get(`users/${targetId}`, transaction),
        db.get("system_config/emergency_lock", transaction),
      ]);

      const actor = actorSnap.data || {};
      const capabilities = Array.isArray(actor.capabilities) ? actor.capabilities : [];
      const canAdjust =
        actorSnap.exists &&
        (actor.role === "owner" ||
          (actor.adminEnabled === true && capabilities.includes("adjustBalances")));

      if (!canAdjust) {
        await db.rollback(transaction);
        throw new ApiError("forbidden", 403);
      }

      if (opSnap.exists) {
        await db.rollback(transaction);
        return { ok: true, code: "duplicate", operationId: key };
      }

      const lock = lockSnap.data || {};
      if (lock.enabled === true || lock.economyLocked === true) {
        await db.rollback(transaction);
        throw new ApiError("emergency_locked", 409);
      }

      if (!userSnap.exists) {
        await db.rollback(transaction);
        throw new ApiError("not_found", 404);
      }

      const before = Number(userSnap.data?.[asset] || 0);
      const after = before + delta;
      if (after < 0) {
        await db.rollback(transaction);
        throw new ApiError("insufficient_balance", 409);
      }

      const createdAt = new Date();
      const auditId = randomId("admin");
      const writes = [
        db.writeUpdate(`users/${targetId}`, { [asset]: after }, [asset]),
        db.writeCreate(`financial_ledger/${key}`, {
          userId: targetId,
          asset,
          delta,
          openingBalance: before,
          closingBalance: after,
          reason,
          sourceType: "adminAdjustment",
          sourceId: key,
          actorUid,
          idempotencyKey: key,
          createdAt,
        }),
        db.writeCreate(`admin_audit_logs/${auditId}`, {
          actorUid,
          action: "adjustBalance",
          targetType: "user",
          targetId,
          reason,
          before: { [asset]: before },
          after: { [asset]: after },
          operationId: key,
          createdAt,
        }),
        db.writeCreate(`control_operations/${key}`, {
          action: "adjustBalance",
          actorUid,
          targetId,
          status: "completed",
          createdAt,
        }),
      ];

      await db.commit(transaction, writes);
      return {
        ok: true,
        code: "ok",
        operationId: key,
        before,
        after,
      };
    } catch (error) {
      await db.rollback(transaction);
      if (error instanceof ApiError) throw error;
      if (isRetryable(error) && attempt < 2) continue;
      throw error;
    }
  }
  throw new ApiError("transaction_failed", 500);
}

export async function adjustBalance(request, env) {
  if (request.method === "GET") {
    return json(request, env, {
      ok: true,
      service: "shadow-control-api",
      provider: "cloudflare-workers",
      firebaseConfigured: Boolean(String(env.FIREBASE_SERVICE_ACCOUNT || "").trim()),
    });
  }

  if (request.method !== "POST") {
    return json(request, env, { ok: false, code: "method_not_allowed" }, 405);
  }

  try {
    const body = await readJson(request);
    const targetId = clean(body.targetId);
    const asset = clean(body.asset);
    const reason = clean(body.reason);
    const key = clean(body.idempotencyKey);
    const delta = Number(body.delta);

    if (
      !targetId ||
      !["coins", "diamonds"].includes(asset) ||
      !Number.isFinite(delta) ||
      delta === 0 ||
      Math.abs(delta) > 1_000_000_000 ||
      reason.length < 3 ||
      !/^[A-Za-z0-9_-]{12,160}$/.test(key)
    ) {
      throw new ApiError("invalid_request", 400);
    }

    const decoded = await verifyFirebaseIdToken(request, env);
    const db = firestoreClient(env);
    const result = await runAdjustment(db, decoded.sub, body);
    return json(request, env, result, 200);
  } catch (error) {
    if (error instanceof ApiError) {
      return json(request, env, { ok: false, code: error.code }, error.status);
    }
    const raw = clean(error?.message);
    if (raw === "unauthorized") {
      return json(request, env, { ok: false, code: "unauthorized" }, 401);
    }
    if (raw === "server_not_configured" || raw === "invalid_service_account_json") {
      return json(request, env, { ok: false, code: raw }, 503);
    }
    return json(request, env, { ok: false, code: "server_adjust_balance_failed" }, 500);
  }
}
