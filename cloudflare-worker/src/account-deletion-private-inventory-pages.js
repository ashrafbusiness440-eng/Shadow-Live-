// INTERNAL READ-ONLY discovery for an account's private conversations and
// authored messages. Neither stage is routed, scheduled or able to erase.
// Cursor exhaustion cannot certify legacy coverage, legal clearance, or Auth.
const clean = v => String(v ?? "").trim();
const uidOk = v => /^[A-Za-z0-9_-]{3,128}$/.test(clean(v));
const reqOk = v => /^[A-Za-z0-9_-]{12,180}$/.test(clean(v));
const idOk = v => /^[A-Za-z0-9_-]{12,180}$/.test(clean(v));
const held = d => [
  d?.reviewHold, d?.legalHold, d?.retentionHold, d?.deletionHold,
  d?.evidenceHold, d?.investigationHold, d?.reported,
].some(x => x === true);
const textKinds = new Set(["text", "animated_emoji"]);
const textSchemaKeys = new Set([
  "senderId", "receiverId", "createdAt", "type", "deletedForEveryone",
  "deletedAt", "erasureRequestId", "hiddenForUids", "text", "vipLevel",
  "animatedEmojiId", "animatedEmojiAssetKey",
  "animatedEmojiFallbackGlyph", "animatedEmojiMinVipLevel",
]);
export const MAX_ACCOUNT_PRIVATE_INVENTORY_PAGE = 5;

export class AccountPrivateInventoryError extends Error {
  constructor(code, status = 409) {
    super(code); this.code = code; this.status = status;
  }
}
const reject = (code, status) => {
  throw new AccountPrivateInventoryError(code, status);
};

/**
 * An externally authenticated Owner-only worker may inspect at most five
 * matching conversations OR authored messages at a time. A server caller
 * must authenticate session, current role and recent auth separately:
 * actor.owner here is NOT authentication and this module exposes NO route.
 */
export async function inspectAccountPrivateErasurePage(db, {
  uid, requestId, actor, kind = "conversations", conversationId = "",
  cursor = null, limit = MAX_ACCOUNT_PRIVATE_INVENTORY_PAGE,
} = {}) {
  uid = clean(uid); requestId = clean(requestId);
  conversationId = clean(conversationId);
  if (!actor?.owner || !uidOk(actor.uid)) reject("owner_required", 403);
  if (!uidOk(uid) || !reqOk(requestId) ||
      !["conversations", "authored_messages"].includes(kind) ||
      !Number.isSafeInteger(limit) || limit < 1 ||
      limit > MAX_ACCOUNT_PRIVATE_INVENTORY_PAGE ||
      (kind === "conversations" && conversationId !== "") ||
      (kind === "authored_messages" && !idOk(conversationId)) ||
      (cursor !== null && (typeof cursor !== "string" || !idOk(cursor)))) {
    reject("invalid_private_inventory_target", 400);
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
      user.data?.authDeleted === true ||
      held(request.data) || held(checkpoint.data) || held(user.data)) {
    reject("private_inventory_review_blocked");
  }
  let path;
  let counterpartyUid = "";
  if (kind === "conversations") {
    path = "conversations";
  } else {
    path = "conversations/" + conversationId + "/messages";
    const chat = await db.get("conversations/" + conversationId);
    if (!chat.exists || held(chat.data) ||
        !Array.isArray(chat.data?.participants) ||
        chat.data.participants.length !== 2 ||
        new Set(chat.data.participants).size !== 2 ||
        !chat.data.participants.includes(uid) ||
        !chat.data.participants.every(uidOk)) {
      reject("private_inventory_conversation_review_required");
    }
    counterpartyUid = chat.data.participants.find(p => p !== uid);
  }
  const rows = await db.runQuery(path, {
    filters: kind === "conversations"
      ? [{ field: "participants", op: "array-contains", value: uid }]
      : [{ field: "senderId", op: "==", value: uid }],
    orderBy: [{ field: "__name__", direction: "asc" }],
    limit: limit + 1,
    startAfter: cursor ? [{ referencePath: path + "/" + cursor }] : [],
  });
  if (!Array.isArray(rows) || rows.length > limit + 1 ||
      rows.some(row => !idOk(row?.id) || !row?.data)) {
    reject("private_inventory_invalid_page", 503);
  }
  const page = rows.slice(0, limit);
  if (new Set(page.map(x => x.id)).size !== page.length) {
    reject("private_inventory_duplicate_page", 503);
  }
  let items;
  if (kind === "conversations") {
    items = page.map(row => {
      const participants = row.data.participants;
      if (!Array.isArray(participants) ||
          !participants.includes(uid)) {
        reject("private_inventory_index_ownership_conflict");
      }
      const valid = participants.length === 2 &&
        new Set(participants).size === 2 && participants.every(uidOk);
      return { id: row.id, needsReview: !valid || held(row.data) };
    });
  } else {
    // Exact evidence-marker reads: max five and no report/evidence scan.
    const flags = await Promise.all(page.map(row =>
      db.get("content_filter_flags/" + row.id)));
    items = page.map((row, index) => {
      const message = row.data;
      if (clean(message.senderId) !== uid) {
        reject("private_inventory_message_owner_conflict");
      }
      const type = clean(message.type);
      // Media and gifts need independent legal/R2/financial handling.
      // A redaction tombstone is not evidence that all private content
      // or identifiers have been cleared elsewhere.
      const needsReview = !textKinds.has(type) ||
        clean(message.receiverId) !== counterpartyUid ||
        (textKinds.has(type) &&
          Object.keys(message).some(key => !textSchemaKeys.has(key))) ||
        held(message) || flags[index].exists;
      return {
        id: row.id,
        class: textKinds.has(type) ? "text_candidate" :
          type === "deleted" ? "tombstone_review" : "media_or_legacy_review",
        needsReview,
        evidenceFlagPresent: flags[index].exists,
      };
    });
  }
  return {
    ok: true, kind, items, hasMore: rows.length > limit,
    nextCursor: rows.length > limit && page.length
      ? page[page.length - 1].id : null,
    needsReview: items.some(item => item.needsReview),
    // Legacy/unindexed messages and external voice/R2 refs are unresolved.
    exhaustive: false, completionVerified: false, erasureAllowed: false,
  };
}
