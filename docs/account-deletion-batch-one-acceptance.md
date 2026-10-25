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
- **Still blocking**: the direct private-text redaction primitive now
  rechecks all six independently audited signoffs in the **same Firestore
  transaction** as its masked text/preview write, and rejects incomplete
  transactional reads. Node and disposable Emulator positive/negative tests
  are required, but this is **not** authorization to run the phase.
  The *internal dispatcher still rejects this step unconditionally*, even
  with otherwise valid synthetic approvals. A production-equivalent
  simultaneous approval-revocation conflict, independent retention/legal
  evidence clearance, stage lease/recovery and operator acceptance remain
  required before any release or completion credit.
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

### Gate 1: no premature R2 job completion or holder bypass

The existing test-only account R2 consumer previously deleted a queue job and
wrote `completeDeletedAccountStorageCleanup` after seeing a single indexed
page shorter than the batch limit. Page exhaustion is **not** an account-wide
inventory certificate: shared room/agency ownership, legacy references,
concurrent creations and unknown external outcomes may remain. That
unsound completion path has been removed. Even after a successful final
short or empty page, the job is preserved, no `complete...` audit is
minted, and the call returns `pendingReconciliation:true`,
`completionVerified:false` and a blocked reason. This does NOT
claim that the earlier test-only object deletion path is externally safe.

The low-level queue verifier also re-reads the non-permissive
request-wide coordination-hold document in the **same Firestore
transaction** as the stop intent, queue audit and current six
approval certificates. If the hold exists, the worker refuses to
enumerate objects at all: a bookkeeping hold is not a bucket-delete
permit. Tests verify both the short-page/empty-page false-completion
regression and holder-blocks-before-R2 behavior. This protection does
not implement a release of the held operation, a trusted execution
lease, or a verified recovery path. Production scheduled account-R2
cleanup remains HARD OFF.

### Gate 1: immutable uncertain external-I/O outcome journal (internal-only)

The **unrouted** account-erasure external-I/O coordination implementation now
records a request-wide, create-only `account_erasure_external_io_uncertain_attempts`
journal for a previously reserved object and its claimed non-permissive hold,
using the same Firestore write transaction as the current account/request,
asset, admission, reservation, hold, stop-intent, and **twelve current
approval/audit records**. Only the exact token and object from that hold
may create it. A mismatched token, missing hold, revoked signoff, hold,
incomplete transaction read, duplicate writer or earlier Owner stop
rejects the attempt **without writing**.

This entry conservatively means the external outcome may now be unknown,
*not* that R2 was actually invoked or succeeded. Its immutable fields
`state:"outcome_unknown_requires_reconciliation"`,
`retryAllowed:false`, `externalIoAllowed:false`,
`completionVerified:false` cannot be changed by a timer, crashed worker
or a second claimant. The Owner's stop-intent writer reads this journal in
the same Firestore transaction, records `uncertainAttemptObserved` in both
the pending stop and its audit, but **never declares the stop effective**.
The journal survives the stop and needs independent outcome reconciliation.

Node tests cover stop-first, stop-after, duplicate, token mismatch,
revocation and damaged batch snapshots. A disposable Cloudflare REST +
Firestore Emulator test exercises persisted unknown-outcome and Owner stop
with separate adapter calls. The journal does **not** grant permission to
call `bucket.delete` or provide a production-equivalent lease, cancellation,
acknowledgement, known R2 result, real-bucket proof, or authenticated human
reconciliation. No live worker calls it. The scheduled account-erasure
R2 route stays HARD OFF; fixed gates 1/2/3/5 remain OPEN.

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

PR #348 is frozen and must never be modified. Use only the approved GitHub Pages/Cloudflare hosting. Do not rebuild APK
per backend change. Reuse shared policies rather than copy-paste guards.

## Internal external-I/O reservation prototype — not a production lease

The module `account-deletion-external-io-reservation.js` is an unrouted,
unscheduled and **non-permissive** single-object reservation. Its exact
Firestore transaction checks request, checkpoint, account, storage object,
original admission audit and twelve independent signoff records before a
unique create-only reservation (no overwrite, no automatic expiry reclaim).
It cannot call R2, change room/agency ownership, clear a hold, or return an
external-I/O permit; its persisted `externalIoAllowed` is always `false`.
Synthetic-only unit tests cover two racing callers, duplicate reservations,
holds, admission mismatch and approval revocations.

This is a necessary but not sufficient component of gate 1. A real
revocation writer and R2 worker must honor a mutually exclusive durable
fence, plus require operator reconciliation of ambiguous external outcomes
before any retry or lease release. **No production R2 deletion may rely on
this prototype.** The live R2 worker has NOT been connected to it, so this
addition cannot be misinterpreted as solving the external side-effect race.

## Extra acceptance: exact R2 queue retry and native reservation competition

