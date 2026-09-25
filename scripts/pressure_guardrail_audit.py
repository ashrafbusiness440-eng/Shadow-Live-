#!/usr/bin/env python3
from __future__ import annotations

import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def read(rel: str) -> str:
    path = ROOT / rel
    if not path.exists():
        raise AssertionError(f"missing required file: {rel}")
    return path.read_text(encoding="utf-8")


def require(pattern: str, text: str, label: str, flags: int = 0) -> None:
    if re.search(pattern, text, flags) is None:
        raise AssertionError(label)


def function_body(text: str, name: str) -> str | None:
    match = re.search(rf"(?:async\s+)?function\s+{re.escape(name)}\s*\(", text)
    if match is None:
        return None
    start = text.find("{", match.end())
    if start < 0:
        return None
    depth = 0
    quote = None
    escaped = False
    for index in range(start, len(text)):
        char = text[index]
        if quote is not None:
            if escaped:
                escaped = False
            elif char == "\\":
                escaped = True
            elif char == quote:
                quote = None
            continue
        if char in {"'", '"', "`"}:
            quote = char
            continue
        if char == "{":
            depth += 1
        elif char == "}":
            depth -= 1
            if depth == 0:
                return text[start : index + 1]
    return None


def main() -> int:
    failures: list[str] = []
    notes: list[str] = []

    def check(fn) -> None:
        try:
            fn()
        except AssertionError as error:
            failures.append(str(error))

    voice = read("lib/features/voice/services/voice_room_session_controller.dart")
    presence_service = read("lib/features/room/services/room_presence_service.dart")
    game_overlay = read("lib/features/games/widgets/room_game_overlay.dart")
    zego = read("lib/features/voice/services/zego_voice_service.dart")
    firestore = read("cloudflare-worker/src/firestore.js")
    auth = read("cloudflare-worker/src/firebase-auth.js")
    worker = read("cloudflare-worker/src/voice-session-legacy.js")
    wrangler = read("cloudflare-worker/wrangler.toml")
    game_runtime = read("cloudflare-worker/src/legacy-games/game-runtime.js")
    realtime_object = read("cloudflare-worker/src/room-realtime-object.js")
    realtime_protocol = read("cloudflare-worker/src/room-realtime-protocol.js")
    worker_index = read("cloudflare-worker/src/index.js")
    app_main = read("lib/main.dart")
    discovery = read("lib/features/home/services/discovery_service.dart")
    realtime_query = read("lib/features/room/services/room_realtime_query_service.dart")

    if "_presenceTimer" in voice or ".heartbeat(" in voice:
        failures.append("Step 4 regression: Firestore presence heartbeat returned to the room session")
    check(lambda: require(
        r"_presenceService\.join\(targetRoomId\)",
        voice,
        "Step 4 regression: room session no longer starts WebSocket presence",
    ))
    check(lambda: require(
        r"connectRoomPresenceSocket",
        presence_service,
        "Step 4 regression: presence service is not using WebSocket transport",
    ))
    check(lambda: require(
        r"'action': 'ticket'",
        presence_service,
        "Step 4 regression: presence service no longer requests a realtime ticket",
    ))
    check(lambda: require(
        r"'action': 'presenceState'",
        presence_service,
        "Step 4 regression: presence state no longer comes from the Durable Object",
    ))
    check(lambda: require(
        r"'action': 'roomSessionLeave'",
        presence_service,
        "Step 4 regression: explicit leave no longer preserves room session cleanup",
    ))
    for legacy_action in (
        "roomPresenceJoin",
        "roomPresenceHeartbeat",
        "roomPresenceLeave",
        "roomPresenceState",
    ):
        if legacy_action in presence_service:
            failures.append(
                f"Step 4 regression: active app presence path references legacy {legacy_action}"
            )
    check(lambda: require(
        r"_poller\s*=\s*Timer\.periodic\([\s\S]{0,260}?const Duration\(seconds:\s*10\)",
        game_overlay,
        "game safety polling changed from the 10s baseline",
    ))
    check(lambda: require(
        r"_ticker\s*=\s*Timer\.periodic\(\s*const Duration\(milliseconds:\s*250\)",
        game_overlay,
        "local game UI ticker changed from the 250ms behavior baseline",
        re.S,
    ))
    check(lambda: require(
        r"final VoiceService _voiceService = ZegoVoiceService\(\);",
        voice,
        "ZEGO is no longer the selected VoiceService implementation",
    ))
    check(lambda: require(
        r"const maxAttempts = retryTransient \? 2 : 1;",
        firestore,
        "Cloudflare Firestore retry ceiling changed from 2 attempts",
    ))
    check(lambda: require(
        r"for \(let attempt = 0; attempt < 2; attempt\+\+\)",
        auth,
        "auth-state retry ceiling changed from 2 attempts",
    ))
    check(lambda: require(
        r'crons\s*=\s*\["\*/5 \* \* \* \*"\]',
        wrangler,
        "Cloudflare settlement cron changed from every 5 minutes",
    ))

    check(lambda: require(
        r'name\s*=\s*"ROOM_REALTIME"[\s\S]*?class_name\s*=\s*"RoomRealtimeObject"',
        wrangler,
        "Room realtime Durable Object binding is missing",
    ))
    check(lambda: require(
        r'new_sqlite_classes\s*=\s*\[\s*"RoomRealtimeObject"\s*\]',
        wrangler,
        "RoomRealtimeObject must stay on SQLite-backed Durable Objects",
    ))
    check(lambda: require(
        r'export \{ RoomRealtimeObject \} from "\./room-realtime-object\.js";',
        worker_index,
        "RoomRealtimeObject is not exported from the Worker entrypoint",
    ))
    check(lambda: require(
        r'url\.pathname === "/api/room-realtime"',
        worker_index,
        "room realtime Worker route is missing",
    ))
    check(lambda: require(
        r"ROOM_REALTIME_TICKET_TTL_MS\s*=\s*45_000",
        realtime_protocol,
        "room realtime ticket TTL changed from 45 seconds",
    ))
    if "acceptWebSocket" not in realtime_object:
        failures.append("RoomRealtimeObject is not using the hibernation WebSocket API")
    if ".accept(" in realtime_object:
        failures.append("RoomRealtimeObject must use ctx.acceptWebSocket, not ws.accept")
    if "firestore" in realtime_object.lower() or "firebase" in realtime_object.lower():
        failures.append("RoomRealtimeObject must not become a Firestore/Firebase authority")
    for route in ("/presence", "/presence/has", "/presence/count"):
        if route not in realtime_object:
            failures.append(f"Realtime Durable Object route missing: {route}")
    for event_type in (
        "room.online_count",
        "room.presence_joined",
        "room.presence_left",
    ):
        if event_type not in realtime_object:
            failures.append(f"Step 5 regression: realtime event missing: {event_type}")
    if "presenceSnapshotFromAttachments" not in realtime_object:
        failures.append("Step 4 regression: socket attachments are not the presence source")
    if "assertRoomRealtimePresence(db,roomId,targetUid)" not in worker:
        failures.append("Step 4 regression: mic target validation is not using realtime presence")
    if 'action==="roomSessionLeave"' not in worker:
        failures.append("Step 4 regression: roomSessionLeave cleanup action is missing")

    if "_handleSocketMessage" not in presence_service or "RoomRealtimeEvent" not in presence_service:
        failures.append("Step 5 regression: client no longer parses realtime room events")
    if "_presenceService.events.listen(_handleRealtimeEvent)" not in voice:
        failures.append("Step 5 regression: voice session is not consuming the single room WebSocket event stream")
    if "'recentEntrance': data['recentEntrance']" in voice:
        failures.append("Step 5 regression: transient entrance event returned to the Firestore room listener")
    if re.search(r"'onlineCount'\s*:\s*state\.onlineCount", app_main):
        failures.append("Step 5 regression: seat Firestore snapshots overwrite WebSocket online count")
    if "RoomRealtimeQueryService" not in discovery or "hydrateRealtimeCounts" not in discovery:
        failures.append("Step 5 regression: discovery no longer hydrates online counts from Durable Objects")
    if "'action': 'presenceCounts'" not in realtime_query:
        failures.append("Step 5 regression: discovery batch count API is missing")
    room_realtime = read("cloudflare-worker/src/room-realtime.js")
    if "checkUserState: false" not in room_realtime:
        failures.append("Step 5 regression: read-only presenceCounts performs avoidable user-state Firestore checks")
    if "const batchSize = 12;" not in room_realtime:
        failures.append("Step 5 regression: presenceCounts lost its bounded Durable Object fan-out")
    for function_name in ("roomPresenceAnnounceJoin", "roomSessionLeave"):
        body = function_body(worker, function_name)
        if body is None:
            failures.append(f"Step 5 regression: {function_name} missing")
            continue
        for volatile_field in ("onlineCount", "participantsCount", "lastPresenceAtMs"):
            if volatile_field in body:
                failures.append(
                    f"Step 5 regression: {function_name} writes/depends on volatile room field {volatile_field}"
                )
    entrance = function_body(worker, "announceRoomEntrance")
    if entrance is None:
        failures.append("Step 5 regression: announceRoomEntrance missing")
    else:
        if "recentEntrance" in entrance:
            failures.append("Step 5 regression: entrance effect is persisted back into rooms/{roomId}")
        if 'broadcastRoomRealtimeEvent' not in entrance or '"room.entrance"' not in entrance:
            failures.append("Step 5 regression: entrance effect is not broadcast over room WebSocket")
    def no_join_delay() -> None:
        start = voice.find("Future<void> join(")
        end = voice.find("Future<void> toggleMic()", start)
        if start < 0 or end < 0:
            raise AssertionError("unable to locate room join path")
        body = voice[start:end]
        if "Future.delayed" in body:
            raise AssertionError("room join path gained an artificial Future.delayed")
    check(no_join_delay)

    heartbeat = function_body(worker, "roomPresenceHeartbeat")
    if heartbeat is None:
        notes.append("legacy roomPresenceHeartbeat removed; old-path heartbeat checks skipped")
    else:
        if "refreshRoomPresenceSummary" in heartbeat:
            failures.append("roomPresenceHeartbeat reintroduced full presence aggregation")
        if ".limit(" in heartbeat:
            failures.append("roomPresenceHeartbeat reintroduced collection scanning")
        if 'collection("rooms")' in heartbeat:
            failures.append("roomPresenceHeartbeat reintroduced room document reads/writes")

    summary = function_body(worker, "refreshRoomPresenceSummary")
    if summary is None:
        notes.append("legacy refreshRoomPresenceSummary removed; scan-cap check skipped")
    else:
        match = re.search(r"\.limit\((\d+)\)\.get\(\)", summary)
        if match is not None and int(match.group(1)) > 500:
            failures.append("presence aggregation scan cap increased above 500 documents")

    listener_caps = {
        "lib/features/voice/services/voice_room_session_controller.dart": 2,
        "lib/features/room/services/room_seat_service.dart": 1,
        "lib/features/room/services/room_moderator_service.dart": 1,
        "lib/features/room/services/room_music_service.dart": 1,
        "lib/features/room/services/room_pk_service.dart": 1,
        "lib/features/room/services/star_battle_service.dart": 1,
        "lib/features/room/services/room_rocket_service.dart": 2,
        "lib/features/room/services/room_chat_service.dart": 1,
    }
    for rel, cap in listener_caps.items():
        content = read(rel)
        count = len(re.findall(r"\.snapshots\s*\(", content))
        if count > cap:
            failures.append(
                f"{rel}: realtime listener count increased from baseline cap {cap} to {count}"
            )

    for field, value in (
        ("roundDurationSeconds", "30"),
        ("lockBeforeMs", "3000"),
        ("resultHoldMs", "4000"),
    ):
        if re.search(rf"{field}:\s*{value}\b", game_runtime) is None:
            failures.append(f"game timing baseline changed: {field} != {value}")

    if failures:
        print("Pressure regression guardrail FAILED:")
        for failure in failures:
            print(f" - {failure}")
        if notes:
            print("Notes:")
            for note in notes:
                print(f" - {note}")
        return 1

    print("Pressure regression guardrail passed.")
    print("Protected baselines: room join, ZEGO, mic path, WebSocket presence/count/events, game polling/timing, retries, cron, and critical listener caps.")
    for note in notes:
        print(f"NOTE: {note}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
