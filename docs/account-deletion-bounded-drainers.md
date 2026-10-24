# Account erasure — bounded owned-notification and device drainers

These **internal-only** adapters connect existing, separately gated
single-document erasure functions to two small indexed Firestore collection
reads. They are **not** routed, scheduled or callable by any deployed
production deletion executor.

* `drainAccountOwnedNotifications(db, {uid,requestId,limit})` uses
  `notifications` filtered by **recipient** `userId == uid`; unrelated
  recipients are excluded. It never scans for actor references in other
  recipients' notices. Such snapshots require their own lawful,
  schema-specific redaction review.
* `drainAccountPrivateCallPushDevices(db, {uid,requestId,limit})` reads only
  the deleted account's `private_call_push_devices/{uid}/tokens`
  subcollection. Each token deletion rechecks its SHA-256 and ownership
  transfer before touching the shared owner index. It cannot revoke tokens
  now belonging to other accounts.

A call performs a **maximum of five** document erasure attempts, with
`limit+1` indexed query results to indicate `moreInPage`. Calls are
sequential to avoid Firestore concurrency spikes. Every underlying
one-document transaction verifies the current request/checkpoint,
`destructiveAllowed=true`, the exact stage, retention/legal approvals,
no holds, and non-Owner status. The preflight and newly admitted processing
checkpoint still have `destructiveAllowed=false` in production, so these
functions cannot run on actual accounts.

No persistent cursor is needed during destructive draining: already removed
documents disappear from the next indexed page. If a network error occurs
after some commits, retry simply selects remaining documents. No result
claims domain completion: `completionVerified` is **always false**, even
for a page with no remaining matching documents. Concurrent producers,
retained content, legacy schemas, audit and full-domain finalization need
separate verification before the checkpoint is advanced.

To enable full deletion, implement server-authorized certificates and
stable phase progression, prevent new notifications and device writes during
`processing`, audit each domain's zero-result proof, review older
notification schemas and cross-user snapshots, and then eventually delete
Firebase Auth last. Test with isolated disposable data only.
