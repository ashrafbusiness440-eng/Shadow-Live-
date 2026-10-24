// Internal read-only, bounded account-erasure diary inventory pages.
// No HTTP route, cron, mutation, authorization to erase or completion proof.
// A full legacy/mirror/comment-on-others inventory remains an independent gate.
const clean = value => String(value ?? "").trim();
const uidOk = value => /^[A-Za-z0-9_-]{3,128}$/.test(clean(value));
const requestOk = value => /^[A-Za-z0-9_-]{12,180}$/.test(clean(value));
const diaryOk = value => /^[A-Za-z0-9_-]{3,220}$/.test(clean(value));
const held = d => [
  d?.reviewHold, d?.legalHold, d?.retentionHold, d?.deletionHold,
  d?.evidenceHold, d?.reported, d?.investigationHold,
].some(flag => flag === true);
export const MAX_DIARY_ERASURE_PAGE = 5;

export class DiaryErasureInventoryError extends Error {
  constructor(code, status = 409) {
    super(code);
    this.code = code;
    this.status = status;
  }
}
const fail = (code, status) => {
  throw new DiaryErasureInventoryError(code, status);
};
function validatedCursor(cursor, collectionPath) {
  if (cursor == null) return [];
  if (typeof cursor !== "object" || Array.isArray(cursor) ||
      !Number.isSafeInteger(cursor.createdAtMs) ||
      cursor.createdAtMs <= 0 || !diaryOk(cursor.id)) {
    fail("invalid_diary_inventory_cursor", 400);
  }
  return [
    { value: cursor.createdAtMs },
    { referencePath: collectionPath + "/" + cursor.id },
  ];
}
function itemCursor(row) {
  const n = row?.data?.createdAtMs;
  if (!Number.isSafeInteger(n) || n <= 0 || !diaryOk(row.id)) {
    fail("diary_inventory_legacy_schema_review");
  }
  return { createdAtMs: n, id: row.id };
}
function checkPage(rows, limit) {
  if (!Array.isArray(rows) || rows.length > limit + 1) {
    fail("diary_inventory_invalid_query", 503);
  }
  const seen = new Set();
  for (const row of rows) {
    itemCursor(row);
    if (seen.has(row.id)) fail("diary_inventory_duplicate_row");
    seen.add(row.id);
  }
  return rows.slice(0, limit);
}

/**
 * One page of the deleted user's own mirrored diaries OR one page of
 * comments on one already identified owned diary. No global scans.
 * The actor must be independently authenticated as Owner by a future caller.
 * The result contains IDs and authorship flags only, never private content.
 */
export async function inspectAccountDiaryErasurePage(db, {
  uid, requestId, actor, kind = "diaries", diaryId,
  cursor = null, limit = MAX_DIARY_ERASURE_PAGE,
} = {}) {
  uid = clean(uid);
  requestId = clean(requestId);
  diaryId = clean(diaryId);
  if (!actor?.owner || !uidOk(actor.uid)) fail("owner_required", 403);
  if (!uidOk(uid) || !requestOk(requestId) ||
      !Number.isSafeInteger(limit) || limit < 1 ||
      limit > MAX_DIARY_ERASURE_PAGE ||
      !["diaries", "comments"].includes(kind) ||
      (kind === "comments" && !diaryOk(diaryId)) ||
      (kind === "diaries" && diaryId)) {
    fail("invalid_diary_inventory_target", 400);
  }
  const collection = kind === "diaries"
    ? "users/" + uid + "/diaries" : "diaries/" + diaryId + "/comments";
  const startAfter = validatedCursor(cursor, collection);
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
    fail("diary_inventory_review_blocked");
  }
  if (kind === "comments") {
    const [original, mirror] = await Promise.all([
      db.get("diaries/" + diaryId),
      db.get("users/" + uid + "/diaries/" + diaryId),
    ]);
    if (!original.exists || !mirror.exists ||
        clean(original.data?.ownerUid) !== uid ||
        clean(mirror.data?.ownerUid) !== uid ||
        held(original.data) || held(mirror.data)) {
      fail("diary_inventory_owner_or_evidence_conflict");
    }
  }
  const rows = await db.runQuery(collection, {
    orderBy: [
      { field: "createdAtMs", direction: "desc" },
      { field: "__name__", direction: "desc" },
    ],
    limit: limit + 1,
    startAfter,
  });
  const page = checkPage(rows, limit);
  const items = [];
  let flaggedForReview = false;
  if (kind === "diaries") {
    // At most five exact-path lookups, not a top-level collection scan.
    const originals = await Promise.all(page.map(row =>
      db.get("diaries/" + row.id)));
    for (let i = 0; i < page.length; i++) {
      const row = page[i], original = originals[i];
      if (clean(row.data?.ownerUid) !== uid ||
          (row.data?.diaryId && clean(row.data.diaryId) !== row.id) ||
          (original.exists && clean(original.data?.ownerUid) !== uid)) {
        fail("diary_inventory_owner_or_evidence_conflict");
      }
      const needsReview = !original.exists ||
        held(row.data) || held(original.data) ||
        (original.exists && original.data?.diaryId &&
          clean(original.data.diaryId) !== row.id);
      flaggedForReview ||= Boolean(needsReview);
      items.push({ id: row.id, mirrorPresent: original.exists,
        needsReview: Boolean(needsReview) });
    }
  } else {
    for (const row of page) {
      const author = clean(row.data?.authorUid);
      if (!uidOk(author) ||
          (row.data?.diaryId && clean(row.data.diaryId) !== diaryId) ||
          (row.data?.commentId && clean(row.data.commentId) !== row.id)) {
        fail("diary_inventory_legacy_schema_review");
      }
      const needsReview = held(row.data);
      flaggedForReview ||= needsReview;
      items.push({ id: row.id, authoredByDeleted: author === uid,
        needsReview });
    }
  }
  return {
    ok: true, kind, items, hasMore: rows.length > limit,
    nextCursor: rows.length > limit && page.length
      ? itemCursor(page[page.length - 1]) : null,
    flaggedForReview,
    // Cursor exhaustion is not a signoff: comments authored on OTHER users'
    // diaries, older legacy mirrors, gifts, notifications and reports remain.
    exhaustive: false,
    completionVerified: false,
    erasureAllowed: false,
  };
}
