import { adminInboxUpsertWrite } from "./admin-inbox-index.js";

// Human-reviewed eligibility stage, not an erasure processor. In particular,
// this module MUST NOT delete Firebase Auth, profiles, wallets or R2 objects.
export const ACCOUNT_DELETION_REVIEW_LIMIT = 6;
const UID_PATTERN = /^[A-Za-z0-9_-]{3,128}$/;
const REQUEST_ID_PATTERN = /^[A-Za-z0-9_-]{12,180}$/;
const REVIEW_TYPE = "account_deletion_review";

function clean(value) {
  return String(value ?? "").trim();
}

function timestampMs(value) {
  if (value instanceof Date) return value.getTime();
  if (typeof value?.toDate === "function") return value.toDate().getTime();
  if (typeof value === "string") {
    const date = Date.parse(value);
    return Number.isFinite(date) ? date : 0;
  }
  const seconds = Number(value?.seconds ?? value?._seconds);
  return Number.isFinite(seconds) ? seconds * 1000 : 0;
}

function roleHint(data = {}) {
  if (clean(data.role) === "owner") return "owner_review_required";
  if (data.adminEnabled === true) return "admin_review_required";
  if (data.legalHold === true || data.retentionHold === true ||
      data.deletionHold === true) return "hold_review_required";
  return "retention_review_required";
}

export async function queueEligibleAccountDeletionReview(db, uid, {
  nowMs = Date.now(),
} = {}) {
  if (!UID_PATTERN.test(clean(uid))) {
    return { queued: false, reason: "invalid_uid" };
  }
  const path = "account_deletion_requests/" + uid;
  let tx = null;
  try {
    tx = await db.beginTransaction();
    const [req, user] = await Promise.all([
      db.get(path, tx),
      db.get("users/" + uid, tx),
    ]);
    if (!req.exists || !user.exists ||
        clean(req.data?.uid) !== uid ||
        clean(req.data?.status) !== "pending" ||
        !REQUEST_ID_PATTERN.test(clean(req.data?.requestId)) ||
        !Number.isFinite(nowMs) ||
        timestampMs(req.data.eligibleAt) > nowMs ||
        timestampMs(req.data.eligibleAt) <= 0 ||
        user.data?.authDeleted === true ||
        clean(user.data?.accountStatus) === "deleted") {
      await db.rollback(tx);
      return { queued: false, reason: "not_eligible" };
    }
    const requestId = clean(req.data.requestId);
    const now = new Date(nowMs);
    const reviewReason = roleHint(user.data || {});
    // "review_ready" still permits self-cancellation; no account lock,
    // Firebase Auth deletion or R2 clean-up job is created.
    await db.commit(tx, [
      db.writeUpdate(path, {
        status: "review_ready",
        reviewQueuedAt: now,
        reviewReason,
        updatedAt: now,
      }, ["status", "reviewQueuedAt", "reviewReason", "updatedAt"]),
      adminInboxUpsertWrite(db, {
        type: REVIEW_TYPE,
        title: "طلب حذف حساب — استكمل مراجعة البيانات",
        body: "انتهت مهلة 30 يومًا؛ يلزم التأكد من البيانات المالية والبلاغات والاحتفاظ قبل إزالة الحساب.",
        targetId: uid,
        route: "account_deletion_review",
        priority: "important",
        createdAt: now,
        meta: {
          userUid: uid,
          requestId,
          eligibleAtMs: timestampMs(req.data.eligibleAt),
          reviewReason,
        },
      }),
      db.writeCreate(
        "admin_audit_logs/account_deletion_review_due_" + requestId,
        {
          action: "accountDeletionDueForReview",
          actorUid: "system",
          targetType: "user",
          targetId: uid,
          requestId,
          reviewReason,
          createdAt: now,
        },
      ),
    ]);
    return { queued: true, reason: reviewReason };
  } catch (error) {
    if (tx) await db.rollback(tx).catch(() => {});
    throw error;
  }
}

export async function runDueAccountDeletionReviews(db, {
  nowMs = Date.now(),
  limit = ACCOUNT_DELETION_REVIEW_LIMIT,
} = {}) {
  const budget = Math.max(1,
    Math.min(ACCOUNT_DELETION_REVIEW_LIMIT, Math.floor(Number(limit) || 0)));
  if (!Number.isFinite(nowMs)) throw Error("invalid_now");
  // One indexed, bounded Firestore query per hourly sweep. Cancelled requests
  // do not consume the scan window and cannot indefinitely starve newer ones.
  const rows = await db.runQuery("account_deletion_requests", {
    filters: [
      { field: "status", op: "==", value: "pending" },
      { field: "eligibleAt", op: "<=", value: new Date(nowMs) },
    ],
    orderBy: [{ field: "eligibleAt", direction: "asc" }],
    limit: budget,
  });
  let queued = 0;
  let skipped = 0;
  let failed = 0;
  for (const row of rows) {
    try {
      const outcome = await queueEligibleAccountDeletionReview(db, row.id,
        { nowMs });
      if (outcome.queued) queued += 1;
      else skipped += 1;
    } catch (error) {
      failed += 1;
      console.error("Deletion eligibility review failed",
        String(error?.code || error?.message || "failed").slice(0,110));
    }
  }
  return {
    checked: rows.length,
    queued, skipped, failed,
  };
}
