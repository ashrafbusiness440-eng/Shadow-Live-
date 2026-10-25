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
