# Gate 1 — R2 fixture dispatch / stop-ordering acceptance (2026-10-25)

**Scope: runnable internal-only synthetic fixture, not production R2 authorization.**

`rehearseAccountErasureR2Dispatch` adds a functional external I/O
rehearsal on the existing PR #527. It reuses the immutable reservation,
request-wide coordination hold, pinned-key uncertain-attempt journal,
admission audit and six independently audited certificates. It reads the
Owner's stop intent in the **same Firestore transaction** as the immutable
fixture dispatch marker; any prior stop blocks before a bucket call. Once
the dispatch marker commits, an Owner stop can only be recorded as pending,
never represented as successfully canceling an external operation which
may already have started.

The dispatch marker persists *before* one call to `bucket.delete`. A thrown
or timed-out call returns outcome unknown, with no automatic retry. A
successful return remains unverified; no object/page/account completion
receipt, no Firebase Auth deletion, and no revocation-effective flag.
Only pinned keys under `erasure-fixture/` are eligible; non-fixture keys
fail closed. The function is intentionally **unrouted and not imported by
the existing Worker scheduler**, whose `ACCOUNT_ERASURE_R2_FENCE_READY`
remains `false`.

The separate Node tests cover: exactly one fixture delete, durable
duplicate blocking, a stop before dispatch, stop during `bucket.delete`,
uncertain timeout and rejection of real-shaped keys/revoked signoffs.
These are synthetic results, **not production approvals or proof of a
live Cloudflare R2 lock**.

**Release blockers still outstanding**: the actual all-revocation-writers
interlock (including financial, Play, legal and shared-media signoff
withdrawals), crash and transaction conflict acceptance on the Cloudflare
REST adapter, independently reviewed exhaustive R2 ownership inventory,
human evidence-based reconciliation and a separate real test bucket.
The existing production Worker remains hard OFF until those conditions
are satisfied. Gates 1, 2, 3 and 5 remain OPEN; PR #526 dependency and
PR #348 freeze unchanged.

## Transactional signoff withdrawal / stop writer

`withdrawAccountErasureDomainWithExternalIoStop` is a concrete
internal-only Firestore transaction coordinating **one of the six independent
signed approvals** with the matching request-wide R2 stop. In one transaction
it reads the current request, checkpoint, account, signed approval and audit,
the stop/audit pair, any hold/uncertain attempt, and the fixture dispatch
journal; then it revokes the approval for *new dispatches*, creates an
immutable domain-withdrawal audit, and creates the stop intent and stop audit
if no earlier valid stop exists.

The fixture dispatch transaction also reads the stop record and all six
approval/audit pairs before creating its own dispatch marker. Firestore's
transaction conflict ordering prevents a stop committed first from issuing a
new dispatch. If the fixture dispatch committed first, its single external
call might already be running, so the later stop remains
`pending_reconciliation` and `revocationEffective:false`.
A withdrawal is allowed even if a legal hold or certificate expiry exists:
neither must prevent an emergency stop. Duplicate/invalid requests fail
closed rather than overwriting immutable audit entries.

Unit regression tests and a disposable Firestore Emulator integration test
using the real Cloudflare REST transaction adapter verify withdrawal while a
**synthetic bucket.delete callback** is in flight, no retry and no false
completion. These tests are not evidence of Cloudflare's actual R2 network
side effects or ownership reconciliation. The withdrawal writer is unexposed:
no real admin route or all-signoff writer migration is yet deployed, and the
fixture executor accepts only `erasure-fixture/` keys. No production
`bucket.delete` is enabled.

### Still required to close Gate 1

Actual approval-revocation call sites (all six domains) and owner operations
must be migrated to the same protocol, tested against true simultaneous
Firestore transactions and real test-bucket R2 failures. A human-controlled,
evidence-based post-crash reconciliation mechanism and all legal, finance,
Play Billing, and shared-media gate approvals remain missing. The observed
`head` presence/absence or fixture call acknowledgment alone can never
close an R2 outcome or certify account deletion.


## Non-destructive post-interruption reconciliation CASE (25 October 2026)

`openAccountErasureExternalIoReconciliationCase` introduces the first
bounded, immutable *operational reconciliation classification* from the
existing stop + unknown-outcome journal + two persisted R2 read-only HEAD
observations. It is internal-only, unexposed and not invoked by the R2
scheduler or finalizer. Unlike treating a HEAD result as a receipt, this
function requires a recorded Owner stop first and **two distinct observations
after the stop in chronological order**, checks the unchanged pinned key and
request/object/token/reservation/hold/stop identity, and writes one case plus
a separate audit in a single Firestore transaction. A missing metadata row
does not lose the pinned R2 identity; a *changed* metadata key fails closed.

The case branches on the **most recent observed state**, NOT on a presumed
historical outcome:

- `object_present_requires_non_destructive_resolution`: the key was
  observed present at the second HEAD; manual review must decide a safe
  disposition without automatically deleting it.
