#!/usr/bin/env python3
from __future__ import annotations

import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def read(rel: str) -> str:
    path = ROOT / rel
    if not path.exists():
        raise AssertionError(f"missing required file: {rel}")
    return path.read_text(encoding="utf-8")


def require(condition: bool, message: str) -> None:
    if not condition:
        raise AssertionError(message)


def main() -> int:
    failures: list[str] = []

    try:
        service = read("lib/features/diaries/services/diary_service.dart")
        screen = read("lib/features/diaries/screens/diaries_screen.dart")
        comments = read("lib/features/diaries/widgets/diary_comments_sheet.dart")
        gifts = read("lib/features/diaries/widgets/diary_gifts_sheet.dart")
        backend = read("cloudflare-worker/src/diaries.js")
        moderation = read("cloudflare-worker/src/diary-moderation.js")
        rules = read("firestore.rules")
        core_tests = read("server/__tests__/diaries-core.test.js")
        gift_tests = read("server/__tests__/gift-transactions.integration.test.js")
        stage07_tests = read("server/__tests__/diary-moderation.test.js")
        flutter_ci = read(".github/workflows/flutter-ci.yml")

        # Client pressure: no direct Firestore access, listeners or polling.
        for label, source in (
            ("DiaryService", service),
            ("DiariesScreen", screen),
            ("DiaryCommentsSheet", comments),
            ("DiaryGiftsSheet", gifts),
        ):
            require("FirebaseFirestore" not in source, f"{label}: direct Firestore access returned")
            require(".snapshots()" not in source, f"{label}: Firestore listener returned")
            require("Timer.periodic" not in source, f"{label}: periodic polling returned")
            require("StreamBuilder<" not in source, f"{label}: extra realtime listener returned")

        # Backend pressure/bounds.
        require("const MAX_PAGE_SIZE = 30" in backend, "diaries backend page cap changed")
        require("Math.min(MAX_PAGE_SIZE" in backend, "pageLimit is no longer capped")
        require("MENTION_RESULT_LIMIT = 8" in backend, "mention result cap changed")
        require("limit: limit + 1" in backend, "cursor pagination no longer uses bounded lookahead")
        require(".list(" not in backend, "unbounded Firestore list operation introduced")
        require("while (" not in backend and "for (;;)" not in backend, "unbounded loop introduced")
        require("db.runQuery("diaries"" in backend, "latest/following bounded query missing")
        require("db.runQuery("follows"" in backend, "following feed bounded follow query missing")

        # Moderation queue stays bounded.
        require("Math.min(30" in moderation, "moderation queue page cap changed")
        require('db.runQuery("diary_reports"' in moderation, "moderation report query missing")
        require("limit: limit + 1" in moderation, "moderation cursor lookahead missing")

        # Security: all diary-owned collections are server-authoritative.
        for rule in (
            "match /diaries/{diaryId}",
            "match /users/{userId}/diaries/{diaryId}",
            "match /diary_operations/{operationId}",
            "match /diary_image_links/{objectId}",
            "match /diary_audit_logs/{logId}",
            "match /diary_comments/{commentId}",
            "match /diary_likes/{likeId}",
            "match /diary_view_keys/{viewKey}",
            "match /diary_reports/{reportId}",
        ):
            require(rule in rules, f"missing explicit Firestore rule: {rule}")

        # Functional closure coverage: create/delete/latest/following/report/gift.
        for needle in (
            'test("owner can toggle comments and delete; other users cannot"',
            'test("following feed filters a bounded latest window without per-user scans"',
            'test("latest and user feeds stay bounded and expose cursors"',
            'test("diary report is deterministic and dedupes same reporter and target"',
        ):
            require(needle in core_tests, f"missing Stage 09 core coverage: {needle}")

        require(
            'test("diary gift reuses chat gift economy without creating chat side effects"' in gift_tests,
            "missing diary gift integration coverage",
        )
        require(
            'test("diary gift rejects a receiver who does not own the diary"' in gift_tests,
            "missing diary gift owner-security coverage",
        )
        require(
            'test("diary moderation report listing is bounded and cursor based"' in stage07_tests,
            "missing moderation bounded-queue coverage",
        )

        # Ensure CI actually executes all of the above suites.
        for test_file in (
            "server/__tests__/diaries-core.test.js",
            "server/__tests__/gift-transactions.integration.test.js",
            "server/__tests__/diary-moderation.test.js",
        ):
            require(test_file in flutter_ci, f"Flutter CI does not run {test_file}")

        print("DIARIES_STAGE09_AUDIT_OK")
        print("pressure=no_polling,no_snapshots,no_direct_firestore")
        print("bounds=page30,mentions8,cursor_lookahead")
        print("security=explicit_server_authority")
        print("coverage=create,delete,latest,following,report,gift,moderation")
        return 0
    except AssertionError as error:
        failures.append(str(error))

    for failure in failures:
        print(f"DIARIES_STAGE09_AUDIT_FAIL: {failure}")
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
