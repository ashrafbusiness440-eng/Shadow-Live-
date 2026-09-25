# Pressure Root Fix — Step 5 Online Count + Live Room Events

Date: 2026-09-25
Base commit: `b0982c8b5c7a703b83dbb7ec99e8da7663ebd096`

## Scope

Move volatile room online counts and transient room events off Firestore and onto the existing per-room Durable Object WebSocket. Games remain untouched until Step 6.

## Realtime behavior

- `RoomRealtimeObject` broadcasts `room.online_count` after connect and disconnect.
- Counts deduplicate multiple sockets for the same UID.
- `server.ready` carries the current online count for the joining client.
- `room.presence_joined` and `room.presence_left` are live WebSocket events.
- Entrance cosmetics are broadcast as `room.entrance`; `recentEntrance` is no longer written to `rooms/{roomId}`.
- The Flutter voice session consumes the same single room WebSocket opened for Presence; Step 5 does not create another room socket.

## Firestore writes removed from the active path

- `roomPresenceAnnounceJoin` no longer writes `onlineCount`, `participantsCount`, or `lastPresenceAtMs` to the room document.
- `roomSessionLeave` no longer writes those volatile count fields.
- `announceRoomEntrance` no longer writes `recentEntrance` to the room document.
- Explicit leave still persists only durable cleanup when required: seats/mic activity and room music state.

## Counts outside the room

- Home and room discovery fetch Firestore only for persistent room metadata.
- A single authenticated `presenceCounts` request asks Cloudflare for up to 60 room IDs.
- Cloudflare fans out to room Durable Objects in bounded batches of 12 and performs no Firestore writes.
- Read-only count requests use token verification with `checkUserState: false` to avoid an unnecessary Firestore user-state lookup.
- Favorite/history room library responses hydrate `onlineCount` from the Durable Object.
- Room ranking uses live Durable Object counts in bounded batches and no longer depends on `lastPresenceAtMs` for the presence bonus.

## Compatibility and fallback

- If a batch count lookup fails for a specific room, that room is omitted from the count response so clients can temporarily fall back to the existing room metadata during rollout.
- Legacy Firestore presence actions remain available only as compatibility fallback; the active app path does not use them.

## Before / After

| Area | Before Step 5 | After Step 5 |
| --- | --- | --- |
| In-room online count | Read from `rooms/{roomId}` snapshots and updated by join/leave room writes | Pushed over the existing room WebSocket |
| Room join/leave count persistence | Firestore room write on join/leave | 0 volatile count writes |
| Entrance effect | `recentEntrance` write to room doc, fanning out to room listeners | `room.entrance` WebSocket event, 0 room-doc write |
| Home/room-list count | Firestore room field | One batch HTTP request, DO count reads only |
| Presence bonus for room activity | `lastPresenceAtMs` Firestore field | Live online count > 0 |

## Step boundary

Seat state, moderators, room lifecycle, music state, PK, Star Battle, chat, Rocket, and game state are not migrated by Step 5 unless specifically needed to preserve the online-count/event contract. Game polling remains 10 seconds until Step 6.
