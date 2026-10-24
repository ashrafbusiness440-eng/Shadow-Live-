// Account erasure: internal, READ-ONLY indexed discovery of diary like/view
// records by userUid. No endpoint, cron, erasure authorization or mutation.
const clean = value => String(value ?? "").trim();
const uidOk = value => /^[A-Za-z0-9_-]{3,128}$/.test(clean(value));
const requestOk = value => /^[A-Za-z0-9_-]{12,180}$/.test(clean(value));
const docIdOk = value => /^[A-Za-z0-9_-]{3,512}$/.test(clean(value));
const diaryIdOk = value => /^[A-Za-z0-9_-]{3,220}$/.test(clean(value));
const held = data => [
  data?.reviewHold, data?.legalHold, data?.retentionHold,
  data?.deletionHold, data?.evidenceHold, data?.investigationHold,
  data?.reported,
].some(value => value === true);

export const MAX_DIARY_INTERACTION_INVENTORY_PAGE = 5;

export class DiaryInteractionInventoryError extends Error {
  constructor(code, status = 409) {
    super(code);
    this.code = code;
    this.status = status;
  }
}
const reject = (code, status) => {
  throw new DiaryInteractionInventoryError(code, status);
};
const hashUid = uid =>
  Array.from(new TextEncoder().encode(uid),
    byte => byte.toString(16).padStart(2, "0")).join("");

/**
 * Reads a single indexed page of the user's own like/view key records,
 * including those referencing somebody else's diary. The daily view
 * dedupe key has NO diary_operations entry, so journal-only discovery is
 * insufficient.
 *
 * A separately authenticated Owner caller must supply actor; there is
 * currently NO route/cron for this method. No finalization is possible.
 */
export async function inspectAccountDiaryInteractions(db, {
  uid, requestId, actor, kind = "likes",
  cursor = null, limit = MAX_DIARY_INTERACTION_INVENTORY_PAGE,
} = {}) {
  uid = clean(uid);
  requestId = clean(requestId);
  if (!actor?.owner || !uidOk(actor.uid)) reject("owner_required", 403);
  if (!uidOk(uid) || !requestOk(requestId) ||
      !["likes", "views"].includes(kind) ||
      !Number.isSafeInteger(limit) || limit < 1 ||
      limit > MAX_DIARY_INTERACTION_INVENTORY_PAGE ||
      (cursor !== null && (typeof cursor !== "string" ||
        !docIdOk(cursor)))) {
    reject("invalid_diary_interaction_inventory", 400);
  }
  const collection = kind === "likes" ? "diary_likes" : "diary_view_keys";
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
    reject("diary_interaction_inventory_blocked");
  }
  const rows = await db.runQuery(collection, {
    filters: [{ field: "userUid", op: "==", value: uid }],
    orderBy: [{ field: "__name__", direction: "asc" }],
    limit: limit + 1,
    startAfter: cursor
      ? [{ referencePath: collection + "/" + cursor }] : [],
  });
  if (!Array.isArray(rows) || rows.length > limit + 1 ||
      rows.some(row => !docIdOk(row?.id) || !row?.data ||
        clean(row.data.userUid) !== uid)) {
    reject("invalid_diary_interaction_page", 503);
  }
  const selected = rows.slice(0, limit);
  if (new Set(selected.map(row => row.id)).size !== selected.length) {
    reject("duplicate_diary_interaction_page");
  }
  // Exact path lookups only. Never scan other users' posts or expose content.
  const ids = selected.map(row => clean(row.data.diaryId));
  if (ids.some(id => !diaryIdOk(id))) {
    reject("diary_interaction_legacy_schema_review");
  }
  const originals = await Promise.all(ids.map(id => db.get("diaries/" + id)));
  const items = selected.map((row, i) => {
    const diary = originals[i];
    const owner = clean(diary.data?.ownerUid);
    const idFormatMatches = row.id === ids[i] + "__" + hashUid(uid);
    const needsReview = !diary.exists || !uidOk(owner) ||
      !idFormatMatches || held(row.data) || held(diary.data);
    return {
      id: row.id,
      diaryId: ids[i],
      sourceDiaryPresent: diary.exists,
      onOtherUserDiary: diary.exists && uidOk(owner) ? owner !== uid : null,
      needsReview,
    };
  });
  return {
    ok: true, kind, items,
    hasMore: rows.length > limit,
    nextCursor: rows.length > limit && selected.length
      ? selected[selected.length - 1].id : null,
    needsReview: items.some(item => item.needsReview),
    // Indexed coverage still does not discover records whose old writers
    // omitted userUid, nor account-linked notifications/mirror snapshots.
    exhaustive: false,
    completionVerified: false,
    erasureAllowed: false,
  };
}