All retries of the R2 cleanup-job enqueue now revalidate the **current**
six independent approval/audit pairs before returning duplicate success,
even when the prior job was consumed. Unit and Firestore Emulator tests
cover a late revoked Play/other domain approval without creating another job
or emitting a misleading success.

The disposable native Admin Firestore transaction tests use a test-only
adapter to call the actual `reserveAccountErasureExternalIo` function
through `runTransaction` with Firestore read locks and create-only
preconditions. They prove no more than one of two competing workers can
reserve the same object and that a pre-revoked approval blocks reservation.
The test bridge is never used in Cloudflare production. The live REST
Firestore transaction semantics, dual-writer revocation interlock and
external bucket deletion remain separate unpassed acceptance gates.

## 25 October 2026 — fail-closed live R2 scheduler and revocation intent

On pending PR #527 (NOT merged/deployed), the existing live scheduled
`runDueStorageCleanup` now invokes an explicitly fenced account-erasure
cleanup wrapper. `ACCOUNT_ERASURE_R2_FENCE_READY=false` makes the entire
account-erasure storage queue non-destructive even if a forged/old checkpoint
has `destructiveAllowed=true`. Normal replacement/expired-ticket cleanup
does not consume this new account-erasure switch. Node source/runtime tests
assert zero account-erasure reads, writes or bucket deletes.

The existing UNROUTED external-I/O reservation now transactionally reads
**seven exact current-state documents** (including a request-specific,
immutable revocation-intent marker) followed by the same twelve audit and
approval records. When an Owner-only internal stop intent is created via
`requestAccountErasureExternalIoRevocationIntent`, it and its immutable
audit are written atomically. It blocks **NEW** reservations even when a
synthetic signoff is subsequently restored. REST/Emulator and Node coverage
exercise this marker without external R2 access.

CRITICAL: the intent's `revocationEffective` is **always false**. It is
NOT an approval revocation, does NOT cancel in-flight `bucket.delete`,
does NOT automatically release timed-out/ambiguous work, and has no live
admin route. Real revocation writers, an in-flight holder protocol and
explicit reconciliation still must be integrated and proven. No one may
flip `ACCOUNT_ERASURE_R2_FENCE_READY` or `destructiveAllowed` on the
strength of these tests. First-batch gates **1/2/3/5 remain open**.

### Gate 1 incremental safety verification (still NOT accepted)

The request-specific revocation-intent document must be read as one of the
**seven** exact Firestore transaction snapshots used by any new object
reservation. A malformed seventh slot (missing, null, non-boolean `exists`)
must fail closed, not look like a missing stop request. Node regressions
assert no writes in these cases. Actual Cloudflare REST + Firestore Emulator
acceptance additionally checks that an Owner stop intent recorded *after*
one reservation blocks reserving a **different** object, even if a synthetic
approval is subsequently restored. This is NOT a proof of external side
effect cancellation.

The existing account-cleanup queue verifier also checks the same durable
pending intent inside its bounded read-only Firestore verification
transaction, before it may enumerate storage objects, before each object
and before completion. A held or malformed response rejects the job. The
existing shared `accountDeletionHasActiveHold` policy is reused instead
of maintaining another separate hold list. This is defense-in-depth:
the scheduled account-erasure R2 path remains independently disabled by
`ACCOUNT_ERASURE_R2_FENCE_READY=false`, while ordinary unrelated storage
maintenance remains unaffected.

Still missing: an independent actual approval-revocation writer; a durable
in-flight holder barrier with cancellation and crash/timeout reconciliation;
safe storage/agency disposition; authorized reviewer evidence; plus verified
private-text transactional concurrency and release evidence. **No live R2 delete,
approval release, Firebase Auth deletion or final completion receipt.**

The *unrouted* paginated private-text page preflight also validates the
same request-specific original admission audit, checkpoint/account identity,
and the 30-day grace and eligibility dates **before scanning even one private
message**. Its inner message mutation independently rechecks all six current
approval/audit pairs transactionally, so a subsequent revocation still
stops writes. Fail-closed unit tests assert malformed or missing admission
and an unelapsed grace cause zero private-message query or mutation.
The dispatcher remains disabled and cannot issue a completion certificate.

### Gate 1: private-message direct mutation guard now implemented — dispatcher OFF

The internal, **UNROUTED** `redactDeletedPrivateTextMessage` now requires in
its very own Firestore write transaction: exact matching request and
checkpoint/account identity, an immutable original
`accountErasureProcessingAdmitted` audit for this UID/request with all six
independent certified domains, the valid 30-day grace and eligibility time,
a clear held-status check, the message/conversation/evidence snapshots,
and twelve current signoff + immutable audit documents via the existing
shared certification helper. All seven primary rows must be returned
explicitly by one transaction-scoped `batchGet`; truncated results fail
closed. The stage refuses to touch any message when the admission
record is absent, mismatched, held, or the grace period has not elapsed,
even if an old checkpoint was forged `destructiveAllowed:true`.
A disposable Cloudflare REST + Firestore Emulator test proves absence of
the original admission blocks text modification and that revoking Play
billing approval after a first synthetic tombstone stops a second
message without changing the counterparty's text or wallet. Existing
native Emulator and paginated tests use disposable, fully synthetic
admissions and certificates, not real reviewer authorizations.

