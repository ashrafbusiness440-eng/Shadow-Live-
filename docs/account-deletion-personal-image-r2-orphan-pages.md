# Shadow Live — bounded personal image orphan preview in R2

This is an internal diagnostic after #508 (Firestore metadata inventory),
#509 (R2 hold gates), and #510 (single-object R2 HEAD). It **does not**
enable account erasure or authorize a storage object to be removed.

The review inspects only ONE of four account-owned prefixes on demand:
\`users/{uid}/profile/\`, \`users/{uid}/profile-animation/\`,
\`users/{uid}/covers/\`, or \`users/{uid}/diaries/\`.
Each R2 LIST is prefix-scoped with limit **1–5**, and uses an opaque
cursor for the following page. **No bucket-wide scan**, no polling,
no listeners, no R2 HEAD/GET/DELETE, no public route, no cron, no writes,
no Auth operation and no automatic evidence purge.

Before listing R2, the function verifies the exact Owner-reviewed
deletion request and checkpoint against the deleting user, including
legal/investigation/report/evidence/appeal/retention holds. After listing,
it validates the prefix and rejects duplicates or a malformed continuation.
Only well-formed file names generate direct Firestore point reads in
\`storage_objects\`, \`storage_upload_tickets\`, and optionally
\`diary_image_links\` or \`storage_active_objects\`. Foreign ownership
is a hard stop. Existing metadata must match the current writer's
scope, MIME, R2 key, bucket and expected constraints to count as a
consistent reference. Unknown legacy layouts are marked for review
without revealing file names or querying arbitrary paths.

A missing \`storage_objects\` row without an upload ticket is only a
**possible orphan**: it could still be referenced by legacy/unindexed
schemas, screenshots, legal evidence or shared data. An upload ticket
means incomplete upload is possible and is *not* an orphan certificate.
The output contains opaque object IDs only for canonical recognized
files, plus limited booleans. It never contains R2 keys, signed URLs,
bytes, personal profile data, counterpart identities or evidence.

The shared R2 prefixes \`chat/\`, \`rooms/\`, \`agencies/\` and image
moderation staging are deliberately excluded. Ownership transfer,
finance, policy and legal review remain necessary. Every result
requires manual review, with \`erasureAllowed:false\`,
\`completionVerified:false\`, \`exhaustive:false\` and
\`mediaRetentionCertified:false\`. Production
\`destructiveAllowed:false\` stays unchanged.

Node unit and disposable Firestore Emulator tests run in the existing
Flutter CI. No real user, live account deletion or production R2 media
is used for these tests.
