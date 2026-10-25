# Account deletion — batch 1 final acceptance (fixed gates 1, 2, 3, 5)

**State on 25 October 2026: NOT ACCEPTED.** This is a reproducible
release-blocker register for the EXISTING four first-batch gates, not four
new development tracks and not an authorization to delete accounts.
Never infer a successful review from fixture approvals or a green CI run.

## Gate 1 — execution safety and independent approval revocation

- Parent PR #526 and dependent PR #527 must pass exact-head Flutter CI,
  Firestore Emulator and R2 checks; review and merge **in dependency order**.
  Do not use a merge workaround if a safety policy rejects the merge.
- Seven existing record/queue write paths use a common six-domain
  audited-signoff recheck in their own Firestore transactions. The existing
  bounded R2 job consumer independently verifies current state/approvals
  before querying records, before each object and before claiming completion.
- **Still blocking**: the direct private-text redaction primitive is not
  guarded within its transaction. The *internal dispatcher now rejects this
  step unconditionally*, even with otherwise valid synthetic approvals;
  no completion credit for text erasure. A targeted guarded change plus
  Node and Firestore Emulator conflict tests must precede re-enabling it.
- **Still blocking**: R2 `bucket.delete`/room-asset transfer is external to
  a Firestore transaction. The approving/revoking administrator and the
  cleanup executor must share a durable lease/fencing interlock (including
  expiry, crash recovery and unresolved/ambiguous outcomes). Approval
  revocation may not silently race an in-flight deletion. Prove on Emulator
  and the actual Cloudflare REST Firestore adapter with a disposable bucket.
- The finalizer needs monotonic stage receipts, bounded resumable batches,
  no skipped legacy schemas, explicit account-wide reconciliation, Firebase
  Auth removal *LAST*, and a genuine completion receipt only once every
  proof is checked. None of these are certified by this first batch.
- **Production remains OFF:** no new delete route, cron, mobile APK or
  destructiveAllowed=true is permitted by this record.

## Gate 2 — financial settlement and Google Play Billing

Review **all pages** of the already implemented eight exact indexed financial
scopes: `purchase`, `ledger`, `ledger_counterparty`,
`ledger_counterparty_group`, `gift_sender`, `gift_recipient`,
`wallet_sender`, `wallet_recipient`. Check counterpart balances,
unfulfilled obligations, disputes, pending refunds/chargebacks, and the
Play purchase-token-to-ledger association. A `credited` purchase or no
rows in one index does not certify settlement; historical ledgers remain
immutable and counterparty value is never erased to settle an account.
An authorized responsible reviewer must record the relevant settlement
evidence and only then provide the matching per-request signoffs
`financial_settlement` and `play_billing` with immutable audits. This
repository does not provide a verified independent signoff issuer; never
generate test signatures as real approvals.

## Gate 3 — rooms, agencies and shared ownership

Exhaust pages of `rooms_owner_uid`, `rooms_legacy_owner_id` and
`agencies_owned`; reconcile agency membership pair, owner roles,
outstanding agency obligations, linked room images, assets and historic
wallet/wealth/gift rights. Distinguish a file uploader from a room owner:
transfer live shared media only after authorized transfer and preserve
counterparty ownership. Known legacy aliases and unindexed references
require independent reconciliation. Do not infer zero owned assets from
an empty single query. Require documented approved ownership disposition,
then the independent `shared_assets` approval and audit. No automatic
closure/transfer is authorized by this file.

## Gate 5 — appeals, report/image evidence and retention

Exhaust the existing four report reference scopes `reporter`, `target`,
`legacy_reporter`, `legacy_target`, plus diary-report mirrors, image
moderation appeals, held voice/chat/media and old records. Retained
evidence follows its existing **90-day period after final disposition**,
not upload or account-deletion time. Pending appeals, disputes, legal,
investigation and evidence holds prevent destruction regardless of due date;
Owner-only release requires an independently audited decision. A valid
retention due date does not itself authorize erasure. Require separate
`moderation_legal`, `content_storage_inventory` and
`retention_policy` review evidence and immutable approvals.
The read-only review modules intentionally return `exhaustive:false`.

## Acceptance evidence required before marking batch 1 complete

1. Merged, independently reviewed SHA(s) on `main` with green post-merge
   CI; exact source links and current actual Cloudflare deployment proof.
2. Negative tests: missing/expired/revoked/appealed signoff; account/legal
   holds; stale request; duplicate/restart; corrupted legacy rows; R2
   revocation during external work; two independent workers, exact-object
   ownership and no other user's money/messages/media affected.
3. Independent, request-specific financial/Play and shared-ownership
   reconciliation, with signed author/audit/date/evidence references.
4. Independent legal/report/appeal/90-day preservation clearance and media
   reconciliation, with no evidence bytes exposed in audit or Control.
5. No claim of production account deletion, Firebase Auth completion or
   practical two-account acceptance at batch-one signoff. Those are later
   gates of the fixed **eight-gate** project closure plan.

**Status: all four first-batch gates remain OPEN until the above has
evidence.** Existing source tests are safety improvements, not approvals.
Related original Trello cards:
https://trello.com/c/O1o7gn2s
https://trello.com/c/z0zPEz0j
https://trello.com/c/gKZWJQVp

PR #348 is frozen and must never be modified. No Vercel. Do not rebuild APK
per backend change. Reuse shared policies rather than copy-paste guards.
