# Shadow Live account deletion — internal bounded stage dispatcher

**Implementation-only; NOT enabled in production.** The user-approved goal
is a fully verifiable account deletion lifecycle, but this isolated component
is **not** a legally or financially certified executor/finalizer.

## Reuse-first implementation

`runCertifiedInternalAccountErasurePage(db, {uid,requestId,actor,step,limit,
conversationId,cursor,nowMs})` uses **existing** guarded modules:

| Step | Delegated stage | Scope |
| --- | --- | --- |
| `notifications` | `drainAccountOwnedNotifications` | max 5 owner-scoped notices |
| `push_devices` | `drainAccountPrivateCallPushDevices` | max 5 owner-scoped device tokens |
| `diary_likes` | `drainAccountDiaryInteractions(kind=likes)` | max 5 indexed reactions |
| `diary_views` | `drainAccountDiaryInteractions(kind=views)` | max 5 indexed views |
| `private_text` | `drainAccountPrivateTextPage` | max 5 sender-scoped text messages, one exact conversation and cursor |

There is **no** `storage_media` stage, R2 queue/delete or Firebase Auth
deletion, and no public route, cron, interval, background worker or hidden
permission switch. The dispatcher never modifies the checkpoint, issues domain
certificates, advances a phase, writes a completion receipt, or labels an empty
page as complete. Results always specify `stageCompleted:false`,
`completionVerified:false`, `accountErased:false` and
`firebaseAuthDeleted:false`.

### Preconditions rechecked for each explicit invocation

- Owner context and valid exact current UID/request ID/step.
- Request `processing`, user `deletion_processing`, non-Owner and not
  Auth-deleted, checkpoint current request with matching phase and
  `destructiveAllowed=true`, no legal/review/evidence/appeal holds.
- Original `accountErasureProcessingAdmitted` audit for the exact request
  and full set of six independently audited admission domains.
- The original **30 full days** have elapsed, regardless of stored eligibleAt.
- Each of the **six** existing domain approval/audit pairs is rechecked via
  `validateErasureDomainSignoff` from the existing processing-admission
  implementation (valid signed-by/actor/request/domain/date, unexpired and no
  hold). A missing/revoked/appealed or expired record blocks all stage work.
- The called stage independently checks its own exact records, phase,
  ownership, evidence and retained financial metadata before each mutation.

Each invocation reads four exact gate documents and twelve exact
certification/audit documents, then performs just one bounded stage page.
The dispatcher deliberately has no looping, scheduling, broad Firestore scans
or external service calls. Previous stages remain reusable and retain their
existing tests and safety behavior.

## Why this is still OFF

The live Owner preflight produces `destructiveAllowed=false`. Even the
internal certified processing-admission helper preserves that value, so
**none of the five dispatched erasure stages is executable on real accounts**.
No route calls this dispatcher. The Firestore Emulator integration test
temporarily seeds disposable synthetic documents with `true` solely to prove
the **existing** bounded notification stage actually cleans up owned data,
preserves a third-party notification and wallet, stops on a freshly opened
appeal, and resumes after the hold clears.

Approval records currently do not attest or verify the real underlying
settlements. Never force `destructiveAllowed` on the basis of a certificate
document alone. Between separate certificate reads and single-record
transactions there is a revocation race, so future production phase leasing
must bind current evidence/approval revisions to the stage transaction.
This dispatcher does not purport to close that race.

### Before live end-to-end erasure

1. Independently verify real financial/Play refund, evidence/legal,
   shared room/agency asset, legacy inventory/R2 and retention decisions.
2. Implement audited revocation-safe phase leasing with bounded durable
   cursors, idempotency and complete coverage of all current and legacy data
   sources, including counterparty-preserving diary and private media cleanup.
3. Independently prove R2 deletion/exhaustion, protected evidence retention
   and ledger history without deleting others' data. No sweep based only
   on a small page or `not_seen`.
4. Delete Firebase Auth **last**, persist a privacy-safe completion receipt
   only after all prior steps are proven, and test interruption/retry/cancel.
5. Perform isolated true two-account practical acceptance, privacy/legal
   and Google Play reviews before enabling production deletion.

Do not replace these approvals by synthetic test data. See
[the Owner closure checklist](account-deletion-closure-readiness.md) for
the six independent domains.

## Security/acceptance tests

Node and Firestore Emulator tests prove blocked production-style checkpoints
cause **zero** deletion, all six approvals must be live on every page,
revoked/appealed certificates block subsequent calls, the indexed
notification stage processes at most five records, retry preserves the
counterparty and financial balances, and no result claims completed deletion.

No Android APK rebuild is required for this Worker-only internal tranche.

## Follow-up: transaction-scoped approval recheck (implementation scaffold, OFF)

`account-deletion-erasure-transactional-cert-gate.js` introduces an internal
`recheckErasureCertificatesInTransaction(db, tx, {uid, requestId,
requestedAtMs, nowMs})` function. It reuses the six existing
`validateErasureDomainSignoff` rules and fetches exactly the twelve approval
and immutable-audit documents with the **supplied transaction**. The function
does not write, lease, issue approval, authorize erasure, create routes or
run a stage; its return explicitly says `destructiveAllowed: false` and
`completionVerified: false`.

This is only a reusable prerequisite for future *same-transaction*,
per-record stage integration. It does **not** yet prevent the documented
post-preflight revocation race: none of the five destructive adapters invokes
the helper and production remains OFF. Before activation, integrate
request/user/checkpoint/target-record hold checks AND this shared six-domain
certification check in the **same stage commit transaction**, prove Firestore
conflict/retry behavior under simultaneous revocation, and implement durable,
audited stage leasing and independent real signoffs. The existing up-to-five
batch size, 30-day grace and no-finalization guard remain unchanged.

