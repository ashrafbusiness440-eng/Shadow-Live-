#!/usr/bin/env python3
from pathlib import Path
import json, re

root = Path(".")
lib = root / "lib"
files = sorted(p for p in lib.rglob("*.dart") if "legacy_quarantine" not in p.parts)
rel = {p: p.as_posix() for p in files}

pubspec = (root / "pubspec.yaml").read_text(encoding="utf-8")
m = re.search(r"^name:\s*([^\s#]+)", pubspec, re.M)
package_name = m.group(1) if m else "voice_chat_room"

imp = re.compile(r"(?:import|export)\s+['\"]([^'\"]+)['\"]")
graph = {p.as_posix(): [] for p in files}

def resolve(src, spec):
    if spec.startswith("dart:"):
        return None
    prefix = f"package:{package_name}/"
    if spec.startswith(prefix):
        return "lib/" + spec[len(prefix):]
    if spec.startswith("package:"):
        return None
    if not spec.startswith("package:"):
        try:
            return (Path(src).parent / spec).resolve().relative_to(root.resolve()).as_posix()
        except ValueError:
            return None
    return None

for p in files:
    src = p.as_posix()
    text = p.read_text(encoding="utf-8", errors="ignore")
    for spec in imp.findall(text):
        target = resolve(src, spec)
        if target in graph:
            graph[src].append(target)

roots = [x for x in ["lib/main.dart", "lib/main_control.dart"] if x in graph]
reachable = set()
stack = roots[:]
while stack:
    cur = stack.pop()
    if cur in reachable:
        continue
    reachable.add(cur)
    stack.extend(graph.get(cur, []))

unreachable = sorted(set(graph) - reachable)
report = {
    "package": package_name,
    "roots": roots,
    "total_dart_files": len(graph),
    "reachable_count": len(reachable),
    "unreachable_count": len(unreachable),
    "unreachable": unreachable,
}
Path("dart_reachability.json").write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
print(json.dumps(report, ensure_ascii=False, indent=2))
