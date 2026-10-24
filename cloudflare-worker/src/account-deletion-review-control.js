import { randomUUID } from "node:crypto";
import { adminInboxUpsertWrite } from "./admin-inbox-index.js";

// This is a human review / legal-hold workflow, NOT a data erasure executor.
// Do not change accountStatus, Firebase Auth, wallet ledgers, R2, or reports.
export class AccountDeletionReviewControlError extends Error {
  constructor(code, status = 400) {
    super(code);
    this.code = code;
    this.status = status;
  }
}

const clean = (value) => String(value ?? "").trim();
const safeUid = (uid) => /^[A-Za-z0-9_-]{3,128}$/.test(clean(uid));
const safeRequestId = (id) => /^[A-Za-z0-9_-]{12,180}$/.test(clean(id));
const requestPath = (uid) => "account_deletion_requests/" + uid;
const ownerProfilePath = (uid) => "users/" + uid;

function millis(value) {
  if (value instanceof Date) return value.getTime();
  if (typeof value?.toDate === "function") return value.toDate().getTime();
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  const seconds = Number(value?.seconds ?? value?._seconds);
  if (value && Number.isFinite(seconds)) return seconds * 1000;
  const parsed = Date.parse(clean(value));
  return Number.isFinite(parsed) ? parsed : 0;
}

function validateRequest(uid, request, nowMs = Date.now()) {
  if (!request?.exists || clean(request.data?.uid) !== uid ||
      !safeRequestId(request.data?.requestId)) {
    throw new AccountDeletionReviewControlError("deletion_request_not_found", 404);
  }
  if (clean(request.data.status) !== "review_ready") {
    throw new AccountDeletionReviewControlError("review_no_longer_available", 409);
  }
  if (millis(request.data.eligibleAt) <= 0 ||
      millis(request.data.eligibleAt) > nowMs) {
    throw new AccountDeletionReviewControlError("review_not_due", 409);
  }
  return request.data;
}

function accountReviewSummary(request, user, membership, uid) {
  const account = user.data || {};
  const data = request.data || {};
  const coins = Number(account.coins ?? account.balance ?? 0);
  const diamonds = Number(account.diamonds ?? 0);
  const financialBalanceDetected = (Number.isFinite(coins) && coins !== 0) ||
    (Number.isFinite(diamonds) && diamonds !== 0);
  return {
    ok: true,
    targetUid: uid,
    requestId: clean(data.requestId),
    status: clean(data.status),
    eligibleAtMs: millis(data.eligibleAt),
    reviewHold: data.reviewHold === true,
    reviewHoldReason: data.reviewHold === true
      ? clean(data.reviewHoldReason).slice(0, 250) : "",
    signals: {
      ownerAccount: clean(account.role) === "owner",
      adminAccount: account.adminEnabled === true,
      legalHold: [account.legalHold, account.retentionHold,
        account.deletionHold].some((flag) => flag === true),
      balanceDetected: financialBalanceDetected,
      balanceUnknown: !Number.isFinite(coins) || !Number.isFinite(diamonds),
      agencyMembershipPresent: membership?.exists === true,
      // Indexed per-actor histories, gift settlements, reports and financial
      // ledgers cannot be established from three direct reads. Never mark
      // these as checked just because today's account balance is zero.
      ledgersAndReportsNotVerified: true,
      roomOwnershipNotVerified: true,
      privateMessagesNotVerified: true,
      storageEvidenceNotVerified: true,
    },
  };
}

export async function inspectAccountDeletionForOwner(db, uid, {
  nowMs = Date.now(),
} = {}) {
  uid = clean(uid);
  if (!safeUid(uid)) throw new AccountDeletionReviewControlError("invalid_target_uid");
  // Only three direct Firestore reads, no global scans/listeners or secrets.
  const [request, user, membership] = await Promise.all([
    db.get(requestPath(uid)),
    db.get(ownerProfilePath(uid)),
    db.get("agency_user_memberships/" + uid),
  ]);
  const valid = validateRequest(uid, request, nowMs);
  if (!user.exists || user.data?.authDeleted === true ||
      clean(user.data?.accountStatus) === "deleted") {
    throw new AccountDeletionReviewControlError("account_not_available", 409);
  }
  return accountReviewSummary({ ...request, data: valid }, user, membership, uid);
}

export async function setAccountDeletionReviewHold(db, {
  actorUid,
  targetUid,
  requestId,
  action,
  reason = "",
  nowMs = Date.now(),
  idFactory = randomUUID,
} = {}) {
  actorUid = clean(actorUid);
  targetUid = clean(targetUid);
  requestId = clean(requestId);
  reason = clean(reason);
  if (!safeUid(actorUid) || !safeUid(targetUid) ||
      !safeRequestId(requestId) ||
      !["accountDeletionHold", "accountDeletionReleaseHold"].includes(action) ||
      reason.length > 250 ||
      (action === "accountDeletionHold" && reason.length < 8)) {
    throw new AccountDeletionReviewControlError("invalid_review_action", 400);
  }
  if (!Number.isFinite(nowMs)) {
    throw new AccountDeletionReviewControlError("invalid_review_time");
  }
  const tx = await db.beginTransaction();
  try {
    const [request, user] = await Promise.all([
      db.get(requestPath(targetUid), tx),
      db.get(ownerProfilePath(targetUid), tx),
    ]);
    const current = validateRequest(targetUid, request, nowMs);
    if (clean(current.requestId) !== requestId || !user.exists ||
        user.data?.authDeleted === true ||
        clean(user.data?.accountStatus) === "deleted") {
      throw new AccountDeletionReviewControlError("review_no_longer_available", 409);
    }
    if (clean(user.data?.role) === "owner") {
      throw new AccountDeletionReviewControlError("owner_protected", 409);
    }
    const hold = action === "accountDeletionHold";
    if (current.reviewHold === hold &&
        (!hold || clean(current.reviewHoldReason) === reason)) {
      await db.rollback(tx);
      return { ok: true, status: "review_ready", reviewHold: hold,
        duplicate: true };
    }
    const now = new Date(nowMs);
    const fields = {
      reviewHold: hold,
      reviewHoldReason: hold ? reason : "",
      reviewUpdatedBy: actorUid,
      reviewUpdatedAt: now,
      updatedAt: now,
    };
    const auditId = idFactory();
    if (!safeRequestId(auditId)) {
      throw new AccountDeletionReviewControlError("invalid_operation_id");
    }
    await db.commit(tx, [
      db.writeUpdate(requestPath(targetUid), fields, Object.keys(fields)),
      adminInboxUpsertWrite(db, {
        type: "account_deletion_review",
        title: hold ? "حذف حساب — مراجعة موقوفة" :
          "حذف حساب — مراجعة البيانات",
        body: hold ?
          "مراجعة الحذف موقوفة إلى حين حل متطلبات الاحتفاظ والأرصدة." :
          "يمكن متابعة مراجعة الحذف دون إزالة البيانات آليًا.",
        targetId: targetUid,
        route: "account_deletion_review",
        priority: "important",
        createdAt: now,
        meta: {
          userUid: targetUid,
          requestId,
          reviewHold: hold,
          eligibleAtMs: millis(current.eligibleAt),
        },
      }),
      db.writeCreate("admin_audit_logs/account_deletion_review_" + auditId, {
        action,
        actorUid,
        targetType: "user",
        targetId: targetUid,
        requestId,
        reason: hold ? reason : reason || null,
        createdAt: now,
      }),
    ]);
    return { ok: true, status: "review_ready", reviewHold: hold };
  } catch (error) {
    await db.rollback(tx).catch(() => {});
    throw error;
  }
}
