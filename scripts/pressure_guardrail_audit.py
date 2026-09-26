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
    auth_reliability = read("cloudflare-worker/src/auth-state-reliability.js")
    worker = read("cloudflare-worker/src/voice-session-legacy.js")
    wrangler = read("cloudflare-worker/wrangler.toml")
    game_runtime = read("cloudflare-worker/src/legacy-games/game-runtime.js")
    realtime_object = read("cloudflare-worker/src/room-realtime-object.js")
    realtime_protocol = read("cloudflare-worker/src/room-realtime-protocol.js")
    worker_index = read("cloudflare-worker/src/index.js")
    app_main = read("lib/main.dart")
    discovery = read("lib/features/home/services/discovery_service.dart")
    realtime_query = read("lib/features/room/services/room_realtime_query_service.dart")
    realtime_game = read("cloudflare-worker/src/room-realtime-game.js")
    flutter_ci = read(".github/workflows/flutter-ci.yml")
    room_realtime_entry = read("cloudflare-worker/src/room-realtime.js")
    economy_control = read("cloudflare-worker/src/legacy-economy/economy-control.js")
    manage_user_access = read("cloudflare-worker/src/manage-user-access.js")
    manage_user_account = read("cloudflare-worker/src/manage-user-account.js")
    control_user_details = read("cloudflare-worker/src/control-user-details.js")
    legacy_admin_shim = read("cloudflare-worker/src/legacy-firebase-admin-shim.js")
    prod_gate = read(".github/workflows/cloudflare-phase8-comprehensive-e2e.yml")
    phase6_e2e = read(".github/workflows/cloudflare-phase6-settlement-e2e.yml")
    economy_e2e = read(".github/workflows/cloudflare-economy-router-phase5-e2e.yml")
    moderation_e2e = read(".github/workflows/cloudflare-phase9-user-moderation-e2e.yml")
    access_e2e = read(".github/workflows/cloudflare-phase9-user-access-e2e.yml")
    batch1_e2e = read(".github/workflows/cloudflare-batch1-e2e.yml")
    chat_core_e2e = read(".github/workflows/cloudflare-chat-core-e2e.yml")
    chat_gift_e2e = read(".github/workflows/cloudflare-chat-gift-e2e.yml")
    chat_safety_e2e = read(".github/workflows/cloudflare-chat-safety-e2e.yml")
    google_play_e2e = read(".github/workflows/cloudflare-google-play-e2e.yml")
    app_asset_e2e = read(".github/workflows/cloudflare-manage-app-asset-e2e.yml")
    cleanup_phase6_e2e = read(".github/workflows/cleanup-phase6-test-users.yml")
    room_gift_e2e = read(".github/workflows/cloudflare-room-gift-e2e.yml")
    voice_phase1_e2e = read(".github/workflows/cloudflare-voice-phase1-e2e.yml")
    voice_phase2_e2e = read(".github/workflows/cloudflare-voice-phase2-e2e.yml")
    wallet_e2e = read(".github/workflows/cloudflare-wallet-e2e.yml")
    phase6_settlement_script = read("cloudflare-worker/scripts/phase6-settlement-e2e.mjs")
    http_helpers = read("cloudflare-worker/src/http.js")
    room_bootstrap_service = read("lib/features/room/services/room_bootstrap_service.dart")
    room_seat_service = read("lib/features/room/services/room_seat_service.dart")
    room_moderator_service = read("lib/features/room/services/room_moderator_service.dart")
    config_cache = read("cloudflare-worker/src/config-cache.js")
    gift_catalog_api = read("cloudflare-worker/src/legacy-economy/gift-catalog.js")
    recharge_config_api = read("cloudflare-worker/src/legacy-economy/recharge-config.js")
    gift_economy_config = read("cloudflare-worker/src/legacy-economy/gift-economy-config.js")
    room_rocket_config = read("cloudflare-worker/src/legacy-economy/room-rocket-config.js")
    game_control = read("cloudflare-worker/src/legacy-games/game-control.js")
    room_gift = read("cloudflare-worker/src/room-gift.js")
    google_play_purchase = read("cloudflare-worker/src/google-play-purchase.js")
    app_assets = read("cloudflare-worker/src/app-assets.js")
    manage_app_asset = read("cloudflare-worker/src/manage-app-asset.js")
    gift_catalog_service = read("lib/features/gift/services/gift_catalog_service.dart")
    recharge_config_service = read("lib/features/wallet/services/recharge_config_service.dart")
    recharge_screen = read("lib/features/wallet/screens/recharge_screen.dart")
    room_presence_authority = read("cloudflare-worker/src/room-presence-authority.js")
    room_rocket_runtime = read("cloudflare-worker/src/legacy-economy/room-rocket-runtime.js")
    chat_safety_actions = read("cloudflare-worker/src/chat-safety-actions.js")
    room_gift_script = read("cloudflare-worker/scripts/room-gift-e2e.mjs")
    chat_safety_script = read("cloudflare-worker/scripts/chat-safety-e2e.mjs")

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
    room_bootstrap = function_body(worker, "roomBootstrap")
    if room_bootstrap is None:
        failures.append("Step 7 regression: roomBootstrap backend action is missing")
    else:
        for required in (
            "seatState",
            "moderatorState",
            "insights",
            "rocketState",
            "games",
            "gameCatalog(db)",
            "assertUserDocumentSessionState(decoded,actor)",
        ):
            if required not in room_bootstrap:
                failures.append(
                    f"Step 7 regression: roomBootstrap missing required contract: {required}"
                )
    if 'action==="roomBootstrap"' not in worker:
        failures.append("Step 7 regression: voice-session handler no longer exposes roomBootstrap")
    if 'action==="roomSessionLeave"||\n      action==="roomBootstrap"' not in worker:
        failures.append("Step 7 regression: bootstrap reintroduced a duplicate auth-state user read")

    if "RoomBootstrapService _roomBootstrapService" not in app_main:
        failures.append("Step 7 regression: room entry no longer owns one RoomBootstrapService")
    if "unawaited(_loadRoomBootstrap(roomId))" not in app_main:
        failures.append("Step 7 regression: room entry no longer starts the non-blocking bootstrap")
    if "_voiceSession.roomStateEvents" not in app_main:
        failures.append("Step 7 regression: seats/moderators are not fed by the shared room snapshot stream")
    for forbidden in (
        "unawaited(_loadRoomInsights(roomId))",
        "unawaited(_loadRoomSeatState(roomId))",
        "unawaited(_watchRoomModerators(roomId))",
        "unawaited(_loadOwnerProfile(args))",
        "_roomSeatSubscription",
        "_roomModeratorSubscription",
    ):
        if forbidden in app_main:
            failures.append(f"Step 7 regression: old room-entry fan-out returned: {forbidden}")
    if "_roomStateController" not in voice or "_roomStateController.add" not in voice:
        failures.append("Step 7 regression: existing room lifecycle listener is not sharing its snapshot")
    if "RoomSeatState fromRoomData" not in room_seat_service:
        failures.append("Step 7 regression: seat parser cannot consume the shared room snapshot")
    if "RoomModeratorState fromRoomData" not in room_moderator_service:
        failures.append("Step 7 regression: moderator parser cannot consume the shared room snapshot")
    if "initialCatalog" not in game_overlay or "initialCatalog: _bootstrapGames" not in app_main:
        failures.append("Step 7 regression: game availability no longer reuses bootstrap catalog")
    if "initialData: _bootstrapRocketState" not in app_main:
        failures.append("Step 7 regression: Rocket sheet no longer seeds from bootstrap state")
    if "'action': 'roomBootstrap'" not in room_bootstrap_service:
        failures.append("Step 7 regression: Flutter bootstrap service lost its single bootstrap request")

    # Step 8: low-change configuration cache must reduce hot Firestore reads
    # without moving financial authority out of Firestore transactions.
    for required in (
        "const inflight = new Map()",
        "readThroughConfigCache",
        "primeConfigCache",
        "invalidateConfigCache",
        "staleUntilMs",
        "isTransientConfigReadError",
    ):
        if required not in config_cache:
            failures.append(f"Step 8 regression: shared config cache missing {required}")

    for label, service, loader in (
        ("gift catalog", gift_catalog_service, "loadCatalog"),
        ("recharge config", recharge_config_service, "loadPackages"),
    ):
        if "FirebaseFirestore" in service or ".snapshots()" in service:
            failures.append(
                f"Step 8 regression: {label} client reopened a direct Firestore config listener"
            )
        if loader not in service:
            failures.append(f"Step 8 regression: {label} cached API loader is missing")

    if "GiftCatalogService.loadCatalog()" not in app_main and "GiftCatalogService.loadCatalog()" not in read("lib/features/gift/widgets/room_gift_sheet.dart"):
        failures.append("Step 8 regression: active gift UI is not using the cached catalog API")
    if "RechargeConfigService.watchPackages()" in recharge_screen or "_packageSubscription" in recharge_screen:
        failures.append("Step 8 regression: recharge screen reopened the Firestore config stream")
    if "RechargeConfigService.loadPackages()" not in recharge_screen:
        failures.append("Step 8 regression: recharge screen is not using the cached packages API")

    for label, api, action in (
        ("gift catalog", gift_catalog_api, 'action === "catalog"'),
        ("recharge config", recharge_config_api, 'action === "packages"'),
    ):
        if "readThroughConfigCache" not in api:
            failures.append(f"Step 8 regression: {label} backend read-through cache is missing")
        if action not in api:
            failures.append(f"Step 8 regression: {label} user-facing cached API action is missing")

    if '"config:game_runtime"' not in game_runtime or "readThroughConfigCache" not in game_runtime:
        failures.append("Step 8 regression: game runtime config is not using the shared cache")
    if "ttlMs:30000" not in game_runtime:
        failures.append("Step 8 regression: game runtime cache changed from the approved 30s fresh TTL")
    if 'invalidateConfigCache("config:game_runtime")' not in game_control:
        failures.append("Step 8 regression: admin game saves no longer invalidate cached config")

    if "readThroughConfigCache" not in gift_economy_config or "primeConfigCache" not in gift_economy_config:
        failures.append("Step 8 regression: gift economy admin state cache is missing")
    if "readThroughConfigCache" not in room_rocket_config or "primeConfigCache" not in room_rocket_config:
        failures.append("Step 8 regression: room Rocket admin config cache is missing")

    # Financial paths must keep authoritative Firestore reads.
    for required in (
        'db.get(catalogPath, transaction)',
        'db.get(economyPath, transaction)',
        'db.get(rocketConfigPath, transaction)',
    ):
        if required not in room_gift:
            failures.append(
                f"Step 8 financial-authority regression: room gift path lost {required}"
            )
    if "config-cache" in room_gift:
        failures.append("Step 8 financial-authority regression: room gift transaction imports config cache")
    if 'db.get("system_config/recharge")' not in google_play_purchase:
        failures.append("Step 8 financial-authority regression: Google Play package validation no longer reads Firestore")
    if "config-cache" in google_play_purchase:
        failures.append("Step 8 financial-authority regression: Google Play purchase path imports config cache")

    mic_activity = function_body(worker, "recordMicActivity")
    if mic_activity is None or "tx.get(economyRef)" not in mic_activity:
        failures.append("Step 8 financial-authority regression: mic activity payout policy is no longer read transactionally")

    # Room level/capacity policy is code-resident today; do not add a Firestore
    # config dependency merely to satisfy the cache step.
    if 'doc("room_levels")' in worker or 'doc("level_config")' in worker:
        failures.append("Step 8 regression: room level policy gained a new Firestore config read")
    for baseline in (
        "const normal=[8,10,12,15,20,20]",
        "const agency=[10,12,14,16,20,22]",
    ):
        if baseline not in worker:
            failures.append("Step 8 regression: approved room level seat-capacity baseline changed")

    if "readThroughConfigCache" not in app_assets:
        failures.append("Step 8 regression: app asset registry hot reads are not cached")
    if 'invalidateConfigCache("registry:app_assets:list")' not in manage_app_asset:
        failures.append("Step 8 regression: app asset updates no longer invalidate list cache")
    if 'registry:app_assets:key:' not in manage_app_asset:
        failures.append("Step 8 regression: app asset updates no longer invalidate per-key cache")

    if "_poller" in game_overlay or "_startPolling" in game_overlay:
        failures.append("Step 6 regression: periodic game state polling returned")
    if re.search(
        r"Timer\.periodic\([\s\S]{0,260}?Duration\(seconds:\s*10\)",
        game_overlay,
    ):
        failures.append("Step 6 regression: 10-second game network polling returned")
    check(lambda: require(
        r"widget\.realtimeEvents\s*\?\?[\s\S]{0,160}?VoiceRoomSessionController\.instance\.realtimeEvents",
        game_overlay,
        "Step 6 regression: game overlay lost the existing room WebSocket event source",
        re.S,
    ))
    check(lambda: require(
        r"_gameRealtimeSubscription\s*=\s*realtimeEvents\.listen",
        game_overlay,
        "Step 6 regression: game overlay is not consuming realtime room events",
    ))
    check(lambda: require(
        r"_service\.loadState\(\s*game,\s*roomId:\s*widget\.roomId",
        game_overlay,
        "Step 6 regression: authoritative game state no longer registers the room realtime schedule",
        re.S,
    ))
    check(lambda: require(
        r"event\.type\s*==\s*'game\.result'",
        game_overlay,
        "Step 6 regression: pushed game.result no longer triggers authoritative refresh",
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
        r"FIRESTORE_TRANSIENT_MAX_ATTEMPTS\s*=\s*3\b",
        firestore,
        "Step 9 borrowed Firestore retry cap changed from 3 attempts",
    ))
    check(lambda: require(
        r"FIRESTORE_RETRY_BASE_DELAY_MS\s*=\s*350\b",
        firestore,
        "Step 9 borrowed Firestore backoff base changed",
    ))
    check(lambda: require(
        r"FIRESTORE_RETRY_JITTER_MS\s*=\s*250\b",
        firestore,
        "Step 9 borrowed Firestore retry jitter changed",
    ))
    check(lambda: require(
        r"FIRESTORE_QUOTA_MAX_ATTEMPTS\s*=\s*2\b",
        firestore,
        "Step 9 regression: Firestore quota retry cap changed from 2 attempts",
    ))
    check(lambda: require(
        r"FIRESTORE_QUOTA_MIN_RETRY_DELAY_MS\s*=\s*1000\b",
        firestore,
        "Step 9 regression: Firestore quota retry spacing changed",
    ))
    check(lambda: require(
        r"FIRESTORE_QUOTA_BREAKER_THRESHOLD\s*=\s*2\b",
        firestore,
        "Step 9 regression: Firestore quota breaker threshold changed",
    ))
    check(lambda: require(
        r"FIRESTORE_QUOTA_BREAKER_MS\s*=\s*10_000\b",
        firestore,
        "Step 9 regression: Firestore quota breaker duration changed",
    ))
    for required in (
        "firestoreQuotaCircuit",
        "registerFirestoreQuotaFailure",
        "isFirestoreQuotaCircuitOpen",
        "firestoreQuotaUnavailableError",
        "firestore_quota_exhausted",
    ):
        if required not in firestore:
            failures.append(f"Step 9 regression: Firestore quota circuit missing {required}")
    if "firestoreQuotaResponse" not in http_helpers:
        failures.append("Step 9 regression: explicit 503 quota response helper is missing")
    for label, content in (
        ("app-assets", app_assets),
        ("manage-app-asset", manage_app_asset),
        ("room-realtime", room_realtime_entry),
    ):
        if "firestoreQuotaResponse" not in content:
            failures.append(f"Step 9 regression: {label} hides Firestore quota state behind generic 500")
    if "checkUserState: false" not in manage_app_asset or "assertUserDocumentSessionState" not in manage_app_asset:
        failures.append("Step 9 regression: app asset owner auth reintroduced duplicate user-state reads")
    check(lambda: require(
        r"AUTH_STATE_MAX_ATTEMPTS\s*=\s*3\b",
        auth_reliability,
        "Step 9 borrowed auth-state retry cap changed from 3 attempts",
    ))
    check(lambda: require(
        r"AUTH_STATE_BASE_DELAY_MS\s*=\s*350\b",
        auth_reliability,
        "Step 9 borrowed auth-state base backoff changed",
    ))
    check(lambda: require(
        r"AUTH_STATE_JITTER_MS\s*=\s*220\b",
        auth_reliability,
        "Step 9 borrowed auth-state jitter changed",
    ))
    if "userStateInflight" not in auth:
        failures.append("Step 9 borrowed regression: auth-state in-flight request coalescing is missing")
    if "AUTH_STATE_BREAKER_THRESHOLD = 2" not in auth:
        failures.append("Step 9 borrowed regression: auth-state circuit breaker threshold changed")
    if "AUTH_STATE_BREAKER_MS = 5_000" not in auth:
        failures.append("Step 9 borrowed regression: auth-state circuit breaker duration changed")
    if "AUTH_STATE_STALE_TTL_MS = 30_000" not in auth:
        failures.append("Step 9 borrowed regression: bounded stale-safe auth cache changed")
    if "fetchAuthStateResponse" not in auth:
        failures.append("Step 9 borrowed regression: auth-state path bypasses retry/backoff helper")

    if "group: shadow-live-flutter-ci-${{ github.ref }}" not in flutter_ci:
        failures.append("Step 9 borrowed regression: Flutter CI concurrency is not isolated per ref")

    standalone_production_workflows = (
        ("batch1", batch1_e2e),
        ("chat-core", chat_core_e2e),
        ("chat-gift", chat_gift_e2e),
        ("chat-safety", chat_safety_e2e),
        ("economy", economy_e2e),
        ("google-play", google_play_e2e),
        ("app-asset", app_asset_e2e),
        ("phase6", phase6_e2e),
        ("moderation", moderation_e2e),
        ("access", access_e2e),
        ("room-gift", room_gift_e2e),
        ("voice-phase1", voice_phase1_e2e),
        ("voice-phase2", voice_phase2_e2e),
        ("wallet", wallet_e2e),
    )
    for label, workflow in standalone_production_workflows:
        if re.search(r"(?m)^\s*push:\s*$", workflow):
            failures.append(
                f"Step 9 regression: standalone {label} production E2E auto-runs on main"
            )
        if "workflow_dispatch:" not in workflow:
            failures.append(
                f"Step 9 regression: standalone {label} production E2E lost manual dispatch"
            )
        if "group: shadow-live-production-firestore-e2e" not in workflow:
            failures.append(
                f"Step 9 regression: standalone {label} E2E is outside shared Firestore serialization"
            )
        if "cancel-in-progress: false" not in workflow:
            failures.append(
                f"Step 9 regression: standalone {label} E2E may cancel/overlap another production suite"
            )

    if re.search(r"(?m)^\s*push:\s*$", cleanup_phase6_e2e):
        failures.append("Step 9 regression: Phase 6 cleanup auto-runs against Production Firestore")
    if "workflow_dispatch:" not in cleanup_phase6_e2e:
        failures.append("Step 9 regression: Phase 6 cleanup lost manual dispatch")
    if "group: shadow-live-production-firestore-e2e" not in cleanup_phase6_e2e:
        failures.append("Step 9 regression: Phase 6 cleanup is outside Production Firestore serialization")
    if "cancel-in-progress: false" not in cleanup_phase6_e2e:
        failures.append("Step 9 regression: Phase 6 cleanup can overlap/cancel Production validation")

    if re.search(r"(?m)^\s*push:\s*$", prod_gate) is None:
        failures.append("Step 9 regression: comprehensive production gate is no longer automatic")
    if "group: shadow-live-production-firestore-e2e" not in prod_gate:
        failures.append("Step 9 regression: comprehensive production gate left shared Firestore serialization")
    if "cancel-in-progress: false" not in prod_gate:
        failures.append("Step 9 regression: comprehensive gate may cancel/overlap another production suite")
    if "'.github/workflows/cloudflare-*-e2e.yml'" not in prod_gate:
        failures.append("Step 9 regression: production gate does not watch standalone E2E workflow policy changes")

    for required in (
        "Skip superseded automatic production gate",
        "run_gate:",
        "Current main:",
        "superseded by a newer main commit",
        "needs: freshness",
    ):
        if required not in prod_gate:
            failures.append(f"Step 9 regression: production gate lost superseded-commit protection: {required}")

    for required_script in (
        "e2e-smoke.mjs",
        "phase9-user-moderation-e2e.mjs",
        "phase9-user-access-e2e.mjs",
        "chat-core-e2e.mjs",
        "chat-safety-e2e.mjs",
        "chat-gift-e2e.mjs",
        "wallet-e2e.mjs",
        "room-gift-e2e.mjs",
        "voice-session-e2e.mjs",
        "voice-phase2-e2e.mjs",
        "economy-router-e2e.mjs",
        "phase6-settlement-e2e.mjs",
        "google-play-e2e.mjs",
    ):
        if required_script not in prod_gate:
            failures.append(f"Step 9 regression: serial production gate missing {required_script}")
    if "Firestore cooldown after moderation" not in prod_gate or "Firestore cooldown after economy router" not in prod_gate:
        failures.append("Step 9 regression: serial production gate lost Firestore cooldown spacing")

    if "manage-app-asset-e2e.mjs" in prod_gate:
        failures.append("Step 9 regression: automatic Production gate reintroduced GitHub asset mutation E2E")
    if "MANUAL / RELEASE-ONLY" not in prod_gate:
        failures.append("Step 9 regression: Production gate summary no longer documents manual App Asset E2E policy")

    if "ALLOW_PRODUCTION_DURABLE_OBJECT_E2E: '0'" not in prod_gate:
        failures.append("Step 9 regression: automatic comprehensive E2E may create production Durable Objects")
    if "ALLOW_PRODUCTION_DURABLE_OBJECT_E2E: '1'" not in phase6_e2e:
        failures.append("Step 9 regression: manual Phase 6 workflow lost explicit production DO opt-in")
    for required in (
        "allowProductionDurableObjectE2E",
        "SKIP automatic production Durable Object realtime coverage",
        "SKIP automatic production Durable Object slot-bet coverage",
    ):
        if required not in phase6_settlement_script:
            failures.append(f"Step 9 regression: Phase 6 script missing DO guard: {required}")

    if "assertUserDocumentSessionState" not in auth:
        failures.append("Step 9 borrowed regression: user document session validator is missing")

    if "const maxAttempts = 3;" not in legacy_admin_shim:
        failures.append("Step 9 borrowed regression: legacy transaction retry cap changed")
    if "firestoreErrorRetryDelayMs" not in legacy_admin_shim:
        failures.append("Step 9 borrowed regression: legacy transactions lost backoff/jitter")
    if "shouldRetryLegacyTransaction" not in legacy_admin_shim:
        failures.append("Step 9 regression: legacy transaction quota fail-fast helper is missing")
    if 'code === "firestore_quota_exhausted"' not in legacy_admin_shim:
        failures.append("Step 9 regression: legacy transactions may back off again after quota breaker opens")
    room_realtime_body = function_body(room_realtime_entry, "roomRealtime")
    if room_realtime_body is None:
        failures.append("Step 9 borrowed regression: roomRealtime handler is missing")
    else:
        if 'checkUserState: action !== "ticket"' not in room_realtime_body:
            failures.append("Step 9 borrowed regression: room ticket does not reuse its user document for session state")
        if "public_profiles" in room_realtime_body:
            failures.append("Step 9 borrowed regression: room ticket reintroduced the duplicate public profile read")
        if 'db.get(`users/${uid}`)' not in room_realtime_body:
            failures.append("Step 9 borrowed regression: room ticket no longer loads the authoritative user document")

    for label, content in (
        ("economy-control", economy_control),
        ("manage-user-access", manage_user_access),
        ("manage-user-account", manage_user_account),
        ("control-user-details", control_user_details),
    ):
        if "assertUserDocumentSessionState" not in content:
            failures.append(f"Step 9 borrowed regression: {label} does not validate session state from its actor snapshot")
        if re.search(r"checkUserState\s*:\s*false", content) is None:
            failures.append(f"Step 9 borrowed regression: {label} reintroduced a duplicate auth-state Firestore lookup")
    # Step 10: migrated room-presence authority must be Durable Object first.
    for required in (
        "realtimeUserPresentFromNamespace",
        '"/presence/has"',
        "legacyPresenceFresh",
        "return body.present === true",
    ):
        if required not in room_presence_authority:
            failures.append(f"Step 10 regression: shared presence authority missing {required}")

    room_gift_body = function_body(room_gift, "sendRoomGift")
    if room_gift_body is None:
        failures.append("Step 10 regression: sendRoomGift handler is missing")
    else:
        for required in (
            "senderRealtimePresence",
            "receiverRealtimePresence",
            "realtimeUserPresentFromNamespace",
            "assertRoomPresence",
        ):
            if required not in room_gift_body:
                failures.append(f"Step 10 regression: Room Gift lost DO-first presence: {required}")
        duplicate_index = room_gift_body.find("if (opSnap.exists)")
        presence_index = room_gift_body.find("assertRoomPresence(")
        if duplicate_index < 0 or presence_index < 0 or duplicate_index > presence_index:
            failures.append("Step 10 regression: Room Gift idempotency no longer wins before presence enforcement")

    invite_body = function_body(chat_safety_actions, "sendRoomInvite")
    if invite_body is None:
        failures.append("Step 10 regression: sendRoomInvite handler is missing")
    else:
        for required in (
            "realtimeUserPresentFromNamespace",
            "realtimePresence === false",
            "realtimePresence === null",
            "legacyPresenceFresh",
        ):
            if required not in invite_body:
                failures.append(f"Step 10 regression: Room Invite lost DO-first/fallback presence: {required}")
        if "roomOwnerUid !== uid" not in invite_body:
            failures.append("Step 10 regression: Room Invite owner bypass changed")

    rocket_entry_body = function_body(room_rocket_runtime, "registerRocketEntry")
    if rocket_entry_body is None:
        failures.append("Step 10 regression: Rocket register entry handler is missing")
    else:
        for required in (
            "realtimeUserPresentFromNamespace",
            "realtimePresent===false",
            "realtimePresent===null",
            "legacyPresenceFresh",
            'presenceSource="room_realtime"',
            'presenceSource="legacy_room_presence"',
        ):
            if required not in rocket_entry_body:
                failures.append(f"Step 10 regression: Rocket lost DO-first/fallback presence: {required}")

    music_presence_body = function_body(worker, "assertRoomMusicSourcePresent")
    if music_presence_body is None:
        failures.append("Step 10 regression: Music source presence helper is missing")
    else:
        for required in (
            "realtimeUserPresent",
            "realtimePresent===false",
            "legacyPresenceFresh",
            "music_source_offline",
        ):
            if required not in music_presence_body:
                failures.append(f"Step 10 regression: Music source check lost DO-first/fallback presence: {required}")

    for label, workflow in (
        ("Room Gift", room_gift_e2e),
        ("Chat Safety", chat_safety_e2e),
    ):
        if "ALLOW_PRODUCTION_DURABLE_OBJECT_E2E: '1'" not in workflow:
            failures.append(f"Step 10 regression: manual {label} E2E lost explicit Production DO opt-in")

    for label, script, marker in (
        ("Room Gift", room_gift_script, "PASS sender + receiver realtime room presence"),
        ("Room Invite", chat_safety_script, "PASS room invite with realtime Durable Object presence"),
    ):
        if "ALLOW_PRODUCTION_DURABLE_OBJECT_E2E" not in script:
            failures.append(f"Step 10 regression: {label} script lost DO safety flag")
        if "openRoomRealtime" not in script or marker not in script:
            failures.append(f"Step 10 regression: {label} script no longer exercises live DO presence")

    if prod_gate.count("ALLOW_PRODUCTION_DURABLE_OBJECT_E2E: '0'") < 3:
        failures.append("Step 10 regression: automatic Production gate may create DOs in Phase6/RoomGift/RoomInvite coverage")
    for marker in (
        "Room Gift realtime Production E2E: MANUAL / RELEASE-ONLY",
        "Room Invite realtime DO coverage: MANUAL / RELEASE-ONLY",
    ):
        if marker not in prod_gate:
            failures.append(f"Step 10 regression: automatic Production summary lost policy marker: {marker}")

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
    if "/game/register" not in realtime_object:
        failures.append("Step 6 regression: Durable Object game schedule registration route is missing")
    for event_type in (
        "game.round_started",
        "game.betting_closed",
        "game.result",
        "game.next_round",
    ):
        if event_type not in realtime_game:
            failures.append(f"Step 6 regression: realtime game event missing: {event_type}")
    if "outcomeId" not in realtime_game or "game.result" not in realtime_game:
        failures.append("Step 6 regression: result outcome is not held for the reveal event")
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

    if "registerGameRealtimeSchedules" not in game_runtime:
        failures.append("Step 6 regression: game state no longer registers server-built realtime schedules")
    if "realtimeGameUserPresent" not in game_runtime:
        failures.append("Step 6 regression: game bets no longer validate Durable Object presence")
    if "useLegacyPresence=realtimePresent===null" not in game_runtime:
        failures.append("Step 6 regression: controlled legacy presence fallback changed")
    if 'collection("room_presence")' not in game_runtime:
        notes.append("legacy game room_presence fallback removed")
    if "resolveOutcome({" not in game_runtime:
        failures.append("Step 6 regression: game outcome is no longer server-authoritative")
    if "calculatePayout({" not in game_runtime:
        failures.append("Step 6 regression: game payout is no longer server-authoritative")
    if "financial_ledger" not in game_runtime:
        failures.append("Step 6 regression: game financial ledger path is missing")
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
    print("Protected baselines: room join, ZEGO, mic path, WebSocket presence/count/events/game phases, local game timing, server-authoritative bets/results, cached low-change config with direct financial authority, bounded retries/backoff, cron, and critical listener caps.")
    for note in notes:
        print(f"NOTE: {note}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
