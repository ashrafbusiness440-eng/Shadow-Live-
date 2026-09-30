#!/usr/bin/env python3
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[2]
WORKFLOW = ROOT / ".github" / "workflows" / "flutter-ci.yml"
TEST_DIR = ROOT / "server" / "__tests__"

workflow = WORKFLOW.read_text(encoding="utf-8")
agency_integration_tests = sorted(TEST_DIR.glob("agency-*.integration.test.js"))

missing = [
    path.relative_to(ROOT).as_posix()
    for path in agency_integration_tests
    if path.relative_to(ROOT).as_posix() not in workflow
]

if missing:
    print("Agency integration tests missing from Flutter CI:", file=sys.stderr)
    for path in missing:
        print(f"  - {path}", file=sys.stderr)
    sys.exit(1)

print(
    f"Agency integration CI coverage OK: {len(agency_integration_tests)} files are wired."
)
