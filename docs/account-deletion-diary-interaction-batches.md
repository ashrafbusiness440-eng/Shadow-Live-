# Account erasure — restartable diary interaction batches (internal / OFF)

`drainAccountDiaryInteractions(db,{uid,requestId,kind,limit})` reads at
most **five** records of one kind (`likes` or `views`) from either
`diary_likes` or `diary_view_keys`, using the indexed
`userUid == uid` filter and `limit + 1`. It then invokes the already
certified-per-record `eraseDeletedDiaryInteraction` transaction
**sequentially**. There is no route, timer, polling, scheduled sweep,
automatic stage progression or actual production erasure caller.

The function checks exact request ID and UID, processing state,
`phase=diary_interactions`, `destructiveAllowed=true`,
`diaryInteractionRetentionCleared=true`,
`legalEvidenceReviewComplete=true`,
`historicalDiaryCountersReviewed=true`, non-Owner user and no holds
**before querying**. Production checkpoints never have
`destructiveAllowed=true`; this API is not reachable from production.

Every selected page is validated **before deleting its first row**:
the index must return the requested `userUid`, a valid diary ID,
the exact writer-defined `diaryId__{hexUtf8(uid)}` document name,
no duplicate IDs and no protected row. Malformed indexed legacy rows
and evidence holds prevent any of the selected page's deletions.
Each underlying exact-record transaction independently verifies
source diary ownership and holds, so any new hold or conflict stops the
batch rather than affecting another person's diary.

If the third transaction fails after two successful removals, a retry
reads the remaining indexed records. The caller must explicitly make
another bounded request; **there is no automatic loop or background
drain**. No user counts, support points, money, purchase receipts,
other users' records or R2 assets are altered. `completionVerified`
always remains false, including when no rows are found. Indexed
`userUid` queries do not discover historic records lacking that field
or all references; no final receipt or Firebase Auth deletion can
follow merely because this helper returned an empty page.

Unit and disposable Firestore Emulator tests cover 5/5/2 paging,
malformed and held pages, cancelled/stale requests, failed and repeated
transactions, and counterparty financial/count preservation. Real
retention and counter decisions, exhaustive legacy discovery, staged
finalizer, evidence holds, ledger, R2 and Auth-last must be separately
implemented before production use.
