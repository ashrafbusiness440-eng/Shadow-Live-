# Pressure Root Fix — Step 2 Performance Baseline

Baseline date: 2026-09-25  
Baseline commit: `3e7bd6f86a5de2516a4b27bd4f7d1a68f284d7ba`

This file freezes the user-visible behavior and pressure-sensitive runtime assumptions before the Durable Object/WebSocket migration. It is a regression contract, not a target architecture. Existing hot spots may be reduced or removed by later steps, but new pressure must not be added silently.

## User-visible invariants

- Room opening must not gain artificial waits or delays.
- ZEGO remains the audio provider and the voice join/mic behavior must not be slowed by pressure work.
- Mic toggle, playback toggle, room buttons, gifts, wallet operations, bets, results, and game timing remain behaviorally unchanged.
- Local animation/countdown timers are not network polling and must not be slowed as a pressure fix.
- Financial and game settlement authority remains server-side.

## Current pressure/timing baseline

| Area | Baseline | Guardrail |
| --- | --- | --- |
| Presence heartbeat | 60 seconds | Exact interval while legacy path exists |
| Presence heartbeat work | O(1): own presence read/write only; profile lookup only if missing | Full-room scan and room document write are forbidden in heartbeat |
| Legacy presence aggregation | Scan cap 500 docs at Join/Leave/State | Cap may decrease/remove, never increase |
| Game state safety polling | 10 seconds for non-slot games | Exact interval until replaced by push |
| Game UI ticker | 250 ms local-only | Exact behavior baseline |
| Game fallback round duration | 30 seconds | Exact until an explicitly approved game-timing change |
| Game fallback lock-before-result | 3000 ms | Exact |
| Game fallback result hold | 4000 ms | Exact |
| Cloudflare Firestore transient attempts | max 2 | Must not increase |
| Auth-state transient attempts | max 2 | Must not increase |
| Cloudflare settlement cron | every 5 minutes | Exact until settlement architecture is intentionally changed |
| Room realtime listeners | current per-file caps | May decrease/remove; may not increase without updating this baseline |
| RoomInsights cache | 10s normal / 15s expanded | Existing behavior retained during Step 2 |

## Critical listener caps

These caps are deliberately *maximums*, so later migration to WebSocket/Durable Objects can reduce them without changing this file:

- `voice_room_session_controller.dart`: 2 direct Firestore snapshots (room lifecycle + current-user ban).
- `room_seat_service.dart`: 1.
- `room_moderator_service.dart`: 1.
- `room_music_service.dart`: 1.
- `room_pk_service.dart`: 1.
- `star_battle_service.dart`: 1.
- `room_rocket_service.dart`: 2.
- `room_chat_service.dart`: 1.

## Before/After contract for every later Pressure Root Fix step

Every later migration PR must record:

1. Which network/Firestore calls are removed, added, or changed.
2. Before/After expected reads, writes, requests/minute, and realtime listener count for the affected path.
3. Whether room-open, voice, mic, game timing, gifts, wallet, bets, results, or button response changed. Expected answer is **no** unless explicitly approved.
4. Flutter analyze/tests, browser E2E, and the pressure regression guardrail result.
5. For runtime migrations, p50/p95/p99 and 429/5xx/reconnect measurements once observability/load-test stages are available.

## CI synthetic readiness metric

The voice-room Playwright E2E records `navigationToGameOverlayReadyMs`. This is a CI rendering/readiness metric only; it is not a production latency SLO and does not replace Step 11/12 runtime observability and stress testing.

## Known hotspots intentionally not fixed in Step 2

Step 2 does not alter production behavior. The following remain documented for later steps:

- `refreshRoomPresenceSummary` can scan up to 500 presence documents at Join/Leave/State.
- Non-slot game state still uses a 10-second safety poll.
- Multiple room features still use independent Firestore listeners.
- Global Rocket events still watch up to 80 recent explosions.
- A Firebase scheduled `gameSettlementWorker` remains in source at one-minute cadence; its deployed production status must be verified before settlement migration.

## Step 4 migration note — WebSocket Presence

The original 60-second Firestore heartbeat was intentionally removed in Step 4. The regression guardrail now forbids reintroducing a presence timer or legacy presence actions into the active room-session path.

The new protected baseline is:

- Presence authority: accepted WebSockets in the room Durable Object.
- Steady-state Firestore presence reads/writes per connected user: 0/minute.
- Presence collection scans on the active app path: 0.
- Presence reconnect attempts: bounded to three short attempts.
- ZEGO, room-open behavior, mic behavior, game timing, gifts, wallet, and button behavior remain unchanged.
- `rooms.onlineCount` and `participantsCount` remain compatibility fields until Step 5 moves count/event delivery.
