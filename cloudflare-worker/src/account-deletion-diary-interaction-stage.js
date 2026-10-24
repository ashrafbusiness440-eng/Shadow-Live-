// Gated internal one-record cleanup for a deleted account's own diary like
// or view-dedupe key. There is no public caller, cron or production executor.
// Real checkpoints still have destructiveAllowed=false. Counterparty diaries,
// their aggregate counts, support points, gifts and money NEVER change here.
const clean = value => String(value ?? "").trim();
const uidOk = value => /^[A-Za-z0-9_-]{3,128}$/.test(clean(value));
const requestOk = value => /^[A-Za-z0-9_-]{12,180}$/.test(clean(value));
const diaryOk = value => /^[A-Za-z0-9_-]{3,220}$/.test(clean(value));
const held = value => [
  value?.reviewHold, value?.legalHold, value?.retentionHold,
  value?.deletionHold, value?.evidenceHold, value?.investigationHold,
  value?.reported,
].some(flag => flag === true);
const kinds = Object.freeze({ likes: "diary_likes", views: "diary_view_keys" });
const commonKeys = [
  "userUid", "diaryId", "reviewHold", "legalHold", "retentionHold",
  "deletionHold", "evidenceHold", "investigationHold", "reported",
];
const permittedKeys = Object.freeze({
  likes: new Set([...commonKeys, "createdAt"]),
  views: new Set([...commonKeys, "lastCountedAt", "lastCountedAtMs",
    "nextEligibleAtMs"]),
});
const hex = uid => Array.from(
  new TextEncoder().encode(uid),
  byte => byte.toString(16).padStart(2, "0"),
).join("");

export class AccountDiaryInteractionErasureError extends Error {
  constructor(code, status = 409) {
    super(code);
    this.code = code;
    this.status = status;
  }
}

/**
 * Only the account's exact like or view dedupe document can be erased.
 * This is NOT authorization to reset a diary's aggregate like/view count.
 * The retention and historical-counter dispositions must be certified by
 * the future finalizer; none of the flags can be set by this module.
 */
export async function eraseDeletedDiaryInteraction(db, {
  uid, requestId, diaryId, kind,
} = {}) {
  uid = clean(uid);
  requestId = clean(requestId);
  diaryId = clean(diaryId);
  if (!uidOk(uid) || !requestOk(requestId) || !diaryOk(diaryId) ||
      !Object.hasOwn(kinds, kind)) {
    throw new AccountDiaryInteractionErasureError(
      "invalid_diary_interaction_erasure_target", 400);
  }
  const path = kinds[kind] + "/" + diaryId + "__" + hex(uid);
  const tx = await db.beginTransaction();
  try {
    const [request, checkpoint, user, record, diary] = await Promise.all([
      db.get("account_deletion_requests/" + uid, tx),
      db.get("account_deletion_erasure_checkpoints/" + uid, tx),
      db.get("users/" + uid, tx),
      db.get(path, tx),
      db.get("diaries/" + diaryId, tx),
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
      throw new AccountDiaryInteractionErasureError(
        "diary_interaction_erasure_not_authorized");
    }
    if (!record.exists) {
      await db.rollback(tx);
      return { ok: true, erased: false, duplicate: true };
    }
    if (clean(record.data?.userUid) !== uid ||
        clean(record.data?.diaryId) !== diaryId) {
      throw new AccountDiaryInteractionErasureError(
        "diary_interaction_owner_conflict");
    }
    // Evidence/retention flags on either document override the global stage.
    if (!diary.exists || !uidOk(diary.data?.ownerUid) ||
        held(record.data) || held(diary.data)) {
      throw new AccountDiaryInteractionErasureError(
        "diary_interaction_source_requires_review");
    }
    // Legacy fields may contain protected/private evidence. Don't silently
    // drop an unrecognized key even with globally approved retention.
    if (Object.keys(record.data || {}).some(
      key => !permittedKeys[kind].has(key))) {
      throw new AccountDiaryInteractionErasureError(
        "diary_interaction_legacy_schema_requires_review");
    }
    await db.commit(tx, [db.writeDelete(path)]);
    return { ok: true, erased: true, duplicate: false };
  } catch (error) {
    await db.rollback(tx).catch(() => {});
    throw error;
  }
}
