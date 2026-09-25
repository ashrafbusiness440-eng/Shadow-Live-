# Pressure Root Fix — Step 7 Room Bootstrap

Date: 2026-09-26  
Base commit: `f181f210620e26df23c63d1951c04f8cde5c3256`

## Goal

Replace the room-entry request/listener fan-out with one non-blocking initial Room Bootstrap while preserving the existing fast ZEGO join path. After bootstrap, the existing VoiceRoomSessionController room snapshot stream feeds room/seat/moderator updates and WebSocket continues to own online count/live events/game phases.

## Bootstrap contract

One `roomBootstrap` request returns:

- Room metadata needed by the room UI.
- Owner/host profile summary.
- Normalized seat state.
- Current user's room permissions/moderator state.
- Room insights and daily Top 3 supporters.
- Current Rocket state.
- Current game availability/catalog.
- Server timestamp and live Durable Object online count.

The backend reuses the same `users/{uid}` actor snapshot for session-state enforcement and room permission calculation; it does not add a second auth-state user lookup.

## Runtime flow

1. ZEGO room join remains first and is not blocked by Bootstrap.
2. After successful voice join, Room Bootstrap starts unawaited.
3. The initial snapshot fills seats, permissions, insights, Top 3, Rocket and game availability.
4. The existing VoiceRoomSessionController listener on `rooms/{roomId}` becomes the single shared room document stream for lifecycle/music/background/seats/moderators.
5. Online count and live room/game events remain WebSocket/DO authoritative.
6. Game overlay reuses the bootstrap catalog and skips an additional catalog request.
7. Rocket sheet uses the bootstrap state as its initial value and only opens its existing live stream on demand.
8. `recordRoomVisit` remains a separate non-blocking analytics write by design.

## Before / After

| Path | Before Step 7 | After Step 7 |
| --- | --- | --- |
| Initial owner identity | Direct `public_profiles/{owner}` client read | Included in Bootstrap response |
| Initial room insights | Separate `roomInsights` HTTP request | Included in Bootstrap response |
| Initial seats | Separate room Firestore listener | Included in Bootstrap, then shared room stream |
| Initial moderator permissions | Separate room Firestore listener | Included in Bootstrap, then shared room stream |
| Room document listeners | Lifecycle + Seats + Moderators = up to 3 listeners to same room doc | One lifecycle/shared room listener |
| Top supporters | Part of separate insights request | Included in Bootstrap |
| Rocket initial state | Only loaded when Rocket sheet stream starts | Bootstrap seeds initial state; stream remains on-demand |
| Game availability | Separate catalog request when game overlay opens | Bootstrap catalog reused when available |
| Online count | WebSocket/DO | Unchanged: WebSocket/DO |
| Voice join | ZEGO join | Unchanged; Bootstrap does not block it |

## Authority / behavior invariants

- ZEGO remains the audio provider.
- No artificial delay is added to room join.
- Mic/seat behavior and room UI semantics stay unchanged.
- Game timing, outcomes, bets, Coins/Diamonds, gifts, settlement and ledger authority stay unchanged.
- Durable Object remains realtime-only and Firestore remains durable/financial authority.
- Existing action requests after user interaction remain valid; Step 7 only consolidates initial room hydration and duplicate room listeners.

## Failure behavior

Bootstrap is non-critical to audio. If Bootstrap is temporarily unavailable, the voice room remains connected and the shared room snapshot stream continues to keep seats/moderator state live. The existing Firestore quota blocker is tracked separately under Steps 9/12.

## Step boundary

Step 7 does not implement the broader config caching / KV / Queue / Batching work reserved for Step 8.
