import { randomUUID } from "node:crypto";
import { firestoreQuotaResponse, json, readJson } from "./http.js";
import { verifyFirebaseIdToken } from "./firebase-auth.js";
import { firestoreClient } from "./firestore.js";
import { adminInboxDeleteWrite } from "./admin-inbox-index.js";

// A request is NOT a completed deletion. The data-erasure / legal-retention
// worker must be separately verified before marking a request completed.
export const ACCOUNT_DELETION_GRACE_MS = 30 * 24 * 60 * 60 * 1000;
export const ACCOUNT_DELETION_RECENT_AUTH_SECONDS = 600;

export class AccountDeletionError extends Error {
  constructor(code, status = 400) {
    super(code);
    this.code = code;
    this.status = status;
  }
}

const clean = (value) => String(value ?? "").trim();
const pathFor = (uid) => "account_deletion_requests/" + uid;

function iso(value) {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString();
  if (typeof value.toDate === "function") return value.toDate().toISOString();
  if (typeof value === "string") {
    const time = Date.parse(value);
    return Number.isFinite(time) ? new Date(time).toISOString() : null;
  }
  const seconds = Number(value.seconds ?? value._seconds);
  return Number.isFinite(seconds) ? new Date(seconds * 1000).toISOString() : null;
}

function publicStatus(record) {
  if (!record) return {
    ok: true, status: "none", requestedAt: null, eligibleAt: null,
    cancellationAvailable: false,
  };
  const status = clean(record.status);
  if (!["pending", "review_ready", "cancelled", "processing", "completed"].includes(status)) {
    throw new AccountDeletionError("deletion_state_invalid", 409);
  }
  return {
    ok: true,
    status,
    requestedAt: iso(record.requestedAt),
    eligibleAt: iso(record.eligibleAt),
    cancellationAvailable: status === "pending" || status === "review_ready",
  };
}

function assertRecentAuth(decoded, nowMs) {
  const authTime = Number(decoded?.auth_time);
  const age = Math.floor(nowMs / 1000) - authTime;
  if (!Number.isFinite(age) || age < -60 ||
      age > ACCOUNT_DELETION_RECENT_AUTH_SECONDS) {
    throw new AccountDeletionError("recent_auth_required", 401);
  }
}

