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
    game_overlay = read("lib/features/games/widgets/room_game_overlay.dart")
    zego = read("lib/features/voice/services/zego_voice_service.dart")
    firestore = read("cloudflare-worker/src/firestore.js")
    auth = read("cloudflare-worker/src/firebase-auth.js")
    worker = read("cloudflare-worker/src/voice-session-legacy.js")
    wrangler = read("cloudflare-worker/wrangler.toml")
    game_runtime = read("cloudflare-worker/src/legacy-games/game-runtime.js")

    check(lambda: require(
        r"_presenceTimer\s*=\s*Timer\.periodic\(\s*const Duration\(seconds:\s*60\)",
        voice,
        "presence heartbeat interval changed from the 60s baseline",
        re.S,
    ))
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
    print("Protected baselines: room join, ZEGO, mic path, presence heartbeat, game polling/timing, retries, cron, and critical listener caps.")
    for note in notes:
        print(f"NOTE: {note}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
