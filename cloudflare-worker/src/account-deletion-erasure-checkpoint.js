// First lifecycle checkpoint only. No destructive operations are exposed here.
// A review_ready request is NOT authorization to erase personal or financial data.
const clean = value => String(value ?? "").trim();
const validUid = value => /^[A-Za-z0-9_-]{3,128}$/.test(clean(value));
const validId = value => /^[A-Za-z0-9_-]{12,180}$/.test(clean(value));
const timeMs = value => {
  if (value instanceof Date) return value.getTime();
  if (typeof value?.toDate === "function") return value.toDate().getTime();
  if (typeof value === "string") return Date.parse(value);
  const seconds = Number(value?.seconds ?? value?._seconds);
  return value && Number.isFinite(seconds) ? seconds * 1000 : NaN;
};

export class AccountErasureCheckpointError extends Error {
  constructor(code, status = 409) {
    super(code);
    this.code = code;
    this.status = status;
  }
}

// Fail closed: balances, historic ledger, media ownership and legal evidence
// MUST be independently cleared by the future executor before next stage.
export function checkErasureStartEligibility({ uid, requestId, request, user, nowMs }) {
  if (!validUid(uid) || !validId(requestId) || !Number.isFinite(nowMs)) {
    throw new AccountErasureCheckpointError("invalid_erasure_target", 400);
  }
  if (!request?.exists || !user?.exists ||
      clean(request.data?.uid) !== uid ||
      clean(request.data?.requestId) !== requestId ||
      clean(request.data?.status) !== "review_ready" ||
      request.data?.reviewHold === true ||
      user.data?.authDeleted === true ||
      clean(user.data?.accountStatus) === "deleted" ||
      clean(user.data?.role) === "owner") {
    throw new AccountErasureCheckpointError("erasure_preflight_blocked");
  }
  const dueMs = timeMs(request.data.eligibleAt);
  if (!Number.isFinite(dueMs) || dueMs <= 0 || dueMs > nowMs) {
    throw new AccountErasureCheckpointError("erasure_not_due");
  }
  if ([user.data?.legalHold, user.data?.retentionHold,
       user.data?.deletionHold].some(flag => flag === true)) {
    throw new AccountErasureCheckpointError("erasure_legal_hold");
  }
  return { uid, requestId, phase: "preflight_blocked", destructiveAllowed: false };
}

// Idempotent transaction: lease the CURRENT request, not a stale request ID.
// Deliberately records BLOCKED (not PROCESSING) until independent sign-offs
// exist for money, shared content, evidence, billing and retention.
export async function recordErasurePreflightCheckpoint(db, {
  uid, requestId, actor, nowMs = Date.now(),
} = {}) {
  if (!actor || actor.owner !== true || !validUid(actor.uid)) {
    throw new AccountErasureCheckpointError("owner_required", 403);
  }
  // Validate before constructing Firestore paths or initiating any reads.
  if (!validUid(uid) || !validId(requestId) ||
      !Number.isFinite(nowMs)) {
    throw new AccountErasureCheckpointError("invalid_erasure_target", 400);
  }
  const requestPath = "account_deletion_requests/" + uid;
  const checkpointPath = "account_deletion_erasure_checkpoints/" + uid;
  const tx = await db.beginTransaction();
  try {
    const [request, user, previous] = await Promise.all([
      db.get(requestPath, tx),
      db.get("users/" + uid, tx),
      db.get(checkpointPath, tx),
    ]);
    const eligible = checkErasureStartEligibility({
      uid, requestId, request, user, nowMs,
    });
    if (previous.exists) {
      // A new request after a cancelled lifecycle may replace ONLY a
      // non-destructive preflight. Never reset active or completed progress.
      if (previous.data?.phase !== "preflight_blocked" ||
          previous.data?.destructiveAllowed !== false) {
        throw new AccountErasureCheckpointError("checkpoint_conflict");
      }
      if (clean(previous.data?.requestId) === requestId) {
        await db.rollback(tx);
        return { ...eligible, duplicate: true };
      }
    }
    const checkpoint = {
      ...eligible,
      createdAt: new Date(nowMs),
      actorUid: actor.uid,
      requiredReviews: [
        "financial_settlement", "play_billing",
        "reports_and_legal_holds", "shared_rooms_and_agencies",
        "content_and_storage_inventory", "retention_policy",
      ],
    };
    await db.commit(tx, [
      previous.exists
        ? db.writeUpdate(checkpointPath, checkpoint, Object.keys(checkpoint))
        : db.writeCreate(checkpointPath, checkpoint),
      db.writeCreate(
        "admin_audit_logs/erasure_preflight_" + requestId,
        {
          action: "accountErasurePreflightBlocked",
          actorUid: actor.uid, targetType: "user", targetId: uid,
          requestId, createdAt: new Date(nowMs),
        },
      ),
    ]);
    return { ...eligible, duplicate: false };
  } catch (error) {
    await db.rollback(tx).catch(() => {});
    throw error;
  }
}
