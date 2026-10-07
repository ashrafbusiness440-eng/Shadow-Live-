import { json, readJson, firestoreQuotaResponse } from "./http.js";
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
  calculateAgencyTargetProgress,
  currentAgencyMonthKey,
  DEFAULT_AGENCY_TARGETS,
  hostActivityBonusForTarget,
  normalizeAgencyMonthKey,
} from "./agency-policy.js";
import { agencyMemberPermissions } from "./agency-permissions.js";
import {
  economyWithAgencyPolicySnapshot,
  revenueTiers,
} from "./economy-policy.js";
import { annotatePressureRequest } from "./pressure-telemetry.js";
import { adminInboxUpsertWrite } from "./admin-inbox-index.js";

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

function validIdempotencyKey(value) {
  return /^[A-Za-z0-9_-]{12,120}$/.test(clean(value));
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
    profileAvatarAsset: clean(user.profileAvatarAsset) || null,
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

function targetDisplaySummary(
  target,
  revenueTierById,
) {
  const summary = targetSummary(target);
  if (!summary) return null;
  const revenueTier = revenueTierById.get(summary.tierId);
  const hostShareBps = Math.max(
    0,
    Math.min(10000, Number(revenueTier?.hostShareBps || 0)),
  );
  const grossSupportCoins =
    hostShareBps > 0
      ? Math.ceil((summary.thresholdCoins * 10000) / hostShareBps)
      : 0;
  return {
    ...summary,
    hostShareBps,
    grossSupportCoins,
    activityBonus: hostActivityBonusForTarget(summary),
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
  const targetPolicy =
    user.agencyPolicySnapshot?.targets ||
    DEFAULT_AGENCY_TARGETS;
  let targetProgress;
  try {
    targetProgress = calculateAgencyTargetProgress({
      monthKey: month,
      storedMonth: user.agencyTargetMonth,
      storedProgressCoins: user.agencyTargetProgressCoins,
      addedHostShareCoins: 0,
      storedPaidDiamonds: user.agencySalaryPaidDiamonds,
      targets: targetPolicy,
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
  const effectiveEconomy = economyWithAgencyPolicySnapshot(
    economy,
    user,
    agencyId,
  );
  const revenueTierById = new Map(
    revenueTiers(effectiveEconomy).map((tier) => [clean(tier.id), tier]),
  );
  const requiredQualifiedDays = 14;
  const requiredMinutesPerDay = 120;

  const reachedTarget = targetDisplaySummary(
    targetProgress.reachedTarget,
    revenueTierById,
  );
  const nextTarget = targetDisplaySummary(
    targetProgress.nextTarget,
    revenueTierById,
  );
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
      description: clean(agency.description) || null,
      publicContact: clean(agency.publicContact) || null,
      backgroundUrl:
        clean(agency.backgroundUrl || agency.roomBackgroundUrl) || null,
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
      levels: Array.isArray(targetPolicy)
        ? targetPolicy
            .map((target) =>
              targetDisplaySummary(
                target,
                revenueTierById,
              )
            )
            .filter(Boolean)
        : [],
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
      bonusMode: "highest_target_month_end",
      requiredMicSecondsMonth:
        requiredQualifiedDays * requiredMinutesPerDay * 60,
    },
  };
}

function hostHistoryTimestampMs(value) {
  if (value instanceof Date) return value.getTime();
  if (value && typeof value.toMillis === "function") {
    const ms = Number(value.toMillis());
    return Number.isFinite(ms) ? ms : 0;
  }
  if (value && typeof value.toDate === "function") {
    const date = value.toDate();
    return date instanceof Date ? date.getTime() : 0;
  }
  const parsed = Date.parse(String(value || ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

function hostTargetHistoryAchievement(raw = {}, fallback = {}) {
  const salaryDeltaDiamonds = nonNegativeInteger(
    raw.salaryDeltaDiamonds ?? fallback.salaryDeltaDiamonds ?? 0,
    "agency_target_history_corrupt",
  );
  return {
    targetId: clean(raw.id || raw.targetId || fallback.targetId),
    tierId: clean(raw.tierId || fallback.tierId) || null,
    rank: clean(raw.rank || fallback.rank) || null,
    thresholdCoins: nonNegativeInteger(
      raw.thresholdCoins ?? fallback.thresholdCoins ?? 0,
      "agency_target_history_corrupt",
    ),
    salaryDeltaDiamonds,
    salaryDiamonds: nonNegativeInteger(
      raw.salaryDiamonds ?? fallback.salaryDiamonds ?? 0,
      "agency_target_history_corrupt",
    ),
    achievedAt: fallback.achievedAt || null,
    sourceId: clean(fallback.sourceId) || null,
  };
}

export async function loadAgencyHostTargetHistory(
  db,
  uidInput,
  body = {},
  now = new Date(),
  { sessionPayload = null } = {},
) {
  const uid = clean(uidInput);
  if (!uid) throw new ApiError("unauthorized", 401);
  const currentMonth = currentAgencyMonthKey(now);
  let month;
  try {
    month = normalizeAgencyMonthKey(body.month || currentMonth);
  } catch (_) {
    throw new ApiError("invalid_agency_month", 400);
  }
  if (month > currentMonth) {
    throw new ApiError("agency_month_in_future", 400);
  }

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
  if (
    !validAgencyId(agencyId) ||
    clean(user.agencyId) !== agencyId ||
    clean(membership.status) !== "active" ||
    !["host", "manager", "senior_manager", "owner"].includes(
      clean(membership.role),
    )
  ) {
    throw new ApiError("agency_host_not_active", 403);
  }

  const rows = await db.runQuery("gift_transactions", {
    filters: [
      { field: "receiverId", op: "==", value: uid },
      { field: "agencyId", op: "==", value: agencyId },
      { field: "agencyTargetMonth", op: "==", value: month },
      { field: "earningsStatus", op: "==", value: "target_paid" },
    ],
    limit: 30,
  });
  const sorted = rows.slice().sort(
    (left, right) =>
      hostHistoryTimestampMs(left?.data?.createdAt) -
      hostHistoryTimestampMs(right?.data?.createdAt),
  );
  const achievements = [];
  for (const row of sorted) {
    const tx = row?.data || {};
    const snapshot = Array.isArray(tx.agencyTargetAchievements)
      ? tx.agencyTargetAchievements
      : [];
    if (snapshot.length) {
      for (const item of snapshot.slice(0, 30)) {
        if (!item || typeof item !== "object") continue;
        const achievement = hostTargetHistoryAchievement(item, {
          achievedAt: tx.createdAt || null,
          sourceId: row?.id || tx.sourceId || null,
        });
        if (achievement.targetId) achievements.push(achievement);
      }
      continue;
    }

    const fallbackTargetId = clean(tx.agencyTargetId);
    const fallbackDelta = nonNegativeInteger(
      tx.salaryDeltaDiamonds || 0,
      "agency_target_history_corrupt",
    );
    if (fallbackTargetId && fallbackDelta > 0) {
      achievements.push(
        hostTargetHistoryAchievement({}, {
          targetId: fallbackTargetId,
          salaryDeltaDiamonds: fallbackDelta,
          achievedAt: tx.createdAt || null,
          sourceId: row?.id || null,
        }),
      );
    }
  }

  return {
    ok: true,
    agencyId,
    month,
    currentMonth,
    achievements: achievements.slice(0, 60),
    source: "bounded_target_paid_transactions",
    transactionLimit: 30,
  };
}

export async function updateAgencyOwnerProfile(
  db,
  uidInput,
  body = {},
  { now = new Date(), sessionPayload = null } = {},
) {
  const uid = clean(uidInput);
  const description = clean(body.description);
  const publicContact = clean(body.publicContact);
  const key = clean(body.idempotencyKey);
  if (!uid) throw new ApiError("unauthorized", 401);
  if (description.length > 500) {
    throw new ApiError("invalid_agency_description", 400);
  }
  if (publicContact.length > 160) {
    throw new ApiError("invalid_agency_public_contact", 400);
  }
  if (!validIdempotencyKey(key)) {
    throw new ApiError("invalid_idempotency_key", 400);
  }

  const opPath = `agency_owner_operations/${uid}__${key}`;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const tx = await db.beginTransaction();
    try {
      const [opSnap, userSnap, membershipSnap] = await Promise.all([
        db.get(opPath, tx),
        db.get(`users/${uid}`, tx),
        db.get(`agency_user_memberships/${uid}`, tx),
      ]);
      if (opSnap.exists) {
        const existing = opSnap.data || {};
        if (clean(existing.action) !== "updateAgencyOwnerProfile") {
          throw new ApiError("idempotency_conflict", 409);
        }
        await db.rollback(tx);
        return { ok: true, code: "duplicate", ...(existing.result || {}) };
      }
      if (!userSnap.exists || !membershipSnap.exists) {
        throw new ApiError("agency_owner_required", 403);
      }
      const user = userSnap.data || {};
      if (sessionPayload) {
        assertUserDocumentSessionState(sessionPayload, user);
      }
      const membership = membershipSnap.data || {};
      const agencyId = clean(membership.agencyId);
      if (
        !validAgencyId(agencyId) ||
        clean(membership.role) !== "owner" ||
        clean(membership.status) !== "active" ||
        clean(user.agencyId) !== agencyId
      ) {
        throw new ApiError("agency_owner_required", 403);
      }
      const agencySnap = await db.get(`agencies/${agencyId}`, tx);
      if (
        !agencySnap.exists ||
        clean(agencySnap.data?.ownerUid) !== uid ||
        clean(agencySnap.data?.status) === "closed"
      ) {
        throw new ApiError("agency_owner_required", 403);
      }
      const result = {
        agencyId,
        description: description || null,
        publicContact: publicContact || null,
      };
      await db.commit(tx, [
        db.writeUpdate(
          `agencies/${agencyId}`,
          {
            description: description || "",
            publicContact: publicContact || "",
            updatedAt: now,
          },
          ["description", "publicContact", "updatedAt"],
        ),
        db.writeCreate(opPath, {
          actorUid: uid,
          action: "updateAgencyOwnerProfile",
          status: "completed",
          result,
          createdAt: now,
        }),
        db.writeCreate(
          `admin_audit_logs/agency_owner_profile_${agencyId}_${key}`,
          {
            actorUid: uid,
            action: "updateAgencyOwnerProfile",
            targetType: "agency",
            targetId: agencyId,
            before: {
              description: clean(agencySnap.data?.description) || null,
              publicContact: clean(agencySnap.data?.publicContact) || null,
            },
            after: result,
            idempotencyKey: key,
            createdAt: now,
          },
        ),
      ]);
      return { ok: true, code: "ok", ...result };
    } catch (error) {
      await db.rollback(tx);
      if (error instanceof ApiError) throw error;
      if (isTransientFirestoreError(error) && attempt < 2) {
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

export async function requestAgencyIdentityChange(
  db,
  uidInput,
  body = {},
  { now = new Date(), sessionPayload = null } = {},
) {
  const uid = clean(uidInput);
  const requestedName = clean(body.name);
  const requestedCountry = clean(body.country) || null;
  const key = clean(body.idempotencyKey);
  if (!uid) throw new ApiError("unauthorized", 401);
  if (!requestedName || requestedName.length > 80) {
    throw new ApiError("invalid_agency_name", 400);
  }
  if (
    requestedCountry != null &&
    (requestedCountry.length < 2 || requestedCountry.length > 64)
  ) {
    throw new ApiError("invalid_agency_country", 400);
  }
  if (!validIdempotencyKey(key)) {
    throw new ApiError("invalid_idempotency_key", 400);
  }

  const opPath = `agency_owner_operations/${uid}__${key}`;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const tx = await db.beginTransaction();
    try {
      const [opSnap, userSnap, membershipSnap] = await Promise.all([
        db.get(opPath, tx),
        db.get(`users/${uid}`, tx),
        db.get(`agency_user_memberships/${uid}`, tx),
      ]);
      if (opSnap.exists) {
        const existing = opSnap.data || {};
        if (clean(existing.action) !== "requestAgencyIdentityChange") {
          throw new ApiError("idempotency_conflict", 409);
        }
        await db.rollback(tx);
        return { ok: true, code: "duplicate", ...(existing.result || {}) };
      }
      if (!userSnap.exists || !membershipSnap.exists) {
        throw new ApiError("agency_owner_required", 403);
      }
      const user = userSnap.data || {};
      if (sessionPayload) {
        assertUserDocumentSessionState(sessionPayload, user);
      }
      const membership = membershipSnap.data || {};
      const agencyId = clean(membership.agencyId);
      if (
        !validAgencyId(agencyId) ||
        clean(membership.role) !== "owner" ||
        clean(membership.status) !== "active" ||
        clean(user.agencyId) !== agencyId
      ) {
        throw new ApiError("agency_owner_required", 403);
      }
      const lockPath = `agency_identity_change_locks/${agencyId}`;
      const [agencySnap, lockSnap] = await Promise.all([
        db.get(`agencies/${agencyId}`, tx),
        db.get(lockPath, tx),
      ]);
      if (
        !agencySnap.exists ||
        clean(agencySnap.data?.ownerUid) !== uid ||
        clean(agencySnap.data?.status) === "closed"
      ) {
        throw new ApiError("agency_owner_required", 403);
      }
      if (lockSnap.exists && clean(lockSnap.data?.status) === "pending") {
        throw new ApiError("agency_identity_change_pending", 409, {
          requestId: clean(lockSnap.data?.requestId) || null,
        });
      }
      const agency = agencySnap.data || {};
      const currentName = clean(agency.name);
      const currentCountry = clean(agency.country) || null;
      if (
        requestedName === currentName &&
        requestedCountry === currentCountry
      ) {
        throw new ApiError("agency_identity_unchanged", 409);
      }

      const requestId = `${agencyId}__${key}`;
      const requestPath = `agency_identity_change_requests/${requestId}`;
      const result = {
        requestId,
        agencyId,
        ownerUid: uid,
        status: "pending",
        currentName,
        currentCountry,
        requestedName,
        requestedCountry,
        createdAt: now,
      };
      await db.commit(tx, [
        db.writeCreate(requestPath, {
          ...result,
          type: "identity_change",
          updatedAt: now,
        }),
        lockSnap.exists
          ? db.writeUpdate(
              lockPath,
              {
                requestId,
                agencyId,
                ownerUid: uid,
                status: "pending",
                updatedAt: now,
              },
              ["requestId", "agencyId", "ownerUid", "status", "updatedAt"],
            )
          : db.writeCreate(lockPath, {
              requestId,
              agencyId,
              ownerUid: uid,
              status: "pending",
              createdAt: now,
              updatedAt: now,
            }),
        db.writeCreate(opPath, {
          actorUid: uid,
          action: "requestAgencyIdentityChange",
          agencyId,
          status: "completed",
          result,
          createdAt: now,
        }),
        db.writeCreate(
          `admin_audit_logs/agency_identity_change_request_${requestId}`,
          {
            actorUid: uid,
            action: "requestAgencyIdentityChange",
            targetType: "agency",
            targetId: agencyId,
            before: {
              name: currentName,
              country: currentCountry,
            },
            after: {
              name: requestedName,
              country: requestedCountry,
            },
            idempotencyKey: key,
            createdAt: now,
          },
        ),
        db.writeCreate(
          `notifications/agency_identity_change_requested_${requestId}`,
          {
            userId: uid,
            type: "agency_identity_change_requested",
            category: "system",
            title: "تم إرسال طلب تغيير اسم/دولة الوكالة",
            body:
              requestedName +
              (requestedCountry ? " — " + requestedCountry : ""),
            read: false,
            mandatory: true,
            agencyId,
            requestId,
            createdAt: now,
          },
        ),
        adminInboxUpsertWrite(db, {
          type: "agency_identity_change",
          title: "طلب تغيير بيانات وكالة",
          body: [agencyId, requestedName].filter(Boolean).join(" • "),
          targetId: requestId,
          route: "agency_control",
          createdAt: now,
          meta: { agencyId, status: "pending" },
        }),
      ]);
      return { ok: true, code: "ok", ...result };
    } catch (error) {
      await db.rollback(tx);
      if (error instanceof ApiError) throw error;
      if (isTransientFirestoreError(error) && attempt < 2) {
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

export async function requestAgencyOwnershipTransfer(
  db,
  uidInput,
  body = {},
  { now = new Date(), sessionPayload = null } = {},
) {
  const uid = clean(uidInput);
  const newOwnerPublicId = clean(body.newOwnerPublicId);
  const key = clean(body.idempotencyKey);
  if (!uid) throw new ApiError("unauthorized", 401);
  if (!/^\d{3,8}$/.test(newOwnerPublicId)) {
    throw new ApiError("invalid_owner_public_id", 400);
  }
  if (!validIdempotencyKey(key)) {
    throw new ApiError("invalid_idempotency_key", 400);
  }

  const opPath = `agency_owner_operations/${uid}__${key}`;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const tx = await db.beginTransaction();
    try {
      const [opSnap, actorUserSnap, membershipSnap, publicIdSnap] =
        await Promise.all([
          db.get(opPath, tx),
          db.get(`users/${uid}`, tx),
          db.get(`agency_user_memberships/${uid}`, tx),
          db.get(`public_ids/${newOwnerPublicId}`, tx),
        ]);

      if (opSnap.exists) {
        const existing = opSnap.data || {};
        if (
          clean(existing.newOwnerPublicId) !== newOwnerPublicId ||
          clean(existing.action) !== "requestAgencyOwnershipTransfer"
        ) {
          throw new ApiError("idempotency_conflict", 409);
        }
        await db.rollback(tx);
        return { ok: true, code: "duplicate", ...(existing.result || {}) };
      }
      if (!actorUserSnap.exists || !membershipSnap.exists) {
        throw new ApiError("agency_owner_required", 403);
      }
      const actorUser = actorUserSnap.data || {};
      if (sessionPayload) {
        assertUserDocumentSessionState(sessionPayload, actorUser);
      }
      const membership = membershipSnap.data || {};
      const agencyId = clean(membership.agencyId);
      if (
        !validAgencyId(agencyId) ||
        clean(membership.role) !== "owner" ||
        clean(membership.status) !== "active" ||
        clean(actorUser.agencyId) !== agencyId
      ) {
        throw new ApiError("agency_owner_required", 403);
      }
      const newOwnerUid = clean(publicIdSnap.data?.uid);
      if (!publicIdSnap.exists || !newOwnerUid) {
        throw new ApiError("owner_not_found", 404);
      }
      if (newOwnerUid === uid) throw new ApiError("owner_unchanged", 409);

      const lockPath = `agency_ownership_transfer_locks/${agencyId}`;
      const [agencySnap, lockSnap, targetMembershipSnap, targetUserSnap] =
        await Promise.all([
          db.get(`agencies/${agencyId}`, tx),
          db.get(lockPath, tx),
          db.get(`agency_user_memberships/${newOwnerUid}`, tx),
          db.get(`users/${newOwnerUid}`, tx),
        ]);
      if (!agencySnap.exists) throw new ApiError("agency_not_found", 404);
      const agency = agencySnap.data || {};
      if (
        clean(agency.ownerUid) !== uid ||
        clean(agency.status) !== "active"
      ) {
        throw new ApiError("agency_owner_required", 403);
      }
      if (lockSnap.exists && clean(lockSnap.data?.status) === "pending") {
        throw new ApiError("ownership_transfer_pending", 409, {
          requestId: clean(lockSnap.data?.requestId) || null,
        });
      }
      if (!targetMembershipSnap.exists || !targetUserSnap.exists) {
        throw new ApiError("new_owner_must_be_active_member", 409);
      }
      const targetMembership = targetMembershipSnap.data || {};
      const targetUser = targetUserSnap.data || {};
      if (
        clean(targetMembership.agencyId) !== agencyId ||
        clean(targetMembership.status) !== "active" ||
        !["host", "manager", "senior_manager"].includes(
          clean(targetMembership.role),
        ) ||
        clean(targetUser.agencyId) !== agencyId ||
        clean(targetUser.accountStatus || "active") !== "active"
      ) {
        throw new ApiError("new_owner_must_be_active_member", 409);
      }

      const requestId = `${agencyId}__${key}`;
      const requestPath = `agency_ownership_transfer_requests/${requestId}`;
      const result = {
        requestId,
        agencyId,
        status: "pending",
        ownerUid: uid,
        newOwnerUid,
        newOwnerPublicId,
        newOwnerDisplayName:
          clean(
            targetUser.displayName ||
            targetUser.name ||
            targetUser.username,
          ) || newOwnerPublicId,
        createdAt: now,
      };
      const writes = [
        db.writeCreate(requestPath, {
          ...result,
          type: "ownership_transfer",
          previousNewOwnerRole: clean(targetMembership.role),
          updatedAt: now,
        }),
        lockSnap.exists
          ? db.writeUpdate(
              lockPath,
              {
                requestId,
                agencyId,
                status: "pending",
                ownerUid: uid,
                newOwnerUid,
                newOwnerPublicId,
                updatedAt: now,
              },
              [
                "requestId",
                "agencyId",
                "status",
                "ownerUid",
                "newOwnerUid",
                "newOwnerPublicId",
                "updatedAt",
              ],
            )
          : db.writeCreate(lockPath, {
              requestId,
              agencyId,
              status: "pending",
              ownerUid: uid,
              newOwnerUid,
              newOwnerPublicId,
              createdAt: now,
              updatedAt: now,
            }),
        db.writeCreate(opPath, {
          actorUid: uid,
          action: "requestAgencyOwnershipTransfer",
          agencyId,
          newOwnerPublicId,
          status: "completed",
          result,
          createdAt: now,
        }),
        db.writeCreate(
          `admin_audit_logs/agency_owner_transfer_request_${requestId}`,
          {
            actorUid: uid,
            action: "requestAgencyOwnershipTransfer",
            targetType: "agency",
            targetId: agencyId,
            after: result,
            idempotencyKey: key,
            createdAt: now,
          },
        ),
        db.writeCreate(
          `notifications/agency_owner_transfer_requested_${requestId}`,
          {
            userId: uid,
            type: "agency_ownership_transfer_requested",
            category: "system",
            title: "تم إرسال طلب نقل ملكية الوكالة",
            body:
              "المالك المقترح: " +
              result.newOwnerDisplayName +
              " • ID " +
              newOwnerPublicId,
            read: false,
            mandatory: true,
            agencyId,
            requestId,
            newOwnerUid,
            newOwnerPublicId,
            createdAt: now,
          },
        ),
        db.writeCreate(
          `notifications/agency_owner_transfer_candidate_${requestId}`,
          {
            userId: newOwnerUid,
            type: "agency_ownership_transfer_candidate",
            category: "system",
            title: "تم ترشيحك لملكية الوكالة",
            body: clean(agency.name) || agencyId,
            read: false,
            mandatory: true,
            agencyId,
            requestId,
            createdAt: now,
          },
        ),
        adminInboxUpsertWrite(db, {
          type: "agency_ownership_transfer",
          title: "طلب نقل ملكية وكالة",
          body: [agencyId, newOwnerPublicId ? `المالك الجديد: ${newOwnerPublicId}` : ""]
            .filter(Boolean)
            .join(" • "),
          targetId: requestId,
          route: "agency_control",
          createdAt: now,
          priority: "high",
          meta: { agencyId, status: "pending" },
        }),
      ];
      await db.commit(tx, writes);
      return { ok: true, code: "ok", ...result };
    } catch (error) {
      await db.rollback(tx);
      if (error instanceof ApiError) throw error;
      if (isTransientFirestoreError(error) && attempt < 2) {
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
    const db = firestoreClient(env);
    if (action === "core") {
      annotatePressureRequest(request, { action: "agencyHost:core" });
      return json(
        request,
        env,
        await loadAgencyHostCore(db, token.sub, new Date(), {
          sessionPayload: token,
        }),
      );
    }
    if (action === "updateProfile") {
      annotatePressureRequest(request, {
        action: "agencyHost:updateProfile",
      });
      return json(
        request,
        env,
        await updateAgencyOwnerProfile(db, token.sub, body, {
          sessionPayload: token,
        }),
      );
    }
    if (action === "requestIdentityChange") {
      annotatePressureRequest(request, {
        action: "agencyHost:requestIdentityChange",
      });
      return json(
        request,
        env,
        await requestAgencyIdentityChange(db, token.sub, body, {
          sessionPayload: token,
        }),
      );
    }
    if (action === "requestOwnershipTransfer") {
      annotatePressureRequest(request, {
        action: "agencyHost:requestOwnershipTransfer",
      });
      return json(
        request,
        env,
        await requestAgencyOwnershipTransfer(db, token.sub, body, {
          sessionPayload: token,
        }),
      );
    }
    if (action === "targetHistory") {
      annotatePressureRequest(request, {
        action: "agencyHost:targetHistory",
      });
      return json(
        request,
        env,
        await loadAgencyHostTargetHistory(
          db,
          token.sub,
          body,
          new Date(),
          { sessionPayload: token },
        ),
      );
    }
    throw new ApiError("invalid_agency_host_action", 400);
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
