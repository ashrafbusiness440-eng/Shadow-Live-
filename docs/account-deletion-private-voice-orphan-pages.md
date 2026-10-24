# Shadow Live — bounded private voice R2 orphan inventory (READ-ONLY, OFF)

The single-object R2 HEAD integrity checker (#502) cannot discover
audio uploaded to R2 whose Firestore metadata is missing. This
**separate, internal-only** inventory searches precisely the verified
prefix `private-voice/{conversationId}/{deletedUid}/`, based on the
current voice-note writer. It is NOT a global R2 bucket scan.

`inspectPrivateVoiceOrphanPage(db,bucket,{uid,requestId,conversationId,actor,cursor,limit})`
checks an externally authenticated Owner, current deletion request and
checkpoint, non-Owner account, current retention/legal/review holds and
membership of the deleted account in an exact two-person conversation.
Only then does it make **one** scoped `bucket.list({prefix,limit,cursor})`
call, with `limit <= 5`. The next cursor is returned for a **separately
invoked** page. No polling, background scheduling or unbounded scans.

Every returned R2 key must be exactly the canonical 32-hex-ID
`private-voice/{chat}/{deletedUid}/{objectId}.wav` within this
prefix. Results outside the scope, malformed IDs, duplicate IDs,
invalid cursors or R2 provider errors **fail closed**. At most five
exact Firestore `private_voice_objects/{id}` reads then identify
missing metadata and legal/ownership mismatches. A metadata owner
claiming another UID is rejected; metadata absent or inconsistent with
the canonical key/conversation is flagged `needsReview`.

Output contains only object IDs, metadata-presence flags, review
flags and an internal pagination cursor: no storage key, media bytes,
other user's UID, source conversation message, presigned URL, or
financial data. It performs no R2 get/head/delete, no Firestore
mutation, no Auth deletion, no automatic cleanup stage.

**Limitations:** This finds only one conversation's canonical R2 prefix
per explicit call. Other conversations, old storage layouts, legacy
unindexed Firestore docs, hidden objects, evidence retained 90 days
and financial/Play billing approvals remain unverified. Every page
returns `exhaustive:false`, `completionVerified:false`, and
`erasureAllowed:false`, even when the page is empty. The future
finalizer must establish complete coverage and lawful retention
independently before any production deletion.

Node and disposable Firestore Emulator tests cover five-record paging,
orphan detection, escaping from the prefix, malformed/duplicate R2 keys,
ownership conflicts, cancellation and legal holds, no writes and
counterparty data preservation.
