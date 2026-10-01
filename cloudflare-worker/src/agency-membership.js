import { json, readJson, firestoreQuotaResponse } from "./http.js";
import { verifyFirebaseIdToken } from "./firebase-auth.js";
import {
  firestoreClient,
  firestoreErrorRetryDelayMs,
  isTransientFirestoreError,
} from "./firestore.js";
import {
  AGENCY_LIMITS,
  boundedAgencyPageSize,
  createAgencyMembershipDocument,
  createAgencyMembershipRequestDocument,
} from "./agency-data-model.js";
import {
  agencyMemberPermissions,
  canPerformAgencyAction,
} from "./agency-permissions.js";
import { currentAgencyMonthKey } from "./agency-policy.js";
import { annotatePressureRequest } from "./pressure-telemetry.js";

const clean = (value) => String(value ?? "").trim();

function agencyPublicSupportSeed(monthlySnap) {
  if (!monthlySnap?.exists) return 0;
  const value = Number(monthlySnap.data?.supportCoins ?? 0);
  return Number.isSafeInteger(value) && value >= 0 ? value : 0;
}

class ApiError extends Error {
  constructor(code, status = 400, details = null) {
    super(code);
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

export const AGENCY_REJOIN_COOLDOWN_MS = 7 * 24 * 60 * 60 * 1000;

function timestampMs(value) {
  if (value instanceof Date) return value.getTime();
  if (value && typeof value.toMillis === "function") {
    const millis = Number(value.toMillis());
    return Number.isFinite(millis) ? millis : 0;
  }
  if (value && typeof value.toDate === "function") {
    const date = value.toDate();
    return date instanceof Date ? date.getTime() : 0;
  }
  if (value && Number.isFinite(Number(value.seconds))) {
    return Number(value.seconds) * 1000 +
      Math.floor(Number(value.nanoseconds || 0) / 1_000_000);
  }
  const parsed = Date.parse(String(value ?? ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

function cooldownUntilFor(now) {
  const baseMs = now instanceof Date ? now.getTime() : timestampMs(now);
  if (!Number.isFinite(baseMs) || baseMs <= 0) {
    throw new ApiError("invalid_membership_time", 500);
  }
  return new Date(baseMs + AGENCY_REJOIN_COOLDOWN_MS);
}

function historicalMembership(snapshot) {
  if (!snapshot?.exists) return false;
  return ["left", "removed"].includes(clean(snapshot.data?.status));
}

function ensureRejoinCooldownExpired(snapshot, now) {
  if (!historicalMembership(snapshot)) return;
  const cooldownUntil = snapshot.data?.cooldownUntil;
  const untilMs = timestampMs(cooldownUntil);
  const nowMs = now instanceof Date ? now.getTime() : timestampMs(now);
  if (untilMs > nowMs) {
    throw new ApiError("agency_rejoin_cooldown", 409, {
      cooldownUntil: new Date(untilMs).toISOString(),
      remainingSeconds: Math.max(1, Math.ceil((untilMs - nowMs) / 1000)),
    });
  }
}

const MEMBERSHIP_WRITE_FIELDS = Object.freeze([
  "schemaVersion",
  "agencyId",
  "uid",
  "role",
  "status",
  "joinedAt",
  "updatedAt",
  "leftAt",
  "removedAt",
  "cooldownUntil",
]);


function validIdempotencyKey(value) {
  return /^[A-Za-z0-9_-]{12,120}$/.test(clean(value));
}

function agencyPolicySnapshotFromOverride(agencyIdInput, snapshot) {
  const agencyId = clean(agencyIdInput);
  if (!agencyId || !snapshot?.exists) return null;
  const data = snapshot.data || {};
  return {
    agencyId,
    policyVersion: clean(data.policyVersion) || null,
    updatedAt: data.updatedAt || null,
    ...(Array.isArray(data.tiers) ? { tiers: data.tiers } : {}),
    ...(Array.isArray(data.targets) ? { targets: data.targets } : {}),
  };
}

function requestIdFor(actorUid, key) {
  const actor = clean(actorUid).replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 80);
  if (!actor) throw new ApiError("invalid_actor", 400);
  return actor + "__" + key;
}

function isAvailableUser(snapshot) {
  if (!snapshot?.exists) return false;
  return clean(snapshot.data?.accountStatus || "active") === "active";
}

function hasAgencyMembership(snapshot) {
  if (!snapshot?.exists) return false;
  const status = clean(snapshot.data?.status);
  return status === "active" || status === "pending";
}

function hasActiveApplicationLock(snapshot) {
  if (!snapshot?.exists) return false;
  const status = clean(snapshot.data?.status);
  return ["draft", "reserved", "pending", "under_review"].includes(status);
}

function fingerprint(payload) {
  return JSON.stringify(payload);
}

function requestKeyPath(agencyId, uid) {
  return `agency_membership_request_keys/${agencyId}__${uid}`;
}

function pendingPath(agencyId, uid) {
  return `agency_membership_pending/${agencyId}__${uid}`;
}

function operationPath(actorUid, key) {
  return `agency_membership_request_operations/${actorUid}__${key}`;
}

function acceptanceLockPath(uid) {
  return `agency_membership_acceptance_locks/${uid}`;
}

function ensureAgencyActive(agencySnap) {
  if (!agencySnap?.exists) throw new ApiError("agency_not_found", 404);
  if (clean(agencySnap.data?.status) !== "active") {
    throw new ApiError("agency_not_accepting_members", 409);
  }
}

function ensureUserCanNegotiate(userSnap, membershipSnap, appLockSnap) {
  if (!isAvailableUser(userSnap)) {
    throw new ApiError(userSnap?.exists ? "user_unavailable" : "user_not_found", userSnap?.exists ? 409 : 404);
  }
  if (hasAgencyMembership(membershipSnap) || clean(userSnap.data?.agencyId)) {
    throw new ApiError("user_already_in_agency", 409);
  }
  if (hasActiveApplicationLock(appLockSnap)) {
    throw new ApiError("user_agency_application_conflict", 409);
  }
}

function memberCanManage({ actorUser, actorMembership, agency }) {
  return canPerformAgencyAction({
    action: "manageInvite",
    user: actorUser,
    membership: actorMembership,
    agencyStatus: clean(agency.status),
  });
}

function memberCanReview({ actorUser, actorMembership, agency }) {
  return canPerformAgencyAction({
    action: "reviewMembershipRequest",
    user: actorUser,
    membership: actorMembership,
    agencyStatus: clean(agency.status),
  });
}

function requestSummary(data = {}) {
  return {
    requestId: clean(data.requestId),
    agencyId: clean(data.agencyId),
    uid: clean(data.uid),
    userPublicId: clean(data.userPublicId) || null,
    agencyName: clean(data.agencyName) || null,
    type: clean(data.type),
    targetRole: clean(data.targetRole || "host"),
    status: clean(data.status),
    initiatorSide: clean(data.initiatorSide),
    userConsent: data.userConsent === true,
    agencyConsent: data.agencyConsent === true,
    createdAt: data.createdAt || null,
    updatedAt: data.updatedAt || null,
    acceptedAt: data.acceptedAt || null,
    resolvedAt: data.resolvedAt || null,
    resolvedBy: clean(data.resolvedBy) || null,
    reason: clean(data.reason) || null,
  };
}

async function loadAgencyActor(
  db,
  actorUid,
  agencyId,
  action,
  transaction = null,
) {
  const [actorUserSnap, actorMembershipSnap, agencySnap] = await Promise.all([
    db.get(`users/${actorUid}`, transaction),
    db.get(`agency_user_memberships/${actorUid}`, transaction),
    db.get(`agencies/${agencyId}`, transaction),
  ]);
  ensureAgencyActive(agencySnap);
  const actorUser = actorUserSnap.exists ? actorUserSnap.data || {} : {};
  const actorMembership =
    actorMembershipSnap.exists &&
    clean(actorMembershipSnap.data?.agencyId) === agencyId
      ? actorMembershipSnap.data || {}
      : {};
  const allowed =
    action === "review"
      ? memberCanReview({
          actorUser,
          actorMembership,
          agency: agencySnap.data || {},
        })
      : memberCanManage({
          actorUser,
          actorMembership,
          agency: agencySnap.data || {},
        });
  if (!allowed) throw new ApiError("forbidden", 403);
  return {
    agency: agencySnap.data || {},
    actorUser,
    actorMembership,
  };
}

async function joinReviewerNotificationUids(
  db,
  tx,
  agencyId,
  agency = {},
) {
  const ownerUid = clean(agency.ownerUid);
  if (!ownerUid) throw new ApiError("agency_owner_missing", 409);

  const recipients = new Set([ownerUid]);
  const slotsSnap = await db.get(`agency_manager_slots/${agencyId}`, tx);
  if (!slotsSnap.exists) return [...recipients];

  const slots = slotsSnap.data || {};
  const seniorManagerUid = clean(slots.seniorManagerUid);
  const managerUids = Array.isArray(slots.managerUids)
    ? slots.managerUids.map(clean).filter(Boolean).slice(0, AGENCY_LIMITS.agencyManagers)
    : [];
  const reviewerUids = [
    ...(seniorManagerUid ? [seniorManagerUid] : []),
    ...managerUids,
  ];

  const membershipSnaps = await Promise.all(
    reviewerUids.map((reviewerUid) =>
      db.get(`agency_user_memberships/${reviewerUid}`, tx)
    ),
  );
  reviewerUids.forEach((reviewerUid, index) => {
    const membershipSnap = membershipSnaps[index];
    const membership =
      membershipSnap?.exists &&
      clean(membershipSnap.data?.agencyId) === agencyId
        ? membershipSnap.data || {}
        : {};
    if (canPerformAgencyAction({
      action: "reviewMembershipRequest",
      membership,
      agencyStatus: clean(agency.status),
    })) {
      recipients.add(reviewerUid);
    }
  });

  return [...recipients];
}

function reviewerNotificationPath(baseId, recipientUid, primaryUid) {
  const safeRecipient = clean(recipientUid)
    .replace(/[^A-Za-z0-9_-]/g, "_")
    .slice(0, 80);
  return `notifications/${baseId}${
    clean(recipientUid) === clean(primaryUid) ? "" : "_" + safeRecipient
  }`;
}

function resolvedRequestResult(request = {}) {
  return {
    ok: true,
    code: "already_processed",
    ...requestSummary(request),
    actionable: false,
    reviewerUid: clean(request.resolvedBy) || null,
    decision:
      clean(request.status) === "accepted"
        ? "accept"
        : clean(request.status) === "rejected"
          ? "reject"
          : null,
  };
}

async function createRequest({
  db,
  actorUid,
  agencyId,
  uid,
  type,
  idempotencyKey,
  userPublicId,
  notificationUserId = null,
  now,
}) {
  const key = clean(idempotencyKey);
  if (!validIdempotencyKey(key)) throw new ApiError("invalid_idempotency_key", 400);
  const requestId = requestIdFor(actorUid, key);
  const opPath = operationPath(actorUid, key);
  const pairPath = requestKeyPath(agencyId, uid);
  const queuePath = pendingPath(agencyId, uid);
  const requestPath = `agency_membership_requests/${requestId}`;
  const requestFingerprint = fingerprint({
    action: type === "join" ? "requestJoin" : "invite",
    agencyId,
    uid,
    userPublicId,
  });

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const tx = await db.beginTransaction();
    try {
      const [
        operationSnap,
        agencySnap,
        userSnap,
        membershipSnap,
        appLockSnap,
        pairSnap,
        acceptanceSnap,
      ] = await Promise.all([
        db.get(opPath, tx),
        db.get(`agencies/${agencyId}`, tx),
        db.get(`users/${uid}`, tx),
        db.get(`agency_user_memberships/${uid}`, tx),
        db.get(`agency_application_locks/${uid}`, tx),
        db.get(pairPath, tx),
        db.get(acceptanceLockPath(uid), tx),
      ]);

      if (operationSnap.exists) {
        const existing = operationSnap.data || {};
        if (clean(existing.requestFingerprint) !== requestFingerprint) {
          throw new ApiError("idempotency_conflict", 409);
        }
        await db.rollback(tx);
        return { ok: true, code: "duplicate", ...(existing.result || {}) };
      }

      ensureAgencyActive(agencySnap);
      ensureUserCanNegotiate(userSnap, membershipSnap, appLockSnap);
      if (acceptanceSnap.exists) {
        throw new ApiError("membership_acceptance_conflict", 409, {
          requestId: clean(acceptanceSnap.data?.requestId) || null,
        });
      }
      if (pairSnap.exists) {
        throw new ApiError("membership_request_pair_conflict", 409, {
          requestId: clean(pairSnap.data?.requestId) || null,
        });
      }

      const request = createAgencyMembershipRequestDocument({
        requestId,
        agencyId,
        uid,
        type,
        actorUid,
        now,
      });
      const fullRequest = {
        ...request,
        userPublicId: clean(userPublicId) || clean(userSnap.data?.publicId) || null,
        agencyName: clean(agencySnap.data?.name) || null,
      };
      const result = requestSummary(fullRequest);
      const notificationId = `agency_membership_${type}_${requestId}`;
      const notificationUserIds =
        type === "join"
          ? await joinReviewerNotificationUids(
              db,
              tx,
              agencyId,
              agencySnap.data || {},
            )
          : [clean(notificationUserId || uid)].filter(Boolean);
      const primaryNotificationUid =
        type === "join"
          ? clean(agencySnap.data?.ownerUid)
          : clean(notificationUserId || uid);
      const notificationWrites = notificationUserIds.map((recipientUid) => {
        const suffix =
          recipientUid === primaryNotificationUid
            ? ""
            : "_" + recipientUid.replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 80);
        return db.writeCreate(`notifications/${notificationId}${suffix}`, {
          userId: recipientUid,
          type:
            type === "join"
              ? "agency_join_request"
              : "agency_membership_invite",
          category: "system",
          title:
            type === "join"
              ? "طلب انضمام جديد للوكالة"
              : "دعوة للانضمام إلى وكالة",
          body:
            type === "join"
              ? "يوجد مستخدم بانتظار مراجعة طلب الانضمام."
              : "لديك دعوة للانضمام إلى وكالة.",
          read: false,
          requestId,
          agencyId,
          requestType: type,
          applicantUid: uid,
          actionState: "pending",
          createdAt: now,
        });
      });

      const writes = [
        db.writeCreate(requestPath, fullRequest),
        db.writeCreate(pairPath, {
          requestId,
          agencyId,
          uid,
          type,
          status: "pending",
          createdAt: now,
          updatedAt: now,
        }),
        db.writeCreate(queuePath, {
          ...result,
          actorUid,
        }),
        db.writeCreate(opPath, {
          actorUid,
          action: type === "join" ? "requestJoin" : "invite",
          requestId,
          requestFingerprint,
          status: "completed",
          result,
          createdAt: now,
        }),
        db.writeCreate(`admin_audit_logs/agency_membership_create_${requestId}`, {
          actorUid,
          action: type === "join" ? "requestAgencyJoin" : "inviteAgencyHost",
          targetType: "agency_membership_request",
          targetId: requestId,
          after: result,
          idempotencyKey: key,
          createdAt: now,
        }),
        db.writeCreate(acceptanceLockPath(uid), {
          requestId,
          agencyId,
          uid,
          type,
          status: "pending",
          createdAt: now,
          updatedAt: now,
        }),
        ...notificationWrites,
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

export async function requestAgencyJoin(
  db,
  actorUid,
  body = {},
  { now = new Date() } = {},
) {
  const agencyId = clean(body.agencyId);
  if (!/^\d{3,8}$/.test(agencyId)) throw new ApiError("invalid_agency_id", 400);
  return createRequest({
    db,
    actorUid,
    agencyId,
    uid: actorUid,
    type: "join",
    idempotencyKey: body.idempotencyKey,
    userPublicId: null,
    now,
  });
}

export async function inviteAgencyHost(
  db,
  actorUid,
  body = {},
  { now = new Date() } = {},
) {
  const agencyId = clean(body.agencyId);
  const targetPublicId = clean(body.targetPublicId);
  if (!/^\d{3,8}$/.test(agencyId)) throw new ApiError("invalid_agency_id", 400);
  if (!/^\d{3,8}$/.test(targetPublicId)) {
    throw new ApiError("invalid_target_public_id", 400);
  }
  const actor = await loadAgencyActor(db, actorUid, agencyId, "invite");
  const publicIdSnap = await db.get(`public_ids/${targetPublicId}`);
  if (!publicIdSnap.exists || !clean(publicIdSnap.data?.uid)) {
    throw new ApiError("target_user_not_found", 404);
  }
  const uid = clean(publicIdSnap.data.uid);
  if (uid === actorUid) throw new ApiError("cannot_invite_self", 409);
  return createRequest({
    db,
    actorUid,
    agencyId,
    uid,
    type: "invite",
    idempotencyKey: body.idempotencyKey,
    userPublicId: targetPublicId,
    notificationUserId: uid,
    now,
  });
}


function leaveRequestFingerprint({ agencyId, uid }) {
  return fingerprint({
    action: "requestLeave",
    agencyId: clean(agencyId),
    uid: clean(uid),
  });
}

export async function requestAgencyLeave(
  db,
  actorUid,
  body = {},
  { now = new Date() } = {},
) {
  const agencyId = clean(body.agencyId);
  const key = clean(body.idempotencyKey);
  if (!/^\d{3,8}$/.test(agencyId)) {
    throw new ApiError("invalid_agency_id", 400);
  }
  if (!validIdempotencyKey(key)) {
    throw new ApiError("invalid_idempotency_key", 400);
  }

  const requestId = requestIdFor(actorUid, key);
  const opPath = operationPath(actorUid, key);
  const pairPath = requestKeyPath(agencyId, actorUid);
  const queuePath = pendingPath(agencyId, actorUid);
  const requestPath = `agency_membership_requests/${requestId}`;
  const fp = leaveRequestFingerprint({ agencyId, uid: actorUid });

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const tx = await db.beginTransaction();
    try {
      const [
        operationSnap,
        userMembershipSnap,
        agencyMembershipSnap,
        userSnap,
        agencySnap,
        pairSnap,
        pendingSnap,
      ] = await Promise.all([
        db.get(opPath, tx),
        db.get(`agency_user_memberships/${actorUid}`, tx),
        db.get(`agency_memberships/${agencyId}__${actorUid}`, tx),
        db.get(`users/${actorUid}`, tx),
        db.get(`agencies/${agencyId}`, tx),
        db.get(pairPath, tx),
        db.get(queuePath, tx),
      ]);

      if (operationSnap.exists) {
        const existing = operationSnap.data || {};
        if (clean(existing.requestFingerprint) !== fp) {
          throw new ApiError("idempotency_conflict", 409);
        }
        await db.rollback(tx);
        return { ok: true, code: "duplicate", ...(existing.result || {}) };
      }

      if (!userMembershipSnap.exists || !agencyMembershipSnap.exists) {
        throw new ApiError("agency_membership_not_found", 404);
      }
      const membership = userMembershipSnap.data || {};
      const agencyMembership = agencyMembershipSnap.data || {};
      const role = clean(membership.role);
      if (
        clean(membership.agencyId) !== agencyId ||
        clean(membership.uid) !== actorUid ||
        clean(membership.status) !== "active" ||
        clean(agencyMembership.agencyId) !== agencyId ||
        clean(agencyMembership.uid) !== actorUid ||
        clean(agencyMembership.status) !== "active" ||
        clean(agencyMembership.role) !== role
      ) {
        throw new ApiError("agency_membership_index_conflict", 409);
      }
      if (role === "owner") {
        throw new ApiError("agency_owner_departure_forbidden", 409);
      }
      if (!["host", "manager", "senior_manager"].includes(role)) {
        throw new ApiError("agency_membership_role_conflict", 409);
      }
      if (!userSnap.exists || clean(userSnap.data?.agencyId) !== agencyId) {
        throw new ApiError("agency_user_link_conflict", 409);
      }
      if (!agencySnap.exists) {
        throw new ApiError("agency_not_found", 404);
      }

      if (pairSnap.exists || pendingSnap.exists) {
        const pending = pendingSnap.exists ? pendingSnap.data || {} : {};
        const pair = pairSnap.exists ? pairSnap.data || {} : {};
        if (
          pairSnap.exists &&
          pendingSnap.exists &&
          clean(pair.requestId) === clean(pending.requestId) &&
          clean(pair.type) === "leave" &&
          clean(pending.type) === "leave" &&
          clean(pair.status) === "pending" &&
          clean(pending.status) === "pending" &&
          clean(pending.uid) === actorUid &&
          clean(pending.agencyId) === agencyId
        ) {
          await db.rollback(tx);
          return {
            ok: true,
            code: "already_pending",
            ...requestSummary(pending),
          };
        }
        throw new ApiError("membership_request_pair_conflict", 409, {
          requestId:
            clean(pair.requestId) ||
            clean(pending.requestId) ||
            null,
        });
      }

      const request = createAgencyMembershipRequestDocument({
        requestId,
        agencyId,
        uid: actorUid,
        type: "leave",
        actorUid,
        now,
      });
      const fullRequest = {
        ...request,
        initiatorSide: "user",
        userConsent: true,
        agencyConsent: false,
        userPublicId: clean(userSnap.data?.publicId) || null,
        agencyName: clean(agencySnap.data?.name) || null,
      };
      const result = requestSummary(fullRequest);
      const ownerUid = clean(agencySnap.data?.ownerUid);
      if (!ownerUid) {
        throw new ApiError("agency_owner_missing", 409);
      }
      const reviewerUids = await joinReviewerNotificationUids(
        db,
        tx,
        agencyId,
        agencySnap.data || {},
      );
      const leaveNotificationBase = `agency_leave_request_${requestId}`;
      const leaveNotificationWrites = reviewerUids.map((reviewerUid) =>
        db.writeCreate(
          reviewerNotificationPath(
            leaveNotificationBase,
            reviewerUid,
            ownerUid,
          ),
          {
            userId: reviewerUid,
            type: "agency_leave_request",
            category: "system",
            title: "طلب مغادرة وكالة",
            body: "يوجد عضو بانتظار مراجعة طلب مغادرة الوكالة.",
            read: false,
            requestId,
            agencyId,
            requestType: "leave",
            applicantUid: actorUid,
            actionState: "pending",
            createdAt: now,
          },
        ),
      );

      const writes = [
        db.writeCreate(requestPath, fullRequest),
        db.writeCreate(pairPath, {
          requestId,
          agencyId,
          uid: actorUid,
          type: "leave",
          status: "pending",
          createdAt: now,
          updatedAt: now,
        }),
        db.writeCreate(queuePath, {
          ...result,
          actorUid,
        }),
        db.writeCreate(opPath, {
          actorUid,
          action: "requestAgencyLeave",
          requestId,
          requestFingerprint: fp,
          status: "completed",
          result,
          createdAt: now,
        }),
        db.writeCreate(
          `admin_audit_logs/agency_leave_request_${requestId}`,
          {
            actorUid,
            action: "requestAgencyLeave",
            targetType: "agency_membership_request",
            targetId: requestId,
            after: result,
            idempotencyKey: key,
            createdAt: now,
          },
        ),
        ...leaveNotificationWrites,
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

export async function getMyAgencyLeaveRequestStatus(
  db,
  actorUid,
  body = {},
) {
  const agencyId = clean(body.agencyId);
  if (!/^\d{3,8}$/.test(agencyId)) {
    throw new ApiError("invalid_agency_id", 400);
  }

  const [membershipSnap, pendingSnap] = await Promise.all([
    db.get(`agency_user_memberships/${actorUid}`),
    db.get(pendingPath(agencyId, actorUid)),
  ]);
  if (!membershipSnap.exists) {
    throw new ApiError("agency_membership_not_found", 404);
  }
  const membership = membershipSnap.data || {};
  if (
    clean(membership.agencyId) !== agencyId ||
    clean(membership.uid) !== actorUid ||
    clean(membership.status) !== "active"
  ) {
    throw new ApiError("agency_membership_conflict", 409);
  }

  const role = clean(membership.role);
  if (pendingSnap.exists) {
    const pending = pendingSnap.data || {};
    if (
      clean(pending.agencyId) !== agencyId ||
      clean(pending.uid) !== actorUid ||
      clean(pending.type) !== "leave"
    ) {
      throw new ApiError("agency_leave_request_conflict", 409);
    }
    return {
      ok: true,
      canRequestLeave: role !== "owner",
      request: requestSummary(pending),
    };
  }

  return {
    ok: true,
    canRequestLeave: role !== "owner",
    request: null,
  };
}

function responseFingerprint({ requestId, decision }) {
  return fingerprint({
    action: "respond",
    requestId: clean(requestId),
    decision: clean(decision),
  });
}

function leaveResponseFingerprint({ requestId, decision }) {
  return fingerprint({
    action: "respondLeave",
    requestId: clean(requestId),
    decision: clean(decision),
  });
}

export async function respondAgencyLeaveRequest(
  db,
  actorUid,
  body = {},
  { now = new Date() } = {},
) {
  const requestId = clean(body.requestId);
  const decision = clean(body.decision);
  const key = clean(body.idempotencyKey);
  const reason = clean(body.reason).slice(0, 500) || null;
  if (!requestId || requestId.includes("/")) {
    throw new ApiError("invalid_request_id", 400);
  }
  if (!["accept", "reject"].includes(decision)) {
    throw new ApiError("invalid_membership_decision", 400);
  }
  if (!validIdempotencyKey(key)) {
    throw new ApiError("invalid_idempotency_key", 400);
  }

  const opPath = operationPath(actorUid, key);
  const requestPath = "agency_membership_requests/" + requestId;
  const fp = leaveResponseFingerprint({ requestId, decision });

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const tx = await db.beginTransaction();
    try {
      const [operationSnap, requestSnap] = await Promise.all([
        db.get(opPath, tx),
        db.get(requestPath, tx),
      ]);

      if (operationSnap.exists) {
        const existing = operationSnap.data || {};
        if (clean(existing.requestFingerprint) !== fp) {
          throw new ApiError("idempotency_conflict", 409);
        }
        await db.rollback(tx);
        return { ok: true, code: "duplicate", ...(existing.result || {}) };
      }

      if (!requestSnap.exists) {
        throw new ApiError("membership_request_not_found", 404);
      }
      const request = requestSnap.data || {};
      if (
        clean(request.status) !== "pending" ||
        clean(request.type) !== "leave"
      ) {
        throw new ApiError("agency_leave_request_not_pending", 409);
      }

      const agencyId = clean(request.agencyId);
      const uid = clean(request.uid);
      if (!/^\d{3,8}$/.test(agencyId) || !uid) {
        throw new ApiError("agency_leave_request_invalid", 409);
      }

      const [
        agencySnap,
        actorMembershipSnap,
        actorUserSnap,
        membershipSnap,
        agencyMembershipSnap,
        userSnap,
        pairSnap,
        pendingSnap,
        acceptanceSnap,
        slotsSnap,
      ] = await Promise.all([
        db.get("agencies/" + agencyId, tx),
        db.get("agency_user_memberships/" + actorUid, tx),
        db.get("users/" + actorUid, tx),
        db.get("agency_user_memberships/" + uid, tx),
        db.get("agency_memberships/" + agencyId + "__" + uid, tx),
        db.get("users/" + uid, tx),
        db.get(requestKeyPath(agencyId, uid), tx),
        db.get(pendingPath(agencyId, uid), tx),
        db.get(acceptanceLockPath(uid), tx),
        db.get("agency_manager_slots/" + agencyId, tx),
      ]);

      if (!agencySnap.exists) throw new ApiError("agency_not_found", 404);
      const agency = agencySnap.data || {};
      const actorMembership =
        actorMembershipSnap.exists ? actorMembershipSnap.data || {} : {};
      const actorUser = actorUserSnap.exists ? actorUserSnap.data || {} : {};
      if (
        clean(agency.status) !== "active" ||
        clean(agency.ownerUid) !== actorUid ||
        clean(actorMembership.agencyId) !== agencyId ||
        clean(actorMembership.uid) !== actorUid ||
        clean(actorMembership.status) !== "active" ||
        clean(actorMembership.role) !== "owner" ||
        clean(actorUser.agencyId) !== agencyId
      ) {
        throw new ApiError("agency_owner_required", 403);
      }

      if (!membershipSnap.exists || !agencyMembershipSnap.exists || !userSnap.exists) {
        throw new ApiError("agency_membership_not_found", 404);
      }
      const membership = membershipSnap.data || {};
      const agencyMembership = agencyMembershipSnap.data || {};
      const role = clean(membership.role);
      if (
        clean(membership.agencyId) !== agencyId ||
        clean(membership.uid) !== uid ||
        clean(membership.status) !== "active" ||
        clean(agencyMembership.agencyId) !== agencyId ||
        clean(agencyMembership.uid) !== uid ||
        clean(agencyMembership.status) !== "active" ||
        clean(agencyMembership.role) !== role ||
        clean(userSnap.data?.agencyId) !== agencyId ||
        clean(userSnap.data?.agencyRole) !== role
      ) {
        throw new ApiError("agency_membership_index_conflict", 409);
      }
      if (role === "owner" || !["host", "manager", "senior_manager"].includes(role)) {
        throw new ApiError("agency_membership_role_conflict", 409);
      }
      if (
        !pairSnap.exists ||
        clean(pairSnap.data?.requestId) !== requestId ||
        clean(pairSnap.data?.type) !== "leave" ||
        clean(pairSnap.data?.status) !== "pending" ||
        !pendingSnap.exists ||
        clean(pendingSnap.data?.requestId) !== requestId ||
        clean(pendingSnap.data?.type) !== "leave" ||
        clean(pendingSnap.data?.status) !== "pending"
      ) {
        throw new ApiError("agency_leave_request_conflict", 409);
      }

      const status = decision === "accept" ? "accepted" : "rejected";
      const result = {
        requestId,
        agencyId,
        uid,
        type: "leave",
        status,
        departureStatus: decision === "accept" ? "left" : null,
      };

      const writes = [
        db.writeUpdate(
          requestPath,
          {
            status,
            agencyConsent: decision === "accept",
            updatedAt: now,
            resolvedAt: now,
            resolvedBy: actorUid,
            reason,
          },
          [
            "status",
            "agencyConsent",
            "updatedAt",
            "resolvedAt",
            "resolvedBy",
            "reason",
          ],
        ),
        db.writeDelete(requestKeyPath(agencyId, uid)),
        db.writeDelete(pendingPath(agencyId, uid)),
        db.writeCreate(opPath, {
          actorUid,
          action: "respondAgencyLeaveRequest",
          requestId,
          requestFingerprint: fp,
          status: "completed",
          result,
          createdAt: now,
        }),
        db.writeCreate(
          "admin_audit_logs/agency_leave_response_" + requestId + "_" + key,
          {
            actorUid,
            action:
              decision === "accept"
                ? "acceptAgencyLeaveRequest"
                : "rejectAgencyLeaveRequest",
            targetType: "agency_membership_request",
            targetId: requestId,
            before: {
              agencyId,
              uid,
              role,
              status: "pending",
            },
            after: {
              ...result,
              reason,
            },
            idempotencyKey: key,
            createdAt: now,
          },
        ),
        db.writeCreate(
          "notifications/agency_leave_response_" + requestId + "_" + key,
          {
            userId: uid,
            type:
              decision === "accept"
                ? "agency_leave_request_accepted"
                : "agency_leave_request_rejected",
            category: "system",
            title:
              decision === "accept"
                ? "تمت الموافقة على مغادرة الوكالة"
                : "تم رفض طلب مغادرة الوكالة",
            body:
              reason ||
              (decision === "accept"
                ? "تم إنهاء عضويتك في الوكالة. يمكنك الانضمام إلى وكالة بعد 7 أيام."
                : "بقيت عضويتك في الوكالة فعالة."),
            read: false,
            requestId,
            agencyId,
            createdAt: now,
          },
        ),
      ];

      if (decision === "accept") {
        const memberCount = Number(agency.memberCount);
        const roleCounterField = counterFieldForRole(role);
        const roleCount = Number(agency[roleCounterField]);
        if (
          !Number.isInteger(memberCount) ||
          memberCount <= 1 ||
          !roleCounterField ||
          !Number.isInteger(roleCount) ||
          roleCount <= 0
        ) {
          throw new ApiError("agency_counter_conflict", 409);
        }

        let departureManagerSlots = null;
        if (role === "manager" || role === "senior_manager") {
          if (!slotsSnap.exists) {
            throw new ApiError("agency_manager_slots_missing", 409);
          }
          const slots = normalizedManagerSlots(slotsSnap.data || {});
          ensureManagerCountersConsistent(agency, slots);
          ensureRoleSlotConsistency(role, uid, slots);
          departureManagerSlots = {
            seniorManagerUid:
              slots.seniorManagerUid === uid ? null : slots.seniorManagerUid,
            managerUids: slots.managerUids.filter((value) => value !== uid),
          };
        }

        const cooldownUntil = cooldownUntilFor(now);
        const membershipPatch = {
          status: "left",
          updatedAt: now,
          leftAt: now,
          removedAt: membership.removedAt || null,
          cooldownUntil,
        };
        result.cooldownUntil = cooldownUntil;

        writes.push(
          db.writeUpdate(
            "agency_memberships/" + agencyId + "__" + uid,
            membershipPatch,
            ["status", "updatedAt", "leftAt", "removedAt", "cooldownUntil"],
          ),
          db.writeUpdate(
            "agency_user_memberships/" + uid,
            membershipPatch,
            ["status", "updatedAt", "leftAt", "removedAt", "cooldownUntil"],
          ),
          db.writeUpdate(
            "users/" + uid,
            { agencyId: "", agencyRole: "" },
            ["agencyId", "agencyRole"],
          ),
          db.writeUpdate(
            "agencies/" + agencyId,
            { updatedAt: now },
            ["updatedAt"],
            [
              db.increment("memberCount", -1),
              db.increment(roleCounterField, -1),
            ],
          ),
          db.writeDelete(acceptanceLockPath(uid)),
        );

        if (departureManagerSlots) {
          writes.push(
            db.writeUpdate(
              "agency_manager_slots/" + agencyId,
              {
                seniorManagerUid: departureManagerSlots.seniorManagerUid,
                managerUids: departureManagerSlots.managerUids,
                updatedAt: now,
              },
              ["seniorManagerUid", "managerUids", "updatedAt"],
            ),
          );
        }
      }

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

export async function respondAgencyMembershipRequest(
  db,
  actorUid,
  body = {},
  { now = new Date() } = {},
) {
  const requestId = clean(body.requestId);
  const decision = clean(body.decision);
  const key = clean(body.idempotencyKey);
  if (!requestId || requestId.includes("/")) throw new ApiError("invalid_request_id", 400);
  if (!["accept", "reject"].includes(decision)) {
    throw new ApiError("invalid_membership_decision", 400);
  }
  if (!validIdempotencyKey(key)) throw new ApiError("invalid_idempotency_key", 400);

  const opPath = operationPath(actorUid, key);
  const requestPath = `agency_membership_requests/${requestId}`;
  const fp = responseFingerprint({ requestId, decision });

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const tx = await db.beginTransaction();
    try {
      const [operationSnap, requestSnap] = await Promise.all([
        db.get(opPath, tx),
        db.get(requestPath, tx),
      ]);
      if (operationSnap.exists) {
        const existing = operationSnap.data || {};
        if (clean(existing.requestFingerprint) !== fp) {
          throw new ApiError("idempotency_conflict", 409);
        }
        await db.rollback(tx);
        return { ok: true, code: "duplicate", ...(existing.result || {}) };
      }
      if (!requestSnap.exists) throw new ApiError("membership_request_not_found", 404);
      const request = requestSnap.data || {};
      if (clean(request.status) !== "pending") {
        throw new ApiError("membership_request_not_pending", 409);
      }

      const agencyId = clean(request.agencyId);
      const uid = clean(request.uid);
      const type = clean(request.type);
      if (!agencyId || !uid || !["join", "invite"].includes(type)) {
        throw new ApiError("membership_request_invalid", 409);
      }

      const pairPath = requestKeyPath(agencyId, uid);
      const queuePath = pendingPath(agencyId, uid);
      let notificationUserId;
      if (type === "invite") {
        if (actorUid !== uid) throw new ApiError("forbidden", 403);
        notificationUserId = clean(request.actorUid);
      } else {
        const actor = await loadAgencyActor(
          db,
          actorUid,
          agencyId,
          "review",
          tx,
        );
        notificationUserId = uid;
        if (!actor.agency) throw new ApiError("forbidden", 403);
      }

      const rankingMonth = currentAgencyMonthKey(now);
      const [
        userSnap,
        membershipSnap,
        agencyMembershipSnap,
        appLockSnap,
        pairSnap,
        acceptanceSnap,
        agencySnap,
        hostMonthSnap,
        policyOverrideSnap,
      ] = await Promise.all([
        db.get(`users/${uid}`, tx),
        db.get(`agency_user_memberships/${uid}`, tx),
        db.get(`agency_memberships/${agencyId}__${uid}`, tx),
        db.get(`agency_application_locks/${uid}`, tx),
        db.get(pairPath, tx),
        db.get(acceptanceLockPath(uid), tx),
        db.get(`agencies/${agencyId}`, tx),
        decision === "accept"
          ? db.get(
              `agency_host_monthly/${agencyId}__${rankingMonth}__${uid}`,
              tx,
            )
          : Promise.resolve({ exists: false, data: null }),
        decision === "accept"
          ? db.get(`agency_policy_overrides/${agencyId}`, tx)
          : Promise.resolve({ exists: false, data: null }),
      ]);
      if (decision === "accept") {
        ensureAgencyActive(agencySnap);
        ensureUserCanNegotiate(userSnap, membershipSnap, appLockSnap);
        ensureRejoinCooldownExpired(membershipSnap, now);
        if (
          agencyMembershipSnap.exists &&
          !historicalMembership(agencyMembershipSnap)
        ) {
          throw new ApiError("user_already_in_agency", 409);
        }
      }
      if (!pairSnap.exists || clean(pairSnap.data?.requestId) !== requestId) {
        throw new ApiError("membership_request_key_conflict", 409);
      }

      const userConsent =
        request.userConsent === true || (type === "invite" && decision === "accept");
      const agencyConsent =
        request.agencyConsent === true || (type === "join" && decision === "accept");
      const accepted = decision === "accept" && userConsent && agencyConsent;
      const acceptanceLockMatches =
        acceptanceSnap.exists &&
        clean(acceptanceSnap.data?.requestId) === requestId &&
        clean(acceptanceSnap.data?.agencyId) === agencyId;
      if (acceptanceSnap.exists && !acceptanceLockMatches) {
        throw new ApiError("membership_acceptance_conflict", 409, {
          requestId: clean(acceptanceSnap.data?.requestId) || null,
        });
      }
      if (
        acceptanceLockMatches &&
        clean(acceptanceSnap.data?.status) !== "pending"
      ) {
        throw new ApiError("membership_acceptance_conflict", 409, {
          requestId,
        });
      }

      const status = decision === "reject" ? "rejected" : accepted ? "accepted" : "pending";
      const membership = accepted
        ? createAgencyMembershipDocument({
            agencyId,
            uid,
            role: "host",
            joinedAt: now,
          })
        : null;
      const result = {
        requestId,
        agencyId,
        uid,
        type,
        status,
        userConsent,
        agencyConsent,
        membershipCommitted: accepted,
        membershipRole: accepted ? "host" : null,
      };
      const writes = [
        db.writeUpdate(requestPath, {
          status,
          userConsent,
          agencyConsent,
          acceptedAt: accepted ? now : null,
          membershipCommittedAt: accepted ? now : null,
          membershipRole: accepted ? "host" : null,
          updatedAt: now,
          resolvedAt: status === "pending" ? null : now,
          resolvedBy: status === "pending" ? null : actorUid,
          reason: decision === "reject" ? clean(body.reason).slice(0, 500) || null : null,
        }, [
          "status",
          "userConsent",
          "agencyConsent",
          "acceptedAt",
          "membershipCommittedAt",
          "membershipRole",
          "updatedAt",
          "resolvedAt",
          "resolvedBy",
          "reason",
        ]),
        db.writeCreate(opPath, {
          actorUid,
          action: "respondAgencyMembershipRequest",
          requestId,
          requestFingerprint: fp,
          status: "completed",
          result,
          createdAt: now,
        }),
        db.writeCreate(`admin_audit_logs/agency_membership_response_${requestId}_${key}`, {
          actorUid,
          action: decision === "accept" ? "acceptAgencyMembershipRequest" : "rejectAgencyMembershipRequest",
          targetType: "agency_membership_request",
          targetId: requestId,
          after: result,
          idempotencyKey: key,
          createdAt: now,
        }),
        db.writeCreate(`notifications/agency_membership_response_${requestId}`, {
          userId: decision === "accept" ? uid : notificationUserId,
          type:
            decision === "accept"
              ? "agency_membership_request_accepted"
              : "agency_membership_request_rejected",
          category: "system",
          title:
            decision === "accept"
              ? "تم تفعيل عضويتك في الوكالة"
              : "تم رفض طلب الوكالة",
          body:
            decision === "accept"
              ? "اكتملت الموافقة وتم تفعيل عضوية الوكالة."
              : clean(body.reason).slice(0, 500) || "تم رفض الطلب.",
          read: false,
          requestId,
          agencyId,
          createdAt: now,
        }),
      ];

      if (accepted) {
        const agencyOwnerUid = clean(agencySnap.data?.ownerUid);
        const agencyMembershipWrite = agencyMembershipSnap.exists
          ? db.writeUpdate(
              `agency_memberships/${agencyId}__${uid}`,
              membership,
              MEMBERSHIP_WRITE_FIELDS,
            )
          : db.writeCreate(
              `agency_memberships/${agencyId}__${uid}`,
              membership,
            );
        const userMembershipWrite = membershipSnap.exists
          ? db.writeUpdate(
              `agency_user_memberships/${uid}`,
              membership,
              MEMBERSHIP_WRITE_FIELDS,
            )
          : db.writeCreate(
              `agency_user_memberships/${uid}`,
              membership,
            );
        writes.push(
          agencyMembershipWrite,
          userMembershipWrite,
          db.writeUpdate(
            `users/${uid}`,
            {
              agencyId,
              agencyRole: "host",
              agencyJoinedAt: now,
              agencyPublicSupportAgencyId: agencyId,
              agencyPublicSupportMonth: rankingMonth,
              agencyPublicSupportCoins:
                agencyPublicSupportSeed(hostMonthSnap),
              agencyPolicySnapshot:
                agencyPolicySnapshotFromOverride(agencyId, policyOverrideSnap),
            },
            [
              "agencyId",
              "agencyRole",
              "agencyJoinedAt",
              "agencyPublicSupportAgencyId",
              "agencyPublicSupportMonth",
              "agencyPublicSupportCoins",
              "agencyPolicySnapshot",
            ],
          ),
          db.writeUpdate(
            `agencies/${agencyId}`,
            { updatedAt: now },
            ["updatedAt"],
            [
              db.increment("memberCount", 1),
              db.increment("hostCount", 1),
            ],
          ),
          db.writeDelete(pairPath),
          db.writeDelete(queuePath),
          acceptanceLockMatches
            ? db.writeUpdate(
                acceptanceLockPath(uid),
                {
                  status: "committed",
                  membershipRole: "host",
                  membershipCommittedAt: now,
                  updatedAt: now,
                },
                [
                  "status",
                  "membershipRole",
                  "membershipCommittedAt",
                  "updatedAt",
                ],
              )
            : db.writeCreate(acceptanceLockPath(uid), {
                requestId,
                agencyId,
                uid,
                status: "committed",
                membershipRole: "host",
                membershipCommittedAt: now,
                createdAt: now,
                updatedAt: now,
              }),
          db.writeCreate(
            `admin_audit_logs/agency_membership_commit_${requestId}`,
            {
              actorUid,
              action: "commitAgencyMembership",
              targetType: "agency_membership",
              targetId: `${agencyId}__${uid}`,
              after: {
                agencyId,
                uid,
                role: "host",
                requestId,
                requestType: type,
              },
              idempotencyKey: key,
              createdAt: now,
            },
          ),
        );
        if (agencyOwnerUid && agencyOwnerUid !== notificationUserId) {
          writes.push(
            db.writeCreate(
              `notifications/agency_membership_committed_${requestId}`,
              {
                userId: agencyOwnerUid,
                type: "agency_membership_committed",
                category: "system",
                title: "تمت إضافة مضيف إلى الوكالة",
                body: "اكتملت الموافقة وتم تفعيل عضوية المضيف.",
                read: false,
                requestId,
                agencyId,
                memberUid: uid,
                createdAt: now,
              },
            ),
          );
        }
      } else if (decision === "reject") {
        writes.push(db.writeDelete(pairPath), db.writeDelete(queuePath));
        if (acceptanceLockMatches) {
          writes.push(db.writeDelete(acceptanceLockPath(uid)));
        }
      }

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

export async function commitAcceptedAgencyMembership(
  db,
  actorUid,
  body = {},
  { now = new Date() } = {},
) {
  const requestId = clean(body.requestId);
  const key = clean(body.idempotencyKey);
  if (!requestId || requestId.includes("/")) {
    throw new ApiError("invalid_request_id", 400);
  }
  if (!validIdempotencyKey(key)) {
    throw new ApiError("invalid_idempotency_key", 400);
  }

  const requestPath = `agency_membership_requests/${requestId}`;
  const opPath = operationPath(actorUid, key);
  const fp = fingerprint({
    action: "commitAccepted",
    requestId,
  });

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const tx = await db.beginTransaction();
    try {
      const [operationSnap, requestSnap] = await Promise.all([
        db.get(opPath, tx),
        db.get(requestPath, tx),
      ]);
      if (operationSnap.exists) {
        const existing = operationSnap.data || {};
        if (clean(existing.requestFingerprint) !== fp) {
          throw new ApiError("idempotency_conflict", 409);
        }
        await db.rollback(tx);
        return { ok: true, code: "duplicate", ...(existing.result || {}) };
      }
      if (!requestSnap.exists) {
        throw new ApiError("membership_request_not_found", 404);
      }

      const request = requestSnap.data || {};
      const agencyId = clean(request.agencyId);
      const uid = clean(request.uid);
      if (
        clean(request.status) !== "accepted" ||
        request.userConsent !== true ||
        request.agencyConsent !== true ||
        !agencyId ||
        !uid
      ) {
        throw new ApiError("membership_request_not_accepted", 409);
      }

      if (actorUid !== uid) {
        await loadAgencyActor(
          db,
          actorUid,
          agencyId,
          "review",
          tx,
        );
      }

      const rankingMonth = currentAgencyMonthKey(now);
      const [
        userSnap,
        userMembershipSnap,
        agencyMembershipSnap,
        agencySnap,
        acceptanceSnap,
        hostMonthSnap,
        policyOverrideSnap,
      ] = await Promise.all([
        db.get(`users/${uid}`, tx),
        db.get(`agency_user_memberships/${uid}`, tx),
        db.get(`agency_memberships/${agencyId}__${uid}`, tx),
        db.get(`agencies/${agencyId}`, tx),
        db.get(acceptanceLockPath(uid), tx),
        db.get(
          `agency_host_monthly/${agencyId}__${rankingMonth}__${uid}`,
          tx,
        ),
        db.get(`agency_policy_overrides/${agencyId}`, tx),
      ]);
      ensureAgencyActive(agencySnap);

      if (
        userMembershipSnap.exists &&
        clean(userMembershipSnap.data?.status) === "active"
      ) {
        if (clean(userMembershipSnap.data?.agencyId) === agencyId) {
          await db.rollback(tx);
          return {
            ok: true,
            code: "already_committed",
            requestId,
            agencyId,
            uid,
            membershipCommitted: true,
            membershipRole: clean(userMembershipSnap.data?.role || "host"),
          };
        }
        throw new ApiError("user_already_in_agency", 409);
      }
      if (
        agencyMembershipSnap.exists &&
        !historicalMembership(agencyMembershipSnap)
      ) {
        throw new ApiError("user_already_in_agency", 409);
      }
      ensureRejoinCooldownExpired(userMembershipSnap, now);
      if (!isAvailableUser(userSnap) || clean(userSnap.data?.agencyId)) {
        throw new ApiError("user_already_in_agency", 409);
      }
      if (
        !acceptanceSnap.exists ||
        clean(acceptanceSnap.data?.requestId) !== requestId ||
        clean(acceptanceSnap.data?.agencyId) !== agencyId ||
        !["accepted", "committed"].includes(
          clean(acceptanceSnap.data?.status),
        )
      ) {
        throw new ApiError("membership_acceptance_conflict", 409);
      }

      const membership = createAgencyMembershipDocument({
        agencyId,
        uid,
        role: "host",
        joinedAt: now,
      });
      const result = {
        requestId,
        agencyId,
        uid,
        status: "accepted",
        membershipCommitted: true,
        membershipRole: "host",
      };
      const agencyOwnerUid = clean(agencySnap.data?.ownerUid);
      const agencyMembershipWrite = agencyMembershipSnap.exists
        ? db.writeUpdate(
            `agency_memberships/${agencyId}__${uid}`,
            membership,
            MEMBERSHIP_WRITE_FIELDS,
          )
        : db.writeCreate(
            `agency_memberships/${agencyId}__${uid}`,
            membership,
          );
      const userMembershipWrite = userMembershipSnap.exists
        ? db.writeUpdate(
            `agency_user_memberships/${uid}`,
            membership,
            MEMBERSHIP_WRITE_FIELDS,
          )
        : db.writeCreate(
            `agency_user_memberships/${uid}`,
            membership,
          );
      const writes = [
        agencyMembershipWrite,
        userMembershipWrite,
        db.writeUpdate(
          `users/${uid}`,
          {
            agencyId,
            agencyRole: "host",
            agencyJoinedAt: now,
            agencyPublicSupportAgencyId: agencyId,
            agencyPublicSupportMonth: rankingMonth,
            agencyPublicSupportCoins:
              agencyPublicSupportSeed(hostMonthSnap),
            agencyPolicySnapshot:
              agencyPolicySnapshotFromOverride(agencyId, policyOverrideSnap),
          },
          [
            "agencyId",
            "agencyRole",
            "agencyJoinedAt",
            "agencyPublicSupportAgencyId",
            "agencyPublicSupportMonth",
            "agencyPublicSupportCoins",
            "agencyPolicySnapshot",
          ],
        ),
        db.writeUpdate(
          `agencies/${agencyId}`,
          { updatedAt: now },
          ["updatedAt"],
          [
            db.increment("memberCount", 1),
            db.increment("hostCount", 1),
          ],
        ),
        db.writeUpdate(
          requestPath,
          {
            membershipCommittedAt: now,
            membershipRole: "host",
            updatedAt: now,
          },
          ["membershipCommittedAt", "membershipRole", "updatedAt"],
        ),
        db.writeUpdate(
          acceptanceLockPath(uid),
          {
            status: "committed",
            membershipRole: "host",
            membershipCommittedAt: now,
            updatedAt: now,
          },
          [
            "status",
            "membershipRole",
            "membershipCommittedAt",
            "updatedAt",
          ],
        ),
        db.writeDelete(requestKeyPath(agencyId, uid)),
        db.writeDelete(pendingPath(agencyId, uid)),
        db.writeCreate(opPath, {
          actorUid,
          action: "commitAcceptedAgencyMembership",
          requestId,
          requestFingerprint: fp,
          status: "completed",
          result,
          createdAt: now,
        }),
        db.writeCreate(
          `admin_audit_logs/agency_membership_commit_${requestId}`,
          {
            actorUid,
            action: "commitAgencyMembership",
            targetType: "agency_membership",
            targetId: `${agencyId}__${uid}`,
            after: {
              agencyId,
              uid,
              role: "host",
              requestId,
              recoveryCommit: true,
            },
            idempotencyKey: key,
            createdAt: now,
          },
        ),
        db.writeCreate(
          `notifications/agency_membership_active_${requestId}`,
          {
            userId: uid,
            type: "agency_membership_active",
            category: "system",
            title: "تم تفعيل عضويتك في الوكالة",
            body: "اكتملت الموافقة وتم تفعيل عضويتك كمضيف.",
            read: false,
            requestId,
            agencyId,
            createdAt: now,
          },
        ),
      ];
      if (agencyOwnerUid && agencyOwnerUid !== uid) {
        writes.push(
          db.writeCreate(
            `notifications/agency_membership_owner_${requestId}`,
            {
              userId: agencyOwnerUid,
              type: "agency_membership_committed",
              category: "system",
              title: "تمت إضافة مضيف إلى الوكالة",
              body: "تم تفعيل عضوية المضيف في الوكالة.",
              read: false,
              requestId,
              agencyId,
              memberUid: uid,
              createdAt: now,
            },
          ),
        );
      }

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



function managerRoleFingerprint({ agencyId, targetUid, targetRole }) {
  return fingerprint({
    action: "setManagerRole",
    agencyId: clean(agencyId),
    targetUid: clean(targetUid),
    targetRole: clean(targetRole),
  });
}

function normalizedManagerSlots(data = {}) {
  const seniorManagerUid = clean(data.seniorManagerUid) || null;
  const managerUids = Array.isArray(data.managerUids)
    ? data.managerUids.map(clean).filter(Boolean)
    : [];
  if (
    managerUids.length > AGENCY_LIMITS.agencyManagers ||
    new Set(managerUids).size !== managerUids.length ||
    (seniorManagerUid && managerUids.includes(seniorManagerUid))
  ) {
    throw new ApiError("agency_manager_slots_conflict", 409);
  }
  return { seniorManagerUid, managerUids };
}

function ensureRoleSlotConsistency(role, targetUid, slots) {
  const isSenior = slots.seniorManagerUid === targetUid;
  const isManager = slots.managerUids.includes(targetUid);
  if (role === "host" && (isSenior || isManager)) {
    throw new ApiError("agency_manager_slots_conflict", 409);
  }
  if (role === "manager" && (!isManager || isSenior)) {
    throw new ApiError("agency_manager_slots_conflict", 409);
  }
  if (role === "senior_manager" && (!isSenior || isManager)) {
    throw new ApiError("agency_manager_slots_conflict", 409);
  }
}

function ensureManagerCountersConsistent(agency, slots) {
  const memberCount = Number(agency.memberCount);
  const hostCount = Number(agency.hostCount);
  const managerCount = Number(agency.managerCount);
  const seniorManagerCount = Number(agency.seniorManagerCount);
  const expectedSeniorCount = slots.seniorManagerUid ? 1 : 0;
  if (
    !Number.isInteger(memberCount) ||
    !Number.isInteger(hostCount) ||
    !Number.isInteger(managerCount) ||
    !Number.isInteger(seniorManagerCount) ||
    memberCount < 1 ||
    hostCount < 0 ||
    managerCount < 0 ||
    seniorManagerCount < 0 ||
    managerCount !== slots.managerUids.length ||
    seniorManagerCount !== expectedSeniorCount ||
    hostCount + managerCount + seniorManagerCount + 1 !== memberCount
  ) {
    throw new ApiError("agency_counter_conflict", 409);
  }
}

export async function setAgencyManagerRole(
  db,
  actorUid,
  body = {},
  { now = new Date() } = {},
) {
  const agencyId = clean(body.agencyId);
  const targetUid = clean(body.targetUid);
  const targetRole = clean(body.targetRole);
  const key = clean(body.idempotencyKey);

  if (!/^\d{3,8}$/.test(agencyId)) {
    throw new ApiError("invalid_agency_id", 400);
  }
  if (!targetUid || targetUid.includes("/")) {
    throw new ApiError("invalid_target_user", 400);
  }
  if (!["host", "manager", "senior_manager"].includes(targetRole)) {
    throw new ApiError("invalid_agency_manager_role", 400);
  }
  if (!validIdempotencyKey(key)) {
    throw new ApiError("invalid_idempotency_key", 400);
  }

  const opPath = operationPath(actorUid, key);
  const eventId = requestIdFor(actorUid, key);
  const fp = managerRoleFingerprint({ agencyId, targetUid, targetRole });

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const tx = await db.beginTransaction();
    try {
      const [
        operationSnap,
        agencySnap,
        slotsSnap,
        targetMembershipSnap,
        targetAgencyMembershipSnap,
        targetUserSnap,
        actorUserSnap,
        actorMembershipSnap,
      ] = await Promise.all([
        db.get(opPath, tx),
        db.get("agencies/" + agencyId, tx),
        db.get("agency_manager_slots/" + agencyId, tx),
        db.get("agency_user_memberships/" + targetUid, tx),
        db.get("agency_memberships/" + agencyId + "__" + targetUid, tx),
        db.get("users/" + targetUid, tx),
        db.get("users/" + actorUid, tx),
        db.get("agency_user_memberships/" + actorUid, tx),
      ]);

      if (operationSnap.exists) {
        const existing = operationSnap.data || {};
        if (clean(existing.requestFingerprint) !== fp) {
          throw new ApiError("idempotency_conflict", 409);
        }
        await db.rollback(tx);
        return { ok: true, code: "duplicate", ...(existing.result || {}) };
      }

      if (!agencySnap.exists) throw new ApiError("agency_not_found", 404);
      const agency = agencySnap.data || {};
      if (clean(agency.status) !== "active") {
        throw new ApiError("agency_not_active", 409);
      }
      if (!slotsSnap.exists) {
        throw new ApiError("agency_manager_slots_missing", 409);
      }

      const actorUser = actorUserSnap.exists ? actorUserSnap.data || {} : {};
      const actorMembership =
        actorMembershipSnap.exists &&
        clean(actorMembershipSnap.data?.agencyId) === agencyId
          ? actorMembershipSnap.data || {}
          : {};
      if (!canPerformAgencyAction({
        action: "manageManager",
        user: actorUser,
        membership: actorMembership,
        agencyStatus: clean(agency.status),
      })) {
        throw new ApiError("forbidden", 403);
      }

      if (
        !targetMembershipSnap.exists ||
        !targetAgencyMembershipSnap.exists ||
        !targetUserSnap.exists
      ) {
        throw new ApiError("agency_membership_not_found", 404);
      }

      const targetMembership = targetMembershipSnap.data || {};
      const targetAgencyMembership = targetAgencyMembershipSnap.data || {};
      const currentRole = clean(targetMembership.role);
      if (
        clean(targetMembership.status) !== "active" ||
        clean(targetMembership.agencyId) !== agencyId ||
        clean(targetAgencyMembership.status) !== "active" ||
        clean(targetAgencyMembership.agencyId) !== agencyId ||
        clean(targetAgencyMembership.uid) !== targetUid ||
        clean(targetAgencyMembership.role) !== currentRole ||
        clean(targetUserSnap.data?.agencyId) !== agencyId ||
        clean(targetUserSnap.data?.agencyRole) !== currentRole
      ) {
        throw new ApiError("agency_membership_index_conflict", 409);
      }
      if (currentRole === "owner") {
        throw new ApiError("agency_owner_role_locked", 409);
      }
      if (!["host", "manager", "senior_manager"].includes(currentRole)) {
        throw new ApiError("agency_membership_role_conflict", 409);
      }

      const slots = normalizedManagerSlots(slotsSnap.data || {});
      ensureManagerCountersConsistent(agency, slots);
      ensureRoleSlotConsistency(currentRole, targetUid, slots);

      if (currentRole === targetRole) {
        await db.rollback(tx);
        return {
          ok: true,
          code: "already_role",
          agencyId,
          uid: targetUid,
          previousRole: currentRole,
          role: targetRole,
        };
      }

      let seniorManagerUid = slots.seniorManagerUid;
      let managerUids = slots.managerUids.filter((uid) => uid !== targetUid);
      if (seniorManagerUid === targetUid) seniorManagerUid = null;

      if (targetRole === "manager") {
        if (managerUids.length >= AGENCY_LIMITS.agencyManagers) {
          throw new ApiError("agency_manager_slots_full", 409);
        }
        managerUids.push(targetUid);
      } else if (targetRole === "senior_manager") {
        if (seniorManagerUid && seniorManagerUid !== targetUid) {
          throw new ApiError("agency_senior_manager_slot_full", 409);
        }
        seniorManagerUid = targetUid;
      }

      const currentCounter = counterFieldForRole(currentRole);
      const targetCounter = counterFieldForRole(targetRole);
      if (!currentCounter || !targetCounter) {
        throw new ApiError("agency_membership_role_conflict", 409);
      }
      const currentCount = Number(agency[currentCounter]);
      const targetCount = Number(agency[targetCounter]);
      if (
        !Number.isInteger(currentCount) ||
        currentCount <= 0 ||
        !Number.isInteger(targetCount) ||
        targetCount < 0
      ) {
        throw new ApiError("agency_counter_conflict", 409);
      }

      const result = {
        agencyId,
        uid: targetUid,
        previousRole: currentRole,
        role: targetRole,
        managerSlots: {
          seniorManagerUid,
          managerUids,
        },
      };

      await db.commit(tx, [
        db.writeUpdate(
          "agency_user_memberships/" + targetUid,
          { role: targetRole, updatedAt: now },
          ["role", "updatedAt"],
        ),
        db.writeUpdate(
          "agency_memberships/" + agencyId + "__" + targetUid,
          { role: targetRole, updatedAt: now },
          ["role", "updatedAt"],
        ),
        db.writeUpdate(
          "users/" + targetUid,
          { agencyRole: targetRole },
          ["agencyRole"],
        ),
        db.writeUpdate(
          "agency_manager_slots/" + agencyId,
          {
            seniorManagerUid,
            managerUids,
            updatedAt: now,
          },
          ["seniorManagerUid", "managerUids", "updatedAt"],
        ),
        db.writeUpdate(
          "agencies/" + agencyId,
          { updatedAt: now },
          ["updatedAt"],
          [
            db.increment(currentCounter, -1),
            db.increment(targetCounter, 1),
          ],
        ),
        db.writeCreate(opPath, {
          actorUid,
          action: "setAgencyManagerRole",
          requestFingerprint: fp,
          status: "completed",
          result,
          createdAt: now,
        }),
        db.writeCreate(
          "admin_audit_logs/agency_manager_role_" + eventId,
          {
            actorUid,
            action: "setAgencyManagerRole",
            targetType: "agency_membership",
            targetId: agencyId + "__" + targetUid,
            before: {
              role: currentRole,
              managerSlots: slots,
            },
            after: {
              role: targetRole,
              managerSlots: {
                seniorManagerUid,
                managerUids,
              },
            },
            idempotencyKey: key,
            createdAt: now,
          },
        ),
        db.writeCreate(
          "notifications/agency_manager_role_" + eventId,
          {
            userId: targetUid,
            type: "agency_membership_role_changed",
            category: "system",
            title: "تم تحديث دورك في الوكالة",
            body:
              targetRole === "senior_manager"
                ? "تم تعيينك مديرًا أول للوكالة."
                : targetRole === "manager"
                  ? "تم تعيينك مديرًا للوكالة."
                  : "تم تحويل دورك في الوكالة إلى مضيف.",
            read: false,
            agencyId,
            previousRole: currentRole,
            role: targetRole,
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

function departureFingerprint({ action, agencyId, targetUid }) {
  return fingerprint({
    action: clean(action),
    agencyId: clean(agencyId),
    targetUid: clean(targetUid),
  });
}

function counterFieldForRole(role) {
  switch (clean(role)) {
    case "host":
      return "hostCount";
    case "manager":
      return "managerCount";
    case "senior_manager":
      return "seniorManagerCount";
    default:
      return null;
  }
}

async function changeAgencyMembershipStatus(
  db,
  actorUid,
  body = {},
  action,
  { now = new Date() } = {},
) {
  const key = clean(body.idempotencyKey);
  if (!validIdempotencyKey(key)) {
    throw new ApiError("invalid_idempotency_key", 400);
  }
  if (!["leave", "remove"].includes(action)) {
    throw new ApiError("invalid_membership_departure_action", 400);
  }

  const targetUid = action === "leave" ? actorUid : clean(body.targetUid);
  if (!targetUid || targetUid.includes("/")) {
    throw new ApiError("invalid_target_user", 400);
  }
  if (action === "remove" && actorUid === targetUid) {
    throw new ApiError("use_leave_for_self", 409);
  }

  const requestedAgencyId = clean(body.agencyId);
  if (requestedAgencyId && !/^\d{3,8}$/.test(requestedAgencyId)) {
    throw new ApiError("invalid_agency_id", 400);
  }

  const opPath = operationPath(actorUid, key);
  const eventId = requestIdFor(actorUid, key);

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const tx = await db.beginTransaction();
    try {
      const [operationSnap, userMembershipSnap] = await Promise.all([
        db.get(opPath, tx),
        db.get("agency_user_memberships/" + targetUid, tx),
      ]);

      if (operationSnap.exists) {
        const existing = operationSnap.data || {};
        const expected = departureFingerprint({
          action,
          agencyId: clean(existing.result?.agencyId || requestedAgencyId),
          targetUid,
        });
        if (clean(existing.requestFingerprint) !== expected) {
          throw new ApiError("idempotency_conflict", 409);
        }
        await db.rollback(tx);
        return { ok: true, code: "duplicate", ...(existing.result || {}) };
      }

      if (!userMembershipSnap.exists) {
        throw new ApiError("agency_membership_not_found", 404);
      }
      const userMembership = userMembershipSnap.data || {};
      const agencyId = clean(userMembership.agencyId);
      const role = clean(userMembership.role);
      if (!agencyId || (requestedAgencyId && requestedAgencyId !== agencyId)) {
        throw new ApiError("agency_membership_conflict", 409);
      }
      if (clean(userMembership.status) !== "active") {
        throw new ApiError("agency_membership_not_active", 409);
      }
      if (role === "owner") {
        throw new ApiError("agency_owner_departure_forbidden", 409);
      }

      const fp = departureFingerprint({ action, agencyId, targetUid });
      const [
        agencyMembershipSnap,
        userSnap,
        agencySnap,
        acceptanceSnap,
        actorUserSnap,
        actorMembershipSnap,
        managerSlotsSnap,
      ] = await Promise.all([
        db.get("agency_memberships/" + agencyId + "__" + targetUid, tx),
        db.get("users/" + targetUid, tx),
        db.get("agencies/" + agencyId, tx),
        db.get(acceptanceLockPath(targetUid), tx),
        action === "remove" ? db.get("users/" + actorUid, tx) : Promise.resolve(null),
        action === "remove"
          ? db.get("agency_user_memberships/" + actorUid, tx)
          : Promise.resolve(null),
        role === "manager" || role === "senior_manager"
          ? db.get("agency_manager_slots/" + agencyId, tx)
          : Promise.resolve(null),
      ]);

      if (!agencyMembershipSnap.exists) {
        throw new ApiError("agency_membership_index_missing", 409);
      }
      const agencyMembership = agencyMembershipSnap.data || {};
      if (
        clean(agencyMembership.agencyId) !== agencyId ||
        clean(agencyMembership.uid) !== targetUid ||
        clean(agencyMembership.status) !== "active" ||
        clean(agencyMembership.role) !== role
      ) {
        throw new ApiError("agency_membership_index_conflict", 409);
      }
      if (!agencySnap.exists) {
        throw new ApiError("agency_not_found", 404);
      }
      if (!userSnap.exists || clean(userSnap.data?.agencyId) !== agencyId) {
        throw new ApiError("agency_user_link_conflict", 409);
      }

      if (action === "remove") {
        const actorUser = actorUserSnap?.exists ? actorUserSnap.data || {} : {};
        const actorMembership =
          actorMembershipSnap?.exists &&
          clean(actorMembershipSnap.data?.agencyId) === agencyId
            ? actorMembershipSnap.data || {}
            : {};
        const platformAllowed = canPerformAgencyAction({
          action: "manageMembership",
          user: actorUser,
          membership: actorMembership,
          agencyStatus: clean(agencySnap.data?.status),
        });
        const agencyOwnerAllowed =
          clean(agencySnap.data?.status) === "active" &&
          clean(actorMembership.status) === "active" &&
          clean(actorMembership.role) === "owner";
        if (!platformAllowed && !agencyOwnerAllowed) {
          throw new ApiError("forbidden", 403);
        }
      }

      let departureManagerSlots = null;
      if (role === "manager" || role === "senior_manager") {
        if (!managerSlotsSnap?.exists) {
          throw new ApiError("agency_manager_slots_missing", 409);
        }
        const slots = normalizedManagerSlots(managerSlotsSnap.data || {});
        ensureManagerCountersConsistent(agencySnap.data || {}, slots);
        ensureRoleSlotConsistency(role, targetUid, slots);
        departureManagerSlots = {
          seniorManagerUid:
            slots.seniorManagerUid === targetUid
              ? null
              : slots.seniorManagerUid,
          managerUids: slots.managerUids.filter((uid) => uid !== targetUid),
        };
      }

      const memberCount = Number(agencySnap.data?.memberCount);
      if (!Number.isInteger(memberCount) || memberCount <= 0) {
        throw new ApiError("agency_counter_conflict", 409);
      }
      const roleCounterField = counterFieldForRole(role);
      if (roleCounterField) {
        const roleCount = Number(agencySnap.data?.[roleCounterField]);
        if (!Number.isInteger(roleCount) || roleCount <= 0) {
          throw new ApiError("agency_counter_conflict", 409);
        }
      }

      const status = action === "leave" ? "left" : "removed";
      const reason = clean(body.reason).slice(0, 500) || null;
      const cooldownUntil = cooldownUntilFor(now);
      const membershipPatch = {
        status,
        updatedAt: now,
        leftAt: action === "leave" ? now : userMembership.leftAt || null,
        removedAt: action === "remove" ? now : userMembership.removedAt || null,
        cooldownUntil,
      };
      const result = {
        agencyId,
        uid: targetUid,
        role,
        status,
        departedAt: now,
        cooldownUntil,
      };
      const increments = [db.increment("memberCount", -1)];
      if (roleCounterField) {
        increments.push(db.increment(roleCounterField, -1));
      }

      const ownerUid = clean(agencySnap.data?.ownerUid);
      const writes = [
        db.writeUpdate(
          "agency_memberships/" + agencyId + "__" + targetUid,
          membershipPatch,
          ["status", "updatedAt", "leftAt", "removedAt", "cooldownUntil"],
        ),
        db.writeUpdate(
          "agency_user_memberships/" + targetUid,
          membershipPatch,
          ["status", "updatedAt", "leftAt", "removedAt", "cooldownUntil"],
        ),
        db.writeUpdate(
          "users/" + targetUid,
          {
            agencyId: "",
            agencyRole: "",
          },
          ["agencyId", "agencyRole"],
        ),
        db.writeUpdate(
          "agencies/" + agencyId,
          { updatedAt: now },
          ["updatedAt"],
          increments,
        ),
        db.writeDelete(acceptanceLockPath(targetUid)),
        db.writeCreate(opPath, {
          actorUid,
          action: action === "leave"
            ? "leaveAgencyMembership"
            : "removeAgencyMember",
          requestFingerprint: fp,
          status: "completed",
          result,
          createdAt: now,
        }),
        db.writeCreate(
          "admin_audit_logs/agency_membership_departure_" + eventId,
          {
            actorUid,
            action: action === "leave"
              ? "leaveAgencyMembership"
              : "removeAgencyMember",
            targetType: "agency_membership",
            targetId: agencyId + "__" + targetUid,
            before: {
              agencyId,
              uid: targetUid,
              role,
              status: "active",
            },
            after: {
              agencyId,
              uid: targetUid,
              role,
              status,
              cooldownUntil,
              reason,
            },
            idempotencyKey: key,
            createdAt: now,
          },
        ),
        db.writeCreate(
          "notifications/agency_membership_departure_" + eventId,
          {
            userId: targetUid,
            type: action === "leave"
              ? "agency_membership_left"
              : "agency_membership_removed",
            category: "system",
            title: action === "leave"
              ? "تمت مغادرة الوكالة"
              : "تمت إزالتك من الوكالة",
            body: action === "leave"
              ? "تم إنهاء عضويتك في الوكالة. يمكنك الانضمام إلى وكالة بعد 7 أيام."
              : reason
                ? reason + " — يمكنك الانضمام إلى وكالة بعد 7 أيام."
                : "تم إنهاء عضويتك في الوكالة بواسطة الإدارة. يمكنك الانضمام إلى وكالة بعد 7 أيام.",
            read: false,
            agencyId,
            memberUid: targetUid,
            createdAt: now,
          },
        ),
      ];

      if (departureManagerSlots) {
        writes.push(
          db.writeUpdate(
            "agency_manager_slots/" + agencyId,
            {
              seniorManagerUid: departureManagerSlots.seniorManagerUid,
              managerUids: departureManagerSlots.managerUids,
              updatedAt: now,
            },
            ["seniorManagerUid", "managerUids", "updatedAt"],
          ),
        );
      }

      if (ownerUid && ownerUid !== targetUid) {
        writes.push(
          db.writeCreate(
            "notifications/agency_membership_owner_departure_" + eventId,
            {
              userId: ownerUid,
              type: action === "leave"
                ? "agency_member_left"
                : "agency_member_removed",
              category: "system",
              title: action === "leave"
                ? "غادر عضو الوكالة"
                : "تمت إزالة عضو من الوكالة",
              body: reason || (
                action === "leave"
                  ? "أنهى أحد الأعضاء عضويته في الوكالة."
                  : "تم إنهاء عضوية أحد الأعضاء."
              ),
              read: false,
              agencyId,
              memberUid: targetUid,
              createdAt: now,
            },
          ),
        );
      }

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

export async function leaveAgencyMembership(
  db,
  actorUid,
  body = {},
  options = {},
) {
  return changeAgencyMembershipStatus(db, actorUid, body, "leave", options);
}

export async function removeAgencyMember(
  db,
  actorUid,
  body = {},
  options = {},
) {
  return changeAgencyMembershipStatus(db, actorUid, body, "remove", options);
}


export async function overrideAgencyRejoinCooldown(
  db,
  actorUid,
  body = {},
  { now = new Date() } = {},
) {
  const targetUid = clean(body.targetUid);
  const key = clean(body.idempotencyKey);
  const reason = clean(body.reason).slice(0, 500);
  if (!targetUid || targetUid.includes("/")) {
    throw new ApiError("invalid_target_user", 400);
  }
  if (!validIdempotencyKey(key)) {
    throw new ApiError("invalid_idempotency_key", 400);
  }
  if (!reason) {
    throw new ApiError("cooldown_override_reason_required", 400);
  }

  const opPath = operationPath(actorUid, key);
  const fp = fingerprint({
    action: "overrideRejoinCooldown",
    targetUid,
    reason,
  });
  const eventId = requestIdFor(actorUid, key);

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const tx = await db.beginTransaction();
    try {
      const [operationSnap, actorUserSnap, membershipSnap] = await Promise.all([
        db.get(opPath, tx),
        db.get("users/" + actorUid, tx),
        db.get("agency_user_memberships/" + targetUid, tx),
      ]);

      if (operationSnap.exists) {
        const existing = operationSnap.data || {};
        if (clean(existing.requestFingerprint) !== fp) {
          throw new ApiError("idempotency_conflict", 409);
        }
        await db.rollback(tx);
        return { ok: true, code: "duplicate", ...(existing.result || {}) };
      }

      const actorUser = actorUserSnap.exists ? actorUserSnap.data || {} : {};
      if (!canPerformAgencyAction({
        action: "manageMembership",
        user: actorUser,
      })) {
        throw new ApiError("forbidden", 403);
      }
      if (!historicalMembership(membershipSnap)) {
        throw new ApiError(
          membershipSnap.exists
            ? "agency_membership_not_in_cooldown"
            : "agency_membership_not_found",
          membershipSnap.exists ? 409 : 404,
        );
      }

      const membership = membershipSnap.data || {};
      const agencyId = clean(membership.agencyId);
      if (!agencyId) {
        throw new ApiError("agency_membership_conflict", 409);
      }
      const previousCooldownUntilMs = timestampMs(membership.cooldownUntil);
      const nowMs = now instanceof Date ? now.getTime() : timestampMs(now);
      if (!previousCooldownUntilMs || previousCooldownUntilMs <= nowMs) {
        throw new ApiError("agency_rejoin_cooldown_not_active", 409);
      }

      const agencyMembershipPath =
        "agency_memberships/" + agencyId + "__" + targetUid;
      const agencyMembershipSnap = await db.get(agencyMembershipPath, tx);
      if (
        !historicalMembership(agencyMembershipSnap) ||
        clean(agencyMembershipSnap.data?.agencyId) !== agencyId ||
        clean(agencyMembershipSnap.data?.uid) !== targetUid
      ) {
        throw new ApiError("agency_membership_index_conflict", 409);
      }

      const previousCooldownUntil =
        new Date(previousCooldownUntilMs).toISOString();
      const result = {
        uid: targetUid,
        agencyId,
        previousCooldownUntil,
        cooldownUntil: now,
        overrideApplied: true,
      };
      const patch = {
        cooldownUntil: now,
        updatedAt: now,
      };

      await db.commit(tx, [
        db.writeUpdate(
          "agency_user_memberships/" + targetUid,
          patch,
          ["cooldownUntil", "updatedAt"],
        ),
        db.writeUpdate(
          agencyMembershipPath,
          patch,
          ["cooldownUntil", "updatedAt"],
        ),
        db.writeCreate(opPath, {
          actorUid,
          action: "overrideAgencyRejoinCooldown",
          requestFingerprint: fp,
          status: "completed",
          result,
          createdAt: now,
        }),
        db.writeCreate(
          "admin_audit_logs/agency_cooldown_override_" + eventId,
          {
            actorUid,
            action: "overrideAgencyRejoinCooldown",
            targetType: "agency_membership",
            targetId: agencyId + "__" + targetUid,
            before: {
              cooldownUntil: previousCooldownUntil,
            },
            after: {
              cooldownUntil: now,
              overrideApplied: true,
              reason,
            },
            idempotencyKey: key,
            createdAt: now,
          },
        ),
        db.writeCreate(
          "notifications/agency_cooldown_override_" + eventId,
          {
            userId: targetUid,
            type: "agency_rejoin_cooldown_overridden",
            category: "system",
            title: "تم رفع انتظار الانضمام للوكالة",
            body: "تم السماح لك بالانضمام إلى وكالة دون انتظار المدة المتبقية.",
            read: false,
            agencyId,
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

export async function cancelAgencyMembershipRequest(
  db,
  actorUid,
  body = {},
  { now = new Date() } = {},
) {
  const requestId = clean(body.requestId);
  const key = clean(body.idempotencyKey);
  if (!requestId || requestId.includes("/")) throw new ApiError("invalid_request_id", 400);
  if (!validIdempotencyKey(key)) throw new ApiError("invalid_idempotency_key", 400);
  const requestPath = `agency_membership_requests/${requestId}`;
  const opPath = operationPath(actorUid, key);
  const fp = fingerprint({ action: "cancel", requestId });

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const tx = await db.beginTransaction();
    try {
      const [operationSnap, requestSnap] = await Promise.all([
        db.get(opPath, tx),
        db.get(requestPath, tx),
      ]);
      if (operationSnap.exists) {
        const existing = operationSnap.data || {};
        if (clean(existing.requestFingerprint) !== fp) {
          throw new ApiError("idempotency_conflict", 409);
        }
        await db.rollback(tx);
        return { ok: true, code: "duplicate", ...(existing.result || {}) };
      }
      if (!requestSnap.exists) throw new ApiError("membership_request_not_found", 404);
      const request = requestSnap.data || {};
      if (clean(request.status) !== "pending") {
        throw new ApiError("membership_request_not_pending", 409);
      }
      const agencyId = clean(request.agencyId);
      const uid = clean(request.uid);
      const type = clean(request.type);
      const acceptanceSnap = await db.get(acceptanceLockPath(uid), tx);
      const acceptanceLockMatches =
        acceptanceSnap.exists &&
        clean(acceptanceSnap.data?.requestId) === requestId &&
        clean(acceptanceSnap.data?.agencyId) === agencyId;

      if (type === "join") {
        if (actorUid !== uid) throw new ApiError("forbidden", 403);
      } else if (type === "invite") {
        await loadAgencyActor(db, actorUid, agencyId, "invite");
      } else {
        throw new ApiError("membership_request_invalid", 409);
      }

      const result = {
        requestId,
        agencyId,
        uid,
        type,
        status: "cancelled",
      };
      const notifyUid = type === "join" ? clean(request.actorUid) : uid;
      const writes = [
        db.writeUpdate(requestPath, {
          status: "cancelled",
          updatedAt: now,
          resolvedAt: now,
          resolvedBy: actorUid,
          reason: clean(body.reason).slice(0, 500) || null,
        }, ["status", "updatedAt", "resolvedAt", "resolvedBy", "reason"]),
        db.writeDelete(requestKeyPath(agencyId, uid)),
        db.writeDelete(pendingPath(agencyId, uid)),
        ...(acceptanceLockMatches
          ? [db.writeDelete(acceptanceLockPath(uid))]
          : []),
        db.writeCreate(opPath, {
          actorUid,
          action: "cancelAgencyMembershipRequest",
          requestId,
          requestFingerprint: fp,
          status: "completed",
          result,
          createdAt: now,
        }),
        db.writeCreate(`admin_audit_logs/agency_membership_cancel_${requestId}_${key}`, {
          actorUid,
          action: "cancelAgencyMembershipRequest",
          targetType: "agency_membership_request",
          targetId: requestId,
          after: result,
          idempotencyKey: key,
          createdAt: now,
        }),
        db.writeCreate(`notifications/agency_membership_cancel_${requestId}`, {
          userId: notifyUid,
          type: "agency_membership_request_cancelled",
          category: "system",
          title: "تم إلغاء طلب الوكالة",
          body: clean(body.reason).slice(0, 500) || "تم إلغاء الطلب.",
          read: false,
          requestId,
          agencyId,
          createdAt: now,
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

function managementRolePermissions(role, agencyStatus = "active") {
  const permissions = agencyMemberPermissions({
    membership: { role, status: "active" },
    agencyStatus,
  });
  return {
    role,
    canViewHosts: permissions.canViewHosts,
    canReviewMembershipRequests: permissions.canReviewMembershipRequests,
    canManageInvites: permissions.canManageInvites,
    canManageRooms: permissions.canManageRooms,
    canManageManagers: permissions.canManageManagers,
    canViewAgencyFinance: permissions.canViewAgencyFinance,
    canViewOwnProgress: permissions.canViewOwnProgress,
  };
}

function activeMemberSummary(row, userSnap) {
  const membership = row?.data || {};
  const user = userSnap?.exists ? userSnap.data || {} : {};
  return {
    uid: clean(membership.uid || row?.id?.split("__").pop()),
    role: clean(membership.role),
    status: clean(membership.status),
    joinedAt: membership.joinedAt || null,
    publicId: clean(user.publicId) || null,
    displayName:
      clean(user.displayName || user.name || user.username) || null,
    profileImageUrl:
      clean(user.profileImageUrl || user.photoUrl || user.avatarUrl) || null,
    accountStatus: clean(user.accountStatus || "active"),
  };
}

async function resolveAgencyMembershipLookupId(db, input) {
  const lookupId = clean(input);
  if (!/^\d{3,8}$/.test(lookupId)) {
    throw new ApiError("invalid_agency_id", 400);
  }

  const registrySnap = await db.get("agency_ids/" + lookupId);
  const resolved = clean(registrySnap.data?.agencyId);
  if (
    registrySnap.exists &&
    registrySnap.data?.reserved !== true &&
    /^\d{3,8}$/.test(resolved)
  ) {
    return resolved;
  }

  const directSnap = await db.get("agencies/" + lookupId);
  const directPublicId = clean(directSnap.data?.publicId || lookupId);
  if (directSnap.exists && directPublicId === lookupId) return lookupId;

  throw new ApiError("agency_not_found", 404);
}

export async function listAgencyMembers(
  db,
  actorUid,
  body = {},
) {
  const agencyId = await resolveAgencyMembershipLookupId(
    db,
    body.agencyId,
  );
  const limit = Math.min(50, boundedAgencyPageSize(body.limit, 25));
  const [agencySnap, slotsSnap, actorUserSnap, actorMembershipSnap] =
    await Promise.all([
      db.get("agencies/" + agencyId),
      db.get("agency_manager_slots/" + agencyId),
      db.get("users/" + actorUid),
      db.get("agency_user_memberships/" + actorUid),
    ]);

  if (!agencySnap.exists) throw new ApiError("agency_not_found", 404);
  if (!slotsSnap.exists) {
    throw new ApiError("agency_manager_slots_missing", 409);
  }

  const agency = agencySnap.data || {};
  const actorUser = actorUserSnap.exists ? actorUserSnap.data || {} : {};
  const actorMembership =
    actorMembershipSnap.exists &&
    clean(actorMembershipSnap.data?.agencyId) === agencyId
      ? actorMembershipSnap.data || {}
      : {};
  const agencyStatus = clean(agency.status);
  const canManageManagers = canPerformAgencyAction({
    action: "manageManager",
    user: actorUser,
    membership: actorMembership,
    agencyStatus,
  });
  const canView =
    canManageManagers ||
    canPerformAgencyAction({
      action: "manageMembership",
      user: actorUser,
      membership: actorMembership,
      agencyStatus,
    }) ||
    canPerformAgencyAction({
      action: "viewHosts",
      user: actorUser,
      membership: actorMembership,
      agencyStatus,
    });
  if (!canView) throw new ApiError("forbidden", 403);

  const rows = await db.runQuery("agency_memberships", {
    filters: [
      { field: "agencyId", op: "==", value: agencyId },
      { field: "status", op: "==", value: "active" },
    ],
    limit,
  });
  const userSnaps = await Promise.all(
    rows.map((row) => {
      const uid = clean(row?.data?.uid || row?.id?.split("__").pop());
      return uid ? db.get("users/" + uid) : Promise.resolve({ exists: false });
    }),
  );
  const roleRank = {
    owner: 0,
    senior_manager: 1,
    manager: 2,
    host: 3,
  };
  const members = rows
    .map((row, index) => activeMemberSummary(row, userSnaps[index]))
    .sort((a, b) => {
      const roleDiff =
        (roleRank[a.role] ?? 99) - (roleRank[b.role] ?? 99);
      if (roleDiff !== 0) return roleDiff;
      return String(a.publicId || a.uid).localeCompare(
        String(b.publicId || b.uid),
      );
    });

  const slots = normalizedManagerSlots(slotsSnap.data || {});
  ensureManagerCountersConsistent(agency, slots);
  const totalActive = Number(agency.memberCount || 0);
  return {
    ok: true,
    agency: {
      agencyId,
      publicId: clean(agency.publicId || agencyId),
      name: clean(agency.name),
      status: agencyStatus,
      ownerUid: clean(agency.ownerUid),
      memberCount: totalActive,
      hostCount: Number(agency.hostCount || 0),
      managerCount: Number(agency.managerCount || 0),
      seniorManagerCount: Number(agency.seniorManagerCount || 0),
    },
    managerSlots: {
      seniorManagerUid: slots.seniorManagerUid,
      managerUids: slots.managerUids,
      managerLimit: AGENCY_LIMITS.agencyManagers,
      seniorManagerLimit: AGENCY_LIMITS.seniorManagers,
    },
    members,
    limit,
    truncated: totalActive > members.length,
    permissions: {
      canViewMembers: true,
      canManageManagers,
    },
    roleMatrix: [
      managementRolePermissions("owner", agencyStatus),
      managementRolePermissions("senior_manager", agencyStatus),
      managementRolePermissions("manager", agencyStatus),
      managementRolePermissions("host", agencyStatus),
    ],
  };
}

function pendingConflictStatus({
  agencyId,
  request,
  userSnap,
  lockSnap,
}) {
  const user = userSnap?.exists ? userSnap.data || {} : {};
  const accountStatus = clean(user.accountStatus || "active");
  if (!userSnap?.exists) return "user_missing";
  if (accountStatus !== "active") return "account_inactive";

  const type = clean(request.type);
  const linkedAgencyId = clean(user.agencyId);
  if (type === "leave") {
    return linkedAgencyId === agencyId ? "none" : "membership_changed";
  }
  if (linkedAgencyId) return "already_in_agency";

  if (
    lockSnap?.exists &&
    clean(lockSnap.data?.requestId) !== clean(request.requestId)
  ) {
    return "reserved_other_request";
  }
  return "none";
}

function pendingRequestView({
  agencyId,
  row,
  userSnap,
  lockSnap,
}) {
  const request = row?.data || {};
  const user = userSnap?.exists ? userSnap.data || {} : {};
  return {
    ...requestSummary(request),
    displayName:
      clean(user.displayName || user.name || user.username) || null,
    profileImageUrl:
      clean(user.profileImageUrl || user.photoUrl || user.avatarUrl) || null,
    accountStatus: clean(user.accountStatus || "active"),
    conflictStatus: pendingConflictStatus({
      agencyId,
      request,
      userSnap,
      lockSnap,
    }),
  };
}

export async function listAgencyMembershipPending(
  db,
  actorUid,
  body = {},
) {
  const agencyId = clean(body.agencyId);
  if (!/^\d{3,8}$/.test(agencyId)) throw new ApiError("invalid_agency_id", 400);
  await loadAgencyActor(db, actorUid, agencyId, "review");

  const limit = Math.min(25, boundedAgencyPageSize(body.limit, 25));
  const offsetRaw = Number(body.offset || 0);
  const offset =
    Number.isInteger(offsetRaw) && offsetRaw >= 0
      ? Math.min(75, offsetRaw)
      : 0;
  const windowLimit = 100;
  const rows = await db.runQuery("agency_membership_pending", {
    filters: [{ field: "agencyId", op: "==", value: agencyId }],
    limit: windowLimit,
  });
  const sorted = rows.slice().sort((left, right) => {
    const leftTime = timestampMs(left?.data?.createdAt);
    const rightTime = timestampMs(right?.data?.createdAt);
    if (leftTime !== rightTime) return rightTime - leftTime;
    return clean(right?.data?.requestId).localeCompare(
      clean(left?.data?.requestId),
    );
  });
  const pageRows = sorted.slice(offset, offset + limit);

  const userSnaps = await Promise.all(
    pageRows.map((row) => {
      const uid = clean(row?.data?.uid);
      return uid ? db.get("users/" + uid) : Promise.resolve({ exists: false });
    }),
  );
  const lockSnaps = await Promise.all(
    pageRows.map((row) => {
      const uid = clean(row?.data?.uid);
      return uid
        ? db.get(acceptanceLockPath(uid))
        : Promise.resolve({ exists: false });
    }),
  );

  const consumed = offset + pageRows.length;
  const hasMore = consumed < sorted.length;
  return {
    ok: true,
    limit,
    offset,
    nextOffset: hasMore ? consumed : null,
    hasMore,
    truncated: sorted.length === windowLimit && !hasMore,
    requests: pageRows.map((row, index) =>
      pendingRequestView({
        agencyId,
        row,
        userSnap: userSnaps[index],
        lockSnap: lockSnaps[index],
      })
    ),
  };
}

export async function getMyAgencyMembershipRequest(
  db,
  actorUid,
  body = {},
) {
  const requestId = clean(body.requestId);
  if (!requestId || requestId.includes("/")) {
    throw new ApiError("invalid_request_id", 400);
  }

  const requestSnap = await db.get(
    `agency_membership_requests/${requestId}`,
  );
  if (!requestSnap.exists) {
    throw new ApiError("membership_request_not_found", 404);
  }
  const request = requestSnap.data || {};
  if (clean(request.uid) !== actorUid) {
    throw new ApiError("forbidden", 403);
  }

  const agencyId = clean(request.agencyId);
  if (!/^\d{3,8}$/.test(agencyId)) {
    throw new ApiError("membership_request_invalid", 409);
  }
  const agencySnap = await db.get(`agencies/${agencyId}`);
  if (!agencySnap.exists) {
    throw new ApiError("agency_not_found", 404);
  }
  const agency = agencySnap.data || {};
  return {
    ok: true,
    request: requestSummary(request),
    agency: {
      agencyId,
      publicId: clean(agency.publicId || agencyId),
      name: clean(agency.name) || "Shadow Live Agency",
      country: clean(agency.country) || null,
      logoUrl:
        clean(agency.logoUrl || agency.imageUrl || agency.profileImageUrl) ||
        null,
      memberCount: Math.max(0, Number(agency.memberCount || 0)),
      hostCount: Math.max(0, Number(agency.hostCount || 0)),
      status: clean(agency.status) || "active",
    },
  };
}

export async function getMyAgencyJoinEligibility(
  db,
  actorUid,
) {
  const [userSnap, membershipSnap, appLockSnap, acceptanceSnap] =
    await Promise.all([
      db.get(`users/${actorUid}`),
      db.get(`agency_user_memberships/${actorUid}`),
      db.get(`agency_application_locks/${actorUid}`),
      db.get(acceptanceLockPath(actorUid)),
    ]);

  if (!userSnap.exists) throw new ApiError("user_not_found", 404);
  const user = userSnap.data || {};
  const membership = membershipSnap.exists ? membershipSnap.data || {} : {};
  const appLock = appLockSnap.exists ? appLockSnap.data || {} : {};
  const acceptance = acceptanceSnap.exists ? acceptanceSnap.data || {} : {};

  const linkedAgencyId =
    clean(user.agencyId) ||
    (clean(membership.status) === "active"
      ? clean(membership.agencyId)
      : "");
  const applicationStatus = clean(appLock.status);
  const applicationReserved =
    appLockSnap.exists &&
    ["draft", "reserved", "pending", "under_review"].includes(
      applicationStatus,
    );
  const membershipReserved =
    acceptanceSnap.exists &&
    ["pending", "accepted", "committed"].includes(clean(acceptance.status));

  return {
    ok: true,
    canRequestJoin:
      !linkedAgencyId &&
      !applicationReserved &&
      !membershipReserved,
    linkedAgencyId: linkedAgencyId || null,
    membershipRole: clean(membership.role) || null,
    membershipStatus: clean(membership.status) || null,
    membershipReservation: membershipReserved
      ? {
          requestId: clean(acceptance.requestId) || null,
          agencyId: clean(acceptance.agencyId) || null,
          status: clean(acceptance.status),
          type: clean(acceptance.type) || null,
        }
      : null,
    applicationReservation: applicationReserved
      ? {
          applicationId:
            clean(appLock.applicationId || appLock.requestId) || null,
          status: applicationStatus,
        }
      : null,
  };
}

export async function listMyAgencyMembershipRequests(
  db,
  actorUid,
  body = {},
) {
  const limit = Math.min(50, boundedAgencyPageSize(body.limit, 50));
  const rows = await db.runQuery("agency_membership_requests", {
    filters: [{ field: "uid", op: "==", value: actorUid }],
    limit,
  });
  return {
    ok: true,
    limit,
    requests: rows
      .map((row) => requestSummary(row.data || {}))
      .sort((a, b) => {
        const left = Date.parse(String(a.updatedAt || a.createdAt || "")) || 0;
        const right = Date.parse(String(b.updatedAt || b.createdAt || "")) || 0;
        return right - left;
      }),
  };
}

export async function agencyMembership(request, env) {
  if (request.method !== "POST") {
    return json(request, env, { ok: false, code: "method_not_allowed" }, 405);
  }
  try {
    const decoded = await verifyFirebaseIdToken(request, env);
    if (decoded.firebase?.sign_in_provider === "anonymous") {
      throw new ApiError("account_required", 403);
    }
    const body = await readJson(request);
    const action = clean(body.action);
    annotatePressureRequest(request, {
      action: `agencyMembership:${action}`,
    });
    const db = firestoreClient(env);
    let result;
    if (action === "requestJoin") {
      result = await requestAgencyJoin(db, decoded.sub, body);
    } else if (action === "requestLeave") {
      result = await requestAgencyLeave(db, decoded.sub, body);
    } else if (action === "leaveStatus") {
      result = await getMyAgencyLeaveRequestStatus(db, decoded.sub, body);
    } else if (action === "invite") {
      result = await inviteAgencyHost(db, decoded.sub, body);
    } else if (action === "respond") {
      result = await respondAgencyMembershipRequest(db, decoded.sub, body);
    } else if (action === "respondLeave") {
      result = await respondAgencyLeaveRequest(db, decoded.sub, body);
    } else if (action === "cancel") {
      result = await cancelAgencyMembershipRequest(db, decoded.sub, body);
    } else if (action === "commitAccepted") {
      result = await commitAcceptedAgencyMembership(
        db,
        decoded.sub,
        body,
      );
    } else if (action === "leave") {
      result = await leaveAgencyMembership(db, decoded.sub, body);
    } else if (action === "remove") {
      result = await removeAgencyMember(db, decoded.sub, body);
    } else if (action === "overrideCooldown") {
      result = await overrideAgencyRejoinCooldown(db, decoded.sub, body);
    } else if (action === "setManagerRole") {
      result = await setAgencyManagerRole(db, decoded.sub, body);
    } else if (action === "listAgencyMembers") {
      result = await listAgencyMembers(db, decoded.sub, body);
    } else if (action === "listAgencyPending") {
      result = await listAgencyMembershipPending(db, decoded.sub, body);
    } else if (action === "getMyRequest") {
      result = await getMyAgencyMembershipRequest(db, decoded.sub, body);
    } else if (action === "eligibility") {
      result = await getMyAgencyJoinEligibility(db, decoded.sub);
    } else if (action === "listMy") {
      result = await listMyAgencyMembershipRequests(db, decoded.sub, body);
    } else {
      throw new ApiError("invalid_action", 400);
    }
    return json(request, env, result);
  } catch (error) {
    if (error instanceof ApiError) {
      return json(request, env, {
        ok: false,
        code: error.code,
        ...(error.details ? { details: error.details } : {}),
      }, error.status);
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
    return json(request, env, { ok: false, code: "agency_membership_failed" }, 500);
  }
}
