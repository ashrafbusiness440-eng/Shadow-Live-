// INTERNAL ONLY: an opt-in certification recheck for a record-erasure transaction.
// NOT wired to a stage, route, scheduler or production checkpoint. It does not
// certify underlying legal/financial evidence or authorize deletion by itself.
// The caller MUST use the same Firestore transaction for these reads and for
// its guarded mutation, and must check request/user/checkpoint/record holds there.
import {
  REQUIRED_ERASURE_ADMISSION_DOMAINS,
  validateErasureDomainSignoff,
  erasureDomainWithdrawalAuditPath,
} from "./account-deletion-processing-admission.js";

// Accept Firestore Timestamp, ISO string or Date without trusting a client clock.
const toTimeMs = value => {
  if (value instanceof Date) return value.getTime();
  if (typeof value?.toDate === "function") return value.toDate().getTime();
  if (typeof value === "string") return Date.parse(value);
  const seconds = Number(value?.seconds ?? value?._seconds);
  return value && Number.isFinite(seconds) ? seconds * 1000 : NaN;
};

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
  uid, requestId, requestedAtMs, requestedAt, nowMs,
} = {}) {
  uid = clean(uid);
  requestId = clean(requestId);
  // Keeping timestamp normalization here avoids multiple stage-specific policies.
  if (requestedAtMs === undefined) requestedAtMs = toTimeMs(requestedAt);
  if (!db || typeof db.get !== "function" || !tx ||
      !validUid(uid) || !validId(requestId) ||
      !Number.isSafeInteger(requestedAtMs) || requestedAtMs <= 0 ||
      !Number.isSafeInteger(nowMs) || nowMs < requestedAtMs) {
    blocked();
  }
  const paths = REQUIRED_ERASURE_ADMISSION_DOMAINS.flatMap(domain => [
    "account_deletion_erasure_approvals/" + requestId + "__" + domain,
    "admin_audit_logs/erasure_domain_cert_" + requestId + "__" + domain,
    erasureDomainWithdrawalAuditPath(requestId, domain),
  ]);
  // Production adapter supports transactional batchGet; one RPC instead of
  // twelve serial remote calls. Mocks fall back to the identical exact reads.
  const records = typeof db.getMany === "function"
    ? await db.getMany(paths, tx)
    : await Promise.all(paths.map(path => db.get(path, tx)));
  if (!Array.isArray(records) || records.length !== paths.length ||
      records.some(row => !row || typeof row.exists !== "boolean")) blocked();
  for (let i = 0; i < REQUIRED_ERASURE_ADMISSION_DOMAINS.length; i++) {
    try {
      validateErasureDomainSignoff(records[3 * i], records[3 * i + 1], {
        uid, requestId, domain: REQUIRED_ERASURE_ADMISSION_DOMAINS[i],
        requestedAtMs, nowMs, withdrawal: records[3 * i + 2],
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
