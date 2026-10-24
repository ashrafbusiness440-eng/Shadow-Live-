# Shadow Live — read-only discovery of comments on other users' diaries

The current `diaries/{diaryId}/comments` hierarchy is owned by **diary**,
not by the comment author's UID. Thus scanning only
`users/{deletedUid}/diaries` cannot find comments left by this person
on a third party's diary.

`inspectAccountCrossDiaryComments(db, {uid,requestId,actor,cursor,limit})`
performs a **read-only**, explicitly Owner-gated, bounded scan of
`diary_operations` filtered by `actorUid == uid`, ordered by document
name (ascending), `limit + 1`, maximum **five** records per call.
`cursor` is the previous verified operation ID. A single operation
can be safely skipped if it is not `action=createComment`, but the
caller must continue through all pages to avoid missing later comments.

For a `createComment` operation, the writer supplies its source diary ID
and `result.commentId`. This inspector uses **exact** `get` operations
to verify the current diary owner, comment author and any
`content_filter_flags/{commentId}` retention marker. It exposes
only operation/diary/comment IDs, a Boolean for a comment written on
someone else's diary, presence and review flags — never comment body,
report evidence, user avatar, balances or R2 keys. A mismatched current
comment author is an immediate error; missing/legacy records or retained
evidence are marked `needsReview`, never presumed cleaned.

An independently authorized Owner caller is required. The existing
production deployment does not expose this inspector through any route,
timer or UI. Its current request/checkpoint guard rejects cancellation,
stale request IDs, protected holds and Owner-target accounts.

**This inventory is not exhaustive.** The `diary_operations` journal
can miss early or legacy comments, deleted operations or other writers.
Other people's diary/comments and their original content must never be
erased indiscriminately. Financial gifts, notification snapshots,
diary likes/mentions, media, reporting evidence and exact retention
policy remain distinct approval gates. Every result returns
`exhaustive:false`, `completionVerified:false`,
`erasureAllowed:false`; no Auth deletion, R2 cleanup, destructive
checkpoint or completion receipt can be issued from these results.

CI runs Node unit tests and Firestore Emulator integration tests over
disposable synthetic data, including cursor paging, other-author
preservation, protected evidence and cancellation.
