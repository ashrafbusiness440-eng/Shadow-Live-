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

class ApiError extends Error {
  constructor(code, status = 400) { super(code); this.code = code; this.status = status; }
}

const clean = (value) => String(value ?? "").trim();
const validKey = (value) => /^[A-Za-z0-9_-]{12,160}$/.test(clean(value));

const ALLOWED_ROLES = new Set(["user", "moderator", "admin", "super_admin"]);
const LEVEL_CAPABILITIES = new Set([
  "manageUserLevels",
  "manageWealthLevel",
  "manageAttractionLevel",
  "manageGameLevel",
  "manageVipLevels",
  "manageVipPolicy",
]);

const ALLOWED_CAPABILITIES = new Set([
  "viewDashboard",
  "viewSystemHealth",
  "viewUsers",
  "manageUsers",
  "viewHiddenUserLevels",
  "manageUserLevels",
  "manageWealthLevel",
  "manageAttractionLevel",
  "manageGameLevel",
  "viewReports",
  "reviewReports",
  "manageDiaries",
  "deleteDiaryComment",
  "muteUsers",
  "suspendUsers",
  "permanentBan",
  "manageRooms",
  "globalRoomControl",
  "canCreateHiddenRoom",
  "manageAgencies",
  "reviewAgencyApplications",
  "manageAgencyMemberships",
  "manageAgencyManagers",
  "viewAgencyFinance",
  "manageAgencyPolicies",
  "manageAgencySettlements",
  "suspendAgencies",
  "manageAgencyPackages",
  "grantAgencyPackage",
  "manageVip",
  "manageVipLevels",
  "manageVipPolicy",
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
  if (!Array.isArray(value) || value.length > 48) throw new ApiError("invalid_request", 400);
  const next = [...new Set(value.map(clean).filter(Boolean))].sort();
  if (next.some((capability) => !ALLOWED_CAPABILITIES.has(capability))) {
    throw new ApiError("invalid_capability", 400);
  }
  return next;
}

function normalizeAllowedVipGrantLevels(value) {
  if (!Array.isArray(value) || value.length > 10) {
    throw new ApiError("invalid_vip_grant_levels", 400);
  }
  const levels = value.map(Number);
  if (levels.some((level) => !Number.isInteger(level) || level < 1 || level > 10)) {
    throw new ApiError("invalid_vip_grant_levels", 400);
  }
  return [...new Set(levels)].sort((a, b) => a - b);
}

async function execute(db, actorPayload, body) {
  const actorUid = clean(actorPayload?.sub);
  const targetUid = clean(body.targetUid);
  const role = clean(body.role);
  const adminEnabled = body.adminEnabled === true;
  const capabilities = normalizeCapabilities(body.capabilities);
  if (
    capabilities.some((capability) => LEVEL_CAPABILITIES.has(capability)) &&
    role !== "admin" &&
    role !== "super_admin"
  ) {
    throw new ApiError("invalid_level_capability_role", 400);
  }
  const hasRequestedVipGrantLevels = Object.prototype.hasOwnProperty.call(
    body,
    "allowedVipGrantLevels",
  );
  const requestedVipGrantLevels = hasRequestedVipGrantLevels
    ? normalizeAllowedVipGrantLevels(body.allowedVipGrantLevels)
    : null;
  const reason = clean(body.reason);
  const key = clean(body.idempotencyKey);

  const maxAttempts = 3;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    let transaction = null;
    try {
      transaction = await db.beginTransaction();
      const [actorSnap, operationSnap, targetSnap] = await Promise.all([
        db.get(`users/${actorUid}`, transaction),
        db.get(`control_operations/${key}`, transaction),
        db.get(`users/${targetUid}`, transaction),
      ]);

      const actor = actorSnap.data || {};
      if (actorSnap.exists) {
        assertUserDocumentSessionState(actorPayload, actor);
      }
      if (!actorSnap.exists || actor.role !== "owner") {
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
      const beforeAllowedVipGrantLevels = (() => {
        const raw = Array.isArray(target.allowedVipGrantLevels)
          ? target.allowedVipGrantLevels
          : [];
        const levels = raw.map(Number).filter(
          (level) => Number.isInteger(level) && level >= 1 && level <= 10,
        );
        return [...new Set(levels)].sort((a, b) => a - b);
      })();
      const vipRoleAllowed = role === "admin" || role === "super_admin";
      const hasVipCapability =
        vipRoleAllowed && capabilities.includes("manageVipLevels");
      const allowedVipGrantLevels = hasVipCapability
        ? (requestedVipGrantLevels ?? beforeAllowedVipGrantLevels)
        : [];
      const before = {
        role: clean(target.role || "user") || "user",
        adminEnabled: target.adminEnabled === true,
        capabilities: beforeCapabilities,
        allowedVipGrantLevels: beforeAllowedVipGrantLevels,
      };
      const after = {
        role,
        adminEnabled,
        capabilities,
        allowedVipGrantLevels,
      };
      const beforeSet = new Set(beforeCapabilities);
      const afterSet = new Set(capabilities);
      const capabilityChanges = [...new Set([
        ...beforeCapabilities,
        ...capabilities,
      ])]
        .sort()
        .filter((capability) =>
          beforeSet.has(capability) !== afterSet.has(capability)
        )
        .map((capability) => ({
          capability,
          oldState: beforeSet.has(capability),
          newState: afterSet.has(capability),
        }));
      const updatedAt = new Date();
      const resultData = {
        targetUid,
        role,
        adminEnabled,
        capabilities,
        allowedVipGrantLevels,
      };

      await db.commit(transaction, [
        db.writeUpdate(
          `users/${targetUid}`,
          { role, adminEnabled, capabilities, allowedVipGrantLevels, updatedAt },
          [
            "role",
            "adminEnabled",
            "capabilities",
            "allowedVipGrantLevels",
            "updatedAt",
          ],
        ),
        db.writeCreate(`admin_audit_logs/admin_${key}`, {
          actorUid,
          action: "setUserAccess",
          targetType: "user",
          targetId: targetUid,
          reason,
          before,
          after,
          capabilityChanges,
          actorId: actorUid,
          targetAdminId: targetUid,
          oldAllowedLevels: beforeAllowedVipGrantLevels,
          newAllowedLevels: allowedVipGrantLevels,
          timestamp: updatedAt,
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
      if (transaction) {
        await db.rollback(transaction);
      }
      if (error instanceof ApiError) throw error;
      if (
        attempt < maxAttempts - 1 &&
        isTransientFirestoreError(error)
      ) {
        await new Promise((resolve) =>
          setTimeout(resolve, firestoreErrorRetryDelayMs(attempt)),
        );
        continue;
      }
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
    if (Object.prototype.hasOwnProperty.call(body, "allowedVipGrantLevels")) {
      normalizeAllowedVipGrantLevels(body.allowedVipGrantLevels);
    }
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
export const manageUserAccessInternals = Object.freeze({
  execute,
  normalizeCapabilities,
  normalizeAllowedVipGrantLevels,
});
