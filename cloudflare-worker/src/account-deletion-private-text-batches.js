// INTERNAL ONLY: bounded, manually driven private-text redaction batches.
// No API route, cron, polling, stage advancement or production executor.
// Checkpoints created by the live account-delete lifecycle have
// destructiveAllowed=false, so no real-account deletion is enabled.
import { redactDeletedPrivateTextMessage }
  from "./account-deletion-private-text-stage.js";

const clean = v => String(v ?? "").trim();
const uidOk = v => /^[A-Za-z0-9_-]{3,128}$/.test(clean(v));
const requestOk = v => /^[A-Za-z0-9_-]{12,180}$/.test(clean(v));
const idOk = v => /^[A-Za-z0-9_-]{12,180}$/.test(clean(v));
const held = d => [
  d?.legalHold, d?.retentionHold, d?.deletionHold,
  d?.reviewHold, d?.evidenceHold, d?.investigationHold,
  d?.reported,
].some(x => x === true);
const allowedText = new Set(["text", "animated_emoji"]);
const safeFields = new Set([
  "senderId", "receiverId", "createdAt", "type", "deletedForEveryone",
  "deletedAt", "erasureRequestId", "hiddenForUids", "text", "vipLevel",
  "animatedEmojiId", "animatedEmojiAssetKey",
  "animatedEmojiFallbackGlyph", "animatedEmojiMinVipLevel",
]);
const tombstoneFields = new Set([
  "senderId", "receiverId", "createdAt", "type", "deletedForEveryone",
  "deletedAt", "erasureRequestId", "hiddenForUids",
]);
export const MAX_PRIVATE_TEXT_ERASURE_BATCH_ITEMS = 5;

export class PrivateTextErasureBatchError extends Error {
  constructor(code, status = 409) {
    super(code); this.code = code; this.status = status;
  }
}
const reject = (code, status) => {
  throw new PrivateTextErasureBatchError(code, status);
};

/**
 * Explicit per-conversation indexed page, not an unbounded sweep.
 * The caller must retain the returned nextCursor and retry the SAME
 * cursor after a thrown error. Tombstones remain indexed, so retries
 * classify them as duplicates instead of accidentally skipping data.
 * No cursor exhaustion can authorize finalization.
 */
export async function drainAccountPrivateTextPage(db, {
  uid, requestId, conversationId, cursor = null,
  limit = MAX_PRIVATE_TEXT_ERASURE_BATCH_ITEMS, now = new Date(),
} = {}) {
  uid = clean(uid); requestId = clean(requestId);
  conversationId = clean(conversationId);
  if (!uidOk(uid) || !requestOk(requestId) || !idOk(conversationId) ||
      (cursor !== null && (typeof cursor !== "string" || !idOk(cursor))) ||
      !Number.isSafeInteger(limit) || limit < 1 ||
      limit > MAX_PRIVATE_TEXT_ERASURE_BATCH_ITEMS ||
      !(now instanceof Date) || !Number.isFinite(now.getTime())) {
    reject("invalid_private_text_batch", 400);
  }
  const [request, checkpoint, user, conversation] = await Promise.all([
    db.get("account_deletion_requests/" + uid),
    db.get("account_deletion_erasure_checkpoints/" + uid),
    db.get("users/" + uid),
    db.get("conversations/" + conversationId),
  ]);
  if (!request.exists || !checkpoint.exists || !user.exists ||
      clean(request.data?.uid) !== uid ||
      clean(request.data?.requestId) !== requestId ||
      clean(request.data?.status) !== "processing" ||
      clean(checkpoint.data?.requestId) !== requestId ||
      clean(checkpoint.data?.phase) !== "private_text" ||
      checkpoint.data?.destructiveAllowed !== true ||
      checkpoint.data?.privateMessageRetentionCleared !== true ||
      checkpoint.data?.legalEvidenceReviewComplete !== true ||
      clean(user.data?.accountStatus) !== "deletion_processing" ||
      clean(user.data?.role) === "owner" ||
      user.data?.authDeleted === true ||
      held(request.data) || held(checkpoint.data) || held(user.data)) {
    reject("private_text_batch_not_authorized");
  }
  const participants = conversation.data?.participants;
  if (!conversation.exists || held(conversation.data) ||
      !Array.isArray(participants) || participants.length !== 2 ||
      new Set(participants).size !== 2 ||
      !participants.includes(uid) ||
      !participants.every(uidOk)) {
    reject("private_text_batch_conversation_review");
  }
  const recipient = participants.find(v => v !== uid);
  const path = "conversations/" + conversationId + "/messages";
  const rows = await db.runQuery(path, {
    filters: [{ field: "senderId", op: "==", value: uid }],
    orderBy: [{ field: "__name__", direction: "asc" }],
    limit: limit + 1,
    startAfter: cursor
      ? [{ referencePath: path + "/" + cursor }] : [],
  });
  if (!Array.isArray(rows) || rows.length > limit + 1 ||
      rows.some(row => !idOk(row?.id) || !row?.data)) {
    reject("private_text_batch_invalid_page", 503);
  }
  const selected = rows.slice(0, limit);
  if (new Set(selected.map(row => row.id)).size !== selected.length) {
    reject("private_text_batch_duplicate_page", 503);
  }
  // This page is preflighted in full. Block protected media, evidence,
  // incorrect recipients, old schemas and foreign tombstones BEFORE
  // touching the first message. Exact-record transactions recheck.
  const evidenceFlags = await Promise.all(selected.map(row =>
    db.get("content_filter_flags/" + row.id)));
  let alreadyRedacted = 0;
  for (const [i, row] of selected.entries()) {
    const msg = row.data;
    if (clean(msg.senderId) !== uid ||
        clean(msg.receiverId) !== recipient) {
      reject("private_text_batch_recipient_conflict");
    }
    if (held(msg) || evidenceFlags[i].exists) {
      reject("private_text_batch_protected_evidence");
    }
    const isTombstone = clean(msg.type) === "deleted" &&
      msg.deletedForEveryone === true &&
      clean(msg.erasureRequestId) === requestId &&
      Object.keys(msg).every(key => tombstoneFields.has(key));
    if (isTombstone) { alreadyRedacted++; continue; }
    if (!allowedText.has(clean(msg.type))) {
      // Includes old tombstones and voice, video, gifts, photos, etc.
      reject("private_text_batch_media_or_legacy_review");
    }
    if (Object.keys(msg).some(key => !safeFields.has(key))) {
      reject("private_text_batch_unknown_fields");
    }
  }
  let redacted = 0, duplicate = 0;
  for (const row of selected) {
    const result = await redactDeletedPrivateTextMessage(db, {
      uid, requestId, conversationId, messageId: row.id, now,
    });
    if (result.redacted === true) redacted++;
    else if (result.duplicate === true) duplicate++;
    else reject("private_text_batch_unverified_result", 503);
  }
  return {
    ok: true, checked: selected.length, redacted, duplicate,
    // The cursor advances across retained tombstones, unlike a
    // delete-and-requery page; callers must provide it next time.
    hasMore: rows.length > limit,
    nextCursor: rows.length > limit && selected.length > 0
      ? selected[selected.length - 1].id : null,
    // Even zero rows means nothing about legacy records, R2 or holds.
    completionVerified: false, erasureComplete: false,
  };
}
