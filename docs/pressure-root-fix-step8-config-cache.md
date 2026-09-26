# Pressure Root Fix — Step 8: Low-Change Config Cache

Date: 26 Sep 2026

## Scope

Step 8 reduces repeated reads for configuration and registry data that changes rarely, while keeping Firestore authoritative for all financial decisions and persistent state.

Cached read paths:
- Gift catalog display/config.
- Recharge package display/config.
- Game runtime catalog/config reads.
- Gift economy admin state.
- Room Rocket admin config state.
- App asset registry reads.

Room level/capacity rules remain code-resident and therefore already require zero Firestore config reads.

## Cache contract

The Worker uses one shared read-through in-memory cache with:
- Fresh TTL per config.
- Same-key in-flight coalescing so concurrent cold requests issue one loader call.
- Bounded stale data for at most 5 minutes only when the upstream failure is transient (for example Firestore 429 / RESOURCE_EXHAUSTED / UNAVAILABLE).
- No stale fallback for permission/validation errors.
- Explicit invalidation or priming after admin writes.

This cache is a pressure-reduction layer, not a new source of truth. Firestore remains authoritative.

## Client changes

### Gift Catalog

Before:
- Every gift-sheet load called `GiftCatalogService.watchCatalog().first`.
- That opened a Firestore snapshot listener/read against `system_config/gift_catalog` for each load.

After:
- Gift sheets call `GiftCatalogService.loadCatalog()`.
- The client performs an authenticated on-demand API read.
- Client memory cache is fresh for 30 seconds, with same-process in-flight coalescing and bounded stale reuse.
- No polling and no direct Firestore config listener.

### Recharge Config

Before:
- `RechargeScreen` kept a Firestore snapshot subscription to `system_config/recharge` for the lifetime of the screen.

After:
- The screen performs one on-demand `RechargeConfigService.loadPackages()` call.
- Client memory cache is fresh for 30 seconds and coalesces concurrent loads.
- Approved fallback packages remain immediately renderable.
- No polling and no direct Firestore config listener.

## Server changes

### Gift Catalog
- User-facing `gift-catalog` action `catalog` reads through the shared cache.
- Admin `state` reads through the same cache.
- Admin `save` invalidates the cache after the Firestore transaction commits.

### Recharge
- User-facing `recharge-config` action `packages` reads through the shared cache.
- Admin `state` uses the cache.
- Admin `save` invalidates the cache after commit.

### Game Runtime
- The existing 30-second game-runtime cache is moved to the shared cache.
- The approved 30-second fresh TTL remains unchanged.
- Admin game saves invalidate the shared game-runtime cache.
- `placeBet`, outcomes, payouts, settlement, balances, and financial ledger remain server-authoritative.

### Economy / Rocket
- Admin state reads for gift economy and Room Rocket use the shared cache.
- Successful saves prime the cache with the newly validated config.
- Gift sending and mic-activity payout logic continue to read financial policy directly from Firestore/transactions.

### App Assets
- `/api/app-assets` now caches list and per-key registry reads for 60 seconds.
- Asset updates invalidate the list and affected per-key cache entries.
- Existing HTTP cache headers remain unchanged.

## Financial authority guardrails

The following paths deliberately bypass the config cache:
- Room gift transaction reads `gift_catalog`, `gift_economy`, and `room_rocket` directly inside its Firestore transaction.
- Google Play package validation reads `system_config/recharge` directly before crediting Coins.
- Mic-activity payout calculation reads gift economy policy transactionally.
- Game betting and settlement continue to read authoritative Firestore state/config in their financial path.

The cache can affect display/control reads only; it cannot decide Coins, prices charged, payouts, or settlement.

## Levels

The current room level/capacity policy is code-resident:
- Normal seats: 8, 10, 12, 15, 20, 20.
- Agency seats: 10, 12, 14, 16, 20, 22.

There is no Firestore level-config read to cache. Step 8 intentionally does not add one.

## Queue / batching boundary

No new queue dependency is introduced in Step 8. Financial operations are not queued.

Audit writes that accompany configuration changes remain batched/transactional with their authoritative config write. `recordRoomVisit` remains the separate non-blocking analytics write approved in Step 7. A dedicated analytics queue should only be introduced later if measured pressure justifies the infrastructure and delivery semantics.

## Before / After

- Gift config: Firestore snapshot read per gift-sheet load -> cached API + 30s client cache.
- Recharge config: persistent Firestore screen listener -> one cached API load.
- Game config: isolated 30s cache without cold-request coalescing -> shared 30s cache + single-flight + bounded stale fallback.
- Economy/Rocket admin state: direct config read per state request -> 60s cached read, primed after save.
- App Assets: Firestore registry read/list per Worker request -> 60s read-through cache.
- Levels: 0 Firestore config reads -> 0 Firestore config reads.

## Regression protection

`scripts/pressure_guardrail_audit.py` now fails CI if:
- Gift or recharge config services reintroduce Firestore snapshot listeners.
- Cached user-facing API actions disappear.
- Game config stops using the shared cache or changes its approved 30s TTL.
- A financial room-gift or Google Play path imports the config cache.
- Transactional financial config reads disappear.
- Room level policy gains a new Firestore config dependency.
- App asset cache invalidation disappears.

`server/__tests__/config-cache.test.js` covers fresh reuse, concurrent single-flight, bounded stale-on-transient-error, priming, invalidation, and transient classification.
