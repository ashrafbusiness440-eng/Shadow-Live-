# Pressure Root Fix — Step 10: Dual Mode Presence Migration

Date: 26 Sep 2026

## Goal

Remove stale Firestore `room_presence` as the primary room-membership authority for migrated runtime paths while preserving a bounded rollback/fallback path during migration.

The authoritative realtime source is the existing per-room Cloudflare Durable Object and its `/presence/has` endpoint.

## Authority rule

For migrated paths:

1. Query the Room Durable Object.
2. If realtime returns `true`, the user is present.
3. If realtime returns `false`, that result is authoritative and the request is rejected where presence is required.
4. Only if realtime is unavailable and returns `null` may the legacy `room_presence/{roomId}/users/{uid}` document be consulted.
5. Legacy fallback requires a fresh `lastSeenAtMs` within 90 seconds.
6. A fresh legacy document must never override an explicit realtime `false`.

This is Dual Mode compatibility, not dual authority.

## Migrated paths

### Room Gift

Sender and receiver presence are now checked against the Room Durable Object first.

The legacy presence documents are no longer unconditional Firestore reads inside every room-gift transaction. They are read only when realtime lookup is unavailable.

Financial invariants remain unchanged:
- Idempotency remains authoritative.
- Existing completed `gift_operations/{idempotencyKey}` returns `duplicate` before presence enforcement.
- Balances, gift pricing, earnings, agency accrual, ledgers, support aggregation, Rocket state, and settlement remain Firestore/server authoritative.
- No financial result is cached or derived from presence fallback.

### Room Invite

Non-owner senders must be present according to realtime.

The existing room-owner bypass remains unchanged.

When realtime is unavailable only, the old presence document may be used temporarily.

### Rocket entry

Entry during the 10-second reward window now checks realtime room presence first.

An explicit realtime absence rejects the entry even if an old Firestore presence document is still fresh.

Contributors outside the room remain eligible for the existing contributor reward path; this migration changes only the room-entry eligibility check.

### Music play / skip

The selected track's `sourceOwnerUid` is checked against realtime presence first.

An explicit realtime absence returns `music_source_offline`.

Legacy presence is consulted only when realtime is unavailable.

## Shared helper

`cloudflare-worker/src/room-presence-authority.js` centralizes:
- Durable Object lookup.
- `/presence/has` semantics.
- Legacy presence freshness validation.

The helper deliberately returns `null` only when realtime is unavailable. It does not convert an explicit `false` into fallback.

## Test policy

PR/local CI:
- Shared presence authority unit tests cover realtime true/false/unavailable semantics.
- Room Gift Firestore emulator integration uses a mock Durable Object namespace contract instead of seeding legacy presence.
- Room Gift idempotency is tested after realtime presence changes to absent.
- Rocket integration tests exercise realtime present, realtime absent overriding legacy presence, and legacy fallback only on realtime unavailable.

Production E2E:
- Automatic Comprehensive remains forbidden from creating Production room Durable Objects.
- Manual Room Gift E2E explicitly opts in and opens live WebSockets for sender and receiver before sending a gift.
- Manual Chat Safety E2E explicitly opts in and tests Room Invite from a live room WebSocket.
- Automatic Comprehensive sets `ALLOW_PRODUCTION_DURABLE_OBJECT_E2E=0` for these scripts and records them as manual/release-only realtime coverage.

## Guardrails

`scripts/pressure_guardrail_audit.py` protects:
- DO-first authority on Room Gift, Room Invite, Rocket, and Music.
- Explicit false must not fall back.
- Room Gift duplicate handling must precede presence enforcement.
- Manual Production DO opt-in.
- Automatic Production DO prohibition.
- Existing Step 4–9 pressure/reliability invariants.

## Not part of this step

The following expanded-audit items remain separate:
- Global Rocket feed migration away from a global Firestore listener.
- Rocket client retry-storm removal.
- High-frequency `rooms/{roomId}` root write fan-out from chat/gifts.
- Step 11 observability and measurement.
- Step 12 upstream Firestore quota and progressive stress tests.
