# Pressure Root Fix — Step 6 Game Realtime Events

Date: 2026-09-25
Base commit: `2af5101f0cc5cff2f548abd2092ecaac65da6641`

## Scope

Remove periodic non-slot game state polling and move round phase delivery to the existing per-room Durable Object WebSocket. Keep betting, balances, outcomes, payouts, settlement, and ledger writes server-authoritative.

## Realtime game contract

The server schedules and the room Durable Object broadcasts these events over the same room WebSocket already used for Presence and room events:

- `game.round_started`
- `game.betting_closed`
- `game.result`
- `game.next_round`

The 250ms Flutter ticker remains local-only for countdown rendering and animation. It performs no network request.

## Authority boundary

- `legacy-games/game-runtime.js` remains the authority for game configuration, deterministic outcome resolution, bets, Coins, payouts, settlement, and financial ledger writes.
- `RoomRealtimeObject` does not import Firestore/Firebase and does not calculate outcomes or payouts.
- `gameState` prepares a short-lived server-built schedule for the current round and the next round, including the hidden outcome. The outcome stays inside server-side Durable Object storage and is not broadcast before `revealAtMs`.
- The Durable Object is only a transient scheduler/broadcaster.

## Client flow

1. Opening a non-slot game performs one authoritative `state` request with the active Room ID.
2. That response provides the current snapshot and registers the current/next server schedule in the room Durable Object.
3. No 10-second Timer polling is started.
4. Local countdown/animation continues from server timestamps.
5. `game.betting_closed` changes the visual phase without a state request.
6. `game.result` triggers one authoritative state refresh. That refresh settles the current user's due operation and returns personal payout/ranking while also extending the next round schedule.
7. `game.next_round` / `game.round_started` move the client to the next server-scheduled round without polling.
8. `server.ready` after a WebSocket reconnect triggers one state resync for recovery.

## Betting presence

Production `placeBet` now validates room presence from the room Durable Object before the financial transaction. `room_presence` is used only when the Durable Object binding is unavailable as a migration fallback. A duplicate idempotency key remains duplicate-safe even if the user has already disconnected.

## Before / After pressure

| Path | Before Step 6 | After Step 6 |
| --- | --- | --- |
| Non-slot game state | Every player: one state HTTP request every 10s (6/min) | No periodic polling; initial state + pushed phases + one result-triggered authoritative refresh per round |
| Local countdown | 250ms UI ticker | Same 250ms UI ticker; still zero network |
| Betting presence check | Firestore `room_presence` read inside each transaction | Durable Object presence check; Firestore presence only fallback |
| Outcome delivery | Discovered by next periodic state request | Server-scheduled `game.result` WebSocket event at reveal time |
| Next round | Discovered by polling/phase refresh | `game.next_round` + `game.round_started` push |

## Reliability details

- Re-registering a round preserves sent-phase flags and cannot replay already delivered phase events.
- The hidden outcome is never included in `round_started` or `betting_closed`; it appears only in `game.result` at/after reveal.
- Two schedules are retained per state refresh (current + next), with the following round metadata attached, so one missed client refresh does not immediately break the next transition.
- A stale state HTTP response cannot overwrite a newer round already applied from WebSocket.

## Step boundary

Step 6 does not implement Room Bootstrap, config caching, general retry/jitter/circuit breaker, or observability. Those remain Steps 7–11.
