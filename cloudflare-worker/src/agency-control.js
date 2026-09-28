import { json, readJson, firestoreQuotaResponse } from "./http.js";
import { verifyFirebaseIdToken } from "./firebase-auth.js";
import {
  firestoreClient,
  firestoreErrorRetryDelayMs,
  isTransientFirestoreError,
} from "./firestore.js";
import {
  boundedAgencyPageSize,
  createAgencyDocument,
  createAgencyManagerSlotsDocument,
  createAgencyMembershipDocument,
} from "./agency-data-model.js";
import { platformAgencyPermissions } from "./agency-permissions.js";
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
  return /^\d{6}$/.test(clean(value));
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

function randomAgencyId() {
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

export async function directCreateAgency(
  db,
  actorUid,
  body = {},
  { now = new Date(), agencyIdCandidates: suppliedAgencyIds = null } = {},
) {
  const ownerPublicId = clean(body.ownerPublicId);
  const name = clean(body.name);
  const country = clean(body.country) || null;
  if (!/^\d{6}$/.test(ownerPublicId)) throw new ApiError("invalid_owner_public_id", 400);
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
      const applications = await listAgencyReviewQueue(db, body.limit);
      return json(request, env, { ok: true, applications, limit: Math.min(50, boundedAgencyPageSize(body.limit, 50)) });
    }
    if (action === "startReview") {
      if (!actor.permissions.canReviewApplications) throw new ApiError("forbidden", 403);
      return json(request, env, await startAgencyReview(db, decoded.sub, body.applicationId));
    }
    if (action === "approve") {
      if (!actor.permissions.canReviewApplications) throw new ApiError("forbidden", 403);
      return json(request, env, await approveAgencyApplication(db, decoded.sub, body));
    }
    if (action === "directCreate") {
      if (!actor.permissions.canManageAgencies) throw new ApiError("forbidden", 403);
      return json(request, env, await directCreateAgency(db, decoded.sub, body));
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
