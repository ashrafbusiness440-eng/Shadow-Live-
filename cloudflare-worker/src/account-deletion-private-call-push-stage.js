import { accountDeletionHasActiveHold as held } from "./account-deletion-active-holds.js";
import { recheckErasureCertificatesInTransaction }
  from "./account-deletion-erasure-transactional-cert-gate.js";
// One-token, already-enumerated private-call push cleanup. NO route or cron.
// Production preflight checkpoints remain destructiveAllowed=false.
import { createHash } from "node:crypto";

const clean = value => String(value ?? "").trim();
const validUid = value => /^[A-Za-z0-9_-]{3,128}$/.test(clean(value));
const validRequestId = value => /^[A-Za-z0-9_-]{12,180}$/.test(clean(value));
const validHash = value => /^[a-f0-9]{64}$/.test(clean(value));
const validToken = value => /^[A-Za-z0-9_:\-.]{32,512}$/.test(clean(value));


export class PrivateCallPushErasureError extends Error {
  constructor(code, status = 409) {
    super(code);
    this.code = code;
    this.status = status;
  }
}

/**
 * Remove one known token record for the deleted user. Ownership is checked
 * transactionally: a token reassigned to another user is NEVER revoked from
 * that user's registry. Does not send FCM, read other users' devices or scan.
 * A separate certified executor must enumerate and verify ALL token hashes.
 */
export async function eraseDeletedPrivateCallPushToken(db, {
  uid, requestId, tokenHash, nowMs = Date.now(),
} = {}) {
  uid = clean(uid);
  requestId = clean(requestId);
  tokenHash = clean(tokenHash);
  if (!validUid(uid) || !validRequestId(requestId) || !validHash(tokenHash) ||
      !Number.isSafeInteger(nowMs) || nowMs <= 0) {
    throw new PrivateCallPushErasureError("invalid_push_erasure_target", 400);
  }
  const devicePath = `private_call_push_devices/${uid}/tokens/${tokenHash}`;
  const ownerPath = `private_call_push_token_owners/${tokenHash}`;
  const tx = await db.beginTransaction();
  try {
    const [request, checkpoint, user, device, owner] = await Promise.all([
      db.get(`account_deletion_requests/${uid}`, tx),
      db.get(`account_deletion_erasure_checkpoints/${uid}`, tx),
      db.get(`users/${uid}`, tx),
      db.get(devicePath, tx),
      db.get(ownerPath, tx),
    ]);
    if (!request.exists || !checkpoint.exists || !user.exists ||
        clean(request.data?.uid) !== uid ||
        clean(request.data?.requestId) !== requestId ||
        clean(checkpoint.data?.requestId) !== requestId ||
        clean(request.data?.status) !== "processing" ||
        clean(checkpoint.data?.phase) !== "push_devices" ||
        checkpoint.data?.destructiveAllowed !== true ||
        checkpoint.data?.notificationRetentionCleared !== true ||
        checkpoint.data?.legalEvidenceReviewComplete !== true ||
        clean(user.data?.accountStatus) !== "deletion_processing" ||
        clean(user.data?.role) === "owner" ||
        held(request.data) || held(checkpoint.data) || held(user.data) ||
        held(device.data) || held(owner.data)) {
      throw new PrivateCallPushErasureError("push_erasure_not_authorized");
    }
    if (device.exists) {
      const token = clean(device.data?.token);
      if (!validToken(token) ||
          createHash("sha256").update(token).digest("hex") !== tokenHash) {
        throw new PrivateCallPushErasureError("push_token_integrity_conflict");
      }
    }
    const ownerUid = clean(owner.data?.uid);
    if (owner.exists && !validUid(ownerUid)) {
      throw new PrivateCallPushErasureError("push_owner_integrity_conflict");
    }
    const writes = [];
    if (device.exists) writes.push(db.writeDelete(devicePath));
    // If another account has since registered the same installation token,
    // leave its owner binding untouched. Old ownership cannot revoke it.
    if (owner.exists && ownerUid === uid) {
      writes.push(db.writeDelete(ownerPath));
    }
    if (!writes.length) {
      await db.rollback(tx);
      return { ok: true, removed: 0, duplicate: true };
    }
    await recheckErasureCertificatesInTransaction(db, tx, {
      uid, requestId, requestedAt: request.data?.requestedAt, nowMs,
    });
    await db.commit(tx, writes);
    return { ok: true, removed: writes.length, duplicate: false };
  } catch (error) {
    await db.rollback(tx).catch(() => {});
    throw error;
  }
}
