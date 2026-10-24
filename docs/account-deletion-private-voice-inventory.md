# Shadow Live — private voice/R2 ownership inventory (internal, READ-ONLY)

Current voice-note writer (`private-voice-media.js`) creates
`private_voice_objects/{32-hex-id}` with `ownerUid`,
`otherUid`, `conversationId`, `storageKey`, size, MIME,
duration and state. Pending/uploaded objects have a related
`private_voice_drafts/{id}`. When a note is sent, a
`conversations/{conversationId}/messages/{voice_id}` document
refers to `storageObjectId`, while the draft is removed.

`inspectAccountPrivateVoicePage(db,{uid,requestId,actor,cursor,limit})`
reads at most **five** indexed `ownerUid == uid` object records,
ordered by document name with an explicit cursor. It checks exact
drafts, two-party conversation membership and, when sent, the exact
message and `content_filter_flags/{messageId}` evidence marker.
It requires a current matching deletion request/checkpoint, an
Owner-authenticated external caller, and no request/account legal
hold. **There is no HTTP route or scheduled caller.**

The output contains only opaque object IDs, coarse state,
linked-message/draft presence, evidence-marker presence and
`needsReview` flags. It deliberately never returns any R2 storage
key, audio data, presigned URL, conversation text, recipient UID,
financial balances or private evidence. Unknown schema fields,
wrong ownership/path, mismatched message metadata, missing draft,
unknown source chat, evidence holds and `deleting` states are
marked for independent manual review. A malformed indexed owner
identity is rejected outright.

**No R2 operations are performed** — not `list`, `head`,
`get`, `delete`, and no Firestore writes or Auth changes.
The current separate expired-draft cleanup cron can transition a
draft to `deleting` and remove its R2 object; this read-only inventory
may observe intermediate states but never asserts completion.

An empty indexed page never certifies:
- older `private_voice_objects` lacking `ownerUid`;
- orphaned R2 objects without Firestore metadata, legacy media,
  voice operations, object/message IDs or cross-account attachments;
- protected report evidence/90-day retention, legal, billing and
  financial settlement signoffs;
- a verifiable exact-R2 deletion outcome or subsequent Auth-last.

Accordingly every response sets `exhaustive:false`,
`completionVerified:false` and `erasureAllowed:false`.
There is still **no production account deletion executor** and
`destructiveAllowed` remains false. Separate validated R2 manifest,
preservation policy, legal review and auditable finalizer are required
before any real voice file can be removed.

Node and disposable Firestore Emulator tests cover five-item paging,
draft/sent message linkage, evidence markers, invalid owner and path,
wrong recipient and held account, absence of mutations and protection
of the counterparty's data.
