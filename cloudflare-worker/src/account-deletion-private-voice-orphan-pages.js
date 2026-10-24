// INTERNAL ONLY: read-only, five-object R2 listing scoped to ONE verified
// private conversation and ONE deleting user. No global bucket scan,
// R2 get/head/delete, timer, Auth changes or account-erasure authorization.
const clean = v => String(v ?? "").trim();
const uidOk = v => /^[A-Za-z0-9_-]{3,128}$/.test(clean(v));
const reqOk = v => /^[A-Za-z0-9_-]{12,180}$/.test(clean(v));
const chatOk = v => /^[A-Za-z0-9_-]{1,180}$/.test(clean(v));
const objectOk = v => /^[a-f0-9]{32}$/.test(clean(v));
const held = d => [
  d?.reviewHold, d?.legalHold, d?.retentionHold, d?.deletionHold,
  d?.evidenceHold, d?.investigationHold, d?.reported,
].some(x => x === true);
export const MAX_PRIVATE_VOICE_ORPHAN_PAGE = 5;

export class PrivateVoiceOrphanInventoryError extends Error {
  constructor(code, status = 409) {
    super(code); this.code = code; this.status = status;
  }
}
const reject = (code, status) => {
  throw new PrivateVoiceOrphanInventoryError(code, status);
};

/**
 * This finds candidates absent from Firestore by examining a *single* R2
 * prefix. It cannot prove comprehensive account storage inventory, perform
 * cleanup, or bypass legal/retention review. No production route calls it.
 */
export async function inspectPrivateVoiceOrphanPage(db, bucket, {
  uid, requestId, conversationId, actor,
  cursor = null, limit = MAX_PRIVATE_VOICE_ORPHAN_PAGE,
} = {}) {
  uid = clean(uid);
  requestId = clean(requestId);
  conversationId = clean(conversationId);
  if (!actor?.owner || !uidOk(actor?.uid)) reject("owner_required", 403);
  if (!uidOk(uid) || !reqOk(requestId) || !chatOk(conversationId) ||
      !Number.isSafeInteger(limit) || limit < 1 ||
      limit > MAX_PRIVATE_VOICE_ORPHAN_PAGE ||
      (cursor !== null && (typeof cursor !== "string" ||
        !/^[A-Za-z0-9+/_=-]{1,512}$/.test(cursor)))) {
    reject("invalid_private_voice_orphan_inventory", 400);
  }
  const [request, checkpoint, user, chat] = await Promise.all([
    db.get("account_deletion_requests/" + uid),
    db.get("account_deletion_erasure_checkpoints/" + uid),
    db.get("users/" + uid),
    db.get("conversations/" + conversationId),
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
    reject("private_voice_orphan_review_blocked");
  }
  const parties = chat.data?.participants;
  if (!chat.exists || held(chat.data) ||
      !Array.isArray(parties) || parties.length !== 2 ||
      new Set(parties).size !== 2 ||
      !parties.includes(uid) || !parties.every(uidOk)) {
    reject("private_voice_orphan_conversation_review");
  }
  if (typeof bucket?.list !== "function") {
    reject("r2_listing_unavailable", 503);
  }
  const prefix = `private-voice/${conversationId}/${uid}/`;
  let listing;
  try {
    listing = await bucket.list({
      prefix, limit, ...(cursor !== null ? {cursor} : {}),
    });
  } catch (_error) {
    // Never leak R2 key or provider error details to a future caller.
    reject("r2_listing_unavailable", 503);
  }
  if (!listing || !Array.isArray(listing.objects) ||
      listing.objects.length > limit ||
      typeof listing.truncated !== "boolean" ||
      (listing.truncated && (listing.objects.length === 0 ||
        typeof listing.cursor !== "string" ||
        !/^[A-Za-z0-9+/_=-]{1,512}$/.test(listing.cursor)))) {
    reject("private_voice_orphan_invalid_listing", 503);
  }
  const seen = new Set();
  const selected = listing.objects.map(obj => {
    const key = clean(obj?.key);
    // R2 results may never take us out of this account + conversation.
    if (!key.startsWith(prefix)) {
      reject("private_voice_orphan_scope_violation", 503);
    }
    const suffix = key.slice(prefix.length);
    const objectId = suffix.endsWith(".wav")
      ? suffix.slice(0, -4) : "";
    if (!objectOk(objectId) || seen.has(objectId)) {
      reject("private_voice_orphan_legacy_object_review");
    }
    seen.add(objectId);
    return {objectId, key};
  });
  // Before returning any result, compare only these <=5 exact Firestore
  // metadata document paths. Never scan all private_voice_objects.
  const metadata = await Promise.all(selected.map(row =>
    db.get("private_voice_objects/" + row.objectId)));
  const items = selected.map((row, index) => {
    const record = metadata[index];
    const data = record.data || {};
    if (record.exists && clean(data.ownerUid) !== uid) {
      reject("private_voice_orphan_metadata_owner_conflict");
    }
    const linked = record.exists &&
      clean(data.objectId) === row.objectId &&
      clean(data.conversationId) === conversationId &&
      clean(data.storageKey) === row.key &&
      clean(data.otherUid) === parties.find(p => p !== uid) &&
      !held(data) &&
      ["pending_upload","uploaded","sent","deleting"].includes(
        clean(data.state));
    return {
      objectId: row.objectId,
      metadataPresent: record.exists,
      needsReview: !linked,
    };
  });
  return {
    ok: true, checked: items.length, items,
    hasMore: listing.truncated,
    nextCursor: listing.truncated ? listing.cursor : null,
    needsReview: items.some(item => item.needsReview),
    // An empty prefix does NOT account for other conversations, legacy
    // storage layouts, unknown R2 buckets or legal/financial holds.
    exhaustive: false, completionVerified: false,
    erasureAllowed: false,
  };
}
