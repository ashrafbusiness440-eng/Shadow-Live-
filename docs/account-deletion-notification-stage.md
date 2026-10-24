# Account deletion — own-notification cleanup (internal only)

`notifications/{id}` is a shared top-level Firestore collection, with a
`userId` identifying the recipient. Never delete all notifications by actor,
report, diary or conversation ID: such a delete may destroy another account's
independent event history.

`eraseDeletedAccountNotification(db, {uid, requestId, notificationId})`
removes exactly one **already enumerated** notification document only when
its `userId` matches the deleted account and the certified checkpoint is
`phase=notifications`, `destructiveAllowed=true`. Requires the current
processing request, matching IDs, non-Owner `deletion_processing` user,
`notificationRetentionCleared=true`, `legalEvidenceReviewComplete=true`,
`financialSettlementApproved=true`, and no review/legal/retention/evidence
hold on any participating record. Missing notification is idempotent. A
counterparty's record is never deleted. There are no collection-wide queries
or scans in the primitive.

**Still open:** The finalizer must enumerate relevant notification IDs through
small indexed batches, recheck after completion for concurrent changes,
identify all legacy recipient schemas, audit each batch, and separately
anonymize references to the removed *actor* in surviving recipients'
notifications without changing their legitimate messages or report evidence.
Source reports, financial ledgers and moderation evidence are never touched.
No API or cron calls this stage; production erasure remains disabled.
