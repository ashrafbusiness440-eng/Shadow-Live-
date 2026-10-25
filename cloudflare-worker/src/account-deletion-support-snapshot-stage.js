import { accountDeletionHasActiveHold as protectedHold } from "./account-deletion-active-holds.js";
import { recheckErasureCertificatesInTransaction }
  from "./account-deletion-erasure-transactional-cert-gate.js";
// Bounded, independently gated erasure stage for pre-enumerated support pairs.
// NOT routed to API/cron. Existing support points and gift counts are immutable.
const clean = value => String(value ?? "").trim();
const validUid = value => /^[A-Za-z0-9_-]{3,128}$/.test(clean(value));
const validRequestId = value => /^[A-Za-z0-9_-]{12,180}$/.test(clean(value));

const REDACTED_NAME = "حساب محذوف";

export class SupportSnapshotStageError extends Error {
  constructor(code) { super(code); this.code = code; this.status = 409; }
}

/**
 * Scrub personal snapshots in the other person's existing wealth/attraction
 * ranking documents. The two documents can still contain the erased person's
 * UID in their document ID; this stage alone is NOT comprehensive erasure.
 *
 * Only a separately certified finalizer may transition the request,
 * checkpoint AND user into the matching processing phase. No public caller
 * or owner action can set those states through this module.
 */
export async function redactDeletedSupporterPair(db, {
  deletedUid, counterpartUid, requestId, nowMs = Date.now(),
} = {}) {
  if (!validUid(deletedUid) || !validUid(counterpartUid) ||
      deletedUid === counterpartUid || !validRequestId(requestId) ||
      !Number.isSafeInteger(nowMs) || nowMs <= 0) {
    throw new SupportSnapshotStageError("invalid_support_erasure_target");
  }
  const tx = await db.beginTransaction();
  try {
    const paths = [
      "user_level_support/" + counterpartUid + "/wealth/" + deletedUid,
      "user_level_support/" + counterpartUid + "/attraction/" + deletedUid,
    ];
    const [request, checkpoint, user, ...rows] = await Promise.all([
      db.get("account_deletion_requests/" + deletedUid, tx),
      db.get("account_deletion_erasure_checkpoints/" + deletedUid, tx),
      db.get("users/" + deletedUid, tx),
      ...paths.map(path => db.get(path, tx)),
    ]);
    if (!request.exists || !checkpoint.exists || !user.exists ||
        clean(request.data?.uid) !== deletedUid ||
        clean(request.data?.requestId) !== requestId ||
        clean(checkpoint.data?.requestId) !== requestId ||
        clean(request.data?.status) !== "processing" ||
        clean(checkpoint.data?.phase) !== "support_snapshots" ||
        checkpoint.data?.destructiveAllowed !== true ||
        clean(user.data?.accountStatus) !== "deletion_processing" ||
        clean(user.data?.role) === "owner" ||
        protectedHold(request.data) || protectedHold(checkpoint.data) ||
        protectedHold(user.data)) {
      throw new SupportSnapshotStageError("support_erasure_not_authorized");
    }

    const writes = [];
    rows.forEach((row, index) => {
      if (!row.exists) return;
      const d = row.data || {};
      if (protectedHold(d)) {
        throw new SupportSnapshotStageError("support_snapshot_retention_hold");
      }
      // A corrupted legacy row must never be rewritten as someone else's.
      if (clean(d.counterpartUid) && clean(d.counterpartUid) !== deletedUid) {
        throw new SupportSnapshotStageError("support_erasure_pair_conflict");
      }
      if (d.displayName === REDACTED_NAME &&
          d.profileImageUrl === "" && d.publicId === "") return;
      // Do not touch points, giftCount, monetary records or counterpart UIDs.
      writes.push(db.writeUpdate(paths[index], {
        displayName: REDACTED_NAME,
        profileImageUrl: "",
        publicId: "",
      }, ["displayName", "profileImageUrl", "publicId"]));
    });

    if (!writes.length) {
      await db.rollback(tx);
      return { ok: true, redacted: 0, duplicate: true };
    }
    await recheckErasureCertificatesInTransaction(db, tx, {
      uid: deletedUid, requestId,
      requestedAt: request.data?.requestedAt, nowMs,
    });
    await db.commit(tx, writes);
    return { ok: true, redacted: writes.length, duplicate: false };
  } catch (error) {
    await db.rollback(tx).catch(() => {});
    throw error;
  }
}
