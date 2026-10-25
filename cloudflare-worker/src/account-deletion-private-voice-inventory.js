import { accountDeletionHasActiveHold as held } from "./account-deletion-active-holds.js";
// INTERNAL read-only inventory of private voice metadata and linked records.
// Never lists or deletes R2 keys. No HTTP route, cron, cleanup authority or
// account-deletion completion certificate is exposed by this module.
const clean = v => String(v ?? "").trim();
const uidOk = v => /^[A-Za-z0-9_-]{3,128}$/.test(clean(v));
const reqOk = v => /^[A-Za-z0-9_-]{12,180}$/.test(clean(v));
const conversationOk = v => /^[A-Za-z0-9_-]{1,180}$/.test(clean(v));
const objectOk = v => /^[a-f0-9]{32}$/.test(clean(v));
const messageOk = v => /^voice_[a-f0-9]{32}$/.test(clean(v));

const knownObjectKeys = new Set([
  "objectId", "ownerUid", "otherUid", "conversationId", "storageKey",
  "mimeType", "expectedSizeBytes", "durationSeconds", "state",
  "createdAt", "uploadExpiresAt", "confirmedAt", "messageId", "sentAt",
  "deletingAt",
]);
const knownDraftKeys = new Set([
  "objectId", "ownerUid", "storageKey", "expiresAt", "createdAt",
]);
const knownVoiceMessageKeys = new Set([
  "type", "senderId", "receiverId", "storageObjectId", "mimeType",
  "sizeBytes", "durationSeconds", "createdAt", "deletedForEveryone",
  "deletedAt", "erasureRequestId",
]);
const unknown = (data, allowed) =>
  Object.keys(data || {}).some(key => !allowed.has(key));
export const MAX_PRIVATE_VOICE_INVENTORY_PAGE = 5;

export class AccountPrivateVoiceInventoryError extends Error {
  constructor(code, status = 409) {
    super(code); this.code = code; this.status = status;
  }
}
const reject = (code, status) => {
  throw new AccountPrivateVoiceInventoryError(code, status);
};

/**
 * At most five indexed private_voice_objects/{hex32} records owned by uid.
 * Cross-checks exact draft, two-party chat, sent message and evidence marker;
 * returns NO R2 object path, audio bytes, text, other UID or download URL.
 * The actor must first be independently authenticated Owner; no route exists.
 */
