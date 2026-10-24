# Shadow Live — exact-object R2 voice HEAD reconciliation (internal / read-only)

The preceding voice metadata inventory (#501) verifies Firestore's owned
`private_voice_objects/{32 hex}` documents, linked draft and sent
message. It cannot tell whether the **actual R2 object** exists.

`inspectPrivateVoiceR2Object(db, bucket, {uid,requestId,objectId,actor})`
checks precisely ONE already enumerated object per explicit invocation.
Only after validating current deletion request/checkpoint, independent
Owner authorization supplied by a **future separately authenticated
caller**, non-Owner target, no legal/retention/review/evidence holds,
exact owner UID and object ID, canonical storage path
`private-voice/{conversationId}/{ownerUid}/{objectId}.wav`,
two-person conversation, draft or sent message and
`content_filter_flags/{messageId}`, does it call
**`bucket.head(canonicalKey)` exactly once**.

Never call `bucket.list`, `bucket.get`, `bucket.delete`, presign,
Firestore writes, Firebase Auth deletion, timers or R2 uploads.
The output contains only object ID, coarse state and three booleans:
`storagePresent`, `sizeMatches`, `mimeMatches`. It includes
`needsReview` for missing/mismatched files and does **not** expose
storage keys, counterpart UID, contents, headers, raw R2 errors or
download URLs. Provider errors fail closed (503); a legitimate absent
object is review-required, **not** proof of deletion.

This is **integrity reconnaissance, not permission to erase**.
`exhaustive:false`, `completionVerified:false` and
`erasureAllowed:false` apply even when size/MIME match and for
missing objects. R2 listing/orphan discovery, legacy metadata not
indexed by owner, voice operations, 90-day moderation evidence,
financial/billing approvals, retention decisions, storage cleanup,
resumable finalizer and Firebase Auth deletion as the final step all
remain independent gates. There is no HTTP route or production caller
and `destructiveAllowed` remains false.

Unit tests exercise owner/request/field/route holds, draft/sent
linkage, mismatch, empty/malformed/error HEAD, no byte access;
disposable Firestore Emulator integration tests preserve a second
participant's message, financial balances, conversation preview,
evidence markers and legal cancellation.
