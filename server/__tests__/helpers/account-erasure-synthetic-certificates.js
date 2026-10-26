// Synthetic, disposable test-only certification fixtures. NEVER use in runtime
// authorization, real account approvals or production seeding.
import { REQUIRED_ERASURE_ADMISSION_DOMAINS as domains }
  from "../../../cloudflare-worker/src/account-deletion-processing-admission.js";

export function syntheticErasureCertificateRows({
  uid, requestId, nowMs = Date.now(),
  ownerUid = "synthetic_owner_123456",
} = {}) {
  return domains.flatMap(domain => [
    ["account_deletion_erasure_approvals/" + requestId + "__" + domain, {
      uid, requestId, domain, decision: "approved",
      signedByUid: ownerUid,
      signedAt: new Date(nowMs - 10_000),
      expiresAt: new Date(nowMs + 86400_000),
    }],
    ["admin_audit_logs/erasure_domain_cert_" + requestId + "__" + domain, {
      action: "accountErasureDomainCertified", actorUid: ownerUid,
      targetId: uid, requestId, domain,
      createdAt: new Date(nowMs - 10_000),
    }],
  ]);
}

export function seedSyntheticErasureCertificates(map, options) {
  for (const [path, data] of syntheticErasureCertificateRows(options))
    map.set(path, data);
  return new Date((options?.nowMs ?? Date.now()) - 40 * 86400_000);
}

export async function seedEmulatorErasureCertificates(store, options) {
  const entries = syntheticErasureCertificateRows(options);
  const refs = entries.map(([path]) => store.doc(path));
  await Promise.all(entries.map(([, data], index) => refs[index].set(data)));
  return refs;
}
