import { json, readJson, firestoreQuotaResponse } from "./http.js";
import { verifyFirebaseIdToken } from "./firebase-auth.js";
import {
  firestoreClient,
  firestoreErrorRetryDelayMs,
  isTransientFirestoreError,
} from "./firestore.js";
import {
  AGENCY_REAPPLY_MODE,
  boundedAgencyPageSize,
  createAgencyDocument,
  createAgencyManagerSlotsDocument,
  createAgencyMembershipDocument,
  createAgencyStatusEventDocument,
} from "./agency-data-model.js";
import { platformAgencyPermissions } from "./agency-permissions.js";
import {
  DEFAULT_AGENCY_TARGETS,
  normalizeAgencyTargets,
} from "./agency-policy.js";
import {
  DEFAULT_REVENUE_TIERS,
  revenueTiers,
} from "./economy-policy.js";
import { overrideAgencyRejoinCooldown } from "./agency-membership.js";
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

function validAgencyId(value) {
  return /^\d{3,8}$/.test(clean(value));
}

function timestampMs(value) {
  if (value && typeof value.toMillis === "function") {
    const ms = Number(value.toMillis());
    return Number.isFinite(ms) ? ms : 0;
  }
  if (value instanceof Date) {
    const ms = value.getTime();
    return Number.isFinite(ms) ? ms : 0;
  }
  const ms = Date.parse(String(value || ""));
  return Number.isFinite(ms) ? ms : 0;
}

function isAvailableUser(snapshot) {
  if (!snapshot?.exists) return false;
  const data = snapshot.data || {};
  return clean(data.accountStatus || "active") === "active";
}

function activeMembership(snapshot) {
  if (!snapshot?.exists) return false;
  const status = clean(snapshot.data?.status);
  return status === "active" || status === "pending";
}

function userAlreadyInAgency(userSnap, membershipSnap) {
  return Boolean(clean(userSnap?.data?.agencyId)) || activeMembership(membershipSnap);
}

function creationFingerprint(payload) {
  return JSON.stringify({
    action: clean(payload.action),
    applicationId: clean(payload.applicationId),
    ownerPublicId: clean(payload.ownerPublicId),
    name: clean(payload.name),
    country: clean(payload.country),
    agencyId: clean(payload.agencyId),
  });
}

export function randomAgencyId() {
  const buffer = new Uint32Array(1);
  crypto.getRandomValues(buffer);
  return String(100000 + (buffer[0] % 900000));
}

function agencyIdCandidates(requestedId, supplied = null) {
  const requested = clean(requestedId);
  if (requested) {
    if (!validAgencyId(requested)) throw new ApiError("invalid_agency_id", 400);
    return [requested];
  }
  if (Array.isArray(supplied) && supplied.length) {
    return supplied.map(clean).filter(validAgencyId).slice(0, 8);
  }
  const values = [];
  while (values.length < 8) {
    const next = randomAgencyId();
    if (!values.includes(next)) values.push(next);
  }
  return values;
}

function sanitizeApplication(row) {
  const data = row?.data || {};
  return {
    applicationId: clean(data.applicationId || row?.id),
    applicantUid: clean(data.applicantUid),
    applicantPublicId: clean(data.applicantPublicId) || null,
    name: clean(data.name),
    country: clean(data.country) || null,
    hostIds: Array.isArray(data.hostIds) ? data.hostIds.map(clean) : [],
    status: clean(data.status),
    reviewedBy: clean(data.reviewedBy) || null,
    createdAt: data.createdAt || null,
    updatedAt: data.updatedAt || null,
  };
}

async function loadActor(db, actorUid) {
  const actor = await db.get(`users/${actorUid}`);
  if (!actor.exists) throw new ApiError("forbidden", 403);
  return {
    user: actor.data || {},
    permissions: platformAgencyPermissions(actor.data || {}),
  };
}

export async function listAgencyReviewQueue(db, limitInput = 50) {
  const totalLimit = Math.min(50, boundedAgencyPageSize(limitInput, 50));
  const perStatus = Math.max(1, Math.ceil(totalLimit / 2));
  const [pending, underReview] = await Promise.all([
    db.runQuery("agency_applications", {
      filters: [{ field: "status", op: "==", value: "pending" }],
      limit: perStatus,
    }),
    db.runQuery("agency_applications", {
      filters: [{ field: "status", op: "==", value: "under_review" }],
      limit: perStatus,
    }),
  ]);
  return [...pending, ...underReview]
    .map(sanitizeApplication)
    .sort((a, b) => timestampMs(a.createdAt) - timestampMs(b.createdAt))
    .slice(0, totalLimit);
}

