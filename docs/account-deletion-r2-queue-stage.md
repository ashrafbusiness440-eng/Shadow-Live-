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
- No legal, deletion, review, or retention holds on request, checkpoint,
  or account.

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
