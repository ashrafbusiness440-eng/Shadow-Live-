# Shadow Live — single image R2 HEAD review (internal, read-only)

Follows #508 (Firestore image metadata inventory) and #509 (R2 cleanup
hold enforcement). This is an additional diagnostic for one **known**
\`storage_objects/{objectId}\` row, never a collection query or R2 list.

- Exact Owner-scoped request, checkpoint, target user and object metadata
  are cross-checked before any R2 operation. The \`actor.owner\` argument
  is NOT sufficient authentication and cannot be exposed as a public route.
- Reconstructs the current nine canonical image prefixes from the
  \`user-storage.js\` writer. Rejects noncanonical keys, moderation staging,
  ambiguous legacy scopes, invalid size or MIME, foreign owners, unexpected
  states, active-pointer conflicts and incomplete upload tickets.
- Cross-checks exact \`diary_image_links\`, two-party conversations, rooms,
  agencies and active-object pointers where applicable. Shared assets are
  **never** approved for erasure. A missing legacy pointer is not approval.
- Blocks legal, evidence, investigation, report, retention and appeal holds
  on the live deletion request, checkpoint, user, object, upload ticket and
  exact linked Firestore documents.
- Only then calls **one** R2 \`bucket.head(canonicalKey)\`. No object bytes
  or URLs are downloaded or returned. Provider failures are sanitized.
- Returns opaque object ID, scope, existence/size/MIME booleans, active-pointer
  presence and shared-asset review requirement. Every response has
  \`needsReview:true\`, \`erasureAllowed:false\`,
  \`mediaRetentionCertified:false\`, \`exhaustive:false\` and
  \`completionVerified:false\`. HEAD cannot prove absence of older uploads,
  orphan media, screenshots, retained evidence or third-party claims.

This module adds no public endpoint, cron, storage cleanup stage, delete,
Auth change, queue certificate or Firestore write. It does **not** make
production account erasure safe or enabled; \`destructiveAllowed:false\`
must remain the production default. Unit and disposable Firestore Emulator
tests run as part of the existing Flutter CI gates. Manual testing of two
synthetic accounts, independent legal/financial signoffs and the complete
resumable finalizer remain open.
