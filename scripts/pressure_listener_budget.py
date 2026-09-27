import json
import re
from pathlib import Path

root = Path("lib")
call_sites = []
patterns = (".snapshots(", ".snapshots()", "StreamBuilder<")

def classify(path, snippet):
    text = (str(path) + "\n" + snippet).lower()
    if "room_rocket_state" in text or "rocket" in text:
        return "rocket"
    if "conversation" in text or "messages" in text:
        return "conversations"
    if "public_profiles" in text or "profile" in text:
        return "profile"
    if "wallet" in text or "diamonds" in text or "coins" in text:
        return "wallet"
    if "collection('users')" in text or 'collection("users")' in text:
        return "users"
    if "room" in text:
        return "room"
    return "other"

for path in sorted(root.rglob("*.dart")):
    lines = path.read_text(encoding="utf-8").splitlines()
    for index, line in enumerate(lines):
        if not any(pattern in line for pattern in patterns):
            continue
        start = max(0, index - 5)
        end = min(len(lines), index + 6)
        snippet = "\n".join(lines[start:end])
        call_sites.append({
            "path": str(path),
            "line": index + 1,
            "kind": classify(path, snippet),
            "source": line.strip()[:220],
        })

by_kind = {}
for item in call_sites:
    by_kind[item["kind"]] = by_kind.get(item["kind"], 0) + 1

key_kinds = ["room", "conversations", "users", "rocket", "profile", "wallet"]
result = {
    "totalStaticListenerCallsites": len(call_sites),
    "byKind": by_kind,
    "keyListenerBudget": {kind: by_kind.get(kind, 0) for kind in key_kinds},
    "callSites": call_sites,
}
Path("step12-listener-budget.json").write_text(
    json.dumps(result, ensure_ascii=False, indent=2) + "\n",
    encoding="utf-8",
)
print("STEP12_LISTENER_BUDGET " + json.dumps({
    "total": result["totalStaticListenerCallsites"],
    "key": result["keyListenerBudget"],
}, ensure_ascii=False))