export async function inspectAccountPrivateVoicePage(db, {
  uid, requestId, actor, cursor = null,
  limit = MAX_PRIVATE_VOICE_INVENTORY_PAGE,
} = {}) {
  uid = clean(uid); requestId = clean(requestId);
  if (!actor?.owner || !uidOk(actor?.uid)) reject("owner_required", 403);
  if (!uidOk(uid) || !reqOk(requestId) ||
      !Number.isSafeInteger(limit) || limit < 1 ||
      limit > MAX_PRIVATE_VOICE_INVENTORY_PAGE ||
      (cursor !== null && (typeof cursor !== "string" ||
        !objectOk(cursor)))) {
    reject("invalid_private_voice_inventory_target", 400);
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
    reject("private_voice_inventory_review_blocked");
  }
  const collection = "private_voice_objects";
  const rows = await db.runQuery(collection, {
    filters: [{ field: "ownerUid", op: "==", value: uid }],
    orderBy: [{ field: "__name__", direction: "asc" }],
    limit: limit + 1,
    startAfter: cursor
      ? [{ referencePath: collection + "/" + cursor }] : [],
  });
  if (!Array.isArray(rows) || rows.length > limit + 1 ||
      rows.some(row => !objectOk(row?.id) || !row?.data) ||
      new Set(rows.map(row => row.id)).size !== rows.length) {
    reject("private_voice_inventory_invalid_page", 503);
  }
  const selected = rows.slice(0, limit);
  const items = await Promise.all(selected.map(async row => {
    const object = row.data;
    if (clean(object.ownerUid) !== uid ||
        clean(object.objectId) !== row.id) {
      reject("private_voice_inventory_owner_conflict");
    }
    const conversationId = clean(object.conversationId);
    const otherUid = clean(object.otherUid);
    const state = clean(object.state);
    const storageKey = clean(object.storageKey);
    const plausible = uidOk(otherUid) && otherUid !== uid &&
      conversationOk(conversationId) &&
      storageKey ===
        `private-voice/${conversationId}/${uid}/${row.id}.wav` &&
      object.mimeType === "audio/wav" &&
      Number.isSafeInteger(object.expectedSizeBytes) &&
      object.expectedSizeBytes >= 46 &&
      object.expectedSizeBytes <= 3 * 1024 * 1024 &&
      Number.isSafeInteger(object.durationSeconds) &&
      object.durationSeconds >= 1 && object.durationSeconds <= 60 &&
      ["pending_upload", "uploaded", "sent", "deleting"].includes(state);
    // Even a malformed row is only inspected through exact safe paths.
    // No storage key, counterpart identity or malformed conversation ID
    // is returned or used to construct an unsafe Firestore reference.
    if (!plausible) {
      return { id: row.id, state: "schema_review", linkedMessagePresent: false,
        draftPresent: false, evidenceMarkerPresent: false, needsReview: true };
    }
    const messageId = clean(object.messageId);
    const sent = state === "sent";
    const [draft, conversation, message, flag] = await Promise.all([
      db.get("private_voice_drafts/" + row.id),
      db.get("conversations/" + conversationId),
      sent && messageOk(messageId)
        ? db.get("conversations/" + conversationId + "/messages/" + messageId)
        : Promise.resolve({exists:false,data:null}),
      sent && messageOk(messageId)
        ? db.get("content_filter_flags/" + messageId)
        : Promise.resolve({exists:false,data:null}),
    ]);
    const participants = conversation.data?.participants;
    const conversationValid = conversation.exists &&
      Array.isArray(participants) && participants.length === 2 &&
      new Set(participants).size === 2 &&
      participants.includes(uid) && participants.includes(otherUid) &&
      participants.every(uidOk);
    const draftValid = draft.exists &&
      clean(draft.data?.ownerUid) === uid &&
      clean(draft.data?.objectId) === row.id &&
      clean(draft.data?.storageKey) === storageKey &&
      !held(draft.data) && !unknown(draft.data, knownDraftKeys);
    const messageValid = message.exists &&
      clean(message.data?.senderId) === uid &&
      clean(message.data?.receiverId) === otherUid &&
      clean(message.data?.storageObjectId) === row.id &&
      clean(message.data?.type) === "voice_note" &&
      message.data?.mimeType === "audio/wav" &&
      message.data?.sizeBytes === object.expectedSizeBytes &&
      message.data?.durationSeconds === object.durationSeconds &&
      message.data?.deletedForEveryone !== true &&
      !held(message.data) &&
      !unknown(message.data, knownVoiceMessageKeys);
    const expectedDraft = ["pending_upload", "uploaded", "deleting"]
      .includes(state);
    const needsReview = held(object) ||
      unknown(object, knownObjectKeys) ||
      !conversationValid || held(conversation.data) ||
      (sent
        ? !messageOk(messageId) || !messageValid || draft.exists
        : !draftValid || Boolean(messageId)) ||
      (expectedDraft && !draftValid) ||
      flag.exists ||
      state === "deleting"; // R2 draft cleanup may be racing.
    return {
      id: row.id, state,
      linkedMessagePresent: message.exists,
      draftPresent: draft.exists,
      evidenceMarkerPresent: flag.exists,
      needsReview: Boolean(needsReview),
    };
  }));
  return {
    ok: true, items, hasMore: rows.length > limit,
    nextCursor: rows.length > limit && selected.length
      ? selected[selected.length - 1].id : null,
    needsReview: items.some(item => item.needsReview),
    // Neither Firestore metadata nor an empty indexed page proves R2
    // object deletion, evidence expiry, legacy coverage or finalization.
    exhaustive: false, completionVerified: false, erasureAllowed: false,
  };
}
