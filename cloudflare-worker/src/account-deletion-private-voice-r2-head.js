// INTERNAL ONLY: reconcile one VERIFIED private voice object with R2 HEAD.
// Read-only. No endpoint/cron, R2 list/get/delete, Firestore mutation,
// erasure stage approval, Firebase Auth deletion or completion receipt.
const clean = value => String(value ?? "").trim();
const uidOk = value => /^[A-Za-z0-9_-]{3,128}$/.test(clean(value));
const requestOk = value => /^[A-Za-z0-9_-]{12,180}$/.test(clean(value));
const objectOk = value => /^[a-f0-9]{32}$/.test(clean(value));
const conversationOk = value => /^[A-Za-z0-9_-]{1,180}$/.test(clean(value));
const messageOk = value => /^voice_[a-f0-9]{32}$/.test(clean(value));
const held = data => [
  data?.reviewHold, data?.legalHold, data?.retentionHold,
  data?.deletionHold, data?.evidenceHold, data?.investigationHold,
  data?.reported,
].some(value => value === true);
const knownObjectFields = new Set([
  "objectId","ownerUid","otherUid","conversationId","storageKey",
  "mimeType","expectedSizeBytes","durationSeconds","state",
  "createdAt","uploadExpiresAt","confirmedAt","messageId",
  "sentAt","deletingAt",
]);
const knownMessageFields = new Set([
  "type","senderId","receiverId","storageObjectId","mimeType",
  "sizeBytes","durationSeconds","createdAt","deletedForEveryone",
  "deletedAt","erasureRequestId",
]);
const knownDraftFields = new Set([
  "objectId","ownerUid","storageKey","expiresAt","createdAt",
]);
const known = (data, fields) =>
  data && Object.keys(data).every(field => fields.has(field));
export class PrivateVoiceR2ReconciliationError extends Error {
  constructor(code, status = 409) {
    super(code); this.code = code; this.status = status;
  }
}
const reject = (code, status) => {
  throw new PrivateVoiceR2ReconciliationError(code, status);
};

/**
 * Current request + Owner-scoped single-object validation precedes the sole
 * R2 .head() call. R2 HEAD is not a legal retention approval or completion
 * proof; it cannot detect old unindexed metadata or orphaned objects.
 */
