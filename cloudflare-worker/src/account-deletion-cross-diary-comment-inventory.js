import { accountDeletionHasActiveHold as held } from "./account-deletion-active-holds.js";
// INTERNAL ONLY: read-only discovery of comments authored by the account
// on OTHER people's diaries, based on indexed diary_operations.actorUid.
// The operation journal is not a complete legacy inventory or erasure proof.
const clean = value => String(value ?? "").trim();
const uidOk = value => /^[A-Za-z0-9_-]{3,128}$/.test(clean(value));
const requestOk = value => /^[A-Za-z0-9_-]{12,180}$/.test(clean(value));
const idOk = value => /^[A-Za-z0-9_-]{3,220}$/.test(clean(value));


export const MAX_CROSS_DIARY_OPERATION_PAGE = 5;
export class AccountCrossDiaryDiscoveryError extends Error {
  constructor(code, status = 409) {
    super(code); this.code = code; this.status = status;
  }
}
const fail = (code, status) => {
  throw new AccountCrossDiaryDiscoveryError(code, status);
};

/**
 * Each call reads one indexed page of at most five operations written by uid.
 * Only action=createComment produces comment references. For such operations,
 * reads the exact diary, comment and filter flag; NO content is returned.
 * Any legacy ambiguity is flagged, never treated as successful deletion.
 *
 * No route/cron/finalizer can call this in production today. The future
 * caller MUST authenticate the Owner independently before supplying actor.
 */
export async function inspectAccountCrossDiaryComments(db, {
  uid, requestId, actor, cursor = null,
  limit = MAX_CROSS_DIARY_OPERATION_PAGE,
} = {}) {
  uid = clean(uid);
  requestId = clean(requestId);
  if (!actor?.owner || !uidOk(actor.uid)) fail("owner_required", 403);
  if (!uidOk(uid) || !requestOk(requestId) ||
      !Number.isSafeInteger(limit) || limit < 1 ||
      limit > MAX_CROSS_DIARY_OPERATION_PAGE ||
      (cursor != null && !idOk(cursor))) {
    fail("invalid_cross_diary_inventory", 400);
  }
  const [request, checkpoint, user] = await Promise.all([
    db.get("account_deletion_requests/" + uid),
    db.get("account_deletion_erasure_checkpoints/" + uid),
    db.get("users/" + uid),
  ]);
  if (!request.exists || !checkpoint.exists || !user.exists ||
      clean(request.data?.uid) !== uid ||
      clean(request.data?.requestId) !== requestId ||
      clean(checkpoint.data?.uid) !== uid ||
      clean(checkpoint.data?.requestId) !== requestId ||
      !["review_ready", "processing"].includes(clean(request.data?.status)) ||
      clean(user.data?.role) === "owner" ||
      held(request.data) || held(checkpoint.data) || held(user.data)) {
    fail("cross_diary_inventory_review_blocked");
  }
  const rows = await db.runQuery("diary_operations", {
    filters: [{ field: "actorUid", op: "==", value: uid }],
    orderBy: [{ field: "__name__", direction: "asc" }],
    limit: limit + 1,
    startAfter: cursor
      ? [{ referencePath: "diary_operations/" + cursor }] : [],
  });
  if (!Array.isArray(rows) || rows.length > limit + 1 ||
      rows.some(row => !idOk(row?.id) ||
        !row.data || clean(row.data.actorUid) !== uid)) {
    fail("cross_diary_inventory_invalid_page", 503);
  }
  const page = rows.slice(0, limit);
  if (new Set(page.map(row => row.id)).size !== page.length) {
    fail("cross_diary_inventory_duplicate_page");
  }
  const comments = [];
  let needsReview = false;
  for (const row of page) {
    const data = row.data || {};
    if (data.action !== "createComment") continue;
    const diaryId = clean(data.diaryId);
    const commentId = clean(data.result?.commentId);
    if (!idOk(diaryId) || !idOk(commentId)) {
      // An older operation may lack a result/commentId. Do not silently
      // exclude it from the privacy review.
      needsReview = true;
      comments.push({ operationId: row.id, needsReview: true,
        onOtherDiary: null, commentPresent: null });
      continue;
    }
    const [diary, comment, filterFlag] = await Promise.all([
      db.get("diaries/" + diaryId),
      db.get("diaries/" + diaryId + "/comments/" + commentId),
      db.get("content_filter_flags/" + commentId),
    ]);
    if (comment.exists &&
        (clean(comment.data?.authorUid) !== uid ||
         (comment.data?.diaryId &&
          clean(comment.data.diaryId) !== diaryId))) {
      fail("cross_diary_comment_owner_conflict");
    }
    const owner = clean(diary.data?.ownerUid);
    const unresolved = !diary.exists || !uidOk(owner) ||
      !comment.exists || filterFlag.exists ||
      held(data) || held(diary.data) || held(comment.data) ||
      held(filterFlag.data);
    needsReview ||= unresolved;
    comments.push({
      operationId: row.id,
      diaryId, commentId,
      onOtherDiary: diary.exists && uidOk(owner) ? owner !== uid : null,
      commentPresent: comment.exists,
      needsReview: unresolved,
      // Neither text, pictures, financial values nor evidence returned.
    });
  }
  return {
    ok: true, scannedOperations: page.length,
    comments, hasMore: rows.length > limit,
    nextCursor: rows.length > limit ? page[page.length - 1]?.id : null,
    needsReview,
    // An operation journal can miss pre-journal/legacy comments. Never
    // advance erasure checkpoints or infer completeness from page exhaustion.
    exhaustive: false,
    completionVerified: false,
    erasureAllowed: false,
  };
}
