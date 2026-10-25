// INTERNAL, UNROUTED erasure-stage dispatcher. Production account deletion
// remains OFF (all live checkpoints have destructiveAllowed=false).
// This is NOT a finalizer and cannot create authorizations or completion receipts.
// One bounded existing stage per explicit invocation; no loops, cron or polling.
import { accountDeletionHasActiveHold as held }
  from "./account-deletion-active-holds.js";
import {
  REQUIRED_ERASURE_ADMISSION_DOMAINS,
  validateErasureDomainSignoff,
} from "./account-deletion-processing-admission.js";
import {
  drainAccountOwnedNotifications,
  drainAccountPrivateCallPushDevices,
} from "./account-deletion-bounded-drainers.js";
import { drainAccountDiaryInteractions }
  from "./account-deletion-diary-interaction-batches.js";
import { drainAccountPrivateTextPage }
  from "./account-deletion-private-text-batches.js";

const clean = value => String(value ?? "").trim();
const uidOk = value => /^[A-Za-z0-9_-]{3,128}$/.test(clean(value));
const requestOk = value => /^[A-Za-z0-9_-]{12,180}$/.test(clean(value));
const resourceOk = value => /^[A-Za-z0-9_-]{12,180}$/.test(clean(value));
const GRACE_MS = 30 * 86400_000;
const phaseForStep = Object.freeze({
  notifications: "notifications",
  push_devices: "push_devices",
  diary_likes: "diary_interactions",
  diary_views: "diary_interactions",
  private_text: "private_text",
});
export const MAX_INTERNAL_ERASURE_PHASE_ITEMS = 5;
export const ACCOUNT_ERASURE_INTERNAL_STEPS = Object.freeze(
  Object.keys(phaseForStep));
export class AccountInternalErasureStageError extends Error {
  constructor(code, status = 409) {
    super(code); this.code = code; this.status = status;
  }
}
const reject = (code, status) => {
  throw new AccountInternalErasureStageError(code, status);
};
function timeMs(value) {
  if (value instanceof Date) return value.getTime();
  if (typeof value?.toDate === "function") return value.toDate().getTime();
  if (typeof value === "string") return Date.parse(value);
  const seconds = Number(value?.seconds ?? value?._seconds);
  return value && Number.isFinite(seconds) ? seconds * 1000 : NaN;
}
const certificatePath = (requestId, domain) =>
  "account_deletion_erasure_approvals/" + requestId + "__" + domain;
const certificateAuditPath = (requestId, domain) =>
  "admin_audit_logs/erasure_domain_cert_" + requestId + "__" + domain;

/**
 * Preflight ALL requirements on every invocation, including every immutable
 * certified domain and original admission audit; no approvals are issued here.
 * Underlying stages recheck current phase, ownership, holds, per-row retention
 * and current request inside their own transactional operations.
 *
 * IMPORTANT: these two checks are not a single atomic transaction. Until
 * legal/financial signoff, resumable phase leasing, retained-evidence policy,
 * exhaustive legacy/R2 verification and final Auth-last are independently
 * implemented/tested, do NOT wire this dispatcher to API/cron or activate
 * destructiveAllowed in production.
 */
