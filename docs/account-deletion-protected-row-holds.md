# Account erasure — per-record and checkpoint hold enforcement

Internal unexposed deletion primitives must never use a blanket request-level
hold as a substitute for evidence/retention flags attached to individual
documents. Every per-record write remains prohibited by the production
`destructiveAllowed=false` gate.

## Additional hold checks

- `redactDeletedSupporterPair`: before the two wealth/attraction
  profile snapshots can be masked, the same transaction now rejects holds on
  **request, checkpoint, processing user, and each existing snapshot**.
  Supports `reviewHold`, `legalHold`, `retentionHold`,
  `deletionHold`, `evidenceHold` and `investigationHold`.
  If any single snapshot is held, *neither* one is updated. Existing earned
  points and gift counts remain unchanged on success.
- `removeDeletedAccountSocialPair`: exact four-document transaction now
  rejects evidence/investigation holds on request, checkpoint, processing
  user and **each** existing follow/block document. A held row makes
  the entire pair cleanup fail without partial removal.

Node regression tests explicitly cover held first/second support snapshots,
held each of four follows/blocks, checkpoint evidence/investigation holds,
and no partial financial or social mutation.

No HTTP route, timer, owner UI or erasure orchestrator was created here.
The six domain certifications, lawful 90-day protected evidence retention,
bounded fully enumerated inventory, financial settlement, finalizer and
Firebase Auth-last gates remain mandatory before production erasure.
