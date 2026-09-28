import { json, readJson, firestoreQuotaResponse } from "./http.js";
import { verifyFirebaseIdToken } from "./firebase-auth.js";
import {
  firestoreClient,
  firestoreErrorRetryDelayMs,
  isTransientFirestoreError,
} from "./firestore.js";
import {
  boundedAgencyPageSize,
  createAgencyMembershipDocument,
  createAgencyMembershipRequestDocument,
} from "./agency-data-model.js";
import { canPerformAgencyAction } from "./agency-permissions.js";
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

function validIdempotencyKey(value) {
  return /^[A-Za-z0-9_-]{12,120}$/.test(clean(value));
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
  return status === "pending" || status === "under_review";
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

async function createRequest({
  db,
  actorUid,
  agencyId,
  uid,
  type,
  idempotencyKey,
  userPublicId,
  notificationUserId,
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
        db.writeCreate(`notifications/${notificationId}`, {
          userId: notificationUserId,
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

export async function requestAgencyJoin(
  db,
  actorUid,
  body = {},
  { now = new Date() } = {},
) {
  const agencyId = clean(body.agencyId);
  if (!/^\d{6}$/.test(agencyId)) throw new ApiError("invalid_agency_id", 400);
  const agencySnap = await db.get(`agencies/${agencyId}`);
  ensureAgencyActive(agencySnap);
  const ownerUid = clean(agencySnap.data?.ownerUid);
  if (!ownerUid) throw new ApiError("agency_owner_missing", 409);
  return createRequest({
    db,
    actorUid,
    agencyId,
    uid: actorUid,
    type: "join",
    idempotencyKey: body.idempotencyKey,
    userPublicId: null,
    notificationUserId: ownerUid,
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
  if (!/^\d{6}$/.test(agencyId)) throw new ApiError("invalid_agency_id", 400);
  if (!/^\d{6}$/.test(targetPublicId)) {
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

function responseFingerprint({ requestId, decision }) {
  return fingerprint({
    action: "respond",
    requestId: clean(requestId),
    decision: clean(decision),
  });
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

      const [
        userSnap,
        membershipSnap,
        agencyMembershipSnap,
        appLockSnap,
        pairSnap,
        acceptanceSnap,
        agencySnap,
      ] = await Promise.all([
        db.get(`users/${uid}`, tx),
        db.get(`agency_user_memberships/${uid}`, tx),
        db.get(`agency_memberships/${agencyId}__${uid}`, tx),
        db.get(`agency_application_locks/${uid}`, tx),
        db.get(pairPath, tx),
        db.get(acceptanceLockPath(uid), tx),
        db.get(`agencies/${agencyId}`, tx),
      ]);
      if (decision === "accept") {
        ensureAgencyActive(agencySnap);
        ensureUserCanNegotiate(userSnap, membershipSnap, appLockSnap);
        if (agencyMembershipSnap.exists) {
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
      if (accepted && acceptanceSnap.exists) {
        throw new ApiError("membership_acceptance_conflict", 409, {
          requestId: clean(acceptanceSnap.data?.requestId) || null,
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
        writes.push(
          db.writeCreate(
            `agency_memberships/${agencyId}__${uid}`,
            membership,
          ),
          db.writeCreate(
            `agency_user_memberships/${uid}`,
            membership,
          ),
          db.writeUpdate(
            `users/${uid}`,
            {
              agencyId,
              agencyRole: "host",
              agencyJoinedAt: now,
            },
            ["agencyId", "agencyRole", "agencyJoinedAt"],
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
          db.writeCreate(acceptanceLockPath(uid), {
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

      const [
        userSnap,
        userMembershipSnap,
        agencyMembershipSnap,
        agencySnap,
        acceptanceSnap,
      ] = await Promise.all([
        db.get(`users/${uid}`, tx),
        db.get(`agency_user_memberships/${uid}`, tx),
        db.get(`agency_memberships/${agencyId}__${uid}`, tx),
        db.get(`agencies/${agencyId}`, tx),
        db.get(acceptanceLockPath(uid), tx),
      ]);
      ensureAgencyActive(agencySnap);

      if (userMembershipSnap.exists || agencyMembershipSnap.exists) {
        const existing =
          userMembershipSnap.exists
            ? userMembershipSnap.data || {}
            : agencyMembershipSnap.data || {};
        if (
          clean(existing.agencyId) === agencyId &&
          clean(existing.status) === "active"
        ) {
          await db.rollback(tx);
          return {
            ok: true,
            code: "already_committed",
            requestId,
            agencyId,
            uid,
            membershipCommitted: true,
            membershipRole: clean(existing.role || "host"),
          };
        }
        throw new ApiError("user_already_in_agency", 409);
      }
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
      const writes = [
        db.writeCreate(
          `agency_memberships/${agencyId}__${uid}`,
          membership,
        ),
        db.writeCreate(
          `agency_user_memberships/${uid}`,
          membership,
        ),
        db.writeUpdate(
          `users/${uid}`,
          {
            agencyId,
            agencyRole: "host",
            agencyJoinedAt: now,
          },
          ["agencyId", "agencyRole", "agencyJoinedAt"],
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

export async function listAgencyMembershipPending(
  db,
  actorUid,
  body = {},
) {
  const agencyId = clean(body.agencyId);
  if (!/^\d{6}$/.test(agencyId)) throw new ApiError("invalid_agency_id", 400);
  await loadAgencyActor(db, actorUid, agencyId, "review");
  const limit = Math.min(50, boundedAgencyPageSize(body.limit, 50));
  const rows = await db.runQuery("agency_membership_pending", {
    filters: [{ field: "agencyId", op: "==", value: agencyId }],
    limit,
  });
  return {
    ok: true,
    limit,
    requests: rows.map((row) => requestSummary(row.data || {})),
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
    } else if (action === "invite") {
      result = await inviteAgencyHost(db, decoded.sub, body);
    } else if (action === "respond") {
      result = await respondAgencyMembershipRequest(db, decoded.sub, body);
    } else if (action === "cancel") {
      result = await cancelAgencyMembershipRequest(db, decoded.sub, body);
    } else if (action === "commitAccepted") {
      result = await commitAcceptedAgencyMembership(
        db,
        decoded.sub,
        body,
      );
    } else if (action === "listAgencyPending") {
      result = await listAgencyMembershipPending(db, decoded.sub, body);
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
