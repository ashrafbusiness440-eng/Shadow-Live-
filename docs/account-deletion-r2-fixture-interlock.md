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
