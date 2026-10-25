# Account deletion — owner closure checklist (read-only)

**Current status: review tool only. This does NOT enable account deletion.**

Existing endpoint `POST /api/admin-inbox` has an additional action:
`accountDeletionClosureReadiness`. Request JSON:

```json
{"action":"accountDeletionClosureReadiness","targetUid":"<CURRENT_FIREBASE_UID>","requestId":"<CURRENT_REQUEST_ID>"}
```

The existing verified Firebase session must belong to the actual platform Owner
as resolved from Firestore, with a recent sign-in (`auth_time` within ten minutes).
Non-Owners, stale tokens, forged IDs, cancelled/replaced requests, active legal
or appeal holds, a prematurely due request, active/destructive checkpoints,
and any already-deleted or processing account fail **before** domain review.

Reads are limited to **three exact account/checkpoint/user documents plus
twelve exact approval/audit documents**, one pair for each domain, and no
queries, bulk Firestore scans, R2 object reads/lists or writes.

| Domain | Required externally verified decision |
| --- | --- |
| `financial_settlement` | Ledger, coins/diamonds, gifts, agency settlement and liabilities |
| `play_billing` | Play purchases, refunds and chargebacks |
| `moderation_legal` | Active reports, appeals, moderation and retained evidence |
| `shared_assets` | Room/agency ownership, counterpart and rights disposition |
| `content_storage_inventory` | Real Firestore/R2 and legacy/unindexed coverage |
| `retention_policy` | Lawful retention basis, expiration and eventual purge |

A domain has `certificateDocumentsValid=true` **only** if the existing
processing-admission validator accepts an immutable approval/audit pair for
the **current** deletion request, signer, timestamps, domain, expiry and
hold state. There is one shared validator — no separate relaxed rules.
A missing record, stale approval, mismatched signer or open appeal produces
`certificateDocumentsValid=false`. These are **structural document checks**,
not verification of the settlement, legal advice, or storage evidence itself.

Always returns `independentEvidenceVerified:false`,
`legacyDataExhaustivelyVerified:false`, `processingAdmitted:false`,
`destructiveAllowed:false`, `erasureAllowed:false`,
`completionVerified:false`, `firebaseAuthDeleted:false`.
Even 6/6 structurally valid pairs **must not** be treated as permission
to run deletion. The existing internal processing-admission routine independently
rechecks certificates transactionally and still cannot delete anything.
No approval is created by this action.

The controller returns domain codes and validity flags only; it does not
expose customer ID, name, wallet values, purchase receipts, signer ID,
audit contents, report text or R2 keys. The Owner can use it to coordinate
the six outstanding human/technical verifications without inventing clearance.
A UI integration may display these flags after independent permission review;
no automatic one-click signoff or finalization exists.

**Outstanding before production:** real six-domain evidence review by authorized
humans, formal storage coverage and safe asset ownership disposition, safe
bounded resumable executor with transaction/retention checks, R2 deletion only
after clearance, Auth deletion last, completion receipts only after verified
outcomes, and isolated two-account end-to-end acceptance. Production
`destructiveAllowed` must stay `false`.

Reusable rule: [Reuse-First Engineering Standard](REUSE_FIRST_ENGINEERING_STANDARD.md).
Account deletion lifecycle: [erasure lifecycle](account-deletion-erasure-lifecycle.md).