export async function runCertifiedInternalAccountErasurePage(db, {
  uid, requestId, actor, step, limit = MAX_INTERNAL_ERASURE_PHASE_ITEMS,
  conversationId = null, cursor = null, nowMs = Date.now(),
} = {}) {
  uid = clean(uid); requestId = clean(requestId);
  if (!actor?.owner || !uidOk(actor.uid)) reject("owner_required", 403);
  if (!uidOk(uid) || !requestOk(requestId) ||
      !Object.hasOwn(phaseForStep, step) ||
      !Number.isSafeInteger(limit) || limit < 1 ||
      limit > MAX_INTERNAL_ERASURE_PHASE_ITEMS ||
      !Number.isSafeInteger(nowMs) || nowMs <= 0 ||
      (step === "private_text"
        ? (!resourceOk(conversationId) ||
          (cursor !== null && !resourceOk(cursor)))
        : (conversationId !== null || cursor !== null))) {
    reject("invalid_internal_erasure_step", 400);
  }
  // The direct private-text primitive has not received its same-transaction
  // certificate guard. Even a forged destructiveAllowed checkpoint and valid
  // signoffs MUST NOT dispatch it. This block has no production escape hatch.
  if (step === "private_text") {
    reject("private_text_erasure_transaction_guard_missing");
  }
  const requestPath = "account_deletion_requests/" + uid;
  const checkpointPath = "account_deletion_erasure_checkpoints/" + uid;
  const userPath = "users/" + uid;
  const admissionAuditPath =
    "admin_audit_logs/erasure_processing_start_" + requestId;
  // Exactly 4 first-party reads; never query any user data before these pass.
  const [request, checkpoint, user, admissionAudit] = await Promise.all([
    db.get(requestPath), db.get(checkpointPath), db.get(userPath),
    db.get(admissionAuditPath),
  ]);
  const r = request?.data || {};
  const c = checkpoint?.data || {};
  const u = user?.data || {};
  const audit = admissionAudit?.data || {};
  if (!request?.exists || !checkpoint?.exists || !user?.exists ||
      !admissionAudit?.exists ||
      clean(r.uid) !== uid || clean(r.requestId) !== requestId ||
      clean(c.uid) !== uid || clean(c.requestId) !== requestId ||
      clean(r.status) !== "processing" ||
      clean(c.phase) !== phaseForStep[step] ||
      c.destructiveAllowed !== true ||
      clean(u.accountStatus) !== "deletion_processing" ||
      clean(u.role) === "owner" || u.authDeleted === true ||
      held(r) || held(c) || held(u) ||
      clean(audit.action) !== "accountErasureProcessingAdmitted" ||
      clean(audit.targetId) !== uid ||
      clean(audit.requestId) !== requestId ||
      !Array.isArray(audit.certifiedDomains) ||
      audit.certifiedDomains.length !==
        REQUIRED_ERASURE_ADMISSION_DOMAINS.length ||
      !REQUIRED_ERASURE_ADMISSION_DOMAINS.every(
        domain => audit.certifiedDomains.includes(domain))) {
    reject("internal_erasure_stage_blocked");
  }
  const requestedAtMs = timeMs(r.requestedAt);
  const eligibleAtMs = timeMs(r.eligibleAt);
  if (!Number.isFinite(requestedAtMs) || requestedAtMs <= 0 ||
      !Number.isFinite(eligibleAtMs) ||
      eligibleAtMs < requestedAtMs + GRACE_MS ||
      nowMs < requestedAtMs + GRACE_MS || nowMs < eligibleAtMs) {
    reject("internal_erasure_grace_not_elapsed");
  }
  // Recheck ALL six current certificates, including appeal/retention holds,
  // expiry and immutable audit, before invoking ANY existing erasure stage.
  const signed = await Promise.all(REQUIRED_ERASURE_ADMISSION_DOMAINS
    .flatMap(domain => [
      db.get(certificatePath(requestId, domain)),
      db.get(certificateAuditPath(requestId, domain)),
    ]));
  for (let i = 0; i < REQUIRED_ERASURE_ADMISSION_DOMAINS.length; i++) {
    try {
      validateErasureDomainSignoff(signed[i * 2], signed[i * 2 + 1], {
        uid, requestId, domain: REQUIRED_ERASURE_ADMISSION_DOMAINS[i],
        requestedAtMs, nowMs,
      });
    } catch {
      reject("internal_erasure_certification_invalid");
    }
  }
  const args = { uid, requestId, limit };
  let result;
  if (step === "notifications") {
    result = await drainAccountOwnedNotifications(db, { ...args, nowMs });
  } else if (step === "push_devices") {
    result = await drainAccountPrivateCallPushDevices(db, { ...args, nowMs });
  } else if (step === "diary_likes" || step === "diary_views") {
    result = await drainAccountDiaryInteractions(db, {
      ...args, kind: step === "diary_likes" ? "likes" : "views", nowMs,
    });
  } else {
    result = await drainAccountPrivateTextPage(db, {
      ...args, conversationId, cursor, now: new Date(nowMs),
    });
  }
  if (result?.ok !== true || result.completionVerified !== false) {
    reject("internal_erasure_unverified_batch_result", 503);
  }
  return {
    ok: true, step, checked: result.checked,
    erased: result.erased ?? result.redacted ?? 0,
    duplicate: result.duplicate ?? 0,
    hasMore: result.moreInPage ?? result.hasMore ?? false,
    nextCursor: step === "private_text" ? result.nextCursor : null,
    // Cursor exhaustion or one verified batch is NEVER proof of deletion.
    stageCompleted: false, completionVerified: false,
    accountErased: false, firebaseAuthDeleted: false,
  };
}