- `absence_does_not_prove_historical_deletion`: the key was observed absent
  at the second HEAD; this does not prove an earlier delete succeeded,
  exclude replacement/re-creation or complete any account inventory.

The case is always `awaiting_independent_evidence_review` with
`retryAllowed:false`, `externalIoAllowed:false`,
`completionVerified:false`, and `revocationEffective:false`. Opening
the case never marks the original attempt, queue job, or Owner stop as
complete. It never calls R2, never reinstates signoffs and never triggers
Firebase Auth deletion. The Owner can open a case after a signoff was
withdrawn; expired/revoked certificates must not block *non-destructive*
incident response. Duplicates and mismatched request, key, stop, token,
probe ID or observation ordering fail closed.

Unit and **actual Cloudflare REST adapter + disposable Firestore Emulator**
tests exercise post-stop HEAD evidence, immutable case and audit creation,
duplicate rejection, changed key and failed/altered probe evidence.
No production reviewer decisions, provider audit evidence, R2 test-bucket
delete or final deletion proofs were fabricated.

**Gate 1 remains OPEN.** Before any independent reviewer can ever
declare a previously ambiguous R2 side effect resolved, they must establish
provider-side operation history/object generation and ownership/retention
evidence; a two-HEAD case alone is not a completion certificate, permission
to retry, or grounds for declaring a stop effective. All real financial,
Google Play, shared assets, legal/90-day retention reviews and signoff writer
coordination remain separate release blockers. No production switch changed.


## Immutable withdrawal tombstone enforcement

Every one of the six certificate checks now reads THREE exact transaction
documents: original signed approval, signed certification audit, and the
`admin_audit_logs/erasure_domain_withdrawal_<requestId>__<domain>`
**immutable withdrawal tombstone**. A missing tombstone must be explicitly
observed as `exists:false`, rather than silently skipped or treated as
missing data. Its existence permanently blocks re-use of that domain
certification for the same deletion request even if a separate actor
incorrectly edits `decision` back to `approved` and original audit remains.
The owner-only admission transaction, destructive stage transaction guard,
and non-destructive closure checklist now enforce the SAME boundary.

This prevents silent approval resurrection; it does not replace authorized
independent signoff issuance, emergency stop writers, real provider evidence,
or production release gates. Existing request-wide stop still blocks R2
dispatch, and no production R2/Auth deletion is enabled.


## Immutable independent external-I/O evidence assessment (internal-only)

The reconciler can now attach **one** immutable, separately audited
*assessment* to an already opened manual R2 case via
`recordAccountErasureExternalIoIndependentReview`. This helper is not
routed or scheduled. The invoking adapter must later prove the reviewer's
rights from a server-authenticated, scoped authorization record. It cannot
accept browser-provided `actor.evidenceReviewer` as authorization.

The assessment enforces independent personnel: the reviewer must not be
the reconciliation case creator, the Owner who filed the stop, or either
original R2 HEAD observer. It reads the current case, original case audit,
stop+audit, uncertain attempt, hold, reservation, account request and
checkpoint in one Firestore transaction, then re-reads **both immutable
post-stop HEAD observations in the same transaction** to reject tampered
tokens, paths, flags or observer identities. Its sole mutations are a
create-only independent review and separate audit record. Repeated
assessments fail closed.

Only three unresolved categories may be recorded:
`insufficient_provider_evidence`, `external_history_discrepancy`, or
`provider_evidence_submitted_unverified`. Even the latter reports only
that an external evidence fingerprint was *submitted*; it does not prove
that such evidence is authentic, that Cloudflare performed any particular
operation, or that the object has been permanently deleted. The only
input evidence identifier is a 64-character lowercase SHA-256 hex digest.
No raw evidence, storage object keys, free text, bucket credentials,
external URLs, payment information or report content is copied to the
review or audit.

Every review has `status:"independent_review_recorded_still_unresolved"`,
`providerHistoryVerified:false`, `evidenceAuthenticityVerified:false`,
`canCertifyErasure:false`, `retryAllowed:false`,
`externalIoAllowed:false`, `completionVerified:false` and
`revocationEffective:false`. The Owner stop, uncertain journal and open
case remain unchanged. Human review is an input to, NOT a substitute for,
provider-side external operation evidence, generation checks, shared
ownership/retention signoffs or an independently justified final
resolution. Live production R2 deletion and Firebase Auth deletion remain
hard disabled.

Unit tests cover independence, duplicates, malformed digest and fake
"confirmed" assessments, changed/missing case/stop/HEAD evidence, withdrawn
certificates and still-unresolved outcomes. An actual Cloudflare Firestore
REST adapter / disposable Firestore Emulator integration confirms a
separate reviewer assessment cannot transform a pending case into a
delete receipt, R2 replay permission or effective stop.

**Still blocking Gate 1:** securely implementing the actual reviewer
authorization and evidence vault, confirming independent Cloudflare R2
provider logs/object generations against an isolated explicitly authorized
test bucket, coordinating all real approval issuers and revocation writers,
and a reviewed finalizer. None are asserted complete by this fixture.
