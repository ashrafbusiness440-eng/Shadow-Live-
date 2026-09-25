# Pressure Root Fix — Step 3 Room Realtime Architecture

Date: 2026-09-25
Foundation commit base: `ef2c9932fee9f2f5614ce0864e1ca61444974bd1`

## Final ownership model

| Domain | Authority | Transport / runtime role |
| --- | --- | --- |
| Voice/audio media | ZEGO | Audio room join, publish, playback and stream transport |
| Persistent room/user state | Firestore | Durable source of truth |
| Coins, Diamonds, gifts, bets, settlement, ledgers | Firestore + server-authoritative Cloudflare handlers | Never authoritative in a Durable Object |
| Room realtime coordination | One `RoomRealtimeObject` per Room ID | Cloudflare Durable Object |
| Realtime delivery | WebSocket | Server push to clients; later steps migrate domains gradually |

## Durable Object identity

`env.ROOM_REALTIME.idFromName(roomId)` is the only mapping used by the Worker. The Room ID therefore deterministically selects exactly one coordinator instance for that room.

## WebSocket lifecycle

1. Authenticated non-guest client requests a ticket with `POST /api/room-realtime` and a Room ID.
2. Worker verifies the Firebase ID token and confirms the room still exists and is active in Firestore.
3. Worker stores a random 45-second, single-use ticket inside that room's Durable Object.
4. Client upgrades `GET /api/room-realtime?roomId=...&ticket=...` to WebSocket.
5. Durable Object consumes the ticket before accepting the socket and attaches `roomId`, `uid`, `connectionId`, and connect time to the hibernatable socket.
6. Server sends `server.ready` with protocol version and server clock.

Tickets are transient connection credentials only. They are not user/session authority and expired unused tickets are cleaned by a Durable Object alarm.

## Hibernation

The object uses Cloudflare's Hibernation WebSocket API (`ctx.acceptWebSocket`) rather than pinning an object in memory. A plain-text `ping` can be answered as `pong` by the runtime auto-response path without waking the object.

## Protocol boundary in Step 3

Protocol version is `1`. Client business messages are deliberately disabled. Only ping/pong is accepted. Presence, online count, room events and games remain on their existing paths until their own migration steps.

This prevents Step 3 from silently becoming Step 4/5/6 and keeps Dual Mode/fallback work explicit.

## Persistence rule

`RoomRealtimeObject` must not import Firestore or Firebase and must not become authoritative for financial/business state. Its storage is currently limited to short-lived handshake tickets and WebSocket attachments. Server-authoritative persistent changes remain in existing APIs/Firestore.

## Before / After for Step 3

- Firestore reads during the current app runtime: unchanged, because the app does not connect to the new WebSocket yet.
- Firestore writes during the current app runtime: unchanged.
- Existing Firestore listeners: unchanged.
- Existing game polling: unchanged at 10 seconds.
- Existing presence heartbeat: unchanged at 60 seconds.
- Room-open/ZEGO/mic/game/gift/wallet behavior: unchanged.
- New production capability after Worker deploy: an authenticated, idle realtime socket foundation is available for later migration steps.

## Step boundaries

- Step 4: move Presence first.
- Step 5: move Online Count / Live Room Events.
- Step 6: remove final game polling in favor of pushed game events.
- Step 7: consolidate Room Bootstrap.

No later-domain migration is included in Step 3.
