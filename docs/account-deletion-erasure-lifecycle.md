# Shadow Live — account erasure: data lifecycle and production gates

Last updated: 2026-10-24. **Technical implementation checklist, not a legal opinion or a claim of Google Play approval.**

## Deletion already implemented

1. Authenticated self-service request inside app and via external web form, scoped to the signed-in account; ten-minute recent authentication required for changes.
2. Thirty-day cancellation window (product decision, not a claim that the Play policy endorses this specific delay).
3. Feature-gated, hourly bounded transition into `review_ready` for owner review, off by default.
4. Owner-only review, audit-backed hold/release; customer may still cancel before processing.
5. On-demand read-only inventory via **existing** admin inbox API, 17 single-result existence queries. `not_seen` **does not** mean absent or erased.

## Required erasure and retention inventory, by domain

| Domain | Known source / record | Pre-erasure requirement | Status |
| --- | --- | --- | --- |
| Identity, public presence | `users/{uid}`, `public_profiles/{uid}`, Firebase Authentication | Remove public PII and login, confirm no linked app sessions, delete/pseudonymize identity only at safe final point | Not implemented |
| Diaries | `diaries` by `ownerUid`, `users/{uid}/diaries`, nested comments, likes, mentions and notifications | Remove author's content and its mirrors without deleting others' permitted content or protected evidence; bounded pagination and idempotent checkpoints | Not implemented |
| Private messages / voice | `conversations` participants; nested messages, private audio records and linked R2 attachments | Preserve other participant's messages where applicable, strip or tombstone deleted user's text/voice and identity, honor reports and retention holds | Not implemented |
| Room/agency links | `rooms` (legacy owner IDs too), `agency_user_memberships/{uid}`, agency memberships, room grants, associated media | Review room ownership transfer; avoid orphaning other people's rooms/agencies and their shared assets | Not implemented |
| R2 media | `storage_objects` by `ownerUid`, `storage_delete_queue`, existing `runDeletedAccountStorageCleanup` | **Reuse existing batched cleanup**, including evidence holds and shared media transfers; start only after a verified account-finalization step | Available cleanup primitive, integration not implemented |
| Purchases / balances | `users/{uid}` coins/diamonds; Google Play purchase receipts, gifting/agency settlement ledgers, financial audit | Settle disputes and unspent balances under policy, retain transactions where legally required, pseudonymize other personal fields, never invent financial clearance from zero visible balance | Not implemented |
| Reports / abuse evidence | `reports`, report history, complaints, uploaded evidence and legal holds | Apply independent role permissions, documented retention rules (including existing 90-day-after-closure rule when applicable), minimize retained identifiers | Not implemented |
| Social relationships / notifications | `follows`, `user_blocks`, `notifications`, device push tokens, badges and profile presentation snapshots | Cleanup bounded by owner/participants and preserve unrelated user records; revoke tokens at appropriate stage | Not implemented |

### Hard blocks before an executor can be enabled

- Finalization must require the **current** `requestId` in `review_ready`, due date passed, no `reviewHold`, correct owner authority and fresh authentication, and a server-side multi-step audit ledger.
- A read-only inventory is neither a complete data enumeration nor proof of deletion. Do not let `not_seen`, an empty coin balance, or a successful R2 object cleanup alone mark `completed`.
- Prevent cancellation/finalization races with Firestore transactions and explicit `processing` transitions; retries must be idempotent, crash-recoverable, and bounded, with no global scans or new polling.
- **Do not** run `deleteAuthUser` as the first step (existing administrative deletion does this); a partial failure would leave orphaned personal data and no user access.
- Track each individual cleanup step and any retained record category with a legal basis, duration, and minimal identifiers; require human review on balances, reports, shared-room data, holds and unresolved unknowns.
- Ensure an explicit outcome/response is provided to the requester, without promising automatic erasure if no executor is deployed.
- Recheck current Google Play account deletion/Data Safety rules, applicable privacy law and the thirty-day timeline before submission.
- Never enable `ACCOUNT_DELETION_REVIEW_READY` in production until end-to-end account lifecycle testing is complete; this flag only queues reviews, not erasure.
- Test with an **isolated test account** whose disposable data can safely be removed; never trial a destructive path on real user data. Build Android APK/AAB only after the broader readiness gates are closed, per project decision.

## Bounded inventory contract

