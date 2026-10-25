# Account erasure — pending image upload-ticket inventory (read only)

This internal-only review fills a gap left by #508–#511: an upload can have a `storage_upload_tickets` row before the corresponding `storage_objects` record exists. These rows may refer to unconfirmed uploads, R2 objects, staging/evidence, or shared conversation/room/agency assets.

`inspectAccountImageUploadTicketPage` reads only records with `ownerUid == deleting UID`, ordered by document ID, max **five** returned plus **one** lookahead, with an optional cursor. It checks the exact request, checkpoint, user and active legal/review/appeal/retention holds before querying. Each selected ticket triggers at most one direct `storage_objects/{id}` get and, for recognized shared scopes, one exact conversation, room or agency get. No bucket queries or wildcard scans.

It checks file naming, MIME/size, canonical personal or shared R2 path, active/staged paths, ticket versus object ownership, and two-party/shared references. R2 keys, counterpart IDs, purchase data, evidence contents, and private user data are never returned. A ticket is **unresolved even after it expires**: expiry or missing metadata is not a cleanup authorization. Cross-user ownership conflicts fail closed.

No R2 GET/HEAD/LIST/DELETE, Firestore writes, Firebase Auth removal, public route, scheduler, owner transfer, finalizer, evidence certification, or account-erasure decision. Every entry has `needsReview:true`; the result always has `erasureAllowed:false`, `completionVerified:false` and `exhaustive:false`. A future wired call MUST independently authenticate the Owner; the `actor` argument is only an internal hint. Production `destructiveAllowed:false` is untouched.

Unit and disposable Firestore Emulator integration tests verify pagination, no automatic disposal of expired tickets, ownership/hold guards, and preservation of the other chat participant. These are not real-account signoffs.