export async function startAgencyReview(
  db,
  actorUid,
  applicationIdInput,
  { now = new Date() } = {},
) {
  const applicationId = clean(applicationIdInput);
  if (!applicationId || applicationId.includes("/")) {
    throw new ApiError("invalid_application_id", 400);
  }
  const path = `agency_applications/${applicationId}`;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const tx = await db.beginTransaction();
    try {
      const applicationSnap = await db.get(path, tx);
      if (!applicationSnap.exists) throw new ApiError("application_not_found", 404);
      const application = applicationSnap.data || {};
      const status = clean(application.status);
      if (status === "under_review") {
        if (clean(application.reviewedBy) === actorUid) {
          await db.rollback(tx);
          return { ok: true, code: "duplicate", applicationId, status };
        }
        throw new ApiError("application_review_conflict", 409);
      }
      if (status !== "pending") throw new ApiError("application_not_reviewable", 409);

      const participantUids = [
        clean(application.applicantUid),
        ...(Array.isArray(application.hostUids) ? application.hostUids.map(clean) : []),
      ].filter(Boolean);
      const lockSnaps = await Promise.all(
        participantUids.map((uid) => db.get(`agency_application_locks/${uid}`, tx)),
      );
      for (let index = 0; index < participantUids.length; index += 1) {
        const lock = lockSnaps[index];
        if (!lock.exists || clean(lock.data?.applicationId) !== applicationId) {
          throw new ApiError("application_lock_conflict", 409);
        }
      }

      const writes = [
        db.writeUpdate(path, {
          status: "under_review",
          reviewedBy: actorUid,
          reviewStartedAt: now,
          updatedAt: now,
        }, ["status", "reviewedBy", "reviewStartedAt", "updatedAt"]),
        ...participantUids.map((uid) =>
          db.writeUpdate(`agency_application_locks/${uid}`, {
            status: "under_review",
            updatedAt: now,
          }, ["status", "updatedAt"])
        ),
        db.writeCreate(
          `admin_audit_logs/agency_application_review_${applicationId}`,
          {
            actorUid,
            action: "startAgencyReview",
            targetType: "agency_application",
            targetId: applicationId,
            after: { status: "under_review" },
            createdAt: now,
          },
        ),
      ];
      await db.commit(tx, writes);
      return { ok: true, code: "ok", applicationId, status: "under_review" };
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

async function createAgencyForOwner({
  db,
  actorUid,
  ownerUid,
  ownerPublicId,
  name,
  country,
  applicationId = null,
  operationId,
  requestedAgencyId = null,
  createdFrom,
  hostUids = [],
  now,
  suppliedAgencyIds = null,
}) {
  const key = clean(operationId);
  if (!validIdempotencyKey(key)) throw new ApiError("invalid_idempotency_key", 400);
  const candidates = agencyIdCandidates(requestedAgencyId, suppliedAgencyIds);
  if (!candidates.length) throw new ApiError("agency_id_allocation_failed", 409);
  const operationPath = `agency_creation_operations/${actorUid}__${key}`;
  const fingerprint = creationFingerprint({
    action: createdFrom === "application" ? "approve" : "directCreate",
    applicationId,
    ownerPublicId,
    name,
    country,
    agencyId: requestedAgencyId,
  });

  for (const candidate of candidates) {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const tx = await db.beginTransaction();
      try {
        const baseReads = [
          db.get(operationPath, tx),
          db.get(`users/${ownerUid}`, tx),
          db.get(`agency_user_memberships/${ownerUid}`, tx),
          db.get(`agency_ids/${candidate}`, tx),
          db.get(`agencies/${candidate}`, tx),
          db.get(`agency_application_locks/${ownerUid}`, tx),
        ];
        if (applicationId) {
          baseReads.push(db.get(`agency_applications/${applicationId}`, tx));
          for (const uid of hostUids) {
            baseReads.push(db.get(`users/${uid}`, tx));
            baseReads.push(db.get(`agency_user_memberships/${uid}`, tx));
            baseReads.push(db.get(`agency_application_locks/${uid}`, tx));
          }
        }
        const reads = await Promise.all(baseReads);
        const [
          operationSnap,
          ownerSnap,
          ownerMembershipSnap,
          idRegistrySnap,
          agencySnap,
          ownerLockSnap,
        ] = reads;

        if (operationSnap.exists) {
          const existing = operationSnap.data || {};
          if (clean(existing.requestFingerprint) !== fingerprint) {
            throw new ApiError("idempotency_conflict", 409);
          }
          await db.rollback(tx);
          return { ok: true, code: "duplicate", ...(existing.result || {}) };
        }

        if (idRegistrySnap.exists || agencySnap.exists) {
          await db.rollback(tx);
          if (requestedAgencyId) throw new ApiError("agency_id_taken", 409);
          break;
        }
        if (!isAvailableUser(ownerSnap)) {
          throw new ApiError(ownerSnap.exists ? "owner_unavailable" : "owner_not_found", ownerSnap.exists ? 409 : 404);
        }
        if (userAlreadyInAgency(ownerSnap, ownerMembershipSnap)) {
          throw new ApiError("owner_already_in_agency", 409);
        }

        let application = null;
        let hostReadsOffset = 6;
        if (applicationId) {
          const applicationSnap = reads[6];
          hostReadsOffset = 7;
          if (!applicationSnap?.exists) throw new ApiError("application_not_found", 404);
          application = applicationSnap.data || {};
          if (clean(application.applicantUid) !== ownerUid) {
            throw new ApiError("application_owner_mismatch", 409);
          }
          if (!["pending", "under_review"].includes(clean(application.status))) {
            if (clean(application.status) === "approved" && clean(application.agencyId)) {
              await db.rollback(tx);
              return {
                ok: true,
                code: "already_approved",
                agencyId: clean(application.agencyId),
                applicationId,
              };
            }
            throw new ApiError("application_not_approvable", 409);
          }
          if (!ownerLockSnap.exists || clean(ownerLockSnap.data?.applicationId) !== applicationId) {
            throw new ApiError("application_lock_conflict", 409);
          }
          for (let index = 0; index < hostUids.length; index += 1) {
            const hostUser = reads[hostReadsOffset + index * 3];
            const hostMembership = reads[hostReadsOffset + index * 3 + 1];
            const hostLock = reads[hostReadsOffset + index * 3 + 2];
            if (!isAvailableUser(hostUser)) throw new ApiError("agency_host_unavailable", 409);
            if (userAlreadyInAgency(hostUser, hostMembership)) {
              throw new ApiError("agency_host_already_in_agency", 409);
            }
            if (!hostLock?.exists || clean(hostLock.data?.applicationId) !== applicationId) {
              throw new ApiError("application_lock_conflict", 409);
            }
          }
        } else if (ownerLockSnap.exists && ["pending", "under_review"].includes(clean(ownerLockSnap.data?.status))) {
          throw new ApiError("owner_has_active_application", 409);
        }

        const agency = createAgencyDocument({
          agencyId: candidate,
          publicId: candidate,
          ownerUid,
          name,
          country,
          createdFrom,
          sourceApplicationId: applicationId,
          now,
        });
        const ownerMembership = createAgencyMembershipDocument({
          agencyId: candidate,
          uid: ownerUid,
          role: "owner",
          joinedAt: now,
        });
        const managerSlots = createAgencyManagerSlotsDocument({
          agencyId: candidate,
          now,
        });
        const result = {
          agencyId: candidate,
          publicId: candidate,
          ownerUid,
          ownerPublicId,
          name: agency.name,
          country: agency.country,
          status: "active",
          ...(applicationId ? { applicationId } : {}),
        };

        const writes = [
          db.writeCreate(`agency_ids/${candidate}`, {
            agencyId: candidate,
            ownerUid,
            source: createdFrom,
            applicationId,
            allocatedAt: now,
          }),
          db.writeCreate(`agencies/${candidate}`, agency),
          db.writeCreate(`agency_memberships/${candidate}__${ownerUid}`, ownerMembership),
          db.writeCreate(`agency_user_memberships/${ownerUid}`, ownerMembership),
          db.writeCreate(`agency_manager_slots/${candidate}`, managerSlots),
          db.writeCreate(`agency_wallets/${candidate}`, {
            agencyId: candidate,
            diamonds: 0,
            remainderCoins: 0,
            lifetimeDiamonds: 0,
            updatedAt: now,
          }),
          db.writeUpdate(`users/${ownerUid}`, {
            agencyId: candidate,
            agencyRole: "owner",
            agencyJoinedAt: now,
          }, ["agencyId", "agencyRole", "agencyJoinedAt"]),
          db.writeCreate(operationPath, {
            actorUid,
            action: createdFrom === "application" ? "approveAgencyApplication" : "directCreateAgency",
            requestFingerprint: fingerprint,
            status: "completed",
            result,
            createdAt: now,
          }),
          db.writeCreate(`admin_audit_logs/agency_create_${candidate}_${key}`, {
            actorUid,
            action: createdFrom === "application" ? "approveAgencyApplication" : "directCreateAgency",
            targetType: "agency",
            targetId: candidate,
            after: result,
            idempotencyKey: key,
            createdAt: now,
          }),
          db.writeCreate(`notifications/agency_created_${candidate}_${key}`, {
            userId: ownerUid,
            type: applicationId ? "agency_application_approved" : "agency_created",
            category: "system",
            title: applicationId ? "تم قبول طلب إنشاء الوكالة" : "تم إنشاء وكالتك",
            body: `${agency.name} — ${candidate}`,
            read: false,
            agencyId: candidate,
            ...(applicationId ? { applicationId } : {}),
            createdAt: now,
          }),
        ];

        if (applicationId) {
          writes.push(
            db.writeUpdate(`agency_applications/${applicationId}`, {
              status: "approved",
              agencyId: candidate,
              approvedBy: actorUid,
              approvedAt: now,
              reviewedBy: actorUid,
              updatedAt: now,
            }, ["status", "agencyId", "approvedBy", "approvedAt", "reviewedBy", "updatedAt"]),
            db.writeUpdate(`agency_application_locks/${ownerUid}`, {
              status: "approved",
              agencyId: candidate,
              updatedAt: now,
            }, ["status", "agencyId", "updatedAt"]),
          );
          for (const uid of hostUids) {
            writes.push(
              db.writeUpdate(`agency_application_locks/${uid}`, {
                status: "approved",
                agencyId: candidate,
                updatedAt: now,
              }, ["status", "agencyId", "updatedAt"]),
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
  }
  throw new ApiError("agency_id_allocation_failed", 409);
}

export async function approveAgencyApplication(
  db,
  actorUid,
  body = {},
  { now = new Date(), agencyIdCandidates: suppliedAgencyIds = null } = {},
) {
  const applicationId = clean(body.applicationId);
  const key = clean(body.idempotencyKey);
  if (!applicationId || applicationId.includes("/")) throw new ApiError("invalid_application_id", 400);

  const applicationSnap = await db.get(`agency_applications/${applicationId}`);
  if (!applicationSnap.exists) throw new ApiError("application_not_found", 404);
  const application = applicationSnap.data || {};
  const hostUids = Array.isArray(application.hostUids)
    ? application.hostUids.map(clean).filter(Boolean)
    : [];
  if (hostUids.length !== 5) throw new ApiError("application_hosts_invalid", 409);

  return createAgencyForOwner({
    db,
    actorUid,
    ownerUid: clean(application.applicantUid),
    ownerPublicId: clean(application.applicantPublicId),
    name: clean(application.name),
    country: clean(application.country) || null,
    applicationId,
    operationId: key,
    requestedAgencyId: clean(body.agencyId) || null,
    createdFrom: "application",
    hostUids,
    now,
    suppliedAgencyIds,
  });
}

export function reapplyAllowedAtForMode(modeInput, nowInput = new Date()) {
  const mode = clean(modeInput);
  if (!AGENCY_REAPPLY_MODE.includes(mode)) {
    throw new ApiError("invalid_agency_reapply_mode", 400);
  }
  const now = nowInput instanceof Date ? nowInput : new Date(nowInput);
  const nowMs = now.getTime();
  if (!Number.isFinite(nowMs)) throw new ApiError("invalid_request", 400);
  if (mode === "manual") return null;
  const durationMs = {
    immediate: 0,
    "24h": 24 * 60 * 60 * 1000,
    "3d": 3 * 24 * 60 * 60 * 1000,
    "7d": 7 * 24 * 60 * 60 * 1000,
    "30d": 30 * 24 * 60 * 60 * 1000,
  }[mode];
  return new Date(nowMs + durationMs);
}

function rejectionFingerprint({
  applicationId,
  reason,
  reapplyMode,
}) {
  return JSON.stringify({
    action: "reject",
    applicationId: clean(applicationId),
    reason: clean(reason),
    reapplyMode: clean(reapplyMode),
  });
}

export async function rejectAgencyApplication(
  db,
  actorUid,
  body = {},
  { now = new Date() } = {},
) {
  const applicationId = clean(body.applicationId);
  const key = clean(body.idempotencyKey);
  const reason = clean(body.rejectionReason);
  const reapplyMode = clean(body.reapplyMode);
  if (!applicationId || applicationId.includes("/")) {
    throw new ApiError("invalid_application_id", 400);
  }
  if (!validIdempotencyKey(key)) {
    throw new ApiError("invalid_idempotency_key", 400);
  }
  if (reason.length < 3 || reason.length > 500) {
    throw new ApiError("invalid_rejection_reason", 400);
  }
  const reapplyAllowedAt = reapplyAllowedAtForMode(reapplyMode, now);
  const operationPath = `agency_review_operations/${actorUid}__${key}`;
  const applicationPath = `agency_applications/${applicationId}`;
  const fingerprint = rejectionFingerprint({
    applicationId,
    reason,
    reapplyMode,
  });

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const tx = await db.beginTransaction();
    try {
      const [operationSnap, applicationSnap] = await Promise.all([
        db.get(operationPath, tx),
        db.get(applicationPath, tx),
      ]);
      if (operationSnap.exists) {
        const existing = operationSnap.data || {};
        if (clean(existing.requestFingerprint) !== fingerprint) {
          throw new ApiError("idempotency_conflict", 409);
        }
        await db.rollback(tx);
        return { ok: true, code: "duplicate", ...(existing.result || {}) };
      }
      if (!applicationSnap.exists) {
        throw new ApiError("application_not_found", 404);
      }
      const application = applicationSnap.data || {};
      const status = clean(application.status);
      if (status === "rejected") {
        if (
          clean(application.rejectionReason) === reason &&
          clean(application.reapplyMode) === reapplyMode
        ) {
          await db.rollback(tx);
          return {
            ok: true,
            code: "already_rejected",
            applicationId,
            status: "rejected",
            rejectionReason: reason,
            reapplyMode,
            reapplyAllowedAt: application.reapplyAllowedAt || null,
          };
        }
        throw new ApiError("application_already_rejected", 409);
      }
      if (!["pending", "under_review"].includes(status)) {
        throw new ApiError("application_not_rejectable", 409);
      }

      const applicantUid = clean(application.applicantUid);
      const hostUids = Array.isArray(application.hostUids)
        ? application.hostUids.map(clean).filter(Boolean)
        : [];
      if (!applicantUid || hostUids.length !== 5) {
        throw new ApiError("application_participants_invalid", 409);
      }
      const participantUids = [applicantUid, ...hostUids];
      const lockSnaps = await Promise.all(
        participantUids.map((uid) =>
          db.get(`agency_application_locks/${uid}`, tx)
        ),
      );
      for (let index = 0; index < participantUids.length; index += 1) {
        const lock = lockSnaps[index];
        if (
          !lock.exists ||
          clean(lock.data?.applicationId) !== applicationId
        ) {
          throw new ApiError("application_lock_conflict", 409);
        }
      }

      const result = {
        applicationId,
        status: "rejected",
        rejectionReason: reason,
        reapplyMode,
        reapplyAllowedAt,
      };
      const notificationId =
        `agency_application_rejected_${applicationId}`;

      const writes = [
        db.writeUpdate(applicationPath, {
          status: "rejected",
          rejectedAt: now,
          rejectedBy: actorUid,
          rejectionReason: reason,
          reapplyMode,
          reapplyAllowedAt,
          reviewedBy: actorUid,
          updatedAt: now,
        }, [
          "status",
          "rejectedAt",
          "rejectedBy",
          "rejectionReason",
          "reapplyMode",
          "reapplyAllowedAt",
          "reviewedBy",
          "updatedAt",
        ]),
        db.writeUpdate(`agency_application_locks/${applicantUid}`, {
          status: "rejected",
          rejectedAt: now,
          rejectedBy: actorUid,
          rejectionReason: reason,
          reapplyMode,
          reapplyAllowedAt,
          updatedAt: now,
        }, [
          "status",
          "rejectedAt",
          "rejectedBy",
          "rejectionReason",
          "reapplyMode",
          "reapplyAllowedAt",
          "updatedAt",
        ]),
        ...hostUids.map((uid) =>
          db.writeUpdate(`agency_application_locks/${uid}`, {
            status: "released",
            releasedAt: now,
            reapplyMode: null,
            reapplyAllowedAt: null,
            rejectionReason: null,
            updatedAt: now,
          }, [
            "status",
            "releasedAt",
            "reapplyMode",
            "reapplyAllowedAt",
            "rejectionReason",
            "updatedAt",
          ])
        ),
        db.writeCreate(operationPath, {
          actorUid,
          action: "rejectAgencyApplication",
          applicationId,
          requestFingerprint: fingerprint,
          status: "completed",
          result,
          createdAt: now,
        }),
        db.writeCreate(
          `admin_audit_logs/agency_application_reject_${applicationId}`,
          {
            actorUid,
            action: "rejectAgencyApplication",
            targetType: "agency_application",
            targetId: applicationId,
            after: result,
            idempotencyKey: key,
            createdAt: now,
          },
        ),
        db.writeCreate(`notifications/${notificationId}`, {
          userId: applicantUid,
          type: "agency_application_rejected",
          category: "system",
          title: "تم رفض طلب إنشاء الوكالة",
          body: reason,
          read: false,
          applicationId,
          reapplyMode,
          reapplyAllowedAt,
          createdAt: now,
        }),
      ];
      if (reapplyMode === "manual") {
        writes.push(
          db.writeCreate(`agency_manual_reapply_blocks/${applicationId}`, {
            applicationId,
            applicantUid,
            applicantPublicId: clean(application.applicantPublicId) || null,
            name: clean(application.name),
            rejectionReason: reason,
            rejectedAt: now,
            rejectedBy: actorUid,
            createdAt: now,
          }),
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

export async function listAgencyManualReapplyBlocks(
  db,
  limitInput = 25,
) {
  const limit = Math.min(25, boundedAgencyPageSize(limitInput, 25));
  const rows = await db.runQuery("agency_manual_reapply_blocks", { limit });
  return rows
    .map((row) => {
      const data = row?.data || {};
      return {
        applicationId: clean(data.applicationId || row?.id),
        applicantUid: clean(data.applicantUid),
        applicantPublicId: clean(data.applicantPublicId) || null,
        name: clean(data.name),
        rejectionReason: clean(data.rejectionReason),
        rejectedAt: data.rejectedAt || null,
        rejectedBy: clean(data.rejectedBy) || null,
      };
    })
    .sort((a, b) => timestampMs(b.rejectedAt) - timestampMs(a.rejectedAt));
}

function unblockFingerprint(applicationId) {
  return JSON.stringify({
    action: "allowReapply",
    applicationId: clean(applicationId),
  });
}

export async function allowAgencyReapply(
  db,
  actorUid,
  body = {},
  { now = new Date() } = {},
) {
  const applicationId = clean(body.applicationId);
  const key = clean(body.idempotencyKey);
  if (!applicationId || applicationId.includes("/")) {
    throw new ApiError("invalid_application_id", 400);
  }
  if (!validIdempotencyKey(key)) {
    throw new ApiError("invalid_idempotency_key", 400);
  }
  const operationPath = `agency_review_operations/${actorUid}__${key}`;
  const blockPath = `agency_manual_reapply_blocks/${applicationId}`;
  const applicationPath = `agency_applications/${applicationId}`;
  const fingerprint = unblockFingerprint(applicationId);

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const tx = await db.beginTransaction();
    try {
      const [operationSnap, blockSnap, applicationSnap] = await Promise.all([
        db.get(operationPath, tx),
        db.get(blockPath, tx),
        db.get(applicationPath, tx),
      ]);
      if (operationSnap.exists) {
        const existing = operationSnap.data || {};
        if (clean(existing.requestFingerprint) !== fingerprint) {
          throw new ApiError("idempotency_conflict", 409);
        }
        await db.rollback(tx);
        return { ok: true, code: "duplicate", ...(existing.result || {}) };
      }
      if (!blockSnap.exists) {
        throw new ApiError("manual_reapply_block_not_found", 404);
      }
      if (!applicationSnap.exists) {
        throw new ApiError("application_not_found", 404);
      }
      const application = applicationSnap.data || {};
      const applicantUid = clean(application.applicantUid);
      if (
        clean(application.status) !== "rejected" ||
        clean(application.reapplyMode) !== "manual" ||
        !applicantUid
      ) {
        throw new ApiError("manual_reapply_block_conflict", 409);
      }
      const lockPath = `agency_application_locks/${applicantUid}`;
      const lockSnap = await db.get(lockPath, tx);
      if (
        !lockSnap.exists ||
        clean(lockSnap.data?.applicationId) !== applicationId ||
        clean(lockSnap.data?.status) !== "rejected"
      ) {
        throw new ApiError("application_lock_conflict", 409);
      }

      const result = {
        applicationId,
        status: "rejected",
        reapplyMode: "immediate",
        reapplyAllowedAt: now,
        manualUnblockedAt: now,
        manualUnblockedBy: actorUid,
      };
      const writes = [
        db.writeUpdate(applicationPath, {
          reapplyMode: "immediate",
          reapplyAllowedAt: now,
          manualUnblockedAt: now,
          manualUnblockedBy: actorUid,
          updatedAt: now,
        }, [
          "reapplyMode",
          "reapplyAllowedAt",
          "manualUnblockedAt",
          "manualUnblockedBy",
          "updatedAt",
        ]),
        db.writeUpdate(lockPath, {
          reapplyMode: "immediate",
          reapplyAllowedAt: now,
          manualUnblockedAt: now,
          manualUnblockedBy: actorUid,
          updatedAt: now,
        }, [
          "reapplyMode",
          "reapplyAllowedAt",
          "manualUnblockedAt",
          "manualUnblockedBy",
          "updatedAt",
        ]),
        db.writeDelete(blockPath),
        db.writeCreate(operationPath, {
          actorUid,
          action: "allowAgencyReapply",
          applicationId,
          requestFingerprint: fingerprint,
          status: "completed",
          result,
          createdAt: now,
        }),
        db.writeCreate(
          `admin_audit_logs/agency_reapply_unblock_${applicationId}`,
          {
            actorUid,
            action: "allowAgencyReapply",
            targetType: "agency_application",
            targetId: applicationId,
            after: result,
            idempotencyKey: key,
            createdAt: now,
          },
        ),
        db.writeCreate(
          `notifications/agency_reapply_unblocked_${applicationId}`,
          {
            userId: applicantUid,
            type: "agency_reapply_unblocked",
            category: "system",
            title: "يمكنك إعادة تقديم طلب الوكالة",
            body: "تم رفع منع إعادة التقديم اليدوي.",
            read: false,
            applicationId,
            reapplyMode: "immediate",
            reapplyAllowedAt: now,
            createdAt: now,
          },
        ),
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


function controlOperationFingerprint(action, payload = {}) {
  return JSON.stringify({
    action: clean(action),
    agencyId: clean(payload.agencyId),
    name: clean(payload.name),
    country: payload.country == null ? null : clean(payload.country),
    newOwnerPublicId: clean(payload.newOwnerPublicId),
    status: clean(payload.status),
    reason: clean(payload.reason),
  });
}

function controlOperationPath(actorUid, key) {
  return `agency_control_operations/${clean(actorUid)}__${clean(key)}`;
}

function sanitizeAgencyForControl(agency = {}, ownerUser = {}) {
  return {
    agencyId: clean(agency.agencyId || agency.publicId),
    publicId: clean(agency.publicId || agency.agencyId),
    name: clean(agency.name),
    country: clean(agency.country) || null,
    status: clean(agency.status),
    ownerUid: clean(agency.ownerUid),
    ownerPublicId: clean(ownerUser.publicId) || null,
    memberCount: Number(agency.memberCount || 0),
    hostCount: Number(agency.hostCount || 0),
    managerCount: Number(agency.managerCount || 0),
    seniorManagerCount: Number(agency.seniorManagerCount || 0),
    updatedAt: agency.updatedAt || null,
  };
}

async function resolveAgencyControlId(db, agencyIdInput) {
  const lookupId = clean(agencyIdInput);
  if (!validAgencyId(lookupId)) throw new ApiError("invalid_agency_id", 400);

  const directSnap = await db.get(`agencies/${lookupId}`);
  if (directSnap.exists) return lookupId;

  const registrySnap = await db.get(`agency_ids/${lookupId}`);
  const resolvedAgencyId = clean(registrySnap.data?.agencyId);
  if (
    !registrySnap.exists ||
    registrySnap.data?.reserved === true ||
    !validAgencyId(resolvedAgencyId)
  ) {
    throw new ApiError("agency_not_found", 404);
  }
  return resolvedAgencyId;
}

export async function getAgencyControlDetails(db, agencyIdInput) {
  const agencyId = await resolveAgencyControlId(db, agencyIdInput);
  const agencySnap = await db.get(`agencies/${agencyId}`);
  if (!agencySnap.exists) throw new ApiError("agency_not_found", 404);
  const agency = agencySnap.data || {};
  const ownerUid = clean(agency.ownerUid);
  const ownerSnap = ownerUid ? await db.get(`users/${ownerUid}`) : null;
  return sanitizeAgencyForControl(agency, ownerSnap?.data || {});
}

export async function updateAgencyIdentity(
  db,
  actorUid,
  body = {},
  { now = new Date() } = {},
) {
  const agencyId = clean(body.agencyId);
  const requestedPublicId = clean(body.publicId);
  const name = clean(body.name);
  const country = clean(body.country) || null;
  const key = clean(body.idempotencyKey);
  if (!validAgencyId(agencyId)) throw new ApiError("invalid_agency_id", 400);
  if (requestedPublicId && !validAgencyId(requestedPublicId)) {
    throw new ApiError("invalid_agency_public_id", 400);
  }
  if (!name || name.length > 80) throw new ApiError("invalid_agency_name", 400);
  if (country != null && (country.length < 2 || country.length > 64)) {
    throw new ApiError("invalid_agency_country", 400);
  }
  if (!validIdempotencyKey(key)) throw new ApiError("invalid_idempotency_key", 400);

  const operationPath = controlOperationPath(actorUid, key);
  const fingerprint = controlOperationFingerprint("updateIdentity", {
    agencyId,
    publicId: requestedPublicId || null,
    name,
    country,
  });

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const tx = await db.beginTransaction();
    try {
      const [operationSnap, agencySnap] = await Promise.all([
        db.get(operationPath, tx),
        db.get(`agencies/${agencyId}`, tx),
      ]);
      if (operationSnap.exists) {
        const existing = operationSnap.data || {};
        if (clean(existing.requestFingerprint) !== fingerprint) {
          throw new ApiError("idempotency_conflict", 409);
        }
        await db.rollback(tx);
        return { ok: true, code: "duplicate", ...(existing.result || {}) };
      }
      if (!agencySnap.exists) throw new ApiError("agency_not_found", 404);
      const agency = agencySnap.data || {};
      if (clean(agency.status) === "closed") {
        throw new ApiError("agency_closed", 409);
      }

      const currentPublicId = clean(agency.publicId || agencyId);
      if (!validAgencyId(currentPublicId)) {
        throw new ApiError("agency_identity_corrupt", 409);
      }
      const nextPublicId = requestedPublicId || currentPublicId;
      const publicIdChanged = nextPublicId !== currentPublicId;

      let nextRegistrySnap = null;
      let currentRegistrySnap = null;
      if (publicIdChanged) {
        const [nextAgencySnap, nextRegistry, currentRegistry] =
          await Promise.all([
            db.get(`agencies/${nextPublicId}`, tx),
            db.get(`agency_ids/${nextPublicId}`, tx),
            db.get(`agency_ids/${currentPublicId}`, tx),
          ]);
        nextRegistrySnap = nextRegistry;
        currentRegistrySnap = currentRegistry;
        if (
          nextRegistrySnap.exists ||
          (nextAgencySnap.exists && nextPublicId !== agencyId)
        ) {
          throw new ApiError("agency_id_taken", 409);
        }
      }

      const before = {
        publicId: currentPublicId,
        name: clean(agency.name),
        country: clean(agency.country) || null,
      };
      const result = {
        agencyId,
        publicId: nextPublicId,
        name,
        country,
        status: clean(agency.status),
      };
      const ownerUid = clean(agency.ownerUid);
      const writes = [
        db.writeUpdate(
          `agencies/${agencyId}`,
          { publicId: nextPublicId, name, country, updatedAt: now },
          ["publicId", "name", "country", "updatedAt"],
        ),
        db.writeCreate(operationPath, {
          actorUid,
          action: "updateAgencyIdentity",
          requestFingerprint: fingerprint,
          status: "completed",
          result,
          createdAt: now,
        }),
        db.writeCreate(`admin_audit_logs/agency_identity_${agencyId}_${key}`, {
          actorUid,
          action: "updateAgencyIdentity",
          targetType: "agency",
          targetId: agencyId,
          before,
          after: { publicId: nextPublicId, name, country },
          idempotencyKey: key,
          createdAt: now,
        }),
      ];

      if (publicIdChanged) {
        writes.push(
          db.writeCreate(`agency_ids/${nextPublicId}`, {
            agencyId,
            ownerUid,
            publicId: nextPublicId,
            source: "control_change",
            allocatedAt: now,
            reserved: false,
          }),
        );
        const retiredRegistry = {
          agencyId: null,
          publicId: currentPublicId,
          reserved: true,
          retiredAgencyId: agencyId,
          currentPublicId: nextPublicId,
          retiredAt: now,
          retiredBy: actorUid,
        };
        if (currentRegistrySnap?.exists) {
          writes.push(
            db.writeUpdate(
              `agency_ids/${currentPublicId}`,
              retiredRegistry,
              [
                "agencyId",
                "publicId",
                "reserved",
                "retiredAgencyId",
                "currentPublicId",
                "retiredAt",
                "retiredBy",
              ],
            ),
          );
        } else {
          writes.push(
            db.writeCreate(`agency_ids/${currentPublicId}`, retiredRegistry),
          );
        }
      }

      if (ownerUid) {
        writes.push(db.writeCreate(`notifications/agency_identity_${agencyId}_${key}`, {
          userId: ownerUid,
          type: "agency_identity_updated",
          category: "system",
          title: "تم تحديث بيانات الوكالة",
          body: `${name} — ID ${nextPublicId}${country ? ` — ${country}` : ""}`,
          read: false,
          agencyId,
          createdAt: now,
        }));
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

export async function transferAgencyOwnership(
  db,
  actorUid,
  body = {},
  { now = new Date() } = {},
) {
  const agencyId = clean(body.agencyId);
  const newOwnerPublicId = clean(body.newOwnerPublicId);
  const key = clean(body.idempotencyKey);
  if (!validAgencyId(agencyId)) throw new ApiError("invalid_agency_id", 400);
  if (!/^\d{3,8}$/.test(newOwnerPublicId)) {
    throw new ApiError("invalid_owner_public_id", 400);
  }
  if (!validIdempotencyKey(key)) throw new ApiError("invalid_idempotency_key", 400);

  const publicIdSnap = await db.get(`public_ids/${newOwnerPublicId}`);
  const newOwnerUid = clean(publicIdSnap.data?.uid);
  if (!publicIdSnap.exists || !newOwnerUid) throw new ApiError("owner_not_found", 404);

  const operationPath = controlOperationPath(actorUid, key);
  const fingerprint = controlOperationFingerprint("transferOwnership", {
    agencyId,
    newOwnerPublicId,
  });

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const tx = await db.beginTransaction();
    try {
      const [
        operationSnap,
        agencySnap,
        newMembershipSnap,
        newUserMembershipSnap,
        newUserSnap,
        managerSlotsSnap,
      ] = await Promise.all([
        db.get(operationPath, tx),
        db.get(`agencies/${agencyId}`, tx),
        db.get(`agency_memberships/${agencyId}__${newOwnerUid}`, tx),
        db.get(`agency_user_memberships/${newOwnerUid}`, tx),
        db.get(`users/${newOwnerUid}`, tx),
        db.get(`agency_manager_slots/${agencyId}`, tx),
      ]);

      if (operationSnap.exists) {
        const existing = operationSnap.data || {};
        if (clean(existing.requestFingerprint) !== fingerprint) {
          throw new ApiError("idempotency_conflict", 409);
        }
        await db.rollback(tx);
        return { ok: true, code: "duplicate", ...(existing.result || {}) };
      }
      if (!agencySnap.exists) throw new ApiError("agency_not_found", 404);
      const agency = agencySnap.data || {};
      if (clean(agency.status) === "closed") throw new ApiError("agency_closed", 409);

      const oldOwnerUid = clean(agency.ownerUid);
      if (!oldOwnerUid) throw new ApiError("agency_owner_missing", 409);
      if (oldOwnerUid === newOwnerUid) throw new ApiError("owner_unchanged", 409);
      if (!newMembershipSnap.exists || !newUserMembershipSnap.exists) {
        throw new ApiError("new_owner_must_be_active_member", 409);
      }
      const newMembership = newMembershipSnap.data || {};
      const newUserMembership = newUserMembershipSnap.data || {};
      const newOwnerRole = clean(newMembership.role);
      if (
        clean(newMembership.status) !== "active" ||
        clean(newUserMembership.status) !== "active" ||
        clean(newMembership.agencyId) !== agencyId ||
        clean(newUserMembership.agencyId) !== agencyId ||
        !["host", "manager", "senior_manager"].includes(newOwnerRole)
      ) {
        throw new ApiError("new_owner_must_be_active_member", 409);
      }
      if (
        !newUserSnap.exists ||
        clean(newUserSnap.data?.accountStatus || "active") !== "active" ||
        clean(newUserSnap.data?.agencyId) !== agencyId
      ) {
        throw new ApiError("new_owner_unavailable", 409);
      }

      const [oldMembershipSnap, oldUserMembershipSnap, oldUserSnap] =
        await Promise.all([
          db.get(`agency_memberships/${agencyId}__${oldOwnerUid}`, tx),
          db.get(`agency_user_memberships/${oldOwnerUid}`, tx),
          db.get(`users/${oldOwnerUid}`, tx),
        ]);
      if (
        !oldMembershipSnap.exists ||
        !oldUserMembershipSnap.exists ||
        !oldUserSnap.exists ||
        clean(oldMembershipSnap.data?.status) !== "active" ||
        clean(oldMembershipSnap.data?.role) !== "owner" ||
        clean(oldUserMembershipSnap.data?.status) !== "active" ||
        clean(oldUserMembershipSnap.data?.role) !== "owner"
      ) {
        throw new ApiError("agency_owner_membership_conflict", 409);
      }
      if (!managerSlotsSnap.exists) throw new ApiError("agency_manager_slots_missing", 409);

      const managerUids = Array.isArray(managerSlotsSnap.data?.managerUids)
        ? managerSlotsSnap.data.managerUids.map(clean).filter(Boolean)
        : [];
      let seniorManagerUid = clean(managerSlotsSnap.data?.seniorManagerUid) || null;
      let nextManagerUids = [...managerUids];
      if (newOwnerRole === "manager") {
        if (!nextManagerUids.includes(newOwnerUid)) {
          throw new ApiError("agency_manager_slot_conflict", 409);
        }
        nextManagerUids = nextManagerUids.map((uid) =>
          uid === newOwnerUid ? oldOwnerUid : uid
        );
      } else if (newOwnerRole === "senior_manager") {
        if (seniorManagerUid !== newOwnerUid) {
          throw new ApiError("agency_manager_slot_conflict", 409);
        }
        seniorManagerUid = oldOwnerUid;
      }

      const result = {
        agencyId,
        oldOwnerUid,
        newOwnerUid,
        newOwnerPublicId,
        previousNewOwnerRole: newOwnerRole,
        previousOwnerRole: newOwnerRole,
      };
      await db.commit(tx, [
        db.writeUpdate(
          `agencies/${agencyId}`,
          { ownerUid: newOwnerUid, updatedAt: now },
          ["ownerUid", "updatedAt"],
        ),
        db.writeUpdate(
          `agency_memberships/${agencyId}__${newOwnerUid}`,
          { role: "owner", updatedAt: now },
          ["role", "updatedAt"],
        ),
        db.writeUpdate(
          `agency_user_memberships/${newOwnerUid}`,
          { role: "owner", updatedAt: now },
          ["role", "updatedAt"],
        ),
        db.writeUpdate(
          `users/${newOwnerUid}`,
          { agencyRole: "owner" },
          ["agencyRole"],
        ),
        db.writeUpdate(
          `agency_memberships/${agencyId}__${oldOwnerUid}`,
          { role: newOwnerRole, updatedAt: now },
          ["role", "updatedAt"],
        ),
        db.writeUpdate(
          `agency_user_memberships/${oldOwnerUid}`,
          { role: newOwnerRole, updatedAt: now },
          ["role", "updatedAt"],
        ),
        db.writeUpdate(
          `users/${oldOwnerUid}`,
          { agencyRole: newOwnerRole },
          ["agencyRole"],
        ),
        db.writeUpdate(
          `agency_manager_slots/${agencyId}`,
          {
            managerUids: nextManagerUids,
            seniorManagerUid,
            updatedAt: now,
          },
          ["managerUids", "seniorManagerUid", "updatedAt"],
        ),
        db.writeCreate(operationPath, {
          actorUid,
          action: "transferAgencyOwnership",
          requestFingerprint: fingerprint,
          status: "completed",
          result,
          createdAt: now,
        }),
        db.writeCreate(`admin_audit_logs/agency_owner_transfer_${agencyId}_${key}`, {
          actorUid,
          action: "transferAgencyOwnership",
          targetType: "agency",
          targetId: agencyId,
          before: { ownerUid: oldOwnerUid, targetRole: newOwnerRole },
          after: {
            ownerUid: newOwnerUid,
            previousOwnerUid: oldOwnerUid,
            previousOwnerRole: newOwnerRole,
          },
          idempotencyKey: key,
          createdAt: now,
        }),
        db.writeCreate(`notifications/agency_owner_transfer_new_${agencyId}_${key}`, {
          userId: newOwnerUid,
          type: "agency_ownership_received",
          category: "system",
          title: "أصبحت مالك الوكالة",
          body: agencyId,
          read: false,
          agencyId,
          createdAt: now,
        }),
        db.writeCreate(`notifications/agency_owner_transfer_old_${agencyId}_${key}`, {
          userId: oldOwnerUid,
          type: "agency_ownership_transferred",
          category: "system",
          title: "تم نقل ملكية الوكالة",
          body: agencyId,
          read: false,
          agencyId,
          createdAt: now,
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

export async function changeAgencyStatus(
  db,
  actorUid,
  body = {},
  { now = new Date() } = {},
) {
  const agencyId = clean(body.agencyId);
  const requestedStatus = clean(body.status);
  const reason = clean(body.reason);
  const key = clean(body.idempotencyKey);
  if (!validAgencyId(agencyId)) throw new ApiError("invalid_agency_id", 400);
  if (!["active", "suspended", "closed"].includes(requestedStatus)) {
    throw new ApiError("invalid_agency_status", 400);
  }
  if (reason.length < 3 || reason.length > 500) {
    throw new ApiError("agency_status_reason_required", 400);
  }
  if (!validIdempotencyKey(key)) throw new ApiError("invalid_idempotency_key", 400);

  const operationPath = controlOperationPath(actorUid, key);
  const fingerprint = controlOperationFingerprint("changeStatus", {
    agencyId,
    status: requestedStatus,
    reason,
  });

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const tx = await db.beginTransaction();
    try {
      const [operationSnap, agencySnap] = await Promise.all([
        db.get(operationPath, tx),
        db.get(`agencies/${agencyId}`, tx),
      ]);
      if (operationSnap.exists) {
        const existing = operationSnap.data || {};
        if (clean(existing.requestFingerprint) !== fingerprint) {
          throw new ApiError("idempotency_conflict", 409);
        }
        await db.rollback(tx);
        return { ok: true, code: "duplicate", ...(existing.result || {}) };
      }
      if (!agencySnap.exists) throw new ApiError("agency_not_found", 404);
      const agency = agencySnap.data || {};
      const previousStatus = clean(agency.status || "active");
      if (previousStatus === "closed") throw new ApiError("agency_closed", 409);
      if (previousStatus === requestedStatus) {
        throw new ApiError("agency_status_unchanged", 409);
      }
      if (requestedStatus === "active" && previousStatus !== "suspended") {
        throw new ApiError("agency_not_suspended", 409);
      }

      const eventType = requestedStatus === "active" ? "resume" :
        requestedStatus === "suspended" ? "suspend" : "close";
      const eventId = `${agencyId}_${eventType}_${key}`;
      const ownerUid = clean(agency.ownerUid);
      const result = { agencyId, status: requestedStatus, previousStatus };
      const statusFields = requestedStatus === "active" ? {
        status: "active",
        suspendedAt: null,
        suspendedBy: null,
        suspensionReason: null,
        updatedAt: now,
      } : requestedStatus === "suspended" ? {
        status: "suspended",
        suspendedAt: now,
        suspendedBy: actorUid,
        suspensionReason: reason,
        updatedAt: now,
      } : {
        status: "closed",
        closedAt: now,
        closedBy: actorUid,
        closureReason: reason,
        updatedAt: now,
      };
      const fieldMask = Object.keys(statusFields);
      const writes = [
        db.writeUpdate(`agencies/${agencyId}`, statusFields, fieldMask),
        db.writeCreate(`agency_status_events/${eventId}`,
          createAgencyStatusEventDocument({
            eventId,
            agencyId,
            type: eventType,
            reason,
            actorUid,
            now,
          })),
        db.writeCreate(operationPath, {
          actorUid,
          action: "changeAgencyStatus",
          requestFingerprint: fingerprint,
          status: "completed",
          result,
          createdAt: now,
        }),
        db.writeCreate(`admin_audit_logs/agency_status_${eventId}`, {
          actorUid,
          action: eventType === "resume" ? "resumeAgency" :
            eventType === "suspend" ? "suspendAgency" : "closeAgency",
          targetType: "agency",
          targetId: agencyId,
          before: { status: previousStatus },
          after: { status: requestedStatus, reason },
          idempotencyKey: key,
          createdAt: now,
        }),
      ];
      if (ownerUid) {
        writes.push(db.writeCreate(`notifications/agency_status_${eventId}`, {
          userId: ownerUid,
          type: `agency_${eventType}`,
          category: "system",
          title: eventType === "resume" ? "تمت إعادة تفعيل الوكالة" :
            eventType === "suspend" ? "تم تعليق الوكالة مؤقتًا" :
              "تم إغلاق الوكالة نهائيًا",
          body: reason,
          read: false,
          agencyId,
          createdAt: now,
        }));
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


export async function directCreateAgency(
  db,
  actorUid,
  body = {},
  { now = new Date(), agencyIdCandidates: suppliedAgencyIds = null } = {},
) {
  const ownerPublicId = clean(body.ownerPublicId);
  const name = clean(body.name);
  const country = clean(body.country) || null;
  if (!/^\d{3,8}$/.test(ownerPublicId)) throw new ApiError("invalid_owner_public_id", 400);
  if (!name || name.length > 80) throw new ApiError("invalid_agency_name", 400);
  if (country != null && (country.length < 2 || country.length > 64)) {
    throw new ApiError("invalid_agency_country", 400);
  }
  const publicIdSnap = await db.get(`public_ids/${ownerPublicId}`);
  if (!publicIdSnap.exists || !clean(publicIdSnap.data?.uid)) {
    throw new ApiError("owner_not_found", 404);
  }
  return createAgencyForOwner({
    db,
    actorUid,
    ownerUid: clean(publicIdSnap.data.uid),
    ownerPublicId,
    name,
    country,
    operationId: clean(body.idempotencyKey),
    requestedAgencyId: clean(body.agencyId) || null,
    createdFrom: "control_direct",
    now,
    suppliedAgencyIds,
  });
}

function policyInteger(value, field, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < min || parsed > max) {
    throw new ApiError("invalid_agency_policy_" + field, 400);
  }
  return parsed;
}

function normalizeAgencyRevenueTierOverride(raw) {
  if (!Array.isArray(raw) || raw.length < 1 || raw.length > 16) {
    throw new ApiError("invalid_agency_policy_tiers", 400);
  }
  const seen = new Set();
  const tiers = raw.map((item, index) => {
    const id = clean(item?.id || ("tier_" + String(index + 1)));
    const nameAr = clean(item?.nameAr || id);
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(id) || seen.has(id)) {
      throw new ApiError("invalid_agency_policy_tier_id", 400);
    }
    seen.add(id);
    const minGiftCoins = policyInteger(
      item?.minGiftCoins,
      "tier_min_gift_coins",
      { min: 0 },
    );
    const hostShareBps = policyInteger(
      item?.hostShareBps,
      "tier_host_share_bps",
      { min: 0, max: 10000 },
    );
    const agencyShareBps = policyInteger(
      item?.agencyShareBps,
      "tier_agency_share_bps",
      { min: 0, max: 10000 },
    );
    if (hostShareBps + agencyShareBps > 10000) {
      throw new ApiError("invalid_agency_policy_tier_share_sum", 400);
    }
    return { id, nameAr, minGiftCoins, hostShareBps, agencyShareBps };
  }).sort((a, b) => a.minGiftCoins - b.minGiftCoins);
  for (let index = 1; index < tiers.length; index += 1) {
    if (tiers[index].minGiftCoins <= tiers[index - 1].minGiftCoins) {
      throw new ApiError("invalid_agency_policy_tier_order", 400);
    }
  }
  return tiers;
}

function normalizeAgencyTargetOverride(raw) {
  if (!Array.isArray(raw) || raw.length < 1 || raw.length > 64) {
    throw new ApiError("invalid_agency_policy_targets", 400);
  }
  const seen = new Set();
  for (const item of raw) {
    const id = clean(item?.id);
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(id) || seen.has(id)) {
      throw new ApiError("invalid_agency_policy_target_id", 400);
    }
    seen.add(id);
    policyInteger(item?.thresholdCoins, "target_threshold_coins", { min: 1 });
    policyInteger(item?.salaryDiamonds, "target_salary_diamonds", { min: 0 });
  }
  try {
    return normalizeAgencyTargets(raw);
  } catch (error) {
    throw new ApiError(clean(error?.message) || "invalid_agency_policy_targets", 400);
  }
}

function sanitizeAgencyPolicyOverride(data = {}) {
  const result = {
    agencyId: clean(data.agencyId) || null,
    policyVersion: clean(data.policyVersion) || null,
    updatedBy: clean(data.updatedBy) || null,
    updatedAt: data.updatedAt || null,
  };
  if (Array.isArray(data.tiers)) result.tiers = data.tiers;
  if (Array.isArray(data.targets)) result.targets = data.targets;
  if (Object.prototype.hasOwnProperty.call(data, "agencyPerformanceBonusBps")) {
    result.agencyPerformanceBonusBps = Number(data.agencyPerformanceBonusBps);
  }
  if (Object.prototype.hasOwnProperty.call(data, "agencyBonusActiveHosts")) {
    result.agencyBonusActiveHosts = Number(data.agencyBonusActiveHosts);
  }
  if (Object.prototype.hasOwnProperty.call(data, "surplusToShadow")) {
    result.surplusToShadow = data.surplusToShadow;
  }
  return result;
}

function effectiveAgencyPolicy(economy = {}, override = {}) {
  const has = (field) => Object.prototype.hasOwnProperty.call(override, field);
  const tiers = has("tiers")
    ? override.tiers
    : revenueTiers(
        Array.isArray(economy.tiers) && economy.tiers.length
          ? economy
          : { ...economy, tiers: DEFAULT_REVENUE_TIERS },
      );
  const targets = has("targets")
    ? override.targets
    : normalizeAgencyTargets(
        Array.isArray(economy.agencyTargets) && economy.agencyTargets.length
          ? economy.agencyTargets
          : DEFAULT_AGENCY_TARGETS,
      );
  return {
    tiers,
    targets,
    agencyPerformanceBonusBps: has("agencyPerformanceBonusBps")
      ? Number(override.agencyPerformanceBonusBps)
      : Math.max(0, Math.min(3000, Number(economy.agencyPerformanceBonusBps ?? 200))),
    agencyBonusActiveHosts: has("agencyBonusActiveHosts")
      ? Number(override.agencyBonusActiveHosts)
      : Math.max(1, Math.min(100000, Number(economy.agencyBonusActiveHosts || 10))),
    surplusToShadow: has("surplusToShadow") ? override.surplusToShadow : null,
    inherited: {
      tiers: !has("tiers"),
      targets: !has("targets"),
      bonus:
        !has("agencyPerformanceBonusBps") &&
        !has("agencyBonusActiveHosts"),
      surplus: !has("surplusToShadow"),
    },
  };
}

function agencyPolicyFingerprint(body = {}) {
  return JSON.stringify({
    action: "updateAgencyPolicy",
    agencyId: clean(body.agencyId),
    overrideTiers: body.overrideTiers === true,
    tiers: body.overrideTiers === true ? body.tiers : null,
    overrideTargets: body.overrideTargets === true,
    targets: body.overrideTargets === true ? body.targets : null,
    overrideBonus: body.overrideBonus === true,
    agencyPerformanceBonusBps:
      body.overrideBonus === true ? Number(body.agencyPerformanceBonusBps) : null,
    agencyBonusActiveHosts:
      body.overrideBonus === true ? Number(body.agencyBonusActiveHosts) : null,
    surplusToShadow: body.surplusToShadow,
  });
}

export async function getAgencyPolicyControlDetails(db, agencyIdInput) {
  const agencyId = clean(agencyIdInput);
  if (!validAgencyId(agencyId)) throw new ApiError("invalid_agency_id", 400);
  const [agencySnap, overrideSnap, economySnap] = await Promise.all([
    db.get("agencies/" + agencyId),
    db.get("agency_policy_overrides/" + agencyId),
    db.get("system_config/gift_economy"),
  ]);
  if (!agencySnap.exists) throw new ApiError("agency_not_found", 404);
  const override = overrideSnap.exists ? overrideSnap.data || {} : {};
  const economy = economySnap.exists ? economySnap.data || {} : {};
  return {
    agencyId,
    agencyStatus: clean(agencySnap.data?.status),
    overrideExists: overrideSnap.exists,
    override: sanitizeAgencyPolicyOverride(override),
    effective: effectiveAgencyPolicy(economy, override),
    propagation: {
      complete: agencySnap.data?.policyPropagationComplete === true,
      cursor: clean(agencySnap.data?.policyPropagationCursor) || null,
      policyVersion: clean(agencySnap.data?.policyVersion) || null,
    },
  };
}

export async function updateAgencyPolicyOverride(
  db,
  actorUid,
  body = {},
  { now = new Date() } = {},
) {
  const agencyId = clean(body.agencyId);
  const key = clean(body.idempotencyKey);
  if (!validAgencyId(agencyId)) throw new ApiError("invalid_agency_id", 400);
  if (!validIdempotencyKey(key)) throw new ApiError("invalid_idempotency_key", 400);
  if (typeof body.surplusToShadow !== "boolean") {
    throw new ApiError("agency_surplus_policy_required", 400);
  }

  const next = {
    schemaVersion: 1,
    agencyId,
    policyVersion: key,
    updatedBy: actorUid,
    updatedAt: now,
    surplusToShadow: body.surplusToShadow,
  };
  if (body.overrideTiers === true) {
    next.tiers = normalizeAgencyRevenueTierOverride(body.tiers);
  }
  if (body.overrideTargets === true) {
    next.targets = normalizeAgencyTargetOverride(body.targets);
  }
  if (body.overrideBonus === true) {
    next.agencyPerformanceBonusBps = policyInteger(
      body.agencyPerformanceBonusBps,
      "agency_bonus_bps",
      { min: 0, max: 3000 },
    );
    next.agencyBonusActiveHosts = policyInteger(
      body.agencyBonusActiveHosts,
      "agency_bonus_active_hosts",
      { min: 1, max: 100000 },
    );
  }

  const opPath = controlOperationPath(actorUid, key);
  const fp = agencyPolicyFingerprint(body);
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const tx = await db.beginTransaction();
    try {
      const [opSnap, agencySnap, beforeSnap] = await Promise.all([
        db.get(opPath, tx),
        db.get("agencies/" + agencyId, tx),
        db.get("agency_policy_overrides/" + agencyId, tx),
      ]);
      if (opSnap.exists) {
        const existing = opSnap.data || {};
        if (clean(existing.requestFingerprint) !== fp) {
          throw new ApiError("idempotency_conflict", 409);
        }
        await db.rollback(tx);
        return { ok: true, code: "duplicate", ...(existing.result || {}) };
      }
      if (!agencySnap.exists) throw new ApiError("agency_not_found", 404);
      if (clean(agencySnap.data?.status) === "closed") {
        throw new ApiError("agency_closed", 409);
      }
      const result = {
        agencyId,
        policyVersion: key,
        propagationRequired: true,
      };
      const policyFields = [
        "schemaVersion",
        "agencyId",
        "policyVersion",
        "updatedBy",
        "updatedAt",
        "surplusToShadow",
        "tiers",
        "targets",
        "agencyPerformanceBonusBps",
        "agencyBonusActiveHosts",
      ];
      const policyWrite = beforeSnap.exists
        ? db.writeMaskedUpdate(
            "agency_policy_overrides/" + agencyId,
            next,
            policyFields,
          )
        : db.writeCreate("agency_policy_overrides/" + agencyId, next);
      await db.commit(tx, [
        policyWrite,
        db.writeUpdate(
          "agencies/" + agencyId,
          {
            policyVersion: key,
            policyUpdatedAt: now,
            policyPropagationCursor: null,
            policyPropagationComplete: false,
          },
          [
            "policyVersion",
            "policyUpdatedAt",
            "policyPropagationCursor",
            "policyPropagationComplete",
          ],
        ),
        db.writeCreate(opPath, {
          actorUid,
          action: "updateAgencyPolicy",
          requestFingerprint: fp,
          status: "completed",
          result,
          createdAt: now,
        }),
        db.writeCreate(
          "admin_audit_logs/agency_policy_" + agencyId + "_" + key,
          {
            actorUid,
            action: "updateAgencyPolicy",
            targetType: "agency_policy_override",
            targetId: agencyId,
            before: beforeSnap.exists
              ? sanitizeAgencyPolicyOverride(beforeSnap.data || {})
              : null,
            after: sanitizeAgencyPolicyOverride(next),
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

export async function propagateAgencyPolicyPage(
  db,
  agencyIdInput,
  {
    limit = 25,
    now = new Date(),
  } = {},
) {
  const agencyId = clean(agencyIdInput);
  if (!validAgencyId(agencyId)) throw new ApiError("invalid_agency_id", 400);
  const pageLimit = Math.max(1, Math.min(25, Math.floor(Number(limit || 25))));

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const tx = await db.beginTransaction();
    try {
      const [agencySnap, overrideSnap] = await Promise.all([
        db.get("agencies/" + agencyId, tx),
        db.get("agency_policy_overrides/" + agencyId, tx),
      ]);
      if (!agencySnap.exists) throw new ApiError("agency_not_found", 404);
      if (agencySnap.data?.policyPropagationComplete === true) {
        await db.rollback(tx);
        return {
          ok: true,
          code: "already_complete",
          agencyId,
          updated: 0,
          hasMore: false,
          nextCursor: null,
          policyVersion: clean(agencySnap.data?.policyVersion) || null,
        };
      }

      const override = overrideSnap.exists ? overrideSnap.data || {} : null;
      const policyVersion = clean(override?.policyVersion) || null;
      if (
        policyVersion &&
        clean(agencySnap.data?.policyVersion) !== policyVersion
      ) {
        throw new ApiError("agency_policy_version_conflict", 409);
      }
      const snapshot = override
        ? {
            agencyId,
            policyVersion,
            updatedAt: override.updatedAt || null,
            ...(Array.isArray(override.tiers) ? { tiers: override.tiers } : {}),
            ...(Array.isArray(override.targets) ? { targets: override.targets } : {}),
          }
        : null;
      const cursorUid = clean(agencySnap.data?.policyPropagationCursor);

      const rows = await db.runQuery("users", {
        filters: [{ field: "agencyId", op: "==", value: agencyId }],
        orderBy: [{ field: "__name__", direction: "asc" }],
        limit: pageLimit + 1,
        transaction: tx,
        ...(cursorUid
          ? { startAfter: [{ referencePath: "users/" + cursorUid }] }
          : {}),
      });
      const page = rows.slice(0, pageLimit);
      const hasMore = rows.length > pageLimit;
      const nextCursor =
        hasMore && page.length ? page[page.length - 1].id : null;

      await db.commit(tx, [
        ...page.map((row) =>
          db.writeUpdate(
            "users/" + row.id,
            { agencyPolicySnapshot: snapshot },
            ["agencyPolicySnapshot"],
          )
        ),
        db.writeUpdate(
          "agencies/" + agencyId,
          {
            policyPropagationCursor: nextCursor,
            policyPropagationComplete: !hasMore,
            policyPropagationUpdatedAt: now,
          },
          [
            "policyPropagationCursor",
            "policyPropagationComplete",
            "policyPropagationUpdatedAt",
          ],
        ),
      ]);

      return {
        ok: true,
        code: "ok",
        agencyId,
        updated: page.length,
        hasMore,
        nextCursor,
        policyVersion,
      };
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

export async function overrideAgencyCooldownByPublicId(
  db,
  actorUid,
  body = {},
  options = {},
) {
  const targetPublicId = clean(body.targetPublicId);
  if (!/^\d{3,8}$/.test(targetPublicId)) {
    throw new ApiError("invalid_target_public_id", 400);
  }
  const publicIdSnap = await db.get("public_ids/" + targetPublicId);
  const targetUid = clean(publicIdSnap.data?.uid);
  if (!publicIdSnap.exists || !targetUid) {
    throw new ApiError("target_user_not_found", 404);
  }
  return overrideAgencyRejoinCooldown(
    db,
    actorUid,
    {
      targetUid,
      reason: body.reason,
      idempotencyKey: body.idempotencyKey,
    },
    options,
  );
}

export async function agencyControl(request, env) {
  if (request.method !== "POST") {
    return json(request, env, { ok: false, code: "method_not_allowed" }, 405);
  }
  try {
    const decoded = await verifyFirebaseIdToken(request, env);
    const body = await readJson(request);
    const action = clean(body.action);
    annotatePressureRequest(request, { action: `agencyControl:${action}` });
    const db = firestoreClient(env);
    const actor = await loadActor(db, decoded.sub);

    if (action === "listReviewQueue") {
      if (!actor.permissions.canReviewApplications) throw new ApiError("forbidden", 403);
      const [applications, manualBlocks] = await Promise.all([
        listAgencyReviewQueue(db, body.limit),
        listAgencyManualReapplyBlocks(db, 25),
      ]);
      return json(request, env, {
        ok: true,
        applications,
        manualBlocks,
        limit: Math.min(50, boundedAgencyPageSize(body.limit, 50)),
        permissions: {
          canReviewApplications: actor.permissions.canReviewApplications,
          canDirectCreate: actor.permissions.canManageAgencies,
          canManageExisting: actor.permissions.canManageAgencies,
          canTransferOwnership: actor.permissions.isOwner,
          canManagePolicies: actor.permissions.canManagePolicies,
          canManageMemberships: actor.permissions.canManageMemberships,
          canSuspendAgencies: actor.permissions.canSuspendAgencies,
          canCloseAgencies: actor.permissions.canCloseAgencies,
        },
      });
    }
    if (action === "startReview") {
      if (!actor.permissions.canReviewApplications) throw new ApiError("forbidden", 403);
      return json(request, env, await startAgencyReview(db, decoded.sub, body.applicationId));
    }
    if (action === "approve") {
      if (!actor.permissions.canReviewApplications) throw new ApiError("forbidden", 403);
      return json(request, env, await approveAgencyApplication(db, decoded.sub, body));
    }
    if (action === "reject") {
      if (!actor.permissions.canReviewApplications) throw new ApiError("forbidden", 403);
      return json(request, env, await rejectAgencyApplication(db, decoded.sub, body));
    }
    if (action === "allowReapply") {
      if (!actor.permissions.canReviewApplications) throw new ApiError("forbidden", 403);
      return json(request, env, await allowAgencyReapply(db, decoded.sub, body));
    }
    if (action === "directCreate") {
      if (!actor.permissions.canManageAgencies) throw new ApiError("forbidden", 403);
      return json(request, env, await directCreateAgency(db, decoded.sub, body));
    }
    if (action === "getAgency") {
      if (!actor.permissions.canManageAgencies) throw new ApiError("forbidden", 403);
      return json(request, env, {
        ok: true,
        agency: await getAgencyControlDetails(db, body.agencyId),
        permissions: {
          canManageExisting: actor.permissions.canManageAgencies,
          canTransferOwnership: actor.permissions.isOwner,
          canManagePolicies: actor.permissions.canManagePolicies,
          canManageMemberships: actor.permissions.canManageMemberships,
          canSuspendAgencies: actor.permissions.canSuspendAgencies,
          canCloseAgencies: actor.permissions.canCloseAgencies,
        },
      });
    }
    if (action === "updateIdentity") {
      if (!actor.permissions.canManageAgencies) throw new ApiError("forbidden", 403);
      return json(request, env, await updateAgencyIdentity(db, decoded.sub, body));
    }
    if (action === "transferOwnership") {
      if (!actor.permissions.isOwner) throw new ApiError("forbidden", 403);
      return json(request, env, await transferAgencyOwnership(db, decoded.sub, body));
    }
    if (action === "changeStatus") {
      const requestedStatus = clean(body.status);
      if (requestedStatus === "closed") {
        if (!actor.permissions.canCloseAgencies) throw new ApiError("forbidden", 403);
      } else if (!actor.permissions.canSuspendAgencies) {
        throw new ApiError("forbidden", 403);
      }
      return json(request, env, await changeAgencyStatus(db, decoded.sub, body));
    }
    if (action === "getPolicy") {
      if (!actor.permissions.canManagePolicies) throw new ApiError("forbidden", 403);
      return json(
        request,
        env,
        {
          ok: true,
          ...(await getAgencyPolicyControlDetails(db, body.agencyId)),
        },
      );
    }
    if (action === "updatePolicy") {
      if (!actor.permissions.canManagePolicies) throw new ApiError("forbidden", 403);
      return json(
        request,
        env,
        await updateAgencyPolicyOverride(db, decoded.sub, body),
      );
    }
    if (action === "propagatePolicy") {
      if (!actor.permissions.canManagePolicies) throw new ApiError("forbidden", 403);
      return json(
        request,
        env,
        await propagateAgencyPolicyPage(db, body.agencyId, {
          limit: body.limit,
        }),
      );
    }
    if (action === "overrideCooldownByPublicId") {
      if (!actor.permissions.canManageMemberships) throw new ApiError("forbidden", 403);
      return json(
        request,
        env,
        await overrideAgencyCooldownByPublicId(db, decoded.sub, body),
      );
    }
    throw new ApiError("invalid_action", 400);
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
    if (code === "unauthorized") return json(request, env, { ok: false, code }, 401);
    if (code === "server_not_configured" || code === "invalid_service_account_json") {
      return json(request, env, { ok: false, code }, 503);
    }
    return json(request, env, { ok: false, code: "agency_control_failed" }, 500);
  }
}
