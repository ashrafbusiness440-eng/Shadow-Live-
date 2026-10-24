# Private calls and voice notes when an account is erased

Existing mutual-follow eligibility uses exactly eight point reads for calls
and nine for voice-note uploads; no additional read or polling is added.

Before permitting a new call, answering an incoming call, refreshing
credentials, continuing call heartbeats, or operating voice-note upload /
playback, the server rejects a party whose current `users/{uid}` document has
`accountStatus` in `deleted`, `deletion_completed`, or
`deletion_processing`, or whose `authDeleted` /
`deletionProcessing` markers are true. The error
`private_voice_account_deleted` returns HTTP 409. Heartbeat eligibility
failure triggers the existing interrupted-call cleanup.

A user with a `pending` or `review_ready` deletion request is not
automatically denied during the 30-day cancellation period. The finalizer
must revoke live sessions and call slots when it really enters processing.

This is a server-side access guard, not deletion of old voice messages,
R2 media, call history, evidence or signed financial records. The
separately verified erasure engine still has to process those in
bounded, resumable phases subject to retention and legal holds.
