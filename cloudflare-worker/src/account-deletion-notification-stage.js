// Account-owned notification cleanup, one pre-enumerated notification at a time.
// Never deletes another recipient's notices or report/financial source records.
// Internal only: no route, cron, or production executor currently invokes it.
const clean = value => String(value ?? "").trim();
const uidOk = value => /^[A-Za-z0-9_-]{3,128}$/.test(clean(value));
const requestOk = value => /^[A-Za-z0-9_-]{12,180}$/.test(clean(value));
const noticeOk = value => /^[A-Za-z0-9_-]{3,300}$/.test(clean(value));
const held = data => [data?.reviewHold, data?.legalHold,
  data?.retentionHold, data?.deletionHold, data?.evidenceHold]
  .some(value => value === true);

export class AccountNotificationErasureError extends Error {
  constructor(code, status = 409) {
    super(code);
    this.code = code;
    this.status = status;
  }
}

export async function eraseDeletedAccountNotification(db, {
  uid, requestId, notificationId,
} = {}) {
  uid = clean(uid);
  requestId = clean(requestId);
  notificationId = clean(notificationId);
  if (!uidOk(uid) || !requestOk(requestId) || !noticeOk(notificationId)) {
    throw new AccountNotificationErasureError("invalid_notification_erasure_target", 400);
  }
  const noticePath = "notifications/" + notificationId;
  const tx = await db.beginTransaction();
  try {
    const [request, checkpoint, user, notification] = await Promise.all([
      db.get("account_deletion_requests/" + uid, tx),
      db.get("account_deletion_erasure_checkpoints/" + uid, tx),
      db.get("users/" + uid, tx),
      db.get(noticePath, tx),
    ]);
    if (!request.exists || !checkpoint.exists || !user.exists ||
        clean(request.data?.uid) !== uid ||
        clean(request.data?.requestId) !== requestId ||
        clean(checkpoint.data?.requestId) !== requestId ||
        clean(request.data?.status) !== "processing" ||
        clean(checkpoint.data?.phase) !== "notifications" ||
        checkpoint.data?.destructiveAllowed !== true ||
        checkpoint.data?.notificationRetentionCleared !== true ||
        checkpoint.data?.legalEvidenceReviewComplete !== true ||
        checkpoint.data?.financialSettlementApproved !== true ||
        clean(user.data?.accountStatus) !== "deletion_processing" ||
        clean(user.data?.role) === "owner" ||
        held(request.data) || held(checkpoint.data) ||
        held(user.data) || held(notification.data)) {
      throw new AccountNotificationErasureError("notification_erasure_not_authorized");
    }
    if (!notification.exists) {
      await db.rollback(tx);
      return { ok: true, deleted: false, duplicate: true };
    }
    if (clean(notification.data?.userId) !== uid) {
      // All notifications share one top-level collection. A guessed ID must
      // NEVER delete a counterparty's notice, even during owner erasure.
      throw new AccountNotificationErasureError("notification_recipient_mismatch");
    }
    await db.commit(tx, [db.writeDelete(noticePath)]);
    return { ok: true, deleted: true, duplicate: false };
  } catch (error) {
    await db.rollback(tx).catch(() => {});
    throw error;
  }
}
