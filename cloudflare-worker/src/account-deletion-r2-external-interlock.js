// INTERNAL / UNROUTED — executable concurrency rehearsal for R2 erasure.
// This is intentionally restricted to a disposable synthetic object prefix.
// Never import it into the production scheduled worker or expand the prefix
// without independent review of revocation writers, media ownership and gates.
import { recheckErasureCertificatesInTransaction }
  from "./account-deletion-erasure-transactional-cert-gate.js";
import { accountDeletionHasActiveHold as held }
  from "./account-deletion-active-holds.js";

const clean = value => String(value ?? "").trim();
const id = value => /^[A-Za-z0-9_-]{12,180}$/.test(clean(value));
const uidValid = value => /^[A-Za-z0-9_-]{3,128}$/.test(clean(value));
const GRACE_MS = 30 * 86400_000;
const dateMs = value => value instanceof Date ? value.getTime()
  : typeof value?.toDate === "function" ? value.toDate().getTime()
  : typeof value === "string" ? Date.parse(value)
  : Number.isFinite(value?.seconds) ? value.seconds * 1000 : NaN;
const path = (collection, uid, requestId) =>
  collection + "/" + uid + "__" + requestId;
const getAll = async (db, tx, paths) => {
  const rows = typeof db.getMany === "function"
    ? await db.getMany(paths, tx)
    : await Promise.all(paths.map(p => db.get(p, tx)));
  if (!Array.isArray(rows) || rows.length !== paths.length ||
      rows.some(row => !row || typeof row.exists !== "boolean")) {
    throw Error("r2_interlock_incomplete_transaction_snapshot");
  }
  return rows;
};

/**
 * Starts exactly ONE synthetic external delete, using a durable create-only
 * dispatch journal BEFORE calling the fixture bucket. An owner stop and this
 * dispatch transaction both read the same stop-intent document, establishing
 * their ordering in Firestore. If dispatch commits first, a later stop MUST
 * remain pending until separately verified reconciliation; if stop commits
 * first, the delete is never started. Neither worker timeouts nor HEAD result
 * can reopen the attempt. No production R2 key may pass this function.
 *
 * This is a tested coordination rehearsal, NOT the final production fence:
 * all six signoff-revocation writers must participate in the same protocol
 * before any non-fixture R2 delete becomes safe.
 */