API action: `accountDeletionInventory` under the existing `/api/admin-inbox` endpoint. AuthZ: owner only, validated signed-in admin session, current `review_ready` request ID. Queries: owner diaries, owned R2 metadata, current/legacy room ownership, participants of private chats, existing financial-ledger rows (`userId`), Google Play purchase rows (`uid`), reports made by the account (`reporterUid`), and reports targeting the account (`targetUid`); each query `limit: 1`, performed **only** on explicit owner click. Gift transactions (senderId/receiverId), ledger counterparties (single UID and group array), wallet transfer sender/recipient and legacy report reporterId/targetUserId are now probed as bounded existence checks. A legacy field may store a public identifier rather than UID, so an empty result still does not establish absence. Refund disputes, agency settlements and evidence remain separate manual/technical review gates. Fails closed: query errors remain `not_verified`. Returned keys represent only existence indicators, never raw messages, media URLs, reports, receipts, or contact details. The response permanently declares `exhaustive: false`, `erasureAllowed: false`, `erasureExecuted: false`.

## Non-destructive owner preflight checkpoint (PR #469 and successor)

A server-authorized owner can call existing `/api/admin-inbox` with action
`accountDeletionPreflightCheckpoint`, `targetUid`, and current `requestId`.
The route uses the existing verified Firebase session, role loaded from Firestore,
and a recent authentication timestamp (ten minutes). The atomic checkpoint
`account_deletion_erasure_checkpoints/{uid}` remains `preflight_blocked`,
`destructiveAllowed: false`, regardless of inventory results. Existing audit
logs are written once per request ID. Repeating the same request is idempotent.

This is **not** the actual erasure executor and does not change the request to
`processing`. The client has no button for it yet. Independent signed-off
financial settlement, Google Play purchase handling, legal-hold evidence,
shared ownership, retention policy, bounded data deletion with resumable
checkpoints, Firebase Auth deletion as final phase, and isolated test-account
validation remain mandatory.

## Financial and report counterparty preflight expansion (17 probes)

The owner-triggered inventory now covers eight additional indexed, single-result checks in `gift_transactions`, `financial_ledger`, `wallet_transfers`, and legacy `reports`. Each check is `limit: 1`, sequential, without exposing private IDs or content. As with earlier probes, `not_seen` cannot certify absence, errors produce `not_verified`, and none of these checks authorizes erasure.

**Outstanding:** purchase refunds and chargebacks, the original coins/diamonds source of truth, agency salary/profit distributions, unindexed legacy schemas, retention periods and legal holds. Do not zero balances, delete financial ledgers or hide chargeback liabilities based on these existence flags.

## Approved account-deletion presentation and owner receipts — 24 October 2026

The owner approved: **(a)** a distinct `سجلات الحسابات المحذوفة` section in
Shadow Control, **(b)** maintaining previously earned support/ranking points
without exposing the deleted supporter identity, and **(c)** replacing deleted
participants in private conversations with `حساب محذوف` without opening
profiles, calling or messaging them. The other participant's messages and
lawfully retained reports/evidence must be handled independently; do not use
an indiscriminate conversation-wide delete.

**Implemented in the presentation tranche:** `user-level-support` reads
only a bounded batch of current user documents for at most 20 support rows.
Missing user documents or completed/deleted account markers are rendered as
`حساب محذوف`, with empty `uid`, `profileImageUrl`, `publicId`, and no
mysterious identity. Historical `points` and `giftCount` are not changed;
the profile screen explicitly disables navigation for such items. The old
profile snapshot still exists in historical documents until future verified
cleanup; serving a tombstone is **not proof of erasure at rest**.

The new owner-only Shadow Control section reads at most 21 indexed records
from `account_deletion_erasure_receipts`, showing up to 20 verified, fully
completed receipts. No data-mutation, no user profile or sensitive evidence
can be retrieved. Receipt allowlist: request operation ID, request/completion
timestamps, executor kind, pre-approved financial/evidence statuses, and
retention categories. No receipts are created by the preflight checkpoint.
An empty screen means **no verified completion receipt**, not that a pending
request was erased. The future finalizer must independently create a receipt
only when all erasure gates have passed; it must not copy user names, emails,
media, report text or raw legal evidence into the receipt.

**Outstanding before full deletion compliance:** actual bounded cleanup of
historical support snapshots in both `user_level_support/{sender}/wealth`
and `user_level_support/{receiver}/attraction`, private conversation
participant tombstones and attachment cleanup, notifications/comment
snapshots, shared ownership transfers, financial/legal sign-offs, R2 cleanup,
Firebase Auth as final irreversible step, and isolated emulator/account
tests. Retained materials require explicit basis, retention period and
access policy.

