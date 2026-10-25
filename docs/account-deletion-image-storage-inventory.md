# Shadow Live — owned image storage inventory (internal, read-only)

This module adds one bounded, indexed `storage_objects.ownerUid == uid`
page per explicit Owner review call. Pages contain at most **5 metadata
rows** (plus one lookahead) in stable document-ID order and a private
cursor. No global Firestore/R2 scan, no polling, no public route, no
cleanup job, no financial changes, no Auth deletion and **no R2 HEAD,
GET, LIST or DELETE** calls.

For each image, the module compares the embedded `objectId`, owner,
MIME/size, scope, target and stored R2 key against the canonical paths
in the **current `user-storage.js` writer**: profile photos, animated
avatars and cover images; diary image; private chat image; room cover;
agency logo/background/room image. The image-moderation
`moderation-staging/` prefix is recognized but does not imply
publication or right to erase.

Only exact Firestore references are read: a diary-image link,
conversation participants, room owner, or agency owner, depending on
scope. Cross-user conversation messages, other members' assets,
moderation proof, evidence and balances are not read or modified.
The actual administrative transfer/closure of rooms or agencies
and preservation of shared chat messages require separate decisions.
The preview returns **opaque object IDs and limited integrity/review
booleans only**, never user photos, R2 keys, URLs, recipient IDs,
messages, financial data or evidence.

Every item retains `needsReview:true`, even if its ownership and
canonical storage reference agree. Moderation, investigation,
retention, reporting and appeal holds are flagged; unknown/legacy
paths, missing diary links, invalid target owners or shared assets
are never certified safe to delete. An empty paged inventory cannot
prove absence of orphaned R2 images, incomplete uploads
(`storage_upload_tickets`), queued storage deletions, legacy
unindexed media, report screenshots or counterpart references.
The future deletion executor must handle those separately and
check legal/financial/retention approvals.

`exhaustive:false`, `sharedOwnershipCleared:false`,
`mediaRetentionCertified:false`, `erasureAllowed:false` and
`completionVerified:false` are **always returned**.

An external route, if ever added, must independently authenticate
Owner role, confirm exact authorized deletion target and use
scoped/signed pagination cursors; `actor.owner` is not itself
authentication. Production account erasure remains disabled.
Unit + disposable Firestore Emulator tests cover five-row paging,
all principal media scopes, canonical paths, staging/evidence holds,
shared assets and preservation of counterpart and financial data.
