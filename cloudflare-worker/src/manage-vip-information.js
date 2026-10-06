import { json, readJson } from "./http.js";
import {
  assertUserDocumentSessionState,
  verifyFirebaseIdToken,
} from "./firebase-auth.js";
import {
  firestoreClient,
  firestoreErrorRetryDelayMs,
  isTransientFirestoreError,
} from "./firestore.js";
import {
  invalidateVipPolicyCache,
  loadVipPolicy,
  normalizeVipQuickPurchaseOffers,
} from "./vip-policy.js";

class ApiError extends Error {
  constructor(code, status = 400) {
    super(code);
    this.code = code;
    this.status = status;
  }
}

const clean = (value) => String(value ?? "").trim();
const validKey = (value) => /^[A-Za-z0-9_-]{12,160}$/.test(clean(value));

function actorCapabilities(actor = {}) {
  return new Set(
    Array.isArray(actor.capabilities)
      ? actor.capabilities.map(clean).filter(Boolean)
      : [],
  );
}

export function canManageVipInformation(actor = {}) {
  if (clean(actor.role) === "owner") return true;
  if (actor.adminEnabled !== true) return false;
  const role = clean(actor.role);
  if (role !== "admin" && role !== "super_admin") return false;
  return actorCapabilities(actor).has("manageVipPolicy");
}

function publicOffers(policy) {
  return (Array.isArray(policy.quickPurchaseOffers)
    ? policy.quickPurchaseOffers
    : []
  ).map((item) => ({
    id: clean(item.id),
    labelAr: clean(item.labelAr),
    growthPoints: Number(item.growthPoints || 0),
    baseCoinCost: Number(item.baseCoinCost || 0),
    finalCoinCost: Number(item.finalCoinCost || 0),
    discountBps: Number(item.discountBps || 0),
    enabled: item.enabled !== false,
    sortOrder: Number(item.sortOrder || 0),
  }));
}

async function loadActor(db, payload, transaction = null) {
  const uid = clean(payload?.sub);
  if (!uid) throw new ApiError("unauthorized", 401);
  const snap = await db.get(`users/${uid}`, transaction);
  if (!snap.exists) throw new ApiError("forbidden", 403);
  const actor = snap.data || {};
  assertUserDocumentSessionState(payload, actor);
  if (!canManageVipInformation(actor)) throw new ApiError("forbidden", 403);
  return { uid, actor };
}

export async function vipInformationControlState(db, payload) {
  await loadActor(db, payload);
  const policy = await loadVipPolicy(db, { useCache: false });
  return {
    ok: true,
    code: "ok",
    purchasedGrowthPerCoin: Number(policy.purchasedGrowthPerCoin || 3),
    quickPurchaseOffers: publicOffers(policy),
  };
}

