import { json, readJson, firestoreQuotaResponse } from "./http.js";
import {
  assertUserDocumentSessionState,
  verifyFirebaseIdToken,
} from "./firebase-auth.js";
import { firestoreClient } from "./firestore.js";
import {
  calculateAgencyTargetProgress,
  currentAgencyMonthKey,
  DEFAULT_AGENCY_TARGETS,
} from "./agency-policy.js";
import { agencyMemberPermissions } from "./agency-permissions.js";
import { annotatePressureRequest } from "./pressure-telemetry.js";

const clean = (value) => String(value ?? "").trim();

class ApiError extends Error {
  constructor(code, status = 400, details = null) {
    super(code);
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

function nonNegativeInteger(value, code) {
  const parsed = Number(value ?? 0);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new ApiError(code, 409);
  }
  return parsed;
}

function boundedInteger(value, fallback, min, max) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < min || parsed > max) {
    return fallback;
  }
  return parsed;
}

function validAgencyId(value) {
  return /^\d{3,8}$/.test(clean(value));
}

function safeAgencyRoomId(value) {
  const roomId = clean(value);
  return /^[A-Za-z0-9_-]{3,180}$/.test(roomId) ? roomId : null;
}

function personSummary(uidInput, snap) {
  const uid = clean(uidInput);
  const user = snap?.exists ? snap.data || {} : {};
  return {
    uid,
    publicId: clean(user.publicId) || null,
    displayName:
      clean(user.displayName || user.name || user.username) || "Shadow Live",
    profileImageUrl:
      clean(user.profileImageUrl || user.photoUrl || user.avatarUrl) || null,
  };
}

function targetSummary(target) {
  if (!target) return null;
  return {
    id: clean(target.id),
    tierId: clean(target.tierId),
    rank: clean(target.rank),
    thresholdCoins: nonNegativeInteger(
      target.thresholdCoins,
      "agency_target_state_corrupt",
    ),
    salaryDiamonds: nonNegativeInteger(
      target.salaryDiamonds,
      "agency_target_state_corrupt",
    ),
    openEnded: target.openEnded === true,
  };
}

