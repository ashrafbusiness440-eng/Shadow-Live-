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