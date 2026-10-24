// Internal account-erasure admission. A certificate is NOT permission to erase.
// No endpoint, timer, cron, Auth deletion or destructive stage is wired here.
const clean = value => String(value ?? "").trim();
const uidOk = value => /^[A-Za-z0-9_-]{3,128}$/.test(clean(value));
const idOk = value => /^[A-Za-z0-9_-]{12,180}$/.test(clean(value));
const GRACE_MS = 30 * 24 * 60 * 60 * 1000;
const held = d => [
  d?.reviewHold, d?.legalHold, d?.retentionHold, d?.deletionHold,
  d?.evidenceHold,
].some(x => x === true);
const ms = v => {
  if (v instanceof Date) return v.getTime();
  if (typeof v?.toDate === "function") return v.toDate().getTime();
  if (typeof v === "string") return Date.parse(v);
  const seconds = Number(v?.seconds ?? v?._seconds);
  return v && Number.isFinite(seconds) ? seconds * 1000 : NaN;
};

// Every category is a separate immutable server-side signoff and audit.
// The actual data/evidence/settlement verification remains a distinct task.
export const REQUIRED_ERASURE_ADMISSION_DOMAINS = Object.freeze([
  "financial_settlement",
  "play_billing",
  "moderation_legal",
  "shared_assets",
  "content_storage_inventory",
  "retention_policy",
]);

export class AccountErasureAdmissionError extends Error {
  constructor(code, status = 409) {
    super(code);
    this.code = code;
    this.status = status;
  }
}
const approvalPath = (requestId, domain) =>
  `account_deletion_erasure_approvals/${requestId}__${domain}`;
const auditPath = (requestId, domain) =>
  `admin_audit_logs/erasure_domain_cert_${requestId}__${domain}`;
const startAuditPath = requestId =>
  "admin_audit_logs/erasure_processing_start_" + requestId;

function checkSignoff(approval, audit, { uid, requestId, domain,
  requestedAtMs, nowMs }) {
  const a = approval?.data;
  const b = audit?.data;
  const signedAt = ms(a?.signedAt);
  const auditedAt = ms(b?.createdAt);
  const expiresAt = ms(a?.expiresAt);
  if (!approval?.exists || !audit?.exists ||
      clean(a?.uid) !== uid || clean(a?.requestId) !== requestId ||
      clean(a?.domain) !== domain || clean(a?.decision) !== "approved" ||
      clean(b?.action) !== "accountErasureDomainCertified" ||
      clean(b?.targetId) !== uid || clean(b?.requestId) !== requestId ||
      clean(b?.domain) !== domain ||
      !uidOk(a?.signedByUid) || clean(b?.actorUid) !== clean(a.signedByUid) ||
      !Number.isFinite(signedAt) || signedAt < requestedAtMs ||
      signedAt > nowMs || !Number.isFinite(auditedAt) ||
      auditedAt < requestedAtMs || auditedAt > nowMs ||
      !Number.isFinite(expiresAt) || expiresAt <= nowMs ||
      held(a) || held(b)) {
    throw new AccountErasureAdmissionError(
      "erasure_domain_certification_missing_or_invalid");
  }
}

/**
 * Admits only a fully certified CURRENT request to non-destructive processing.
 * All six domain certificates must already exist, with matching immutable
 * audit records. This routine cannot create/approve those documents itself.
 * Even after admission, checkpoint.destructiveAllowed stays FALSE.
 *
 * Only a separately verified backend Owner caller may use this internal API.
 * A future exposed route MUST enforce session, Owner role and recent auth
 * server-side before calling this function.
 */
