import { accountDeletionHasActiveHold as held } from "./account-deletion-active-holds.js";
// Internal small-batch drainers for two previously gated one-document stages.
// No route, cron, polling, completion receipt or production executor.
import { eraseDeletedAccountNotification }
  from "./account-deletion-notification-stage.js";
import { eraseDeletedPrivateCallPushToken }
  from "./account-deletion-private-call-push-stage.js";

const clean = value => String(value ?? "").trim();
const uidOk = value => /^[A-Za-z0-9_-]{3,128}$/.test(clean(value));
const requestOk = value => /^[A-Za-z0-9_-]{12,180}$/.test(clean(value));

export const MAX_ACCOUNT_ERASURE_BATCH_ITEMS = 5;

export class AccountErasureBatchError extends Error {
  constructor(code, status = 409) {
    super(code);
    this.code = code;
    this.status = status;
  }
}

async function drainBatch(db, {
  uid, requestId, phase, limit, collection, filters, idPattern, erase,
  nowMs = Date.now(),
}) {
  uid = clean(uid);
  requestId = clean(requestId);
  if (!uidOk(uid) || !requestOk(requestId) ||
      !Number.isSafeInteger(limit) || limit < 1 ||
      limit > MAX_ACCOUNT_ERASURE_BATCH_ITEMS) {
    throw new AccountErasureBatchError("invalid_erasure_batch", 400);
  }
  // Guard BEFORE performing any query. Each underlying single-document
  // erasure independently rechecks these and the exact target in a transaction.
  const [request, checkpoint, user] = await Promise.all([
    db.get("account_deletion_requests/" + uid),
    db.get("account_deletion_erasure_checkpoints/" + uid),
    db.get("users/" + uid),
  ]);
  if (!request.exists || !checkpoint.exists || !user.exists ||
      clean(request.data?.uid) !== uid ||
      clean(request.data?.requestId) !== requestId ||
      clean(checkpoint.data?.requestId) !== requestId ||
      clean(request.data?.status) !== "processing" ||
      clean(checkpoint.data?.phase) !== phase ||
      checkpoint.data?.destructiveAllowed !== true ||
      checkpoint.data?.notificationRetentionCleared !== true ||
      checkpoint.data?.legalEvidenceReviewComplete !== true ||
      clean(user.data?.accountStatus) !== "deletion_processing" ||
      clean(user.data?.role) === "owner" ||
      held(request.data) || held(checkpoint.data) || held(user.data) ||
      (phase === "notifications" &&
        checkpoint.data?.financialSettlementApproved !== true)) {
    throw new AccountErasureBatchError("erasure_batch_not_authorized");
  }
  const rows = await db.runQuery(collection(uid), {
    filters: filters(uid),
    limit: limit + 1,
  });
  if (!Array.isArray(rows) || rows.length > limit + 1) {
    throw new AccountErasureBatchError("invalid_erasure_batch_query", 503);
  }
  const selected = rows.slice(0, limit);
  // Validate the entire selected page before issuing the first delete.
  if (selected.some(row => !idPattern.test(clean(row?.id)) ||
      !row?.data || (phase === "notifications" &&
        clean(row.data.userId) !== uid))) {
    throw new AccountErasureBatchError("erasure_batch_legacy_schema_review");
  }
  let erased = 0;
  let duplicate = 0;
  for (const row of selected) {
    // Network failures abort; previously committed items are safely drained
    // on retry (the next indexed query will omit their removed documents).
    const result = await erase(db, uid, requestId, row.id, nowMs);
    if (result.deleted === true || result.removed > 0) erased++;
    else if (result.duplicate === true) duplicate++;
    else throw new AccountErasureBatchError("erasure_batch_unverified_result");
  }
  return {
    ok: true, phase, checked: selected.length, erased, duplicate,
    moreInPage: rows.length > limit,
    // False even for an empty page: unindexed legacy fields, concurrent
    // writes and retention evidence require SEPARATE final proof.
    completionVerified: false,
  };
}

export async function drainAccountOwnedNotifications(db, {
  uid, requestId, limit = MAX_ACCOUNT_ERASURE_BATCH_ITEMS,
  nowMs = Date.now(),
} = {}) {
  return drainBatch(db, {
    uid, requestId, phase: "notifications", limit, nowMs,
    collection: () => "notifications",
    filters: targetUid => [
      { field: "userId", op: "==", value: targetUid },
    ],
    idPattern: /^[A-Za-z0-9_-]{3,300}$/,
    erase: (store, userId, operationId, id, atMs) =>
      eraseDeletedAccountNotification(store, {
        uid: userId, requestId: operationId, notificationId: id, nowMs: atMs,
      }),
  });
}

export async function drainAccountPrivateCallPushDevices(db, {
  uid, requestId, limit = MAX_ACCOUNT_ERASURE_BATCH_ITEMS,
} = {}) {
  return drainBatch(db, {
    uid, requestId, phase: "push_devices", limit,
    collection: targetUid => `private_call_push_devices/${targetUid}/tokens`,
    filters: () => [],
    idPattern: /^[a-f0-9]{64}$/,
    erase: (store, userId, operationId, id) =>
      eraseDeletedPrivateCallPushToken(store, {
        uid: userId, requestId: operationId, tokenHash: id,
      }),
  });
}
