# Shadow Live — bounded diary and nested-comment inventory (internal / OFF)

`inspectAccountDiaryErasurePage(db, options)` is an **internal read-only
tool** for the future audited erasure pipeline. It has no public or Control
route, cron, background scan, destructive action, or retention approval.

An independently authenticated Owner will ultimately pass `actor`; the
caller must check the Firebase session, Owner role and recent auth server-side.
Current code does **not** wire an entrypoint, nor does it confer authority
to delete any account.

The routine requires the exact current `account_deletion_requests/{uid}`
and `account_deletion_erasure_checkpoints/{uid}` request ID, review-ready or
processing status, a non-Owner target, and no review/legal/evidence holds.
It rejects stale requests, rotations and malformed cursors **before queries**.

- `kind: "diaries"`: one indexed, ordered page of at most five rows from
  `users/{uid}/diaries`; each selected ID is cross-checked against its exact
  `diaries/{id}` document. Missing global mirrors are reported for review,
  not asserted erased. Ownership conflicts fail closed.
- `kind: "comments"`: one indexed page of at most five
  `diaries/{diaryId}/comments` rows, only after checking both original and
  user diary mirror are owned by the account being deleted. Each comment is
  marked `authoredByDeleted` or **owned by another author**; the latter must
  not be silently erased. Protected comments are flagged for manual review.
- Pagination uses the writer's `createdAtMs desc, __name__ desc` order,
  a validated two-field cursor, and `limit + 1`. The response contains
  identifiers, ownership/retention flags and cursors **only** — no diary
  texts, comment bodies, photos, reporter details, media keys or balances.

At most one query and five exact source document lookups per page, plus
bounded request/user/checkpoint reads; no collection-group/wide scans.
Every result forces `exhaustive: false`, `completionVerified: false`,
`erasureAllowed: false`. Even exhausting these cursors cannot certify
complete discovery: comments **written by the deleted user on somebody
else's diary**, legacy missing mirrors, likes, mentions, moderation reports,
notification copies, storage references and linked financial records require
separate approved inventories. No Auth deletion, R2 erasure or progress
checkpoint may be inferred from these pages.

Unit and Firestore Emulator tests cover pagination, counterparty content,
misowned mirrors, legal holds, corrupted legacy authors, cancellation and
absence of destructive side effects. Only disposable emulator data is used.
