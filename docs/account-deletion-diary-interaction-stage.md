# Shadow Live — guarded diary interaction erasure (internal / OFF)

`eraseDeletedDiaryInteraction(db,{uid,requestId,diaryId,kind})` is
a **single-record**, fail-closed primitive for the deleted account's
canonical `diary_likes/{diaryId}__{hexUtf8(uid)}` or
`diary_view_keys/{diaryId}__{hexUtf8(uid)}` document. Kinds are
`likes` and `views`; the writer's ID convention is verified by
constructing this exact path. There is NO public route, cron, Owner
button or scheduled erasure executor. **Production remains disabled**.

Every Firestore transaction reads the current deletion request,
erasure checkpoint, account user, exact interaction record and original
diary. Destructive action is permitted in isolated tests **only if all
of the following are already set by a separately trusted finalizer**:

- Current matching request ID and UID, `status=processing`, user state
  `deletion_processing`; never an Owner or Auth-deleted account.
- Exact `checkpoint.phase=diary_interactions` and
  `destructiveAllowed=true`. The deployed preflight/admission never
  sets this flag true.
- Independent `diaryInteractionRetentionCleared=true`,
  `legalEvidenceReviewComplete=true`, and
  `historicalDiaryCountersReviewed=true` stage certificates. This
  module **does not create** these certificates or waive review.
- No review, legal, retention, deletion, evidence, investigation, or
  report hold on the request, checkpoint, user, target record **or
  original diary**.
- The interaction record must say the same `userUid`, `diaryId`;
  its original diary must exist with a valid owner. Unrecognized extra
  interaction fields block cleanup for legacy schema review.

The transaction deletes **only this one interaction document**; it
cannot change the other person's diary, likeCount, viewCount,
comments, gift counts, support/wealth rankings, wallet balances,
purchases, ledger entries, reports or R2 content. Historical
`likeCount`/`viewCount` therefore remain unchanged **by this
primitive**; an independent policy/consistency review must decide how
aggregate counters should behave before production approval.
A nonexistent interaction record is an idempotent no-op after the
stage gate; unknown schemas and held source diaries fail closed.

Unit and disposable Firestore Emulator integration tests verify
counterparty isolation, no aggregate or financial mutations, exact
UID ownership, held evidence, cancellation, approval failures, race/
retry idempotency, legacy fields and network failures.

**Remaining before production erasure:** exhaustive and legacy index
coverage, real retention and aggregate signoffs, shared ownership,
financial/Google Play/legal review, protected voice/media/R2 handling,
resumable stage checkpoint orchestration, Firebase Auth LAST and a
verified non-PII completion receipt. Neither an empty inventory page
nor a successful single-record primitive certifies completion.