export async function admitCertifiedAccountErasure(db, {
  uid, requestId, actor, nowMs = Date.now(),
} = {}) {
  uid = clean(uid);
  requestId = clean(requestId);
  if (!actor?.owner || !uidOk(actor?.uid)) {
    throw new AccountErasureAdmissionError("owner_required", 403);
  }
  if (!uidOk(uid) || !idOk(requestId) ||
      !Number.isSafeInteger(nowMs) || nowMs <= 0) {
    throw new AccountErasureAdmissionError("invalid_admission_target", 400);
  }
  const requestPath = "account_deletion_requests/" + uid;
  const checkpointPath = "account_deletion_erasure_checkpoints/" + uid;
  const userPath = "users/" + uid;
  const tx = await db.beginTransaction();
  try {
    const base = await Promise.all([
      db.get(requestPath, tx),
      db.get(checkpointPath, tx),
      db.get(userPath, tx),
      db.get(startAuditPath(requestId), tx),
    ]);
    const [request, checkpoint, user, startAudit] = base;
    const r = request.data || {};
    const c = checkpoint.data || {};
    const u = user.data || {};
    if (!request.exists || !checkpoint.exists || !user.exists ||
        clean(r.uid) !== uid || clean(r.requestId) !== requestId ||
        clean(c.requestId) !== requestId || clean(c.uid) !== uid ||
        clean(u.role) === "owner" || u.authDeleted === true ||
        held(r) || held(c) || held(u)) {
      throw new AccountErasureAdmissionError("erasure_admission_blocked");
    }
    if (r.status === "processing" && c.phase === "processing_admitted" &&
        c.destructiveAllowed === false &&
        u.accountStatus === "deletion_processing" &&
        startAudit.exists &&
        clean(startAudit.data?.requestId) === requestId &&
        clean(startAudit.data?.targetId) === uid &&
        clean(startAudit.data?.action) === "accountErasureProcessingAdmitted") {
      await db.rollback(tx);
      return { ok: true, admitted: false, duplicate: true,
        phase: "processing_admitted", destructiveAllowed: false };
    }
    if (r.status !== "review_ready" || c.phase !== "preflight_blocked" ||
        c.destructiveAllowed !== false ||
        !["", "active"].includes(clean(u.accountStatus)) ||
        startAudit.exists) {
      throw new AccountErasureAdmissionError("erasure_admission_state_conflict");
    }
    const requestedAtMs = ms(r.requestedAt);
    const eligibleAtMs = ms(r.eligibleAt);
    if (!Number.isFinite(requestedAtMs) ||
        !Number.isFinite(eligibleAtMs) ||
        requestedAtMs <= 0 ||
        eligibleAtMs < requestedAtMs + GRACE_MS ||
        nowMs < requestedAtMs + GRACE_MS || nowMs < eligibleAtMs) {
      throw new AccountErasureAdmissionError("erasure_grace_not_elapsed");
    }
    const signed = await Promise.all(REQUIRED_ERASURE_ADMISSION_DOMAINS
      .flatMap(domain => [
        db.get(approvalPath(requestId, domain), tx),
        db.get(auditPath(requestId, domain), tx),
      ]));
    for (let i = 0; i < REQUIRED_ERASURE_ADMISSION_DOMAINS.length; i++) {
      checkSignoff(signed[i * 2], signed[i * 2 + 1], {
        uid, requestId,
        domain: REQUIRED_ERASURE_ADMISSION_DOMAINS[i],
        requestedAtMs, nowMs,
      });
    }
    const now = new Date(nowMs);
    await db.commit(tx, [
      db.writeUpdate(requestPath, {
        status: "processing", processingStartedAt: now, updatedAt: now,
      }, ["status", "processingStartedAt", "updatedAt"]),
      db.writeUpdate(userPath, {
        accountStatus: "deletion_processing",
        deletionProcessing: true, sessionsRevokedAt: now,
      }, ["accountStatus", "deletionProcessing", "sessionsRevokedAt"]),
      db.writeUpdate(checkpointPath, {
        phase: "processing_admitted", destructiveAllowed: false,
        processingStartedAt: now, admittedByUid: clean(actor.uid),
      }, ["phase", "destructiveAllowed", "processingStartedAt", "admittedByUid"]),
      db.writeCreate(startAuditPath(requestId), {
        action: "accountErasureProcessingAdmitted",
        actorUid: clean(actor.uid),
        targetType: "user", targetId: uid, requestId,
        certifiedDomains: [...REQUIRED_ERASURE_ADMISSION_DOMAINS],
        createdAt: now,
      }),
    ]);
    return { ok: true, admitted: true, duplicate: false,
      phase: "processing_admitted", destructiveAllowed: false };
  } catch (error) {
    await db.rollback(tx).catch(() => {});
    throw error;
  }
}