export async function inspectPrivateVoiceR2Object(db, bucket, {
  uid, requestId, objectId, actor,
} = {}) {
  uid = clean(uid);
  requestId = clean(requestId);
  objectId = clean(objectId);
  if (!actor?.owner || !uidOk(actor?.uid)) reject("owner_required", 403);
  if (!uidOk(uid) || !requestOk(requestId) || !objectOk(objectId)) {
    reject("invalid_private_voice_r2_target", 400);
  }
  const [request, checkpoint, user, objectDoc] = await Promise.all([
    db.get("account_deletion_requests/" + uid),
    db.get("account_deletion_erasure_checkpoints/" + uid),
    db.get("users/" + uid),
    db.get("private_voice_objects/" + objectId),
  ]);
  if (!request.exists || !checkpoint.exists || !user.exists ||
      clean(request.data?.uid) !== uid ||
      clean(request.data?.requestId) !== requestId ||
      clean(checkpoint.data?.uid) !== uid ||
      clean(checkpoint.data?.requestId) !== requestId ||
      !["review_ready","processing"].includes(clean(request.data?.status)) ||
      clean(user.data?.role) === "owner" ||
      user.data?.authDeleted === true ||
      held(request.data) || held(checkpoint.data) || held(user.data)) {
    reject("private_voice_r2_review_blocked");
  }
  if (!objectDoc.exists) reject("private_voice_metadata_missing");
  const voice = objectDoc.data || {};
  if (clean(voice.ownerUid) !== uid ||
      clean(voice.objectId) !== objectId) {
    reject("private_voice_r2_owner_conflict");
  }
  const chatId = clean(voice.conversationId);
  const otherUid = clean(voice.otherUid);
  const state = clean(voice.state);
  const key = clean(voice.storageKey);
  // Derive canonical key; NEVER trust arbitrary stored R2 object paths.
  if (!conversationOk(chatId) ||
      !uidOk(otherUid) || otherUid === uid ||
      key !== `private-voice/${chatId}/${uid}/${objectId}.wav` ||
      voice.mimeType !== "audio/wav" ||
      !Number.isSafeInteger(voice.expectedSizeBytes) ||
      voice.expectedSizeBytes < 46 ||
      voice.expectedSizeBytes > 3 * 1024 * 1024 ||
      !Number.isSafeInteger(voice.durationSeconds) ||
      voice.durationSeconds < 1 || voice.durationSeconds > 60 ||
      !["pending_upload","uploaded","sent","deleting"].includes(state) ||
      !known(voice, knownObjectFields) || held(voice)) {
    reject("private_voice_r2_metadata_review_required");
  }
  const sent = state === "sent";
  const messageId = clean(voice.messageId);
  if (sent !== Boolean(messageId) ||
      (sent && !messageOk(messageId)) ||
      state === "deleting") {
    reject("private_voice_r2_linkage_review_required");
  }
  const [conversation, draft, message, evidence] = await Promise.all([
    db.get("conversations/" + chatId),
    db.get("private_voice_drafts/" + objectId),
    sent ? db.get("conversations/" + chatId + "/messages/" + messageId)
      : Promise.resolve({exists: false}),
    sent ? db.get("content_filter_flags/" + messageId)
      : Promise.resolve({exists: false}),
  ]);
  const parties = conversation.data?.participants;
  if (!conversation.exists || held(conversation.data) ||
      !Array.isArray(parties) || parties.length !== 2 ||
      new Set(parties).size !== 2 ||
      !parties.includes(uid) || !parties.includes(otherUid) ||
      !parties.every(uidOk)) {
    reject("private_voice_r2_conversation_review_required");
  }
  if (sent) {
    const msg = message.data || {};
    if (!message.exists || draft.exists || evidence.exists ||
        held(msg) || !known(msg, knownMessageFields) ||
        clean(msg.type) !== "voice_note" ||
        clean(msg.senderId) !== uid ||
        clean(msg.receiverId) !== otherUid ||
        clean(msg.storageObjectId) !== objectId ||
        msg.deletedForEveryone === true ||
        clean(msg.mimeType) !== "audio/wav" ||
        msg.sizeBytes !== voice.expectedSizeBytes ||
        msg.durationSeconds !== voice.durationSeconds) {
      reject("private_voice_r2_sent_message_review_required");
    }
  } else if (!draft.exists || held(draft.data) ||
      !known(draft.data, knownDraftFields) ||
      clean(draft.data.ownerUid) !== uid ||
      clean(draft.data.objectId) !== objectId ||
      clean(draft.data.storageKey) !== key) {
    reject("private_voice_r2_draft_review_required");
  }
  if (typeof bucket?.head !== "function") {
    reject("r2_head_unavailable", 503);
  }
  let head;
  try {
    // Exactly ONE metadata-only R2 operation after all Firestore checks.
    head = await bucket.head(key);
  } catch (_error) {
    // Never surface private R2 paths, storage errors or signed URLs.
    reject("r2_head_unavailable", 503);
  }
  if (head !== null && head !== undefined &&
      (!Number.isSafeInteger(head.size) || head.size < 0)) {
    reject("r2_head_invalid_response", 503);
  }
  const present = head != null;
  const sizeMatches = present &&
    head.size === voice.expectedSizeBytes;
  const observedType = clean(head?.httpMetadata?.contentType).toLowerCase();
  const mimeMatches = present && observedType === "audio/wav";
  return {
    ok: true, objectId, state,
    storagePresent: present,
    sizeMatches, mimeMatches,
    needsReview: !present || !sizeMatches || !mimeMatches,
    // Presence cannot authorize deletion. Even a missing object is not
    // proof that the user has no remaining voice audio in R2.
    exhaustive: false,
    completionVerified: false,
    erasureAllowed: false,
  };
}