export async function loadAgencyHostCore(
  db,
  uidInput,
  now = new Date(),
  { sessionPayload = null } = {},
) {
  const uid = clean(uidInput);
  if (!uid) throw new ApiError("unauthorized", 401);

  const [userSnap, membershipSnap] = await Promise.all([
    db.get("users/" + uid),
    db.get("agency_user_memberships/" + uid),
  ]);

  if (!userSnap.exists || !membershipSnap.exists) {
    throw new ApiError("agency_host_not_found", 404);
  }

  const user = userSnap.data || {};
  if (sessionPayload) {
    assertUserDocumentSessionState(sessionPayload, user);
  }
  const membership = membershipSnap.data || {};
  const agencyId = clean(membership.agencyId);
  const role = clean(membership.role);
  const membershipStatus = clean(membership.status);

  if (
    !validAgencyId(agencyId) ||
    clean(user.agencyId) !== agencyId ||
    membershipStatus !== "active" ||
    !["host", "manager", "senior_manager", "owner"].includes(role)
  ) {
    throw new ApiError("agency_host_not_active", 403);
  }

  const [agencySnap, economySnap] = await Promise.all([
    db.get("agencies/" + agencyId),
    db.get("system_config/gift_economy"),
  ]);

  if (!agencySnap.exists) throw new ApiError("agency_not_found", 404);
  const agency = agencySnap.data || {};
  if (clean(agency.agencyId || agencyId) !== agencyId) {
    throw new ApiError("agency_host_state_corrupt", 409);
  }

  const ownerUid = clean(agency.ownerUid);
  if (!ownerUid) throw new ApiError("agency_owner_missing", 409);
  const ownerSnap = await db.get("users/" + ownerUid);
  if (!ownerSnap.exists) throw new ApiError("agency_owner_missing", 409);

  const month = currentAgencyMonthKey(now);
  let targetProgress;
  try {
    targetProgress = calculateAgencyTargetProgress({
      monthKey: month,
      storedMonth: user.agencyTargetMonth,
      storedProgressCoins: user.agencyTargetProgressCoins,
      addedHostShareCoins: 0,
      storedPaidDiamonds: user.agencySalaryPaidDiamonds,
      targets:
        user.agencyPolicySnapshot?.targets ||
        DEFAULT_AGENCY_TARGETS,
    });
  } catch (_) {
    throw new ApiError("agency_target_state_corrupt", 409);
  }

  const activitySameMonth = clean(user.giftHostActivityMonth) === month;
  const qualifiedDays = activitySameMonth
    ? nonNegativeInteger(
        user.giftHostQualifiedDays,
        "agency_activity_state_corrupt",
      )
    : 0;
  const micSecondsMonth = activitySameMonth
    ? nonNegativeInteger(
        user.giftHostMicSecondsMonth,
        "agency_activity_state_corrupt",
      )
    : 0;

  const economy = economySnap?.exists ? economySnap.data || {} : {};
  const requiredQualifiedDays = boundedInteger(
    economy.hostBonusQualifiedDays,
    9,
    1,
    31,
  );
  const requiredMinutesPerDay = boundedInteger(
    economy.hostBonusMinutesPerQualifiedDay,
    120,
    1,
    1440,
  );

  const reachedTarget = targetSummary(targetProgress.reachedTarget);
  const nextTarget = targetSummary(targetProgress.nextTarget);
  const membershipPermissions = agencyMemberPermissions({
    membership,
    agencyStatus: clean(agency.status),
  });

  return {
    ok: true,
    agency: {
      agencyId,
      publicId: clean(agency.publicId) || agencyId,
      name: clean(agency.name) || "Shadow Live Agency",
      country: clean(agency.country) || null,
      status: clean(agency.status) || "active",
      logoUrl:
        clean(agency.logoUrl || agency.imageUrl || agency.profileImageUrl) ||
        null,
      roomId: safeAgencyRoomId(agency.roomId || agency.agencyRoomId),
    },
    owner: personSummary(ownerUid, ownerSnap),
    membership: {
      role,
      status: membershipStatus,
      capabilities: Array.isArray(membership.capabilities)
        ? membership.capabilities.map(clean).filter(Boolean)
        : [],
      permissions: {
        canReviewMembershipRequests:
          membershipPermissions.canReviewMembershipRequests,
        canManageInvites: membershipPermissions.canManageInvites,
      },
    },
    target: {
      month,
      progressCoins: targetProgress.progressCoins,
      paidDiamonds: targetProgress.paidDiamonds,
      remainingCoins: targetProgress.remainingToNextTargetCoins,
      currentLevel: reachedTarget,
      nextLevel: nextTarget,
      targetCoins:
        nextTarget?.thresholdCoins ||
        reachedTarget?.thresholdCoins ||
        0,
    },
    activity: {
      month,
      qualifiedDays,
      micSecondsMonth,
      requiredQualifiedDays,
      requiredMinutesPerDay,
    },
  };
}

export async function agencyHost(request, env) {
  if (request.method !== "POST") {
    return json(request, env, { ok: false, code: "method_not_allowed" }, 405);
  }

  try {
    const token = await verifyFirebaseIdToken(request, env, {
      // loadAgencyHostCore already reads users/{uid}; reuse that document
      // for accountStatus/session revocation instead of a duplicate lookup.
      checkUserState: false,
    });
    const body = await readJson(request);
    const action = clean(body.action) || "core";
    if (action !== "core") {
      throw new ApiError("invalid_agency_host_action", 400);
    }

    annotatePressureRequest(request, { action: "agencyHost:core" });
    const db = firestoreClient(env);
    return json(
      request,
      env,
      await loadAgencyHostCore(db, token.sub, new Date(), {
        sessionPayload: token,
      }),
    );
  } catch (error) {
    if (error instanceof ApiError) {
      return json(
        request,
        env,
        {
          ok: false,
          code: error.code,
          ...(error.details ? { details: error.details } : {}),
        },
        error.status,
      );
    }

    const quota = firestoreQuotaResponse(request, env, error);
    if (quota) return quota;

    const code = clean(error?.message);
    if (code === "unauthorized") {
      return json(request, env, { ok: false, code }, 401);
    }
    if (
      code === "server_not_configured" ||
      code === "invalid_service_account_json"
    ) {
      return json(request, env, { ok: false, code }, 503);
    }
    return json(request, env, { ok: false, code: "agency_host_failed" }, 500);
  }
}
