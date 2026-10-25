// INTERNAL ONLY: an opt-in certification recheck for a record-erasure transaction.
// NOT wired to a stage, route, scheduler or production checkpoint. It does not
// certify underlying legal/financial evidence or authorize deletion by itself.
// The caller MUST use the same Firestore transaction for these reads and for
// its guarded mutation, and must check request/user/checkpoint/record holds there.
import {
  REQUIRED_ERASURE_ADMISSION_DOMAINS,
  validateErasureDomainSignoff,
} from "./account-deletion-processing-admission.js";

const clean = value => String(value ?? "").trim();
const validUid = value => /^[A-Za-z0-9_-]{3,128}$/.test(value);
const validId = value => /^[A-Za-z0-9_-]{12,180}$/.test(value);

export class AccountErasureTransactionalCertificationError extends Error {
  constructor() {
    super("erasure_transactional_certification_blocked");
    this.code = "erasure_transactional_certification_blocked";
    this.status = 409;
  }
}
const blocked = () => {
  throw new AccountErasureTransactionalCertificationError();
};

/**
 * Call BEFORE any write in a stage's *same* Firestore transaction.
 * Transactional reads make an approval revocation concurrent with this
 * transaction conflict/retry (subject to the Firestore adapter semantics).
 * This routine DOES NOT independently grant a lease or enable production.
 *
 * This is deliberately separate from the runner's existing read-only preflight:
 * that preflight does not protect the interval until an actual stage mutation.
 * Production use requires integrating this check in every guarded record stage
 * and testing real Firestore transaction conflicts before turning deletion ON.
 */
export async function recheckErasureCertificatesInTransaction(db, tx, {
  uid, requestId, requestedAtMs, nowMs,
} = {}) {
  uid = clean(uid);
  requestId = clean(requestId);
  if (!db || typeof db.get !== "function" || !tx ||
      !validUid(uid) || !validId(requestId) ||
      !Number.isSafeInteger(requestedAtMs) || requestedAtMs <= 0 ||
      !Number.isSafeInteger(nowMs) || nowMs < requestedAtMs) {
    blocked();
  }
  const records = await Promise.all(REQUIRED_ERASURE_ADMISSION_DOMAINS
    .flatMap(domain => [
      db.get("account_deletion_erasure_approvals/" + requestId +
        "__" + domain, tx),
      db.get("admin_audit_logs/erasure_domain_cert_" + requestId +
        "__" + domain, tx),
    ]));
  for (let i = 0; i < REQUIRED_ERASURE_ADMISSION_DOMAINS.length; i++) {
    try {
      validateErasureDomainSignoff(records[2 * i], records[2 * i + 1], {
        uid, requestId, domain: REQUIRED_ERASURE_ADMISSION_DOMAINS[i],
        requestedAtMs, nowMs,
      });
    } catch {
      blocked();
    }
  }
  return Object.freeze({
    validAtTransactionRead: true,
    validatedDomains: REQUIRED_ERASURE_ADMISSION_DOMAINS.length,
    destructiveAllowed: false,
    completionVerified: false,
  });
}
