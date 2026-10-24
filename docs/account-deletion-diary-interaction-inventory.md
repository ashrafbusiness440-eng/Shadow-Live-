# Shadow Live — account deletion: read-only diary like/view inventory

The deletion pipeline must locate a deleted account's interactions with
**other users' diaries** without deleting those users' content or adjusting
historical totals. The actual `diaries.js` writer stores:

- `diary_likes/{diaryId}__{hexUtf8(uid)}`, fields `userUid`, `diaryId`.
- `diary_view_keys/{diaryId}__{hexUtf8(uid)}`, fields `userUid`, `diaryId`.

`inspectAccountDiaryInteractions(db, {uid,requestId,actor,kind,cursor,limit})`
is a **purely read-only**, internal, unexposed utility. `kind` is
`likes` or `views`. It reads at most **five** documents from exactly
one indexed collection per invocation, filtered by `userUid == uid`
and ordered by document name. Pagination uses `limit + 1` with an
explicitly validated document-name cursor, plus one exact source-diary
lookup per selected record. It does not perform collection-group scans,
global Firestore scans, timers, listeners or any writes.

A future independently authenticated Owner caller must verify session,
Owner role and recent authentication before invoking this method.
The utility also requires the current, matching deletion request and
checkpoint, a review-ready or processing request, and no current
review, evidence, legal or retention holds. It rejects Owner account
deletion. Neither production admin APIs nor schedules call it.

Results include document ID, diary ID, presence, whether the interaction
relates to another person's diary, and review flags. They exclude text,
image URLs, names, purchase data, retention evidence and raw content.
Missing source diaries, unexpected old document IDs and holds are flagged
for review rather than interpreted as successful erasure. A row with the
wrong userUid, an invalid diary ID or a malformed page fails closed.

**Mandatory caveat:** old records missing the `userUid` field are not
discoverable by this index, and journal-only detection cannot cover
`diary_view_keys` because views do not write `diary_operations`.
The future approved inventory must independently review legacy cases,
diary notifications, references, reports, and account-linked mirrors.
Every page returns `exhaustive: false`, `completionVerified: false`,
`erasureAllowed: false`, even with an empty result. No stage transition,
retention signoff, financial mutation, Firebase Auth deletion or R2
cleanup is authorized.

Unit and disposable Firestore Emulator tests verify both indexed
collections, page cursors, two-user isolation, preserved counters,
stale/cancelled deletion requests, legal holds, and legacy review flags.
