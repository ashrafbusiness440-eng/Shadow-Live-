# Account deletion social relationships — bounded cleanup stage

`removeDeletedAccountSocialPair` is an **unrouted, unscheduled** internal
primitive for a **single known counterparty**, not an enumeration routine.
The Worker uses the established canonical follow and block paths, at most:
`follows/{deleted}__{other}`, `follows/{other}__{deleted}`,
`user_blocks/{deleted}/items/{other}`, and
`user_blocks/{other}/items/{deleted}`.

Each attempt uses one Firestore transaction to verify the current deletion
request ID in `processing`, checkpoint `phase=social_links` with
`destructiveAllowed=true`, account in `deletion_processing`, and no
review/legal/retention/deletion holds. The Owner account cannot be processed.
Existing path documents must match their expected follower/blocked UID
fields; a corrupt or misattributed legacy record aborts **all four** deletes.

Only existing pair records are deleted and retries are idempotent.
Other users' unrelated follows, notifications, wallet, level support,
messages, report evidence and account documents remain unchanged.
Node tests and Firestore Emulator concurrency tests verify those boundaries.

This primitive does **not** enumerate all following/follower relationships,
resolve historic unidentified schemas, update denormalized follower counters,
purge notification snapshots, or prove full account deletion. Those
are separate bounded-discovery and retention-verified finalizer stages.
The current deployment exposes no action that sets
`destructiveAllowed=true`, so real accounts cannot use this stage.
