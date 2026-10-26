import { accountDeletionHasActiveHold as held } from "./account-deletion-active-holds.js";
// Internal only: bounded resumable drain of one user's exact diary like/view
// records using the independently guarded single-record erasure stage.
// No route, cron, polling, Firebase Auth/R2 deletion or completion receipt.
import { eraseDeletedDiaryInteraction }
  from "./account-deletion-diary-interaction-stage.js";

const clean = v => String(v ?? "").trim();
const uidOk = v => /^[A-Za-z0-9_-]{3,128}$/.test(clean(v));
const requestOk = v => /^[A-Za-z0-9_-]{12,180}$/.test(clean(v));
const diaryOk = v => /^[A-Za-z0-9_-]{3,220}$/.test(clean(v));

const collections = Object.freeze({ likes: "diary_likes", views: "diary_view_keys" });
const hex = uid => Array.from(new TextEncoder().encode(uid),
  byte => byte.toString(16).padStart(2, "0")).join("");
export const MAX_DIARY_ERASURE_BATCH_ITEMS = 5;

export class AccountDiaryErasureBatchError extends Error {
  constructor(code, status = 409) {
    super(code); this.code = code; this.status = status;
  }
}

/**
 * Drain at most five records of ONE interaction type per invocation.
 * Deletions remove indexed rows, so retry starts with remaining records.
 * The existing one-document transaction rechecks authZ and record holds.
 * No empty page or successful drain establishes exhaustive discovery.
 */
export async function drainAccountDiaryInteractions(db, {
  uid, requestId, kind, limit = MAX_DIARY_ERASURE_BATCH_ITEMS,
  nowMs = Date.now(),
} = {}) {
  uid = clean(uid);
  requestId = clean(requestId);
  if (!uidOk(uid) || !requestOk(requestId) ||
      !Object.hasOwn(collections, kind) ||
      !Number.isSafeInteger(limit) || limit < 1 ||
      limit > MAX_DIARY_ERASURE_BATCH_ITEMS) {
    throw new AccountDiaryErasureBatchError("invalid_diary_erasure_batch", 400);
  }
  const [request, checkpoint, user] = await Promise.all([
    db.get("account_deletion_requests/" + uid),
    db.get("account_deletion_erasure_checkpoints/" + uid),
    db.get("users/" + uid),
  ]);
  if (!request.exists || !checkpoint.exists || !user.exists ||
      clean(request.data?.uid) !== uid ||
      clean(request.data?.requestId) !== requestId ||
      clean(request.data?.status) !== "processing" ||
      clean(checkpoint.data?.uid) !== uid ||
      clean(checkpoint.data?.requestId) !== requestId ||
      clean(checkpoint.data?.phase) !== "diary_interactions" ||
      checkpoint.data?.destructiveAllowed !== true ||
      checkpoint.data?.diaryInteractionRetentionCleared !== true ||
      checkpoint.data?.legalEvidenceReviewComplete !== true ||
      checkpoint.data?.historicalDiaryCountersReviewed !== true ||
      clean(user.data?.accountStatus) !== "deletion_processing" ||
      clean(user.data?.role) === "owner" ||
      user.data?.authDeleted === true ||
      held(request.data) || held(checkpoint.data) || held(user.data)) {
    throw new AccountDiaryErasureBatchError(
      "diary_erasure_batch_not_authorized");
  }
  const rows = await db.runQuery(collections[kind], {
    filters: [{ field: "userUid", op: "==", value: uid }],
    limit: limit + 1,
  });
  if (!Array.isArray(rows) || rows.length > limit + 1) {
    throw new AccountDiaryErasureBatchError(
      "diary_erasure_batch_invalid_query", 503);
  }
  const selected = rows.slice(0, limit);
  const observed = new Set();
  for (const row of selected) {
    const diaryId = clean(row?.data?.diaryId);
    if (!diaryOk(diaryId) ||
        clean(row?.data?.userUid) !== uid ||
        clean(row?.id) !== diaryId + "__" + hex(uid) ||
        observed.has(row.id) || held(row.data)) {
      throw new AccountDiaryErasureBatchError(
        "diary_erasure_batch_legacy_or_protected_record");
    }
    observed.add(row.id);
  }
  let erased = 0, duplicate = 0;
  for (const row of selected) {
    // Rechecks current request, source diary, holds and record inside its
    // transaction; failures stop the batch. Already-deleted records are
    // missing from a retry query and won't be processed twice.
    const result = await eraseDeletedDiaryInteraction(db, {
      uid, requestId, kind, diaryId: clean(row.data.diaryId), nowMs,
    });
    if (result.erased === true) erased++;
    else if (result.duplicate === true) duplicate++;
    else throw new AccountDiaryErasureBatchError(
      "diary_erasure_batch_unverified_result");
  }
  return {
    ok: true, kind, checked: selected.length, erased, duplicate,
    moreInPage: rows.length > limit,
    // Covers only indexed userUid records in this one kind; legacy data and
    // pending protected evidence cannot be certified from this response.
    completionVerified: false,
  };
}
