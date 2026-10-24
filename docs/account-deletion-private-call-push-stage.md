# Account deletion — private-call push device token erasure (internal stage)

The pre-existing `private_call_push_devices/{uid}/tokens/{sha256(token)}`
registry contains raw FCM tokens. The separate
`private_call_push_token_owners/{sha256(token)}` index permits atomic ownership
reassignment. During account deletion, remove personal push tokens without
revoking an installation now registered to a different user.

`eraseDeletedPrivateCallPushToken(db, { uid, requestId, tokenHash })` deletes
**at most two known documents** transactionally. A separately certified
finalizer must enumerate the target user's token hashes through small bounded
pages, process retries, certify the entire enumeration has been exhausted,
and then advance the checkpoint. No global scan or implicit discovery occurs
inside this primitive. A stale per-user token is cleaned even when the owner
index already points to a new user; the new owner's binding remains intact.

Required conditions: current `account_deletion_requests/{uid}` request in
`processing`, corresponding checkpoint `phase=push_devices`,
`destructiveAllowed=true`, `notificationRetentionCleared=true`,
`legalEvidenceReviewComplete=true`, matching request IDs, a user in
`deletion_processing` that is not Owner, and no deletion/review/legal/retention
or evidence holds. A mismatched SHA-256 token or malformed ownership row
blocks the entire transaction for manual investigation. Responses never
contain raw FCM tokens.

**Deployment status:** intentionally NOT connected to an HTTP route, cron, or
production deletion executor. Production preflight remains
`destructiveAllowed=false`. This stage does NOT remove general
`notifications`, independently-owned devices, Firebase Auth, media,
financial records or report evidence. Full erasure and legal/Play readiness
remain OPEN. Test using disposable Emulator data only.
