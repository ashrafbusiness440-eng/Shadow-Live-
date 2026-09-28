import { json, readJson, firestoreQuotaResponse } from "./http.js";
import { verifyFirebaseIdToken } from "./firebase-auth.js";
import {
  firestoreClient,
  firestoreErrorRetryDelayMs,
  isTransientFirestoreError,
} from "./firestore.js";
import {
  createAgencyApplicationDocument,
  normalizeApplicationHostIds,
} from "./agency-data-model.js";
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

function applicationIdFor(uid, key) {
  const safeUid = clean(uid)
    .replace(/[^A-Za-z0-9_-]/g, "_")
    .slice(0, 80);
  if (!safeUid) throw new ApiError("invalid_applicant", 400);
  return `${safeUid}__${key}`;
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

function activeMembership(snapshot) {
  if (!snapshot?.exists) return false;
  const status = clean(snapshot.data?.status);
  return status === "active" || status === "pending";
}

function activeApplicationLock(snapshot) {
  if (!snapshot?.exists) return false;
  const status = clean(snapshot.data?.status);
  return status === "pending" || status === "under_review";
}

function assertApplicantLockAllowsSubmit(lockSnap, applicantUid, nowMs) {
  if (!lockSnap?.exists) return;
  const lock = lockSnap.data || {};
  const status = clean(lock.status);

  if (status === "pending" || status === "under_review") {
    const code = clean(lock.applicantUid) === applicantUid
      ? "agency_application_already_pending"
      : "agency_application_participation_conflict";
    throw new ApiError(code, 409, {
      applicationId: clean(lock.applicationId) || null,
    });
  }

  if (status !== "rejected") return;

  const mode = clean(lock.reapplyMode);
  if (mode === "immediate") return;
  if (mode === "manual") {
    throw new ApiError("agency_reapply_blocked", 409);
  }
  if (!["24h", "3d", "7d", "30d"].includes(mode)) {
    throw new ApiError("agency_reapply_blocked", 409);
  }

  const allowedAtMs = timestampMs(lock.reapplyAllowedAt);
  if (!allowedAtMs || allowedAtMs > nowMs) {
    throw new ApiError("agency_reapply_too_early", 409, {
      reapplyMode: mode || null,
      reapplyAllowedAt: lock.reapplyAllowedAt || null,
    });
  }
}

function accountAvailableForAgency(userSnap) {
  if (!userSnap?.exists) return false;
  const user = userSnap.data || {};
  const status = clean(user.accountStatus || "active");
  return status === "active";
}

function userAlreadyInAgency(userSnap, membershipSnap) {
  const user = userSnap?.data || {};
  return Boolean(clean(user.agencyId)) || activeMembership(membershipSnap);
}

function applicationFingerprint({ name, country, hostIds }) {
  return JSON.stringify({
    name: clean(name),
    country: clean(country),
    hostIds,
  });
}

export async function submitAgencyApplication(
  db,
  applicantUidInput,
  body = {},
  { now = new Date() } = {},
) {
  const applicantUid = clean(applicantUidInput);
  const name = clean(body.name);
  const country = clean(body.country) || null;
  const key = clean(body.idempotencyKey);
  let hostIds;
  try {
    hostIds = normalizeApplicationHostIds(body.hostIds);
  } catch (error) {
    throw new ApiError(clean(error?.message) || "invalid_agency_application_hosts", 400);
  }
  if (!applicantUid || !validIdempotencyKey(key)) {
    throw new ApiError("invalid_request", 400);
  }
  if (!name || name.length > 80) {
    throw new ApiError("invalid_agency_name", 400);
  }
  if (country != null && (country.length < 2 || country.length > 64)) {
    throw new ApiError("invalid_agency_country", 400);
  }

  const applicationId = applicationIdFor(applicantUid, key);
  const operationPath =
    `agency_application_operations/${applicantUid}__${key}`;
  const applicationPath = `agency_applications/${applicationId}`;
  const applicantMembershipPath =
    `agency_user_memberships/${applicantUid}`;
  const applicantLockPath =
    `agency_application_locks/${applicantUid}`;
  const fingerprint = applicationFingerprint({ name, country, hostIds });
  const nowDate = now instanceof Date ? now : new Date(now);
  const nowMs = nowDate.getTime();
  if (!Number.isFinite(nowMs)) throw new ApiError("invalid_request", 400);

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const transaction = await db.beginTransaction();
    try {
      const [
        operationSnap,
        applicantSnap,
        applicantMembershipSnap,
        applicantLockSnap,
        ...publicIdSnaps
      ] = await Promise.all([
        db.get(operationPath, transaction),
        db.get(`users/${applicantUid}`, transaction),
        db.get(applicantMembershipPath, transaction),
        db.get(applicantLockPath, transaction),
        ...hostIds.map((hostId) =>
          db.get(`public_ids/${hostId}`, transaction)
        ),
      ]);

      if (operationSnap.exists) {
        const existing = operationSnap.data || {};
        if (clean(existing.requestFingerprint) !== fingerprint) {
          throw new ApiError("idempotency_conflict", 409);
        }
        await db.rollback(transaction);
        return {
          ok: true,
          code: "duplicate",
          operationId: key,
          ...(existing.result || {}),
        };
      }

      if (!accountAvailableForAgency(applicantSnap)) {
        throw new ApiError(
          applicantSnap.exists ? "applicant_unavailable" : "applicant_not_found",
          applicantSnap.exists ? 409 : 404,
        );
      }
      if (userAlreadyInAgency(applicantSnap, applicantMembershipSnap)) {
        throw new ApiError("applicant_already_in_agency", 409);
      }
      assertApplicantLockAllowsSubmit(
        applicantLockSnap,
        applicantUid,
        nowMs,
      );

      const hostUids = publicIdSnaps.map((snap, index) => {
        if (!snap.exists) {
          throw new ApiError("agency_host_id_not_found", 404, {
            hostId: hostIds[index],
          });
        }
        const uid = clean(snap.data?.uid);
        if (!uid) {
          throw new ApiError("agency_host_id_not_found", 404, {
            hostId: hostIds[index],
          });
        }
        return uid;
      });
      if (new Set(hostUids).size !== hostUids.length) {
        throw new ApiError("duplicate_agency_application_host", 400);
      }
      if (hostUids.includes(applicantUid)) {
        throw new ApiError("applicant_cannot_be_application_host", 409);
      }

      const hostState = await Promise.all(
        hostUids.flatMap((uid) => [
          db.get(`users/${uid}`, transaction),
          db.get(`agency_user_memberships/${uid}`, transaction),
          db.get(`agency_application_locks/${uid}`, transaction),
        ]),
      );

      for (let index = 0; index < hostUids.length; index += 1) {
        const userSnap = hostState[index * 3];
        const membershipSnap = hostState[index * 3 + 1];
        const lockSnap = hostState[index * 3 + 2];
        if (!accountAvailableForAgency(userSnap)) {
          throw new ApiError("agency_host_unavailable", 409, {
            hostId: hostIds[index],
          });
        }
        if (userAlreadyInAgency(userSnap, membershipSnap)) {
          throw new ApiError("agency_host_already_in_agency", 409, {
            hostId: hostIds[index],
          });
        }
        if (activeApplicationLock(lockSnap)) {
          throw new ApiError("agency_host_application_conflict", 409, {
            hostId: hostIds[index],
          });
        }
      }

      const application = createAgencyApplicationDocument({
        applicationId,
        applicantUid,
        name,
        requestedPublicId: null,
        hostIds,
        hostUids,
        country,
        reapplyMode: null,
        now: nowDate,
      });
      const result = {
        applicationId,
        status: "pending",
        name,
        country,
        hostIds,
      };

      const writes = [
        db.writeCreate(applicationPath, {
          ...application,
          applicantPublicId: clean(applicantSnap.data?.publicId) || null,
        }),
        applicantLockSnap.exists
          ? db.writeUpdate(applicantLockPath, {
              applicationId,
              applicantUid,
              participantType: "applicant",
              status: "pending",
              reapplyMode: null,
              reapplyAllowedAt: null,
              rejectedAt: null,
              rejectedBy: null,
              rejectionReason: null,
              updatedAt: nowDate,
            }, [
              "applicationId",
              "applicantUid",
              "participantType",
              "status",
              "reapplyMode",
              "reapplyAllowedAt",
              "rejectedAt",
              "rejectedBy",
              "rejectionReason",
              "updatedAt",
            ])
          : db.writeCreate(applicantLockPath, {
              applicationId,
              applicantUid,
              participantType: "applicant",
              status: "pending",
              reapplyMode: null,
              reapplyAllowedAt: null,
              rejectedAt: null,
              rejectedBy: null,
              rejectionReason: null,
              createdAt: nowDate,
              updatedAt: nowDate,
            }),
        ...hostUids.map((uid, index) => {
          const lockSnap = hostState[index * 3 + 2];
          const fields = {
            applicationId,
            applicantUid,
            participantType: "host_candidate",
            hostUid: uid,
            hostPublicId: hostIds[index],
            status: "pending",
            reapplyMode: null,
            reapplyAllowedAt: null,
            rejectedAt: null,
            rejectedBy: null,
            rejectionReason: null,
            updatedAt: nowDate,
          };
          return lockSnap.exists
            ? db.writeUpdate(
                `agency_application_locks/${uid}`,
                fields,
                Object.keys(fields),
              )
            : db.writeCreate(`agency_application_locks/${uid}`, {
                ...fields,
                createdAt: nowDate,
              });
        }),
        db.writeCreate(operationPath, {
          uid: applicantUid,
          action: "submitAgencyApplication",
          applicationId,
          requestFingerprint: fingerprint,
          status: "completed",
          result,
          createdAt: nowDate,
        }),
        db.writeCreate(
          `admin_audit_logs/agency_application_submit_${applicationId}`,
          {
            actorUid: applicantUid,
            action: "submitAgencyApplication",
            targetType: "agency_application",
            targetId: applicationId,
            after: {
              status: "pending",
              name,
              country,
              hostIds,
              hostUids,
            },
            idempotencyKey: key,
            createdAt: nowDate,
          },
        ),
      ];

      await db.commit(transaction, writes);
      return {
        ok: true,
        code: "ok",
        operationId: key,
        ...result,
      };
    } catch (error) {
      await db.rollback(transaction);
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

export async function getAgencyApplicationStatus(
  db,
  applicantUidInput,
  { now = new Date() } = {},
) {
  const applicantUid = clean(applicantUidInput);
  if (!applicantUid) throw new ApiError("invalid_applicant", 400);
  const lockSnap = await db.get(`agency_application_locks/${applicantUid}`);
  if (!lockSnap.exists) {
    return {
      ok: true,
      status: "none",
      applicationId: null,
      canReapply: true,
      reapplyMode: null,
      reapplyAllowedAt: null,
      remainingSeconds: 0,
      rejectionReason: null,
    };
  }
  const lock = lockSnap.data || {};
  const applicationId = clean(lock.applicationId) || null;
  const applicationSnap = applicationId
    ? await db.get(`agency_applications/${applicationId}`)
    : { exists: false, data: null };
  const application = applicationSnap.exists
    ? applicationSnap.data || {}
    : {};
  const status = clean(application.status || lock.status || "none");
  const reapplyMode = clean(
    application.reapplyMode || lock.reapplyMode,
  ) || null;
  const reapplyAllowedAt =
    application.reapplyAllowedAt || lock.reapplyAllowedAt || null;
  const nowDate = now instanceof Date ? now : new Date(now);
  const nowMs = nowDate.getTime();
  if (!Number.isFinite(nowMs)) throw new ApiError("invalid_request", 400);

  let canReapply = false;
  let remainingSeconds = 0;
  if (status === "rejected") {
    if (reapplyMode === "immediate") {
      canReapply = true;
    } else if (reapplyMode === "manual") {
      canReapply = false;
    } else {
      const allowedAtMs = timestampMs(reapplyAllowedAt);
      canReapply = allowedAtMs > 0 && allowedAtMs <= nowMs;
      remainingSeconds = allowedAtMs > nowMs
        ? Math.ceil((allowedAtMs - nowMs) / 1000)
        : 0;
    }
  }

  return {
    ok: true,
    status,
    applicationId,
    canReapply,
    reapplyMode,
    reapplyAllowedAt,
    remainingSeconds,
    rejectionReason:
      clean(application.rejectionReason || lock.rejectionReason) || null,
    rejectedAt: application.rejectedAt || lock.rejectedAt || null,
  };
}

export async function agencyApplication(request, env) {
  if (request.method !== "POST") {
    return json(
      request,
      env,
      { ok: false, code: "method_not_allowed" },
      405,
    );
  }

  try {
    const decoded = await verifyFirebaseIdToken(request, env);
    if (decoded.firebase?.sign_in_provider === "anonymous") {
      throw new ApiError("account_required", 403);
    }
    const body = await readJson(request);
    const action = clean(body.action || "submit");
    annotatePressureRequest(request, {
      action: `agencyApplication:${action}`,
    });
    if (action === "status") {
      const result = await getAgencyApplicationStatus(
        firestoreClient(env),
        decoded.sub,
      );
      return json(request, env, result);
    }
    if (action !== "submit") {
      throw new ApiError("invalid_action", 400);
    }
    const result = await submitAgencyApplication(
      firestoreClient(env),
      decoded.sub,
      body,
    );
    return json(request, env, result);
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
    return json(
      request,
      env,
      { ok: false, code: "agency_application_failed" },
      500,
    );
  }
}
