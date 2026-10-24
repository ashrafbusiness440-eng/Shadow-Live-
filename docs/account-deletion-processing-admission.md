# Account erasure — certified processing admission (internal / OFF)

The already deployed Owner preflight is strictly `preflight_blocked` with
`destructiveAllowed=false`. This next internal stage allows *only* an
audited, non-destructive transition to `processing_admitted`. It does
**not** launch an erasure executor, authorize any individual deletion stage,
revoke Firebase Auth, mutate financial balances, touch reports, or delete R2.

## Certification contract

`admitCertifiedAccountErasure(db, { uid, requestId, actor, nowMs })`
requires an independently authenticated Owner caller. There is **no**
endpoint/cron for it, and production users cannot invoke it.

The current `account_deletion_requests/{uid}` must have `review_ready`,
a strictly matching request ID, requestedAt and eligibleAt dates that
establish **at least 30 actual days elapsed**, and no review/legal/retention
hold. `users/{uid}` must be in a known not-yet-deleted state (`active`, `suspended`, `banned`, or `disabled`), not Owner and not Auth-deleted. Moderation restrictions never waive the six certifications or legal holds; the previous state is recorded as `priorAccountStatus` on the checkpoint so it is not silently lost. A suspended/banned user retains the right to request erasure subject to lawful evidence retention. The
matching `account_deletion_erasure_checkpoints/{uid}` must still have
`phase=preflight_blocked` and `destructiveAllowed=false`. Never reset an
advanced checkpoint or cross deletion request lifecycles.

All **six independently verified review domains** must already have a
matching signoff and immutable audit record:

| Domain | Required independent verification |
|---|---|
| `financial_settlement` | balances, gifts, wallet, agency settlement, refunds and ledger |
| `play_billing` | purchases, refunds, chargebacks and retention |
| `moderation_legal` | unresolved reports, appeals, legal/evidence holds |
| `shared_assets` | ownership of shared rooms, agencies, media and chat rights |
| `content_storage_inventory` | complete indexed enumeration plan and unknown legacy fields |
| `retention_policy` | lawful basis, duration, privacy access and eventual purge |

Each `account_deletion_erasure_approvals/{requestId}__{domain}` record needs
`uid`, `requestId`, `domain`, `decision=approved`, `signedByUid`,
`signedAt` after the deletion request and before admission, and an
`expiresAt` in the future. It is paired with
`admin_audit_logs/erasure_domain_cert_{requestId}__{domain}` having
`action=accountErasureDomainCertified` and the **same signer, user,
request and domain**. A missing, expired, conflicting or held certificate
blocks the transition. **Neither certificates nor audits can be created by
this module**: a separate, permission-checked Owner-reviewed process must
issue them only after the underlying evidence really is verified.

If all six certificates pass, one transaction updates: request `processing`,
user `deletion_processing` plus session revocation timestamp, checkpoint
`processing_admitted` with **destructiveAllowed=false**, and one immutable
`accountErasureProcessingAdmitted` audit. A retry cannot duplicate the audit
or regress advanced stages. Network/transaction failure leaves no partial
admission. No new listeners, scheduled scans, or wide queries are added.

## Explicit blockers to go live

The signing backend/UI and real domain verification evidence do not exist
yet, so this stage cannot be safely invoked in production. The future
resumable processor still needs per-domain indexed cursor discovery, per-stage
certification and checkpoint progression, retention enforcement, legal
review, verified R2 exhaustion, Firebase Auth **last**, and completion
receipt only after proof. End-to-end disposable account and emulator tests
must pass before enabling any destructive flow. Until then, production
preflight remains blocked and no real account is erased.

## Investigation and active-report holds (24 October 2026)

Admission now rejects **both** `investigationHold=true` and
`reported=true` on the current deletion request, checkpoint and
user document, as well as on **every** independent domain approval
certificate and its matching immutable administrative audit entry.
These markers are treated as review blockers, not automatically
resolved evidence. Any such hold keeps the request in
`review_ready` and the checkpoint at `destructiveAllowed=false`.

Cancellation or evidence review cannot be bypassed merely because
financial or storage signoffs exist. On repeated calls after admission,
a newly recorded investigation or report hold also denies the
duplicate processing transition. Unit tests exercise the six domains
and the account-level gates; Firestore Emulator tests cover late
holds on a previously admitted request. This is an **additional
fail-closed safeguard** and does not implement automatic signing,
settlement, actual erasure, R2 deletion or Firebase Auth deletion.
