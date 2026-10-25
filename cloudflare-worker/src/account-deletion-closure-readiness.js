// INTERNAL read-only readiness review for the current account deletion request.
// Owner authentication / recent sign-in must be enforced by the calling route.
// A structurally matching domain approval NEVER proves a real settlement,
// ownership transfer or statutory clearance. This module cannot issue approvals.
import { accountDeletionHasActiveHold } from "./account-deletion-active-holds.js";
import {
  REQUIRED_ERASURE_ADMISSION_DOMAINS,
  validateErasureDomainSignoff,
  AccountErasureAdmissionError,
  erasureDomainWithdrawalAuditPath,
} from "./account-deletion-processing-admission.js";

const clean = value => String(value ?? "").trim();
const uidOk = value => /^[A-Za-z0-9_-]{3,128}$/.test(clean(value));
const requestOk = value => /^[A-Za-z0-9_-]{12,180}$/.test(clean(value));
const GRACE_MS = 30 * 86400_000;
function timestampMs(value) {
  if (value instanceof Date) return value.getTime();
  if (typeof value?.toDate === "function") return value.toDate().getTime();
  if (typeof value === "string") return Date.parse(value);
  const seconds = value?.seconds ?? value?._seconds;
  return typeof seconds === "number" && Number.isFinite(seconds)
    ? seconds * 1000 : NaN;
}

export class AccountClosureReadinessError extends Error {
  constructor(code, status = 409) {
    super(code); this.code = code; this.status = status;
  }
}
const reject = (code, status) => {
  throw new AccountClosureReadinessError(code, status);
};
const approvalPath = (requestId, domain) =>
  "account_deletion_erasure_approvals/" + requestId + "__" + domain;
const auditPath = (requestId, domain) =>
  "admin_audit_logs/erasure_domain_cert_" + requestId + "__" + domain;

/**
 * 3 exact account reads + at most 18 exact certificate/audit/withdrawal
 * reads; never scans or leaks signer UIDs, evidence, ledger or customer data.
 * Only a CURRENT, due, non-held review_ready / preflight_blocked request
 * can have domain documents checked. Empty/inaccessible documents are blockers.
 * Even six structurally valid certificates cannot enable destructive stages.
 */
export async function inspectAccountDeletionClosureReadiness(db, {
  uid, requestId, actor, nowMs = Date.now(),
} = {}) {
  uid = clean(uid);
  requestId = clean(requestId);
  if (!actor?.owner || !uidOk(actor.uid)) reject("owner_required", 403);
  if (!uidOk(uid) || !requestOk(requestId) ||
      !Number.isSafeInteger(nowMs) || nowMs <= 0) {
    reject("invalid_closure_readiness_target", 400);
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
      clean(request.data?.status) !== "review_ready" ||
      clean(checkpoint.data?.phase) !== "preflight_blocked" ||
      checkpoint.data?.destructiveAllowed !== false ||
      clean(user.data?.role) === "owner" ||
      !["", "active", "suspended", "banned", "disabled"].includes(
        clean(user.data?.accountStatus)) ||
      user.data?.authDeleted === true ||
      accountDeletionHasActiveHold(request.data) ||
      accountDeletionHasActiveHold(checkpoint.data) ||
      accountDeletionHasActiveHold(user.data)) {
    reject("closure_readiness_review_blocked");
  }
  const requestedAtMs = timestampMs(request.data.requestedAt);
  const eligibleAtMs = timestampMs(request.data.eligibleAt);
  if (!Number.isFinite(requestedAtMs) || requestedAtMs <= 0 ||
      !Number.isFinite(eligibleAtMs) ||
      eligibleAtMs < requestedAtMs + GRACE_MS ||
      nowMs < requestedAtMs + GRACE_MS || nowMs < eligibleAtMs) {
    reject("closure_readiness_grace_not_elapsed");
  }
  const documents = await Promise.all(REQUIRED_ERASURE_ADMISSION_DOMAINS.flatMap(
    domain => [
      db.get(approvalPath(requestId, domain)),
      db.get(auditPath(requestId, domain)),
      db.get(erasureDomainWithdrawalAuditPath(requestId, domain)),
    ],
  ));
  const domains = REQUIRED_ERASURE_ADMISSION_DOMAINS.map((domain, i) => {
    const approval = documents[i * 3];
    const audit = documents[i * 3 + 1];
    const withdrawal = documents[i * 3 + 2];
    let certificateDocumentsValid = false;
    if (approval?.exists && audit?.exists) {
      try {
        validateErasureDomainSignoff(approval, audit, {
          uid, requestId, domain, requestedAtMs, nowMs, withdrawal,
        });
        certificateDocumentsValid = true;
      } catch (error) {
        if (!(error instanceof AccountErasureAdmissionError)) throw error;
      }
    }
    return {
      domain,
      certificateDocumentsPresent: Boolean(approval?.exists && audit?.exists),
      certificateDocumentsValid,
      // A matching signature is not proof that the underlying financial,
      // legal, storage, retention and ownership work was actually performed.
      independentEvidenceReviewRequired: true,
    };
  });
  const structurallySignedDomains = domains.filter(
    domain => domain.certificateDocumentsValid).length;
  return {
    ok: true,
    phase: "preflight_blocked",
    domains,
    structurallySignedDomains,
    totalRequiredDomains: REQUIRED_ERASURE_ADMISSION_DOMAINS.length,
    // This endpoint is a *read-only administrative checklist*, not a
    // signoff issuer, transaction, or executable admission/finalizer.
    independentEvidenceVerified: false,
    legacyDataExhaustivelyVerified: false,
    processingAdmitted: false,
    destructiveAllowed: false,
    erasureAllowed: false,
    completionVerified: false,
    firebaseAuthDeleted: false,
  };
}