export async function rehearseAccountErasureR2Dispatch(db, bucket, {
  uid, requestId, objectId, token, actor, nowMs = Date.now(),
} = {}) {
  uid = clean(uid); requestId = clean(requestId);
  objectId = clean(objectId); token = clean(token);
  if (!actor?.owner || !uidValid(clean(actor.uid))) {
    throw Error("r2_interlock_owner_required");
  }
  if (!uidValid(uid) || !id(requestId) || !id(objectId) ||
      !/^[A-Za-z0-9_-]{20,180}$/.test(token) ||
      !Number.isSafeInteger(nowMs) || nowMs <= 0) {
    throw Error("r2_interlock_invalid_target");
  }
  if (typeof bucket?.delete !== "function" ||
      typeof db?.beginTransaction !== "function" ||
      typeof db?.commit !== "function" ||
      typeof db?.rollback !== "function" ||
      typeof db?.writeCreate !== "function") {
    throw Error("r2_interlock_adapter_missing");
  }
  const stopPath = path("account_erasure_external_io_revocation_intents",
    uid, requestId);
  const dispatchPath = path("account_erasure_external_io_fixture_dispatches",
    uid, requestId);
  const reservationPath = "account_erasure_external_io_reservations/" +
    uid + "__" + objectId;
  const paths = [
    "account_deletion_requests/" + uid,
    "account_deletion_erasure_checkpoints/" + uid,
    "users/" + uid,
    "storage_objects/" + objectId,
    reservationPath,
    path("account_erasure_external_io_coordination_holds", uid, requestId),
    path("account_erasure_external_io_uncertain_attempts", uid, requestId),
    stopPath, dispatchPath,
    "admin_audit_logs/erasure_processing_start_" + requestId,
  ];
  const tx = await db.beginTransaction();
  let storageKey;
  try {
    const [request, checkpoint, user, object, reservation, hold, attempt,
      stop, prior, admission] = await getAll(db, tx, paths);
    if (stop.exists || prior.exists) {
      throw Error("r2_interlock_stopped_or_already_dispatched");
    }
    storageKey = clean(attempt.data?.storageKey);
    // An immutable allowlist deliberately prevents ANY live account or
    // shared-media asset from being deleted by this unconnected rehearsal.
    if (!storageKey.startsWith("erasure-fixture/") ||
        storageKey.length > 1024 || !storageKey ||
        !request.exists || !checkpoint.exists || !user.exists ||
        !object.exists || !reservation.exists || !hold.exists ||
        !attempt.exists || !admission.exists ||
        clean(request.data?.uid) !== uid ||
        clean(request.data?.requestId) !== requestId ||
        clean(request.data?.status) !== "processing" ||
        clean(checkpoint.data?.uid) !== uid ||
        clean(checkpoint.data?.requestId) !== requestId ||
        clean(checkpoint.data?.phase) !== "storage_media" ||
        checkpoint.data?.destructiveAllowed !== true ||
        checkpoint.data?.storageRetentionApproved !== true ||
        checkpoint.data?.sharedMediaOwnershipReviewed !== true ||
        checkpoint.data?.legalEvidenceReviewComplete !== true ||
        checkpoint.data?.financialSettlementApproved !== true ||
        checkpoint.data?.playBillingReviewComplete !== true ||
        clean(user.data?.accountStatus) !== "deletion_processing" ||
        clean(user.data?.role) === "owner" ||
        clean(object.data?.ownerUid) !== uid ||
        clean(object.data?.storageKey) !== storageKey ||
        clean(reservation.data?.uid) !== uid ||
        clean(reservation.data?.requestId) !== requestId ||
        clean(reservation.data?.objectId) !== objectId ||
        clean(reservation.data?.operationToken) !== token ||
        reservation.data?.externalIoAllowed !== false ||
        reservation.data?.completionVerified !== false ||
        clean(hold.data?.uid) !== uid ||
        clean(hold.data?.requestId) !== requestId ||
        clean(hold.data?.objectId) !== objectId ||
        clean(hold.data?.operationToken) !== token ||
        hold.data?.externalIoAllowed !== false ||
        hold.data?.completionVerified !== false ||
        clean(attempt.data?.uid) !== uid ||
        clean(attempt.data?.requestId) !== requestId ||
        clean(attempt.data?.objectId) !== objectId ||
        clean(attempt.data?.operationToken) !== token ||
        clean(attempt.data?.state) !== "outcome_unknown_requires_reconciliation" ||
        attempt.data?.retryAllowed !== false ||
        attempt.data?.externalIoAllowed !== false ||
        attempt.data?.completionVerified !== false ||
        clean(admission.data?.action) !== "accountErasureProcessingAdmitted" ||
        clean(admission.data?.requestId) !== requestId ||
        clean(admission.data?.targetId) !== uid ||
        held(request.data) || held(checkpoint.data) ||
        held(user.data) || held(object.data)) {
      throw Error("r2_interlock_unverified_or_non_fixture_target");
    }
    const requestedAtMs = dateMs(request.data?.requestedAt);
    const eligibleAtMs = dateMs(request.data?.eligibleAt);
    if (!Number.isSafeInteger(requestedAtMs) ||
        !Number.isSafeInteger(eligibleAtMs) ||
        eligibleAtMs < requestedAtMs + GRACE_MS ||
        nowMs < eligibleAtMs || nowMs < requestedAtMs + GRACE_MS) {
      throw Error("r2_interlock_grace_not_elapsed");
    }
    await recheckErasureCertificatesInTransaction(db, tx, {
      uid, requestId, requestedAtMs, nowMs,
    });
    // The owner stop writer transactionally reads stopPath, hold and attempt.
    // Both transactions reading stopPath ensure a stop-first commit conflicts
    // with this begin; a dispatch-first stop is pending, never 'effective'.
    await db.commit(tx, [db.writeCreate(dispatchPath, {
      uid, requestId, objectId, operationToken: token, storageKey,
      state: "fixture_external_io_may_have_started",
      startedAt: new Date(nowMs), startedByUid: clean(actor.uid),
      // A crash before/within/after bucket.delete makes history ambiguous.
      retryAllowed: false, completionVerified: false,
      revocationEffective: false, productionExternalIoAllowed: false,
    })]);
  } catch (error) {
    await db.rollback(tx).catch(() => {});
    throw error;
  }

  // ONLY the immutable synthetic key can reach this external call.
  // A stop racing AFTER the dispatch commit must remain pending; it cannot
  // undo a started request. Never retry on timeout or any ambiguous error.
  try {
    await bucket.delete(storageKey);
  } catch {
    return {ok: false, dispatched: true, outcome: "unknown",
      retryAllowed: false, completionVerified: false,
      revocationEffective: false, pendingReconciliation: true};
  }
  // Even an ACK isn't proof of historical object lifetime, inventory
  // exhaustion, or erasure of other assets. No completion receipt is issued.
  return {ok: true, dispatched: true,
    outcome: "fixture_delete_returned_unverified",
    retryAllowed: false, completionVerified: false,
    revocationEffective: false, pendingReconciliation: true};
}
