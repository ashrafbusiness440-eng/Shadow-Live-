import { json, readJson, firestoreQuotaResponse } from "./http.js";
import { verifyFirebaseIdToken } from "./firebase-auth.js";
import {
  firestoreClient,
  firestoreErrorRetryDelayMs,
  isTransientFirestoreError,
} from "./firestore.js";
import {
  AGENCY_LIMITS,
  createAgencyApplicationDocument,
  normalizeApplicationHostIds,
} from "./agency-data-model.js";
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
  return ["draft", "reserved", "pending", "under_review"].includes(status);
}

function assertApplicantLockAllowsSubmit(
  lockSnap,
  applicantUid,
  nowMs,
  applicationId = null,
) {
  if (!lockSnap?.exists) return;
  const lock = lockSnap.data || {};
  const status = clean(lock.status);

  if (status === "draft") {
    if (applicationId && clean(lock.applicationId) === applicationId) return;
    throw new ApiError("agency_application_participation_conflict", 409, {
      applicationId: clean(lock.applicationId) || null,
    });
  }

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


function requiredHostCountFromSnapshot(snapshot) {
  const raw = snapshot?.exists
    ? Number(snapshot.data?.requiredHostCount)
    : AGENCY_LIMITS.applicationHostIds;
  if (
    !Number.isInteger(raw) ||
    raw < AGENCY_LIMITS.minApplicationHostIds ||
    raw > AGENCY_LIMITS.maxApplicationHostIds
  ) {
    return AGENCY_LIMITS.applicationHostIds;
  }
  return raw;
}

function profileSnapshot(userSnap, hostId, uid) {
  const user = userSnap?.data || {};
  const displayName = clean(
    user.displayName ||
      user.name ||
      user.username ||
      user.nickname ||
      user.fullName ||
      hostId,
  );
  const photoUrl = clean(
    user.photoUrl ||
      user.photoURL ||
      user.avatarUrl ||
      user.avatarURL ||
      user.profileImageUrl ||
      user.profileImage,
  );
  return {
    uid,
    publicId: hostId,
    displayName,
    photoUrl: photoUrl || null,
  };
}

function sameApplicationLock(lockSnap, applicationId) {
  return (
    lockSnap?.exists &&
    clean(lockSnap.data?.applicationId) === clean(applicationId)
  );
}

export async function reserveAgencyApplicationHost(
  db,
  applicantUidInput,
  body = {},
  { now = new Date() } = {},
) {
  const applicantUid = clean(applicantUidInput);
  const hostId = clean(body.hostId);
  const key = clean(body.idempotencyKey);
  if (!applicantUid || !validIdempotencyKey(key)) {
    throw new ApiError("invalid_request", 400);
  }
  if (!/^\d{3,8}$/.test(hostId)) {
    throw new ApiError("invalid_agency_application_host_id", 400);
  }

  const applicationId = applicationIdFor(applicantUid, key);
  const applicantLockPath = `agency_application_locks/${applicantUid}`;
  const nowDate = now instanceof Date ? now : new Date(now);
  const nowMs = nowDate.getTime();
  if (!Number.isFinite(nowMs)) throw new ApiError("invalid_request", 400);

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const transaction = await db.beginTransaction();
    try {
      const [
        settingsSnap,
        applicantSnap,
        applicantMembershipSnap,
        applicantLockSnap,
        publicIdSnap,
      ] = await Promise.all([
        db.get("system_config/agency_application", transaction),
        db.get(`users/${applicantUid}`, transaction),
        db.get(`agency_user_memberships/${applicantUid}`, transaction),
        db.get(applicantLockPath, transaction),
        db.get(`public_ids/${hostId}`, transaction),
      ]);

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
        applicationId,
      );

      const hostUid = clean(publicIdSnap.data?.uid);
      if (!publicIdSnap.exists || !hostUid) {
        throw new ApiError("agency_host_id_not_found", 404, { hostId });
      }
      if (hostUid === applicantUid) {
        throw new ApiError("applicant_cannot_be_application_host", 409);
      }

      const [hostUserSnap, hostMembershipSnap, hostLockSnap] = await Promise.all([
        db.get(`users/${hostUid}`, transaction),
        db.get(`agency_user_memberships/${hostUid}`, transaction),
        db.get(`agency_application_locks/${hostUid}`, transaction),
      ]);
      if (!accountAvailableForAgency(hostUserSnap)) {
        throw new ApiError("agency_host_unavailable", 409, { hostId });
      }
      if (userAlreadyInAgency(hostUserSnap, hostMembershipSnap)) {
        throw new ApiError("agency_host_already_in_agency", 409, { hostId });
      }

      if (activeApplicationLock(hostLockSnap)) {
        if (
          sameApplicationLock(hostLockSnap, applicationId) &&
          clean(hostLockSnap.data?.hostPublicId) === hostId
        ) {
          const profile = profileSnapshot(hostUserSnap, hostId, hostUid);
          await db.rollback(transaction);
          return {
            ok: true,
            code: "duplicate",
            applicationId,
            requiredHostCount: Number(
              applicantLockSnap.data?.requiredHostCount ??
                requiredHostCountFromSnapshot(settingsSnap),
            ),
            host: profile,
          };
        }
        throw new ApiError("agency_host_application_conflict", 409, { hostId });
      }

      const existingDraft =
        applicantLockSnap.exists &&
        clean(applicantLockSnap.data?.status) === "draft" &&
        sameApplicationLock(applicantLockSnap, applicationId);
      const requiredHostCount = existingDraft
        ? Number(applicantLockSnap.data?.requiredHostCount)
        : requiredHostCountFromSnapshot(settingsSnap);
      if (
        !Number.isInteger(requiredHostCount) ||
        requiredHostCount < AGENCY_LIMITS.minApplicationHostIds ||
        requiredHostCount > AGENCY_LIMITS.maxApplicationHostIds
      ) {
        throw new ApiError("invalid_agency_application_host_count", 409);
      }
      if (requiredHostCount === 0) {
        throw new ApiError("agency_application_hosts_not_required", 409);
      }

      const hostIds = existingDraft && Array.isArray(applicantLockSnap.data?.hostIds)
        ? applicantLockSnap.data.hostIds.map(clean).filter(Boolean)
        : [];
      const hostUids = existingDraft && Array.isArray(applicantLockSnap.data?.hostUids)
        ? applicantLockSnap.data.hostUids.map(clean).filter(Boolean)
        : [];
      const hostProfiles =
        existingDraft && Array.isArray(applicantLockSnap.data?.hostProfiles)
          ? applicantLockSnap.data.hostProfiles
              .filter((item) => item && typeof item === "object")
              .map((item) => ({ ...item }))
          : [];

      if (hostIds.includes(hostId) || hostUids.includes(hostUid)) {
        throw new ApiError("duplicate_agency_application_host", 409, { hostId });
      }
      if (hostIds.length >= requiredHostCount) {
        throw new ApiError("agency_application_host_limit_reached", 409, {
          requiredHostCount,
        });
      }

      const profile = profileSnapshot(hostUserSnap, hostId, hostUid);
      const nextHostIds = [...hostIds, hostId];
      const nextHostUids = [...hostUids, hostUid];
      const nextHostProfiles = [...hostProfiles, profile];
      const applicantDraftFields = {
        applicationId,
        applicantUid,
        participantType: "applicant",
        status: "draft",
        reservationKey: key,
        requiredHostCount,
        hostIds: nextHostIds,
        hostUids: nextHostUids,
        hostProfiles: nextHostProfiles,
        reapplyMode: null,
        reapplyAllowedAt: null,
        rejectedAt: null,
        rejectedBy: null,
        rejectionReason: null,
        updatedAt: nowDate,
      };
      const hostReservationFields = {
        applicationId,
        applicantUid,
        participantType: "host_candidate",
        hostUid,
        hostPublicId: hostId,
        status: "reserved",
        reservationKey: key,
        requiredHostCount,
        reservedAt: nowDate,
        updatedAt: nowDate,
      };

      const writes = [
        applicantLockSnap.exists
          ? db.writeUpdate(
              applicantLockPath,
              applicantDraftFields,
              Object.keys(applicantDraftFields),
            )
          : db.writeCreate(applicantLockPath, {
              ...applicantDraftFields,
              createdAt: nowDate,
            }),
        hostLockSnap.exists
          ? db.writeUpdate(
              `agency_application_locks/${hostUid}`,
              hostReservationFields,
              Object.keys(hostReservationFields),
            )
          : db.writeCreate(`agency_application_locks/${hostUid}`, {
              ...hostReservationFields,
              createdAt: nowDate,
            }),
      ];
      await db.commit(transaction, writes);
      return {
        ok: true,
        code: "ok",
        applicationId,
        requiredHostCount,
        host: profile,
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


export async function releaseAgencyApplicationHost(
  db,
  applicantUidInput,
  body = {},
  { now = new Date() } = {},
) {
  const applicantUid = clean(applicantUidInput);
  const hostId = clean(body.hostId);
  const key = clean(body.idempotencyKey);
  if (!applicantUid || !validIdempotencyKey(key)) {
    throw new ApiError("invalid_request", 400);
  }
  if (!/^\d{3,8}$/.test(hostId)) {
    throw new ApiError("invalid_agency_application_host_id", 400);
  }

  const applicationId = applicationIdFor(applicantUid, key);
  const applicantLockPath = `agency_application_locks/${applicantUid}`;
  const nowDate = now instanceof Date ? now : new Date(now);

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const transaction = await db.beginTransaction();
    try {
      const applicantLockSnap = await db.get(
        applicantLockPath,
        transaction,
      );
      if (
        !applicantLockSnap.exists ||
        clean(applicantLockSnap.data?.status) !== "draft" ||
        !sameApplicationLock(applicantLockSnap, applicationId)
      ) {
        throw new ApiError("agency_application_draft_not_editable", 409);
      }

      const lock = applicantLockSnap.data || {};
      const reservedIds = Array.isArray(lock.hostIds)
        ? lock.hostIds.map(clean)
        : [];
      const reservedUids = Array.isArray(lock.hostUids)
        ? lock.hostUids.map(clean)
        : [];
      const reservedIndex = reservedIds.indexOf(hostId);
      if (
        reservedIndex < 0 ||
        reservedIndex >= reservedUids.length ||
        !reservedUids[reservedIndex]
      ) {
        await db.rollback(transaction);
        return {
          ok: true,
          code: "already_released",
          applicationId,
          hostId,
        };
      }
      const hostUid = reservedUids[reservedIndex];
      const hostLockPath = `agency_application_locks/${hostUid}`;
      const hostLockSnap = await db.get(hostLockPath, transaction);
      if (
        !hostLockSnap.exists ||
        !sameApplicationLock(hostLockSnap, applicationId) ||
        clean(hostLockSnap.data?.hostPublicId) !== hostId
      ) {
        await db.rollback(transaction);
        return {
          ok: true,
          code: "already_released",
          applicationId,
          hostId,
        };
      }
      if (clean(hostLockSnap.data?.status) !== "reserved") {
        throw new ApiError("agency_host_reservation_not_editable", 409, {
          hostId,
        });
      }

      const hostIds = Array.isArray(lock.hostIds)
        ? lock.hostIds.map(clean).filter((value) => value && value !== hostId)
        : [];
      const hostUids = Array.isArray(lock.hostUids)
        ? lock.hostUids.map(clean).filter((value) => value && value !== hostUid)
        : [];
      const hostProfiles = Array.isArray(lock.hostProfiles)
        ? lock.hostProfiles.filter((item) => {
            if (!item || typeof item !== "object") return false;
            return clean(item.uid) !== hostUid && clean(item.publicId) !== hostId;
          })
        : [];

      await db.commit(transaction, [
        db.writeUpdate(
          applicantLockPath,
          {
            hostIds,
            hostUids,
            hostProfiles,
            updatedAt: nowDate,
          },
          ["hostIds", "hostUids", "hostProfiles", "updatedAt"],
        ),
        db.writeUpdate(
          hostLockPath,
          {
            status: "released",
            releasedAt: nowDate,
            updatedAt: nowDate,
          },
          ["status", "releasedAt", "updatedAt"],
        ),
      ]);

      return {
        ok: true,
        code: "ok",
        applicationId,
        hostId,
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
    if (!Array.isArray(body.hostIds)) {
      throw new Error("invalid_agency_application_hosts");
    }
    hostIds = normalizeApplicationHostIds(body.hostIds, body.hostIds.length);
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
        settingsSnap,
      ] = await Promise.all([
        db.get(operationPath, transaction),
        db.get(`users/${applicantUid}`, transaction),
        db.get(applicantMembershipPath, transaction),
        db.get(applicantLockPath, transaction),
        db.get("system_config/agency_application", transaction),
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
        applicationId,
      );

      const draftForThisApplication =
        applicantLockSnap.exists &&
        clean(applicantLockSnap.data?.status) === "draft" &&
        sameApplicationLock(applicantLockSnap, applicationId);
      const requiredHostCount = draftForThisApplication
        ? Number(applicantLockSnap.data?.requiredHostCount)
        : requiredHostCountFromSnapshot(settingsSnap);
      if (
        !Number.isInteger(requiredHostCount) ||
        requiredHostCount < AGENCY_LIMITS.minApplicationHostIds ||
        requiredHostCount > AGENCY_LIMITS.maxApplicationHostIds ||
        hostIds.length !== requiredHostCount
      ) {
        throw new ApiError("invalid_agency_application_hosts", 400, {
          requiredHostCount,
        });
      }

      let hostUids;
      if (draftForThisApplication) {
        const draftHostIds = Array.isArray(applicantLockSnap.data?.hostIds)
          ? applicantLockSnap.data.hostIds.map(clean)
          : [];
        const draftHostUids = Array.isArray(applicantLockSnap.data?.hostUids)
          ? applicantLockSnap.data.hostUids.map(clean)
          : [];
        if (
          draftHostIds.length !== requiredHostCount ||
          draftHostUids.length !== requiredHostCount ||
          new Set(draftHostIds).size !== draftHostIds.length ||
          new Set(draftHostUids).size !== draftHostUids.length
        ) {
          throw new ApiError("agency_host_reservation_missing", 409);
        }
        hostUids = hostIds.map((hostId) => {
          const index = draftHostIds.indexOf(hostId);
          if (index < 0 || !draftHostUids[index]) {
            throw new ApiError("agency_host_reservation_missing", 409, {
              hostId,
            });
          }
          return draftHostUids[index];
        });
      } else {
        const publicIdSnaps = await Promise.all(
          hostIds.map((hostId) =>
            db.get(`public_ids/${hostId}`, transaction)
          ),
        );
        hostUids = publicIdSnaps.map((snap, index) => {
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
      }
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
        if (
          activeApplicationLock(lockSnap) &&
          !sameApplicationLock(lockSnap, applicationId)
        ) {
          throw new ApiError("agency_host_application_conflict", 409, {
            hostId: hostIds[index],
          });
        }
        if (
          draftForThisApplication &&
          (
            !lockSnap.exists ||
            clean(lockSnap.data?.status) !== "reserved" ||
            !sameApplicationLock(lockSnap, applicationId)
          )
        ) {
          throw new ApiError("agency_host_reservation_missing", 409, {
            hostId: hostIds[index],
          });
        }
      }

      const hostProfiles = hostUids.map((uid, index) =>
        profileSnapshot(
          hostState[index * 3],
          hostIds[index],
          uid,
        )
      );

      const application = createAgencyApplicationDocument({
        applicationId,
        applicantUid,
        name,
        requestedPublicId: null,
        hostIds,
        hostUids,
        requiredHostCount,
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
        requiredHostCount,
      };

      const writes = [
        db.writeCreate(applicationPath, {
          ...application,
          applicantPublicId: clean(applicantSnap.data?.publicId) || null,
          hostProfiles,
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
              requiredHostCount,
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
              "requiredHostCount",
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
              requiredHostCount,
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
            requiredHostCount,
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
        adminInboxUpsertWrite(db, {
          type: "agency_application",
          title: "طلب إنشاء وكالة",
          body: name,
          targetId: applicationId,
          route: "agency_control",
          createdAt: nowDate,
          priority: "high",
          meta: { status: "pending" },
        }),
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
  const [lockSnap, settingsSnap] = await Promise.all([
    db.get(`agency_application_locks/${applicantUid}`),
    db.get("system_config/agency_application"),
  ]);
  const configuredHostCount = requiredHostCountFromSnapshot(settingsSnap);
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
      requiredHostCount: configuredHostCount,
      reservedHosts: [],
      reservationKey: null,
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
  const storedRequiredHostCount = Number.isInteger(Number(
    application.requiredHostCount ?? lock.requiredHostCount,
  ))
    ? Number(application.requiredHostCount ?? lock.requiredHostCount)
    : configuredHostCount;
  const requiredHostCount =
    status === "rejected" ? configuredHostCount : storedRequiredHostCount;
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
    requiredHostCount,
    reservationKey: status === "draft"
      ? clean(lock.reservationKey) || null
      : null,
    reservedHosts:
      status === "draft" && Array.isArray(lock.hostProfiles)
        ? lock.hostProfiles
            .filter((item) => item && typeof item === "object")
            .map((item) => ({
              uid: clean(item.uid),
              publicId: clean(item.publicId),
              displayName: clean(item.displayName),
              photoUrl: clean(item.photoUrl) || null,
            }))
        : [],
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
    if (action === "reserveHost") {
      const result = await reserveAgencyApplicationHost(
        firestoreClient(env),
        decoded.sub,
        body,
      );
      return json(request, env, result);
    }
    if (action === "releaseHost") {
      const result = await releaseAgencyApplicationHost(
        firestoreClient(env),
        decoded.sub,
        body,
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