This is a concrete guarded code path, **NOT release approval**. The internal
phase dispatcher still rejects `private_text` unconditionally; no new
API, scheduler, actual account deletion, certificate issuer, Auth removal,
or false completion receipt is introduced. Real reviewer evidence, a
durable resumable stage mechanism and full reconciliation remain blockers
under fixed gates 1/2/3/5.

### Gate 1: batchGet transport-row completeness (not a go-live signal)

The actual Cloudflare Firestore REST `getMany` previously synthesized
`exists:false` for a requested path omitted by a malformed or truncated
HTTP `documents:batchGet` response. In particular, an omitted
`account_erasure_external_io_revocation_intents` row could be mistaken
for an explicitly missing revocation-intent document. The shared adapter
now requires **one unique, matching found/missing row for every requested
document**, allows arbitrary response order, and rejects incomplete,
duplicate, mixed found-and-missing, or unrelated rows. This distinguishes
a legitimate absent stop marker from a failed transport response.
Regression tests check each case in the shared Firestore reliability suite.
The change also protects other consumers of this reusable Firestore adapter;
it adds no scans, new external services or background work.

This is additional fail-closed defense for the *unmerged* branch. It
does not implement in-flight external-I/O cancellation, authorize deletions
or override any of the outstanding four gate blockers.

### Gate 1: request-wide non-permissive coordination hold (still NOT a lease)

The unmerged PR #527 adds a **create-only, never-auto-expiring,
request-specific coordination hold** in
`account_erasure_external_io_coordination_holds`. An internal-only
holder may record one such document only after the matching single-object
reservation exists and the same transaction verifies its immutable token,
current account/request/checkpoint/asset/admission state, all twelve
audited signoff documents and the absence of a stop intent. A second
holder, including a holder for a different object under that request, is
denied pending human reconciliation. The stop-intent writer atomically
checks this very same hold path before recording an immutable pending
stop, and records only whether it observed a hold. The reservation
writer also checks the request-wide hold in its transaction: a claimed
hold blocks **new reservations for ANY object** under that request even
before a stop is requested. Missing or malformed transaction slots
fail closed. Both writers coordinate via Firestore transaction read-set
conflict plus create-only preconditions, with no polling and at most
eight exact primary document reads followed by twelve signoff reads.

Unit and disposable Cloudflare REST + Firestore Emulator coverage
verifies repeated holders, invalid tokens, malformed hold snapshots,
cross-object reservation attempts under an existing hold, already-pending
stops and a preexisting hold followed by an Owner stop. The marker is deliberately
**non-permissive**: `externalIoAllowed:false`,
`revocationEffective:false`, and `completionVerified:false` are
immutable. No call to R2 or Firebase Auth, no production caller, no
scheduled task, no automatic expiry takeover and no automatic release
are introduced. A missing coordination hold proves nothing about
possible legacy in-flight external work. An observed hold does not
certify that an R2 operation started or finished.

**Still NOT passed:** this marker is NOT the external-operation lease.
A genuine external side-effect worker must coordinate its actual
`bucket.delete` with the approving/revoking administrator, durable
acquisition/acknowledgment, crash/unknown-outcome handling, conflict
verification on two independent workers, disposable real-bucket
acceptance and human-audited reconciliation. Until all of that and
the other gate evidence is satisfied, production account deletion
and R2 erasure remain OFF, all four gates remain OPEN.

### Gate 1: private-text record transactional signoff gate (still NOT accepted)

On unmerged PR #527 the **unrouted direct** private-message text tombstone
primitive now fetches seven exact request/checkpoint/user/chat/message/
moderation-flag/original-admission-audit snapshots in a single transaction-scoped `getMany` when
available, rejects truncated/malformed reads, and reuses the shared
six-domain, twelve-record audited-certification checker **inside the same
transaction** as the masked message/preview write. An independently revoked,
missing, expired or appealed approval blocks both a new redaction and
a tombstone retry. Bounded paginated message tests use disposable synthetic
approval fixtures; no actual reviewer decision or production signoff is
generated. Counterparty messages, balances, content-filter evidence and
media remain untouched by this text-only primitive.

**The internal phase runner stays hard-blocked** with
`private_text_erasure_transaction_guard_missing` (legacy conservative
release-blocker identifier), because a passing primitive test alone does
NOT establish legal release, production transaction conflict safety, stage
leases, all legacy text schema reconciliation or Auth-last completion.
Do not remove this hard block or report private-text erasure ready.
This is additional defense and test preparation, not a go-live signal.
