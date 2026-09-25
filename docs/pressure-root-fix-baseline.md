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
| Cloudflare Firestore transient attempts | Step 9 borrowed: max 3 with bounded backoff + jitter | Must stay bounded; no tight retry loops |
| Auth-state transient attempts | Step 9 borrowed: max 3 with bounded exponential backoff + jitter | Circuit breaker + in-flight coalescing prevent amplification |
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

## Step 5 migration note — Online Count + Live Events

Volatile room count/event state is no longer allowed to return to Firestore on the active path.

- `onlineCount`, `participantsCount`, and `lastPresenceAtMs` must not be written by active join/leave actions.
- In-room online count comes from the existing room WebSocket.
- `recentEntrance` must not be persisted to `rooms/{roomId}`; entrance effects are WebSocket events.
- Discovery uses one batch count request with bounded Durable Object fan-out.
- Seat Firestore snapshots must not overwrite the WebSocket online count.
- Games remain on the Step 4 baseline until Step 6.

## Step 6 migration note — Game WebSocket phases

The old 10-second non-slot game state poll is intentionally removed in Step 6.

- Periodic game network polling must remain absent from `RoomGameOverlaySheet`.
- The 250ms game ticker is UI-only and must not perform network I/O.
- Game phase delivery uses the existing room WebSocket: `game.round_started`, `game.betting_closed`, `game.result`, and `game.next_round`.
- A pushed `game.result` may trigger exactly an event-driven authoritative state refresh for personal settlement/result details; this is not periodic polling.
- Bets, balances, outcomes, payouts, settlement, and financial ledger remain in the server-authoritative game runtime.
- Durable Object game scheduling must remain transient and must not import Firestore/Firebase.
- Production bet presence validation uses room WebSocket Presence, with legacy `room_presence` only as a migration fallback.

## Step 9 borrowed early — Auth-state reliability

This subset was pulled forward during Step 6 because production Economy/Settlement E2E repeatedly failed before game logic with `auth_state_lookup_failed`.

- Auth-state transient retry cap: 3 attempts.
- Backoff: bounded exponential delay starting at 350ms with up to 220ms jitter.
- Retry-After is honored but capped at 2500ms.
- Same-UID concurrent auth-state reads are coalesced in-flight.
- Circuit breaker opens after 2 exhausted transient lookup failures for 5 seconds.
- A previously verified session state may be used stale for at most 30 seconds only during transient upstream failure; unknown users still fail closed.
- Normal fresh auth-state cache TTL is 10 seconds.
- No change to token signature verification, accountStatus semantics, session revocation checks, roles, capabilities, games, balances, or settlement authority.
- Flutter CI concurrency is isolated per Git ref, so a main run or unrelated PR no longer cancels the active Step 6 validation run.
- This completes only the auth-state reliability + Flutter CI isolation subsets of Step 9. The Step 9 root item remains open for broader retry/circuit-breaker and production-test coordination work.

## Step 9 borrowed early — Single authoritative user read

Pulled forward during Step 6 production closure after version 21 still showed auth/session pressure.

- Admin/economy actor requests that already load `users/{uid}` now verify the Firebase token signature first with `checkUserState:false`, then apply `accountStatus` and `sessionsRevokedAt` checks to that same actor snapshot.
- This removes the duplicate `users/{uid}` lookup while preserving the same session-revocation and account-status enforcement. There is no fail-open behavior.
- Room realtime `ticket` now uses `users/{uid}` as the authoritative user/session/profile source together with `rooms/{roomId}`; the duplicate `public_profiles/{uid}` read is removed from the normal ticket path.
- Room ticket pressure changes from 3 Firestore reads (auth user + room + public profile) to 2 reads (user + room).
- Economy/admin actor pressure changes from 2 user reads (auth-state + permissions) to 1 user read.
- `presenceState` and other read-only realtime actions keep their existing authentication semantics.
- User-visible room name/photo behavior is expected to remain unchanged because the application keeps authoritative public profile identity fields synchronized with the user document.
- This is another completed subset of Step 9 only; the Step 9 root item remains open.

## Step 9 borrowed early — Firestore transient reliability

Pulled forward during Step 6 closure after production E2E returned `RESOURCE_EXHAUSTED` from Firestore.

- Firestore transient reads/queries/begin/rollback use a small cap of 3 attempts.
- Backoff starts at 350ms and doubles, with up to 250ms jitter.
- Retry-After is honored up to 2500ms.
- `RESOURCE_EXHAUSTED`, `UNAVAILABLE`, 408, 429, and 5xx are treated as transient for eligible read/control paths.
- Legacy transaction loops are reduced from 5 attempts to 3 and now wait with backoff+jitter before retrying.
- Manage-user-access and manage-user-account transaction retries use the same bounded transient policy.
- Firestore commits are still not blindly retried at the HTTP layer; transaction/idempotency logic remains the authority for write safety.
- This is a borrowed subset of Step 9 only; Step 9 root remains open.

## Step 9 borrowed early — Serial production validation

Pulled forward during Step 6 closure after automatic main-branch E2E workflows created simultaneous Firestore spikes and repeatedly produced `RESOURCE_EXHAUSTED` / 429 failures.

- The standalone Phase 6, Economy Router, User Moderation, and User Access production E2E workflows remain available through `workflow_dispatch` but no longer auto-run in parallel on every `main` push.
- `Cloudflare Phase 8 Comprehensive E2E` becomes the single automatic production gate for relevant Worker changes.
- The comprehensive gate now includes moderation, role/capability, economy-router, and Phase 6 settlement/game checks sequentially.
- Short Firestore cooldown gaps are inserted between heavy suites so CI itself does not generate a burst that resembles production load.
- The comprehensive gate triggers for all Worker source/script/wrangler changes and for changes to the E2E workflow definitions.
- If a commit changes CI only and not Worker source, the gate uses the currently deployed Worker instead of waiting forever for an impossible matching Worker build SHA.
- This is a borrowed Step 9 CI-pressure subset only; the Step 9 root item remains open.
