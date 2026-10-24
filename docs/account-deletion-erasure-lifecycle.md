# Shadow Live — account erasure: data lifecycle and production gates

Last updated: 2026-10-24. **Technical implementation checklist, not a legal opinion or a claim of Google Play approval.**

## Deletion already implemented

1. Authenticated self-service request inside app and via external web form, scoped to the signed-in account; ten-minute recent authentication required for changes.
2. Thirty-day cancellation window (product decision, not a claim that the Play policy endorses this specific delay).
3. Feature-gated, hourly bounded transition into `review_ready` for owner review, off by default.
4. Owner-only review, audit-backed hold/release; customer may still cancel before processing.
5. On-demand read-only inventory via **existing** admin inbox API, five single-result existence queries. `not_seen` **does not** mean absent or erased.

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

API action: `accountDeletionInventory` under the existing `/api/admin-inbox` endpoint. AuthZ: owner only, validated signed-in admin session, current `review_ready` request ID. Queries: owner diaries, owned R2 metadata, current/legacy room ownership, participants of private chats; each query `limit: 1`, performed **only** on explicit owner click. Fails closed: query errors remain `not_verified`. Returned keys represent only existence indicators, never raw messages, media URLs, reports, receipts, or contact details. The response permanently declares `exhaustive: false`, `erasureAllowed: false`, `erasureExecuted: false`.
