#!/usr/bin/env python3
from __future__ import annotations

import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SELF = Path(__file__).resolve()
SKIP_DIRS = {
    ".git",
    ".dart_tool",
    ".idea",
    ".vscode",
    "build",
    "node_modules",
    "Pods",
    "ephemeral",
}
TEXT_SUFFIXES = {
    ".dart", ".js", ".mjs", ".cjs", ".ts", ".tsx", ".json", ".yaml", ".yml",
    ".md", ".html", ".htm", ".xml", ".toml", ".properties", ".gradle", ".kts",
    ".sh", ".py", ".txt", ".rules", ".cfg", ".conf", ".ini",
}
FORBIDDEN = (
    ("Vercel reference", re.compile(r"vercel", re.IGNORECASE)),
    ("legacy API environment variable", re.compile(r"SHADOW_API_BASE_URL")),
    ("legacy root API JavaScript reference", re.compile(r"(?<![/\\w])api/[A-Za-z0-9_-]+\\.js")),
)

REQUIRED_WORKER_ROUTES = (
    "/api/adjust-balance",
    "/api/app-assets",
    "/api/change-public-id",
    "/api/set-id-management-permission",
    "/api/wallet-actions",
    "/api/chat-actions",
    "/api/storage-health",
    "/api/room-gift",
    "/api/voice-session",
    "/api/room-realtime",
    "/api/google-play-purchase",
    "/api/manage-app-asset",
    "/api/economy-router",
    "/api/economy-control",
    "/api/gift-catalog",
    "/api/gift-economy-config",
    "/api/recharge-config",
    "/api/room-rocket-config",
    "/api/room-rocket",
    "/api/reward-inventory",
    "/api/game-runtime",
    "/api/game-control",
)

def text_files():
    for path in ROOT.rglob("*"):
        if not path.is_file() or path.resolve() == SELF:
            continue
        rel = path.relative_to(ROOT)
        if any(part in SKIP_DIRS for part in rel.parts):
            continue
        if path.suffix.lower() in TEXT_SUFFIXES or path.name in {".gitignore", ".firebaserc"}:
            yield path, rel

def main() -> int:
    violations: list[str] = []

    for legacy in (ROOT / "vercel.json", ROOT / "scripts" / "build_vercel.sh"):
        if legacy.exists():
            violations.append(f"legacy deployment artifact still exists: {legacy.relative_to(ROOT)}")

    legacy_api = ROOT / "api"
    if legacy_api.exists():
        violations.append("legacy root api/ serverless directory still exists")

    for path, rel in text_files():
        try:
            content = path.read_text(encoding="utf-8")
        except UnicodeDecodeError:
            continue
        for label, pattern in FORBIDDEN:
            for match in pattern.finditer(content):
                line = content.count("\n", 0, match.start()) + 1
                violations.append(f"{rel}:{line}: {label}")
                break

    worker_index = ROOT / "cloudflare-worker" / "src" / "index.js"
    worker_text = worker_index.read_text(encoding="utf-8") if worker_index.exists() else ""
    for route in REQUIRED_WORKER_ROUTES:
        if route not in worker_text:
            violations.append(f"missing Cloudflare Worker route: {route}")

    endpoints = ROOT / "lib" / "admin" / "control_api_endpoints.dart"
    endpoints_text = endpoints.read_text(encoding="utf-8") if endpoints.exists() else ""
    if "SHADOW_CLOUDFLARE_API_BASE_URL" not in endpoints_text:
        violations.append("control API does not use SHADOW_CLOUDFLARE_API_BASE_URL")
    if "shadow-live.ashraf-business-440.workers.dev/api" not in endpoints_text:
        violations.append("control API default is not the production Cloudflare Worker")

    if violations:
        print("Phase 7 Cloudflare cutover audit FAILED:")
        for violation in violations:
            print(f" - {violation}")
        return 1

    print("Phase 7 Cloudflare cutover audit passed.")
    print(f"Verified {len(REQUIRED_WORKER_ROUTES)} production Worker routes and no legacy Vercel dependency.")
    return 0

if __name__ == "__main__":
    sys.exit(main())
