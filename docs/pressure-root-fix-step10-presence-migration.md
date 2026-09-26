# Pressure Root Fix — Step 10: Dual Mode Presence Migration

Date: 26 Sep 2026

## Goal

Finish the migration gaps left after Step 4 moved room presence authority from
Firestore heartbeat documents to the Room Durable Object/WebSocket.

Step 10 does not reopen Steps 1–9 and does not change ZEGO, room audio, gift
economics, wallet authority, game outcomes, or financial idempotency.

## Dual Mode rule

For migrated presence decisions:

1. Ask the Room Durable Object `/presence/has`.
2. If it returns `true`, the user is present.
3. If it returns `false`, the user is absent. Do **not** consult legacy
   `room_presence`.
4. Only if realtime itself is unavailable and the lookup returns `null`, use
   the existing <=90s `room_presence.lastSeenAtMs` document as a temporary
   migration fallback.

This keeps Durable Object presence authoritative while preserving a bounded
rollback/fallback path during migration.

## Migrated paths

### Room Gift

Sender and receiver presence now use the shared Durable Object presence helper.
Legacy Firestore presence is read only when realtime is unavailable.

Financial safeguards are unchanged:
- gift price/economy/Rocket policy remain Firestore-authoritative,
- balances and ledgers remain transactional,
- idempotency remains authoritative.

The duplicate operation check runs before presence enforcement. A repeated
idempotency key still returns the original duplicate result even if the sender
or receiver leaves the room after the original successful gift.

### Rocket entry

A user entering the 10-second Rocket window now uses Durable Object presence.
A definitive realtime absence rejects entry even if a fresh legacy presence
document exists. Legacy presence is used only when realtime is unavailable.

Contributor eligibility outside the room and Top 3 extra attempts are
unchanged.

### Room Music

`play` and `skip` validate the source owner through Durable Object presence.
The old `room_presence` lookup is retained only as a bounded fallback when
realtime cannot answer.

### Room Invite

Non-owner room invites use Durable Object presence for the sender. The existing
room-owner bypass, mutual-follow requirement, block checks, rate limiting,
conversation validation, and invite expiry rules are unchanged.

## Tests and guardrails

Automatic PR/Main CI covers:
- shared presence authority true / false / unavailable semantics,
- bounded legacy presence freshness,
- Room Gift Firestore integration with mocked Durable Object presence,
- Room Gift duplicate idempotency after realtime presence changes,
- Rocket integration where realtime presence is authoritative,
- Rocket legacy fallback only when realtime is unavailable,
- pressure guardrails enforcing DO-first behavior for Room Gift, Rocket,
  Music, and Room Invite.

Production Durable Object E2E remains opt-in:
- manual Room Gift workflow opens sender + receiver room WebSockets,
- manual Chat Safety workflow opens the sender room WebSocket and tests
  `sendRoomInvite`,
- automatic Comprehensive explicitly sets
  `ALLOW_PRODUCTION_DURABLE_OBJECT_E2E=0` for these paths so CI does not become
  the first creator of Production room Durable Objects.

## Fallback removal

Step 10 keeps legacy fallback intentionally. It can be removed only after
Step 11 observability and Step 12 progressive stress/reconnect verification
show that realtime presence is consistently available in Production.