export async function ownAccountDeletion(db, decoded, body = {}, {
  nowMs = Date.now(), idFactory = randomUUID,
} = {}) {
  const uid = clean(decoded?.sub);
  const action = clean(body?.action || "status");
  if (!uid || uid.length > 128 || uid.includes("/")) {
    throw new AccountDeletionError("unauthorized", 401);
  }
  if (clean(decoded?.firebase?.sign_in_provider) === "anonymous") {
    throw new AccountDeletionError("registered_account_required", 403);
  }
  if (!["status", "request", "cancel"].includes(action)) {
    throw new AccountDeletionError("invalid_action", 400);
  }
  const path = pathFor(uid);

  if (action === "status") {
    const [user, request] = await Promise.all([
      db.get("users/" + uid),
      db.get(path),
    ]);
    if (!user.exists || user.data?.authDeleted === true) {
      throw new AccountDeletionError("account_not_available", 403);
    }
    return publicStatus(request.exists ? request.data : null);
  }

  assertRecentAuth(decoded, nowMs);
  const tx = await db.beginTransaction();
  try {
    const [user, previous] = await Promise.all([
      db.get("users/" + uid, tx),
      db.get(path, tx),
    ]);
    if (!user.exists || user.data?.authDeleted === true ||
        clean(user.data?.accountStatus || "active") === "deleted") {
      throw new AccountDeletionError("account_not_available", 403);
    }
    const existing = previous.exists ? previous.data || {} : null;
    if (existing &&
        !["pending", "review_ready", "cancelled", "processing", "completed"].includes(
          clean(existing.status))) {
      throw new AccountDeletionError("deletion_state_invalid", 409);
    }
    if (action === "request") {
      if (["pending", "review_ready"].includes(existing?.status)) {
        await db.rollback(tx);
        return { ...publicStatus(existing), duplicate: true };
      }
      if (existing?.status === "processing" ||
          existing?.status === "completed") {
        throw new AccountDeletionError("deletion_not_available", 409);
      }
      // Never accept payment instructions, target UIDs or asserted deadlines
      // from the client. Firebase ID token selects the ONLY affected account.
      const now = new Date(nowMs);
      const record = {
        uid,
        status: "pending",
        requestedAt: now,
        eligibleAt: new Date(nowMs + ACCOUNT_DELETION_GRACE_MS),
        cancelledAt: null,
        updatedAt: now,
        // Stay pending until a verified erasure/retention processor exists.
        retentionReviewRequired: true,
        // A new request after cancellation is a new lifecycle. It must
        // never inherit the previous review's hold or owner decisions.
        reviewHold: false,
        reviewHoldReason: "",
        reviewUpdatedBy: null,
        reviewUpdatedAt: null,
        reviewQueuedAt: null,
        reviewReason: null,
        requestId: idFactory(),
      };
      const writes = [
        previous.exists
          ? db.writeUpdate(path, record, Object.keys(record))
          : db.writeCreate(path, record),
        db.writeCreate("admin_audit_logs/self_delete_request_" + record.requestId, {
          action: "selfAccountDeletionRequested",
          actorUid: uid,
          targetType: "user", targetId: uid,
          requestId: record.requestId,
          createdAt: now,
        }),
      ];
      await db.commit(tx, writes);
      return publicStatus(record);
    }

    if (!existing || existing.status === "cancelled") {
      await db.rollback(tx);
      return { ...publicStatus(existing), duplicate: true };
    }
    if (!["pending", "review_ready"].includes(existing.status)) {
      throw new AccountDeletionError("deletion_not_cancellable", 409);
    }
    const now = new Date(nowMs);
    const record = {
      ...existing,
      status: "cancelled",
      cancelledAt: now,
      updatedAt: now,
    };
    await db.commit(tx, [
      db.writeUpdate(path, {
        status: "cancelled",
        cancelledAt: now,
        updatedAt: now,
      }, ["status", "cancelledAt", "updatedAt"]),
      ...(existing.status === "review_ready" ? [
        adminInboxDeleteWrite(db, "account_deletion_review", uid),
      ] : []),
      db.writeCreate("admin_audit_logs/self_delete_cancel_" + idFactory(), {
        action: "selfAccountDeletionCancelled",
        actorUid: uid,
        targetType: "user", targetId: uid,
        requestId: clean(existing.requestId),
        createdAt: now,
      }),
    ]);
    return publicStatus(record);
  } catch (error) {
    await db.rollback(tx).catch(() => {});
    throw error;
  }
}

export async function accountDeletion(request, env) {
  if (request.method !== "POST") {
    return json(request, env, { ok: false, code: "method_not_allowed" }, 405);
  }
  try {
    const actor = await verifyFirebaseIdToken(request, env, {
      // A suspended user must still be able to request account deletion.
      // Identity is verified; all actions remain self-scoped by sub.
      checkUserState: false,
    });
    const body = await readJson(request);
    const result = await ownAccountDeletion(
      firestoreClient(env), actor, body,
    );
    return json(request, env, result);
  } catch (error) {
    if (error instanceof AccountDeletionError) {
      return json(request, env, { ok: false, code: error.code }, error.status);
    }
    if (clean(error?.message) === "unauthorized") {
      return json(request, env, { ok: false, code: "unauthorized" }, 401);
    }
    if (/firestore_quota_exhausted|RESOURCE_EXHAUSTED/.test(
      clean(error?.code || error?.message))) {
      return firestoreQuotaResponse(request, env, error);
    }
    console.error("Account deletion request failed",
      clean(error?.code || error?.message).slice(0, 90));
    return json(request, env, { ok: false, code: "deletion_request_unavailable" }, 503);
  }
}
