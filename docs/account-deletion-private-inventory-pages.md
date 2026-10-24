# Shadow Live — private chat inventory, bounded and read-only (internal / OFF)

The deletion finalizer cannot rely solely on a `conversations`
`limit:1` existence check. It needs to enumerate owned conversation
links and the account's own messages without reading or destroying
the other person's content. The app's current writers store two-person
conversations in `conversations/{id}` and nested messages under
`conversations/{id}/messages/{id}`.

`inspectAccountPrivateErasurePage(db,options)` is **internal-only**:
- `kind=conversations` retrieves at most five indexed
  `participants array-contains uid` conversation rows, ordered by
  document ID ascending, with an explicit name cursor.
- `kind=authored_messages` requires an **already verified** conversation
  ID with exactly two unique participant UIDs including the deletion
  target. Retrieves at most five indexed `senderId == uid` messages
  within that one conversation, ordered by document ID with a cursor.
  It checks an exact `content_filter_flags/{messageId}` evidence
  marker for each selected message (max five lookups).

The caller must independently authenticate Owner, role, recent
authentication and account-target permissions. This module has NO
HTTP route, Control button, cron, Firestore writes or production
erasure executor. It also rejects mismatched current request and
checkpoint IDs, cancelled accounts, Owner targets and legal/retention
or investigation holds. No global collection scans or listeners.

Results contain IDs and limited classification only. They never
include message text, preview, counterpart UID or name, media URL,
voice-object key, financial payload or report evidence. Text and
animated emoji are `text_candidate` **not automatically approved
for erasure**; wrong-receiver routing or unrecognized legacy text
fields are explicitly flagged for separate review; voice, image, gift, deleted/tombstone and unknown
message types require independent review. Content-filter evidence
flags and per-record holds force `needsReview`.

Even after all cursor pages, the response **always** says
`exhaustive:false`, `completionVerified:false`,
`erasureAllowed:false`. There can be unindexed legacy conversation
memberships, messages with missing senderId, media in R2,
content-filter/legal reports without matching message ID, mirrored
previews, stale notifications and finance events. This inventory
does not perform private-text redaction, authorize retention
approval, touch Auth, execute R2 cleanup or write a completed
receipt. The other person's messages must remain protected.

Unit and disposable Firestore Emulator tests cover two-account
privacy, 5-item pagination, evidence holds, voice/media classification,
stale/cancelled request, malformed membership and no data mutation.