export async function saveVipQuickPurchaseOffers(db, payload, body) {
  const key = clean(body.idempotencyKey);
  const reason = clean(body.reason);
  const rawOffers = body.quickPurchaseOffers;
  if (
    !validKey(key) ||
    reason.length > 160 ||
    !Array.isArray(rawOffers) ||
    rawOffers.length > 8
  ) {
    throw new ApiError("invalid_request", 400);
  }

  for (let attempt = 0; attempt < 3; attempt += 1) {
    let transaction = null;
    try {
      transaction = await db.beginTransaction();
      const [{ uid: actorUid }, operationSnap, configSnap, policy] =
        await Promise.all([
          loadActor(db, payload, transaction),
          db.get(`control_operations/${key}`, transaction),
          db.get("system_config/vip", transaction),
          loadVipPolicy(db, { transaction, useCache: false }),
        ]);

      if (operationSnap.exists) {
        await db.rollback(transaction);
        return {
          ok: true,
          code: "duplicate",
          operationId: key,
          ...(operationSnap.data?.result || {}),
        };
      }

      const normalized = normalizeVipQuickPurchaseOffers(
        rawOffers,
        policy.purchasedGrowthPerCoin,
      );
      if (normalized.length !== rawOffers.length) {
        await db.rollback(transaction);
        throw new ApiError("invalid_vip_quick_offers", 400);
      }

      const before = publicOffers(policy);
      const stored = normalized.map((item) => ({
        id: item.id,
        labelAr: item.labelAr,
        growthPoints: item.growthPoints,
        baseCoinCost: item.baseCoinCost,
        enabled: item.enabled,
        sortOrder: item.sortOrder,
      }));
      const now = new Date();
      const result = {
        quickPurchaseOffers: normalized,
        purchasedGrowthPerCoin: Number(policy.purchasedGrowthPerCoin || 3),
      };

      const configPath = "system_config/vip";
      const configWrite = configSnap.exists
        ? db.writeUpdate(
            configPath,
            {
              quickPurchaseOffers: stored,
              updatedAt: now,
              updatedBy: actorUid,
            },
            ["quickPurchaseOffers", "updatedAt", "updatedBy"],
          )
        : db.writeCreate(configPath, {
            quickPurchaseOffers: stored,
            updatedAt: now,
            updatedBy: actorUid,
          });

      await db.commit(transaction, [
        configWrite,
        db.writeCreate(`admin_audit_logs/vip_info_${key}`, {
          actorId: actorUid,
          actorUid,
          targetType: "vip_policy",
          targetId: "quickPurchaseOffers",
          action: "setVipQuickPurchaseOffers",
          before,
          after: normalized,
          reason: reason || null,
          timestamp: now,
          createdAt: now,
          operationId: key,
        }),
        db.writeCreate(`control_operations/${key}`, {
          action: "manageVipInformation",
          actorUid,
          targetId: "system_config/vip",
          status: "completed",
          result,
          createdAt: now,
        }),
      ]);

      invalidateVipPolicyCache();
      return {
        ok: true,
        code: "ok",
        operationId: key,
        ...result,
      };
    } catch (error) {
      if (transaction) await db.rollback(transaction).catch(() => {});
      if (error instanceof ApiError) throw error;
      if (attempt < 2 && isTransientFirestoreError(error)) {
        await new Promise((resolve) =>
          setTimeout(resolve, firestoreErrorRetryDelayMs(attempt))
        );
        continue;
      }
      throw error;
    }
  }

  throw new ApiError("transaction_failed", 500);
}

export async function manageVipInformation(request, env) {
  if (request.method !== "POST") {
    return json(request, env, { ok: false, code: "method_not_allowed" }, 405);
  }
  try {
    const payload = await verifyFirebaseIdToken(request, env, {
      checkUserState: false,
    });
    const authAge = Math.floor(Date.now() / 1000) - Number(payload.auth_time || 0);
    if (!Number.isFinite(authAge) || authAge > 1800) {
      throw new ApiError("recent_auth_required", 401);
    }
    const body = await readJson(request);
    const action = clean(body.action);
    const db = firestoreClient(env);
    if (action === "state") {
      return json(request, env, await vipInformationControlState(db, payload), 200);
    }
    if (action === "saveQuickOffers") {
      return json(
        request,
        env,
        await saveVipQuickPurchaseOffers(db, payload, body),
        200,
      );
    }
    throw new ApiError("invalid_action", 400);
  } catch (error) {
    if (error instanceof ApiError) {
      return json(request, env, { ok: false, code: error.code }, error.status);
    }
    const raw = clean(error?.message);
    if (raw === "unauthorized") {
      return json(request, env, { ok: false, code: raw }, 401);
    }
    if (raw === "server_not_configured" || raw === "invalid_service_account_json") {
      return json(request, env, { ok: false, code: raw }, 503);
    }
    return json(request, env, { ok: false, code: "server_vip_info_failed" }, 500);
  }
}

export const vipInformationControlInternals = Object.freeze({
  canManageVipInformation,
  vipInformationControlState,
  saveVipQuickPurchaseOffers,
});
