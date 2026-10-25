# Certified R2 cleanup queue — internal erasure stage

The existing `runDeletedAccountStorageCleanup` Worker already performs
bounded object processing, including legal evidence archival and shared-room
or agency asset ownership transfer. Its queue is
`storage_account_cleanup_jobs`.

`queueAccountDeletionR2Stage` is an **internal, unrouted** one-job
queue adapter. It can only create a job for one exactly matching current
deletion request when all these server-owned conditions are true:

- Request status `processing` with current `requestId`.
- Account status `deletion_processing` and account role not Owner.
- Checkpoint phase `storage_media`, `destructiveAllowed=true`.
- Signoffs `storageRetentionApproved`,
  `sharedMediaOwnershipReviewed`,
  `legalEvidenceReviewComplete`, `financialSettlementApproved`,
  and `playBillingReviewComplete` all exactly `true`.
- No legal, deletion, review, retention, evidence, investigation, report,
  or pending-appeal holds on request, checkpoint, or account.

The adapter writes `storage_account_cleanup_jobs/{uid}` and an immutable
`admin_audit_logs/r2_deletion_queue_{requestId}` certificate in one
Firestore transaction. A job cannot be re-created after the existing
cleanup worker consumes it: the audit marker stops duplicate retry.
Mismatched legacy jobs or conflicting audits fail closed.
No global scans, network polling, new cron, R2 API calls, or Firebase Auth
actions are introduced by this adapter.

**Current state:** No production entrypoint sets the above
`destructiveAllowed` or approvals, so this code cannot queue real
deletions today. Enabling it requires completed evidence and shared media
ownership review, refund/payment settlement and independent legal
authorization. The existing cleanup routine still needs a verified
completion/reconciliation certificate before the main erasure executor
can remove Firebase Auth. A queued job alone is not proof of R2 erasure.

Unit tests and Firestore Emulator tests validate hold/cancellation
fail-closed behavior, exactly one queue job, idempotent retries even after
the queue row is consumed, and no user balance changes.

## Defense in depth: the existing R2 worker also verifies the queue job

The existing hourly `runDeletedAccountStorageCleanup` now independently
checks the job's reason, request ID, and queued status, then makes exactly
four direct Firestore reads for the current deletion request, checkpoint,
user, and immutable audit certificate. It rechecks the current processing
request, Owner protection, five required financial/media/legal reviews,
and all deletion/legal/review/retention/evidence/report/investigation/
appeal holds **before** querying
`storage_objects` or touching R2 bytes.

A legacy `account_deleted` job without certification is blocked.
Unsupported/malformed jobs are left in place for manual Owner
investigation; the worker does **not** silently drop them, authorize
deletion, or begin new polling. As a result, an oldest invalid queue
item can halt the queue until resolved; this is deliberate fail-closed
behavior and must be surfaced through operational review.

The individual-object retention/archive and shared room/agency transfer
rules still apply. Preflight validation is not sufficient to guarantee
that a hold cannot change during a long external bucket operation.
The verified finalizer must keep the account in its storage-media phase
until cleanup has completed, avoid concurrent release of review holds,
and validate the completion record before proceeding to Auth deletion.
\n## Additional legal hold gates (25 October 2026)\n\nBoth the internal queue-stage transaction and the hourly worker now block\n`evidenceHold`, `investigationHold`, `reported`, `appealPending` and\n`appealStatus` in `pending`, `open` or `under_review` on the current\nrequest, checkpoint or user. This also applies to queue retries if the\nhold appears after an earlier administrative approval. No R2 media query,\ndelete, or removal of a consumed queue certificate is permitted during\nthese holds. Unit and Emulator tests cover stale/late holds. The adapter\nstill has **no production entry point**; `destructiveAllowed` remains\nfalse in the live lifecycle.\n
## Verified queue consumer — seven-domain? No: exactly six independent certification domains (25 October 2026)

The hourly `runDeletedAccountStorageCleanup` consumer now goes beyond the
existing queue-audit/checkpoint preflight: its
`verifyAccountStorageCleanupJob` reads the current request, checkpoint,
account and immutable queue audit **in a Firestore transaction**, then
uses the same shared audited **six-domain** certification guard as the
internal erasure stages. Missing, expired, revoked, held or disputed approvals
fail closed *before* querying owner-scoped storage metadata.

The bounded consumer rechecks this job and six certifications **before every
object** and **before** deleting the job and recording its completion audit.
If the certification is withdrawn partway through the page, the remaining
objects are not processed and the cleanup job remains for later review.
No new cron, timer, global scan or listener; existing 25-object maximum
remains in place. This adds bounded read cost per candidate object.

**Important limitation:** a Firestore read transaction cannot atomically
hold authorization across an external `bucket.delete` or an agency/room
asset-transfer operation. There is still a possible revocation interval
*within a single object operation*. A durable finalizer lease and matching
revocation/interlock contract must be tested before production erasure can
ever be enabled. Queue exhaustion does not certify removal of legacy,
unindexed or legally protected R2 records. This hardening does NOT change the
live `destructiveAllowed=false`, create a production delete route, issue any
legal/financial/Play approvals, or remove Firebase Auth.

The worker's unit tests now cover missing independent certifications,
a revocation after the first object that must prevent later deletions and
completion receipt, plus preservation of existing room/agency ownership
transfers and immutable support/financial history. A CI source regression
requires all three consumer rechecks to remain wired.
