# Pressure Root Fix — Step 9: Reliability Finalization

Date: 26 Sep 2026

## Scope

Step 9 closes the reliability work that was only partially pulled forward during Step 6.

Already completed before this step and preserved:
- Auth-state retry/backoff/jitter, in-flight coalescing, stale-safe verified cache, and circuit breaker.
- Single Authoritative User Read on existing migrated admin/economy/room-ticket paths.
- Firestore transient retry cap/backoff/jitter and legacy transaction retry cap.
- Flutter CI per-ref concurrency.
- Serial Comprehensive Production E2E for the Phase 6/9/economy subsets.

This step finalizes the remaining quota, CI, and Durable Object policies.

## Firestore quota policy

Normal transient read/query behavior stays capped at 3 attempts.

For explicit Firestore quota exhaustion:
- HTTP 429 or `RESOURCE_EXHAUSTED` is classified as quota exhaustion.
- Quota retries are capped at 2 attempts.
- Quota retries wait at least 1000 ms and still honor bounded Retry-After/backoff.
- Two quota failures open a process-local circuit breaker for 10 seconds.
- While the breaker is open, eligible Firestore reads fail fast instead of sending more requests.
- A successful eligible Firestore response resets the quota breaker.
- Commit/write authority is not moved to cache and commits are not blindly replayed by this policy.

The breaker is intentionally process-local. It reduces amplification from a warm Worker isolate; it does not claim to replace or raise the upstream Firestore project quota.

## First-read / cold-cache behavior

When a safe stale cached value exists, the existing bounded stale policy may serve it only on transient upstream failure.

When no safe cached value exists:
- The Worker does not fabricate a catalog, registry, permission, balance, room, or financial state.
- Quota exhaustion is surfaced as HTTP 503 with code `firestore_quota_exhausted`.
- The response includes `Retry-After` and `retryAfterSeconds`.
- Critical room/voice auth-state lookup failures are surfaced as transient 503 rather than generic server failures where supported.

This means a cold cache can still be unavailable while the upstream project quota is exhausted. That remaining infrastructure condition belongs to Step 12 closure, not to application retry amplification.

## Single Authoritative User Read expansion

The App Asset owner path previously performed:
1. Firebase token verification with user-state lookup.
2. A second `users/{uid}` read for owner/admin permissions.

It now:
1. Verifies the token signature with `checkUserState:false`.
2. Reads `users/{uid}` once.
3. Applies account/session state and owner/admin permissions to that same snapshot.

This removes one avoidable Firestore read from every App Asset owner request without weakening authorization.

## Final Production CI policy

`Cloudflare Phase 8 Comprehensive E2E` remains the single automatic Production Firestore E2E gate.

All standalone Production suites are manual-only via `workflow_dispatch`:
- Core/Batch smoke.
- Chat Core.
- Chat Gift.
- Chat Safety.
- Economy Router.
- Google Play guards.
- App Asset Manager.
- Phase 6 Settlement.
- Phase 9 User Access.
- Phase 9 User Moderation.
- Room Gift.
- Voice Phase 1.
- Voice Phase 2.
- Wallet.

Every manual suite and the Comprehensive gate use the same concurrency group:
`shadow-live-production-firestore-e2e`

`cancel-in-progress:false` prevents overlapping Production Firestore suites. Because GitHub keeps only a bounded pending concurrency state and Worker/Pages deploys intentionally keep the newest main build, the automatic Comprehensive workflow now has a freshness job: if its push SHA is no longer the current main SHA, it exits without creating Production load instead of waiting for an exact deployment that was superseded. Manual dispatch is never rejected by this freshness check.

The stale Phase 6 test-user cleanup workflow is also manual-only and uses the same Production Firestore concurrency group.

The Comprehensive gate watches Worker source/scripts/wrangler changes and the Production E2E workflow policy files.


The full App Asset Manager write/delete E2E is intentionally excluded from the automatic Comprehensive gate. It writes a temporary asset to the GitHub `main` branch and deletes it during cleanup, which creates extra main commits and Pages/CI churn. The dedicated App Asset workflow remains manual/release-only and serialized through the same Production Firestore group.

## Production Durable Object policy

Automatic CI must not create a new Production Room Durable Object merely to test realtime behavior.

The Phase 6 settlement script now requires:
`ALLOW_PRODUCTION_DURABLE_OBJECT_E2E=1`

Policy:
- Automatic Comprehensive E2E explicitly sets the flag to `0`.
- It still tests settlement, cron, game catalog, agency settlement, and financial ledger behavior without opening a Production room WebSocket.
- The standalone Phase 6 Production workflow is manual-only and explicitly sets the flag to `1`.
- Local/PR Durable Object dry-run and unit/browser coverage remains unchanged.

This keeps automatic CI from becoming the first creator of a Production room Durable Object.

## Financial authority

No financial decision is moved to stale/cache state:
- Gifts, balances, payout policy, Google Play crediting, bets, outcomes, settlement, and ledgers remain server-authoritative.
- Quota breaker behavior is fail-closed.
- Firestore commits are not blindly retried by the REST client.
- Idempotency and transaction logic remain the write-safety authority.

## Before / After

Before:
- Several standalone E2E suites could auto-run at the same time as Comprehensive E2E.
- Each suite used its own concurrency group, so GitHub allowed parallel Production Firestore load.
- Repeated quota reads could retry independently and amplify 429.
- App Asset owner auth used two user-state reads.
- Automatic Phase 6 coverage could create a Production Durable Object.
- Cold quota failures were often reported as generic 500.

After:
- One automatic Production E2E gate.
- One shared Production Firestore concurrency group, with superseded automatic runs skipped before Production load.
- Quota-aware 2-attempt policy + 10s circuit breaker.
- App Asset owner auth uses one authoritative user read.
- Automatic CI skips Production Durable Object creation.
- Phase 6 stale-user cleanup is manual/serialized.
- Full App Asset mutation E2E is manual/release-only, so the automatic gate no longer creates GitHub main commits.
- Critical cold quota failures surface as explicit retryable 503.

## Remaining Step 12 dependency

Step 9 reduces amplification and makes quota behavior deterministic. It cannot raise/reset the actual Firestore project quota.

Step 12 stays open until Production can repeatedly complete first reads and full room flows without 429, usage is measured, and progressive stress testing succeeds.
