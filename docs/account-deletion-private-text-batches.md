# Shadow Live — bounded private text redaction batches (internal only, production OFF)

The existing single-document `redactDeletedPrivateTextMessage` primitive can
redact text/animated emoji from the **deleting sender's own message document**
while preserving routing metadata and the other participant's messages.
This module adds a bounded restartable page executor with **no public route,
cron, polling, automatic transitions, Auth deletion, R2 deletion or final
completion receipt**.

`drainAccountPrivateTextPage(db,{uid,requestId,conversationId,cursor,limit,now})`
is restricted to a **specific verified two-person conversation** and
max **five** authored message documents per call. It performs an indexed
`senderId == uid` query ordered by document name, retrieving `limit+1`
records to derive `hasMore`; `nextCursor` must be passed explicitly to
the following page. Since a redacted message remains as a tombstone with
`senderId`, cursor paging is mandatory; delete-and-requery pagination
would repeatedly encounter earlier tombstones.

**Fail-closed gates before the first mutation:**
- Current request and checkpoint IDs, `status=processing`,
  `phase=private_text`, `destructiveAllowed=true` (the live lifecycle
  does not grant this), `privateMessageRetentionCleared=true` and
  `legalEvidenceReviewComplete=true`.
- Account state `deletion_processing`, non-Owner and not Auth deleted;
  no legal, retention, review, deletion, investigation, report, or
  evidence holds on account, request, checkpoint, or conversation.
- Exactly two distinct valid participants, including deleting sender;
  every indexed row belongs to that sender and is addressed to
  the other participant.
- The *entire selected page* has no protected flags, evidence markers
  in `content_filter_flags/{messageId}`, unknown legacy schema,
  media, voice notes, gift/payment or photo references, foreign/old
  tombstones, or unknown fields.

Each exact-message transaction independently rechecks its current request,
checkpoint, account, conversation evidence holds, message ownership and
filter evidence. If a hold appears after one redaction, processing stops.
A failed mid-page attempt is retried with the **same input cursor**:
previously replaced tombstones are no-ops; remaining text is redacted
without changing the counterpart's messages, financial ledgers, virtual
currencies, R2 media or reports. No broad scans.

The result contains only counts and a cursor, no message content or
identities. `completionVerified=false` and `erasureComplete=false`
**always** — including empty pages. Legacy messages lacking
`senderId`, media/R2 objects, shared legal evidence and historic
conversation previews need separate treatment before final erasure.
The general account-deletion executor and independent certified
retention/financial/legal workflow are not yet implemented.

Tests: unit (pagination 5/5/2, duplicates, mid-batch network error,
holds/races, illegal media/schema, no counterpart mutation) and disposable
Firestore Emulator integration (three pages, other participant preserved,
audio evidence and cancellation), both wired to Flutter CI.