## Batch 1 — transactional revocation protection for notification records

The existing **unrouted** `notifications` adapter now rechecks the six
domain approval/audit pairs **inside the same Firestore transaction** that
deletes an exact owned notice. It delegates to the shared transaction helper
from PR #525, rather than reimplementing finance or legal policy. The helper
normalizes the request timestamp, validates all six signoffs and uses
transactional `getMany` (one 12-document batchGet RPC on the production REST
adapter) when supported. An invalid, expired, revoked or appealed signoff
rejects the write. This is independent of and in addition to the runner's
pre-batch checks. The runner forwards its bounded test clock to that stage.

The notification unit tests now seed explicit independently signed synthetic
approval/audit documents and cover revocation of every domain; the emulator
tests cover a revoked approval rejected within an actual Firestore SDK
transaction, as well as existing bounded synthetic cleanup. The SDK test
does **not** prove a deliberately synchronized concurrent update conflict:
perform a separate locking/retry test before production activation.

**NOT A COMPLETED SECURITY GATE OR PRODUCTION APPROVAL.** Other per-record
stages (private chat text, call tokens, diary interactions, social links,
support snapshots and profile) must use this same in-transaction certification
check before their writes; audited phase leasing/retry and independent real
financial/Play/room/agency/legal/retention signoffs remain missing.
No changes were made to financial ledgers, purchase status, room ownership,
appeal holdings, retention rules, Auth or R2. No account erasure was enabled;
`destructiveAllowed=false` remains the only production behavior. No new
route, listener, cron, global scan or APK build.

This is the FIRST implementation item in the **fixed eight closure gates**
(not a new ninth gate). Do not mark the financial, Play, legal or shared
asset decisions cleared just because test fixtures contain approvals.

## Batch 1 continuation — shared transactional guards for push and diary

The already-guarded per-record push-token erasure and diary like/view erasure
now reuse the exact same six-domain Firestore transaction certification check
as notifications (dependent on the separate notification PR #526). The
bounded push and diary page adapters forward an explicit checked time
without changing maximum page size (five), ownership, legal evidence holds,
counterparty protection or account-status rules.

A test-only fixture helper centrally creates 12 disposable domain approval
and audit records. It is NEVER imported into the Cloudflare runtime.
Node regressions cover missing/revoked signoffs, and existing Firestore
Emulator acceptance exercises owned records, idempotent retry and
counterparty preservation. As with #526, the synthetic certificate fixtures
ARE NOT real independent financial/Play/legal/asset/retention approvals.

**This does not yet cover private text, profile, support-snapshot or social
pair writes.** Never claim all per-record races resolved. The private text
stage remains unchanged; no route, cron, live destructive checkpoint, R2
delete, Firebase Auth delete, financial settlement or production activation.
The existing independently reviewed approvals and real concurrent conflict
acceptance are still required for release.

## Additional batch-one per-record guards (profile, relationships, supporter snapshots)

The public profile, exact social-pair and exact supporter-snapshot stage
adapters now each require an independently validated six-domain certificate
and audit-pair check *within their own Firestore write transaction*. They
retain existing account/current-request/checkpoint/role/record-hold checks,
owner/counterparty matching, idempotence and historical support points.
No financial or counterparty history is erased by this extension.

Unit and isolated Firestore Emulator fixtures use synthetic test-only
approvals and verify existing privacy/hold behavior; revoked certificates
are checked before any stage mutation. The test-only fixture must never
be used to issue real approvals.

These safeguards DO NOT automatically admit or execute deletion. The private
text stage remains outside the new stage-level recheck, and real concurrent
revocation conflict acceptance, live independent financial/Play/legal/shared
asset/storage/retention evidence, durable phase leasing, exhaustive inventory
and final Auth deletion remain blocking. Keep production deletion disabled.

## Emulator conflict acceptance — transactional signoff revocation

A separate disposable Firestore Emulator test now creates six synthetic signed
domain approvals and holds an actual Firestore SDK write transaction **after**
its twelve approval/audit reads. A second independent Firestore operation then
commits a revocation before that transaction attempts its owned-notification
delete. The transaction must abort/retry, and on retry the shared validator
must reject the revoked approval. The notification must survive. This
specifically checks the read/write race not covered by merely revoking a
certificate before an initial read. A second unit test confirms one bounded
12-document `getMany(paths, tx)` RPC and that an absent audit fails closed
without a non-transactional fallback.

**Scope:** test-only Firestore SDK/emulator concurrency contract. Deployment
still uses Cloudflare's REST Firestore adapter and its own transactional
batchGet; compare and independently exercise its conflict behavior before
production, especially across retries and ambiguous commits. Other system
gates (finance, billing, shared assets, legal/retention, inventory,
phase leasing, private text, Auth-last) remain unresolved. No production
deletion activation is authorized by this test.

## R2 cleanup queue — revoke-safe enqueue only (not object deletion)

The existing `storage_media` queue adapter now checks the same six approval
and immutable-audit pairs inside its own Firestore transaction before
writing the cleanup job plus audit. A late revocation must reject the enqueue.
Existing job deduplication, content holds, shared ownership, financial and
Play checkpoint checks remain unchanged. The actual R2 object deletion
belongs to another storage worker and is **NOT** made safe or authorized by
this enqueue guard. Recheck approval/retention/ownership in that worker before
any object delete, and prove exact-inventory coverage first.

The fixed seven-stage source audit is executed by Flutter CI and intentionally
records the private-text stage as a remaining exception. CI also runs
disposable queue unit and Firestore Emulator tests. No production deletion
switch is enabled; the completed-account receipt is still not written.
