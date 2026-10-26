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


### Case-scoped reviewer grant and current privilege guard (internal-only)

The independent-review writer now **rejects a naked** `actor.evidenceReviewer`
flag. Before accepting an assessment, in the **same Firestore transaction**
as creating the review and audit it reads:

- `users/<reviewerUid>`: current `adminEnabled:true`, specific
  `reviewAccountErasureR2Evidence` capability, matching UID, and a
  non-deleted / non-banned profile.
- `account_erasure_external_io_reviewer_grants/<targetUid>__<requestId>__<reviewerUid>`:
  exact account, request, object, reviewer and scope; status `active`,
  `revoked!==true`, granted time no older than **one hour** at expiration,
  and not expired when assessed.
- `admin_audit_logs/erasure_external_io_reviewer_grant_<requestId>__<reviewerUid>`:
  matching independent grant issuer UID, object/request/reviewer and exact
  grant timestamp. The issuer's `users/<issuerUid>` record must **currently**
  indicate an active platform Owner, re-read in this same transaction.

A revoked/expired/replaced grant, absent audit, missing admin capability,
demoted issuer or damaged transactional snapshot fails closed. Tests exercise
these refusal paths and a real REST/Firestore Emulator guard: setting a
caller-provided reviewer flag while `adminEnabled:false` never works.

This is not a newly wired capability issuer or proof of cryptographic
session authentication. A future restricted backend route MUST bind the
reviewer's UID to the server-verified Firebase ID token and recent sign-in,
then issue grants only through independently authorized Owner actions with
create-only audits. Existing private test grants are synthetic. **No external
evidence or account erasure is certified here**, and no public HTTP route,
cron, production R2 operation or Firebase Auth deletion was added.


### Bounded REST reviewer grant verification and deadlock-safe tests

The independent reviewer now supplies an **exact expected Owner issuer UID**
to its internal call. The current issuer profile is included in the SAME
initial transactional Firestore REST `batchGet` as the signed grant,
immutable grant audit, current reviewer profile, request and stop.
`grantIssuerUid` is not trusted as authority: it MUST match the
per-case grant's `grantedByUid`, the grant audit actor and a currently
active Owner's existing server profile. Invalid/missing issuer rows fail
closed. This eliminates the additional single-document REST read taken
while holding the transaction. Actual Firebase ID-token authentication
and secure grant issuing remain future release requirements.

The disposable REST Emulator suite also tests a first durable
create-only reservation followed by an independently instantiated
second REST worker which MUST reject a replay. The unbounded direct
dual-REST lock race was isolated away from the multipurpose REST test
because this Emulator can deadlock and spend 85 seconds timing out
without a bucket operation. Actual simultaneous worker conflicts
remain tested by a dedicated native Firestore Emulator race; real REST
stop-first vs dispatch-first ordering remains tested with the synthetic
R2 fixture. No user data, R2 bucket deletion or production switch changed.


## Owner-authenticated reviewer grant issuance and immutable revocation

An existing Owner-only `adminInbox` route now recognizes two strictly
**non-destructive** actions, both subject to the same existing verified
Firebase ID token, current Owner profile and recent authentication
(maximum 10 minutes) as other account-deletion Owner actions:

- `accountErasureR2ReviewerGrant`
- `accountErasureR2ReviewerRevoke`

Arguments: `targetUid`, `requestId`, `objectId`, `reviewerUid`.
The authenticated Owner actor/issuer is **never taken from the request
body**. These actions create no account-erasure certificates or permission
to dispatch R2. They grant only an evidence **assessment** on an existing
post-stop reconciliation case.

`issueAccountErasureExternalIoReviewerGrant` validates the currently
active Owner and reviewer (who needs the specific
`reviewAccountErasureR2Evidence` capability) in one bounded Firestore
transaction. It checks the exact stopped, non-permissive reconciliation
case and creates the one-hour single-case grant and immutable matching
Owner audit atomically. A duplicate or any prior revocation fails closed;
no timer or new request can renew the same grant ID.

`revokeAccountErasureExternalIoReviewerGrant` is an emergency Owner
operation that requires neither unexpired permission nor current reviewer
rights: it updates the grant to revoked and atomically creates an
**immutable tombstone audit**. The independent reviewer reads the
tombstone in its own review transaction alongside all other case/Owner
evidence, so restoring `grant.status="active"` cannot permit a review
after withdrawal. Neither operation changes the R2 stop, uncertain
journal, case completion, account status or external file state.

Tests exercise Owner/admin boundaries, wrong target, duplicate issue,
expired/revoked/missing grants, illegal case state, permanent revocation,
and actual Cloudflare REST + disposable Firestore Emulator issue/review/
revoke flow. Browser-provided `actor.owner` or `actor.evidenceReviewer`
cannot bypass the HTTP session and current-role checks.

**Remaining release gates:** authorized human assessment of real R2
provider logs and object generation, data-owner evidence and real
sanctioned isolated test bucket, credential protection, six independent
data-domain certifications and the safe eventual finalizer. This route
does not implement or enable production account / R2 / Firebase Auth
deletion and no merge or deploy is implied.


## Separately provisioned Cloudflare R2 erasure TEST-bucket evidence

A MANUAL-ONLY GitHub Action, `.github/workflows/account-erasure-isolated-r2-proof.yml`,
runs `cloudflare-worker/scripts/account-erasure-isolated-r2-smoke.mjs`
only after explicit confirmation. It NEVER runs for PRs, pushes, a
timer or production deployment. It does not import any erasure executor.
The script refuses every bucket except **`shadow-live-erasure-test`**;
the production `shadow-live-storage` bucket is not an allowed value,
including with disguised slash/path suffixes.

The user must separately provision this isolated test bucket and **two
test-only** repository secrets, `R2_ERASURE_TEST_ACCESS_KEY_ID` and
`R2_ERASURE_TEST_SECRET_ACCESS_KEY`, scoped to that bucket, not the
production credential pair. The existing `CLOUDFLARE_ACCOUNT_ID`
is reused only to locate the Cloudflare S3 endpoint. Trigger inputs:

- `bucket` exactly `shadow-live-erasure-test`
- `confirmation` exactly `TEST_BUCKET_ONLY_DELETE_EPHEMERAL_FIXTURE`

Only a cryptographically fresh, run-specific
`erasure-fixture/github-<run-id>/<random-uuid>.bin` may be created or
deleted. Provider operations: HEAD (404 required), PUT nonce payload,
HEAD with exact length + ETag, GET to compare exact bytes, a **single**
DELETE, then HEAD (404 required). An unknown timeout after DELETE is
NEVER retried; the generated fixture key is logged for manual
reconciliation. Failed pre-delete verification never invokes DELETE.
No list, wildcard, multi-delete, user-provided key, existing account
asset, Firebase Auth action, certificate, stage status or success
receipt occurs here. Offline stub tests cover production-bucket name
rejection, missing test credentials, metadata mismatch, one-shot DELETE
and unknown-outcome handling.

**Important distinction:** a successful test-bucket smoke is
*provider-function evidence only*. It is not evidence that the
stopped account's actual R2 operation happened, that shared objects are
erasable, that a Firebase deletion succeeded, or that Gate 1 can release
a stop. The real-world execution order, independent provider logs,
account asset/owner ownership, stale signed-off domain writers, and
human finalizer are still blocked until independently certified.

This workflow is intentionally NOT invoked automatically. If dedicated
test-bucket credentials do not exist, it cannot run; a successful
production R2 smoke on the unrelated `shadow-live-storage` bucket
must never be mistaken for the isolated Gate 1 test.
