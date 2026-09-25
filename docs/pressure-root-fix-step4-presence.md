# Pressure Root Fix — Step 4 WebSocket Presence

Date: 2026-09-25
Base commit: `d19f59bf434cff0c2050bf81df4e99b4e5479685`

## Scope

Move room presence from Firestore heartbeat documents to the room Durable Object's accepted WebSockets. This step does not move general live room events or game events.

## Presence authority after Step 4

- An accepted WebSocket in `RoomRealtimeObject` means that user is present.
- When the socket closes, that socket stops contributing to presence.
- Multiple sockets for the same UID are deduplicated into one participant.
- Presence snapshots are built from WebSocket attachments; the Durable Object does not import Firestore or Firebase.
- The active Flutter room path has no presence heartbeat timer and performs no `roomPresenceHeartbeat` calls.

## Compatibility behavior kept intact

- ZEGO join remains independent and is not delayed by presence startup.
- Explicit room leave still releases the user's mic seat and records host mic activity through `roomSessionLeave`.
- If the leaving user is the room-music source, the existing music-stop cleanup is preserved.
- Join system messages/VIP join text are preserved through `roomPresenceAnnounceJoin` after the first socket is established.
- Mic invite/approve target validation now checks the Durable Object first. Firestore presence is only a compatibility fallback when the Durable Object binding is unavailable.
- `rooms.onlineCount` / `participantsCount` are still compatibility fields for existing UI until Step 5. Initial join and explicit leave refresh those fields without any presence collection scan.

## Before / After pressure

| Path | Before Step 4 | After Step 4 |
| --- | --- | --- |
| Steady presence per connected user | 1 Firestore presence read + 1 write every 60s | 0 Firestore presence reads/writes per minute; one open WebSocket |
| Join | Presence doc reads/writes + room/profile/user reads + up to 500 presence-doc scan + room aggregate write | Room/profile reads for realtime ticket + DO ticket/WS accept; join announcement keeps existing message/count compatibility without presence scan |
| Presence list | Room read + up to 500 presence-doc scan + stale deletes + aggregate room write | Authenticated Durable Object in-memory snapshot |
| Mic target presence validation | Firestore `room_presence/{room}/users/{uid}` read | Durable Object `/presence/has`; Firestore fallback only if DO unavailable |
| Explicit leave | Room transaction + presence delete + up to 500 scan + room aggregate write | WebSocket close + room session cleanup transaction; no presence document delete/scan |

## Reconnect policy

The client performs at most three short reconnect attempts (1s, 2s, 4s) for a dropped presence socket. This is deliberately bounded so Step 4 cannot create a reconnect storm. Step 9 owns the broader backoff/jitter/circuit-breaker policy.

## Step boundary

Step 4 does not migrate general Online Count delivery or Live Room Events to WebSocket push. Existing count fields remain temporarily compatible until Step 5.
