import { json, readJson } from "./http.js";
import {
  assertUserDocumentSessionState,
  verifyFirebaseIdToken,
} from "./firebase-auth.js";
import { firestoreClient } from "./firestore.js";

class ApiError extends Error {
  constructor(code, status = 400) { super(code); this.code = code; this.status = status; }
}

const clean = (value) => String(value ?? "").trim();
const validKey = (value) => /^[A-Za-z0-9_-]{12,160}$/.test(clean(value));

const ALLOWED_ROLES = new Set(["user", "moderator", "admin", "super_admin"]);
const ALLOWED_CAPABILITIES = new Set([
  "viewDashboard",
  "viewUsers",
  "manageUsers",
  "viewReports",
  "reviewReports",
  "muteUsers",
  "suspendUsers",
  "permanentBan",
  "manageRooms",
  "globalRoomControl",
  "canCreateHiddenRoom",
  "manageAgencies",
  "manageVip",
  "manageSpecialIds",
  "manageIds",
  "manageStore",
  "manageGames",
  "manageEconomy",
  "adjustBalances",
  "manageWithdrawals",
  "manageSettlements",
  "manageCampaigns",
  "manageRoles",
  "viewAuditLog",
  "emergencyLock",
]);

function normalizeCapabilities(value) {
  if (!Array.isArray(value) || value.length > 40) throw new ApiError("invalid_request", 400);
  const next = [...new Set(value.map(clean).filter(Boolean))].sort();
  if (next.some((capability) => !ALLOWED_CAPABILITIES.has(capability))) {
    throw new ApiError("invalid_capability", 400);
  }
  return next;
}

async function execute(db, actorPayload, body) {
  const actorUid = clean(actorPayload?.sub);
  const targetUid = clean(body.targetUid);
  const role = clean(body.role);
  const adminEnabled = body.adminEnabled === true;
  const capabilities = normalizeCapabilities(body.capabilities);
  const reason = clean(body.reason);
  const key = clean(body.idempotencyKey);

  for (let attempt = 0; attempt < 3; attempt++) {
    const transaction = await db.beginTransaction();
    try {
      const [actorSnap, operationSnap, targetSnap] = await Promise.all([
        db.get(`users/${actorUid}`, transaction),
        db.get(`control_operations/${key}`, transaction),
        db.get(`users/${targetUid}`, transaction),
      ]);

      const actor = actorSnap.data || {};
      if (actorSnap.exists) {
        assertUserDocumentSessionState(actorPayload, actor);
      }
      if (!actorSnap.exists || actor.role !== "owner" || actor.adminEnabled !== true) {
        await db.rollback(transaction);
        throw new ApiError("forbidden", 403);
      }

      if (operationSnap.exists) {
        await db.rollback(transaction);
        return {
          ok: true,
          code: "duplicate",
          operationId: key,
          ...(operationSnap.data?.result || {}),
        };
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

      const beforeCapabilities = Array.isArray(target.capabilities)
        ? [...new Set(target.capabilities.map(clean).filter(Boolean))].sort()
        : [];
      const before = {
        role: clean(target.role || "user") || "user",
        adminEnabled: target.adminEnabled === true,
        capabilities: beforeCapabilities,
      };
      const after = { role, adminEnabled, capabilities };
      const updatedAt = new Date();
      const resultData = {
        targetUid,
        role,
        adminEnabled,
        capabilities,
      };

      await db.commit(transaction, [
        db.writeUpdate(
          `users/${targetUid}`,
          { role, adminEnabled, capabilities, updatedAt },
          ["role", "adminEnabled", "capabilities", "updatedAt"],
        ),
        db.writeCreate(`admin_audit_logs/admin_${key}`, {
          actorUid,
          action: "setUserAccess",
          targetType: "user",
          targetId: targetUid,
          reason,
          before,
          after,
          operationId: key,
          createdAt: updatedAt,
        }),
        db.writeCreate(`control_operations/${key}`, {
          action: "manageUserAccess",
          actorUid,
          targetId: targetUid,
          status: "completed",
          result: resultData,
          createdAt: updatedAt,
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

export async function manageUserAccess(request, env) {
  if (request.method !== "POST") {
    return json(request, env, { ok: false, code: "method_not_allowed" }, 405);
  }

  try {
    const decoded = await verifyFirebaseIdToken(request, env, {
      checkUserState: false,
    });
    const authAge = Math.floor(Date.now() / 1000) - Number(decoded.auth_time || 0);
    if (!Number.isFinite(authAge) || authAge > 1800) {
      throw new ApiError("recent_auth_required", 401);
    }

    const body = await readJson(request);
    const targetUid = clean(body.targetUid);
    const role = clean(body.role);
    const reason = clean(body.reason);
    const key = clean(body.idempotencyKey);

    if (
      !targetUid ||
      targetUid === decoded.sub ||
      !ALLOWED_ROLES.has(role) ||
      typeof body.adminEnabled !== "boolean" ||
      reason.length < 3 ||
      reason.length > 160 ||
      !validKey(key)
    ) {
      throw new ApiError("invalid_request", 400);
    }

    normalizeCapabilities(body.capabilities);
    const result = await execute(firestoreClient(env), decoded, body);
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
    return json(request, env, { ok: false, code: "server_transaction_failed" }, 500);
  }
}