## Deleted participant chat safety tranche (after PR #472)

The chat-list identity cache now distinguishes a confirmed missing
`public_profiles/{uid}` record from network errors. An explicitly deleted
public profile also has its stored avatar/name/frames suppressed at the
visual-identity model layer; deleted conversation participants display
`حساب محذوف` and cannot open quick profiles. Existing conversations remain
visible to their other participants; removing or retaining message content
is a separate audited erasure/retention decision.

In a private-chat detail view, the **existing profile stream** (no new
listener) controls a fail-closed composer, chat-profile access and call
button. While identity is loading or the stream errors, the composer
remains unavailable. Confirmed missing/deleted profiles show the neutral
identity with no saved photo. The Worker independently rejects new
private text or gift transactions when sender/receiver `users` state is
deleted, deletion_processing, or authDeleted. A previously accepted
idempotency receipt can still return its existing result; it cannot
authorize a new operation.

This is interface and write-gating safety, **not** final message/content
erasure. The approved finalizer must separately enumerate conversation
message collections using small resumable batches, remove the deleted
sender's personal text/voice/attachments (unless protected evidence
requires a legal basis and separate access control), retain the other
party's messages, update both counterpart/preview snapshots, and purge
R2 links safely after retention decisions. Do not mark completed merely
because the profile stream shows a tombstone.

The normal conversation UI also replaces the deleted sender's visible text, voice and image messages with deletion tombstones and suppresses old last-message previews. Other participants' own messages and gift/settlement events remain visible. This does **not** erase original text/media bytes or the message documents at rest: evidence and stored snapshots must still pass legal review and the future deletion executor.

## Legacy admin direct-delete shutdown — safety gate

The old Owner-only `manageUserAccount(accountAction: deleteAccount)` path
previously called Firebase Auth deletion before finishing the Firestore
transaction and before financial, legal and R2 retention review. This could
leave orphaned PII or unresolved liabilities if a later operation failed.

That direct-delete action now returns a non-mutating HTTP 409
`account_deletion_lifecycle_required` after verifying Owner authority.
The Shadow Control Users screen no longer presents an enabled direct-delete
button and directs Owner to existing deletion-request review instead.
Moderation suspension, ban, session revocation and warning flows remain
independent. The old Auth-first deletion helper was removed.

This safety closure is **not** an implemented full executor. Account deletion
still requires a separately tested, bounded, resumable finalizer that reviews
financial settlement, protected evidence and ownership before deleting
Firebase Auth last. No actual user data was destroyed by this change.

## Room gifts to deleted accounts — fail-closed financial gate

Room gifts use a separate Worker mutation from private chat gifts.
The room gift sender and **every** selected receiver now undergo the same
deletion-state guard inside the existing gift transaction, before any
wallet debit, recipient credit, ledger or support-ranking writes.
States `deleted`, `deletion_completed`, `deletion_processing`,
`authDeleted=true` and `deletionProcessing=true` are rejected with 409.
A pending or review-ready deletion *request* does not by itself stop
the user's right to send/receive gifts during the cancellation window;
the financial review must account for balances at finalization time.
The check does not delete historic gifts or balance records.

## Historical support snapshot sanitization — bounded internal stage

Historical support rank rows in `user_level_support/{other}/wealth/{deleted}`
and `user_level_support/{other}/attraction/{deleted}` may hold copies of the
deleted person's displayName, profileImageUrl, and publicId. A new internal
`redactDeletedSupporterPair` primitive accepts **one already enumerated
counterparty** and can mask only those three personal fields in at most
two documents in one transaction. It does not change points, giftCount,
wallet or financial ledger entries.

It is intentionally **not connected to any production route or cron**.
It requires a current, exactly matching deletion request in `processing`,
user in `deletion_processing`, checkpoint phase `support_snapshots`,
`destructiveAllowed=true`, and no current review, legal or deletion hold.
Current deployment checkpoints are always `preflight_blocked` and
`destructiveAllowed=false`, so this cannot run on real accounts until a
future independently verified finalizer authorizes the stage.

This is **not sufficient to prove account erasure**, since Firestore
document IDs and counterpart references can still contain a UID and
legacy pairs must be exhaustively discovered and resolved under a
retention/anonymization policy. The actual finalizer must handle those
references and safely retry incomplete batches. No financial counters
or legitimate recipient rewards may be reduced by privacy cleanup.
