from __future__ import annotations

import base64
import io
import json
import math
import os
import re
import time
from datetime import datetime, timezone
from urllib.parse import quote

import requests
from PIL import Image, ImageDraw, ImageFilter
from google.auth.transport.requests import Request as GoogleAuthRequest
from google.oauth2 import service_account

OWNER = "ashrafbusiness440-eng"
REPO = "Shadow-Live-"
WORKER_BASE = "https://shadow-live.ashraf-business-440.workers.dev"
MAX_BYTES = 2_500_000
KEY_RE = re.compile(r"^[a-z0-9][A-Za-z0-9._-]{2,119}$")
SEGMENT_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$")

TIERS = [
    ("lv01_05", (202, 216, 224), (24, 48, 58), (42, 218, 213), "gem"),
    ("lv06_10", (212, 225, 240), (26, 47, 84), (49, 128, 244), "star"),
    ("lv11_15", (222, 205, 232), (75, 35, 83), (236, 78, 181), "star"),
    ("lv16_20", (226, 170, 82), (88, 28, 48), (231, 69, 102), "gem"),
    ("lv21_25", (184, 162, 229), (48, 28, 86), (67, 153, 255), "star"),
    ("lv26_30", (231, 189, 88), (88, 55, 31), (239, 97, 170), "gem"),
    ("lv31_35", (246, 210, 91), (93, 58, 18), (255, 139, 41), "compass"),
]

def now_iso():
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")

def mix(a, b, t):
    return tuple(int(a[i] * (1 - t) + b[i] * t) for i in range(3))

def glow(base, center, radius, color, strength=180):
    layer = Image.new("RGBA", base.size, (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    d.ellipse(
        (center[0] - radius, center[1] - radius,
         center[0] + radius, center[1] + radius),
        fill=color + (strength,),
    )
    base.alpha_composite(layer.filter(ImageFilter.GaussianBlur(max(1, radius // 3))))

def polygon(cx, cy, radius, sides, rotation=-math.pi / 2):
    return [
        (
            cx + math.cos(rotation + i * 2 * math.pi / sides) * radius,
            cy + math.sin(rotation + i * 2 * math.pi / sides) * radius,
        )
        for i in range(sides)
    ]

def star(cx, cy, outer, inner, count=8, rotation=-math.pi / 2):
    points = []
    for i in range(count * 2):
        radius = outer if i % 2 == 0 else inner
        angle = rotation + i * math.pi / count
        points.append((cx + math.cos(angle) * radius, cy + math.sin(angle) * radius))
    return points

def draw_badge(index, size):
    width, height = size
    scale = min(width, height)
    cx, cy = width // 2, height // 2
    _, metal, dark, accent, symbol = TIERS[index]
    base = Image.new("RGBA", size, (0, 0, 0, 0))
    radius = int(scale * (0.34 if width == height else 0.37))

    glow(base, (cx, cy), int(scale * 0.34), accent, 90)
    d = ImageDraw.Draw(base)

    for k in range(10, 0, -1):
        rr = radius + int(k * scale * 0.006)
        d.ellipse(
            (cx - rr, cy - rr, cx + rr, cy + rr),
            outline=accent + (8 * k,),
            width=max(1, int(scale * 0.006)),
        )

    rings = [
        (mix(metal, (255, 255, 255), 0.35), 0.045),
        (metal, 0.035),
        (mix(metal, dark, 0.35), 0.045),
        (dark, 0.065),
        (mix(metal, (255, 255, 255), 0.15), 0.024),
    ]
    rr = radius
    for color, factor in rings:
        line = max(2, int(scale * factor))
        d.ellipse((cx - rr, cy - rr, cx + rr, cy + rr), outline=color + (255,), width=line)
        rr -= line // 2 + max(1, int(scale * 0.004))

    inner = int(radius * 0.72)
    for q in range(inner, 0, -4):
        t = 1 - q / inner
        color = mix(dark, (8, 10, 18), t * 0.75)
        d.ellipse((cx - q, cy - q, cx + q, cy + q), fill=color + (255,))

    for side in (-1, 1):
        pts = [
            (cx + side * radius * 0.78, cy - radius * 0.58),
            (cx + side * radius * 1.06, cy - radius * 0.25),
            (cx + side * radius * 0.90, cy - radius * 0.05),
            (cx + side * radius * 1.11, cy + radius * 0.12),
            (cx + side * radius * 0.82, cy + radius * 0.42),
            (cx + side * radius * 0.63, cy + radius * 0.22),
        ]
        d.polygon(pts, fill=metal + (255,), outline=mix(metal, (255, 255, 255), 0.45) + (255,))
        inner_pts = [(x + (cx - x) * 0.12, y + (cy - y) * 0.12) for x, y in pts]
        d.line(inner_pts, fill=accent + (210,), width=max(2, int(scale * 0.012)), joint="curve")

    for direction in (-1, 1):
        jewel_y = cy + direction * radius * 0.93
        d.polygon(
            polygon(cx, jewel_y, radius * 0.16, 4, math.pi / 4),
            fill=mix(metal, (255, 255, 255), 0.25) + (255,),
            outline=(255, 255, 255, 220),
        )
        d.polygon(polygon(cx, jewel_y, radius * 0.09, 4, math.pi / 4), fill=accent + (255,))
        glow(base, (cx, int(jewel_y)), int(radius * 0.10), accent, 100)
        d = ImageDraw.Draw(base)

    shield = [
        (cx, cy - radius * 0.50),
        (cx + radius * 0.36, cy - radius * 0.28),
        (cx + radius * 0.30, cy + radius * 0.24),
        (cx, cy + radius * 0.52),
        (cx - radius * 0.30, cy + radius * 0.24),
        (cx - radius * 0.36, cy - radius * 0.28),
    ]
    d.polygon(
        shield,
        fill=mix(dark, accent, 0.16) + (250,),
        outline=mix(metal, (255, 255, 255), 0.45) + (255,),
    )
    inset = [(x + (cx - x) * 0.13, y + (cy - y) * 0.13) for x, y in shield]
    d.line(inset + [inset[0]], fill=accent + (205,), width=max(2, int(scale * 0.012)), joint="curve")

    line = max(4, int(scale * 0.018))
    if symbol == "sword":
        blade = [
            (cx, cy - radius * 0.55),
            (cx + radius * 0.07, cy - radius * 0.10),
            (cx + radius * 0.03, cy + radius * 0.30),
            (cx - radius * 0.03, cy + radius * 0.30),
            (cx - radius * 0.07, cy - radius * 0.10),
        ]
        d.polygon(blade, fill=mix(metal, (255, 255, 255), 0.55) + (255,), outline=accent + (255,))
        d.line((cx - radius * 0.20, cy + radius * 0.18, cx + radius * 0.20, cy + radius * 0.18),
               fill=metal + (255,), width=line * 2)
        d.polygon([(cx, cy + radius * 0.42), (cx - radius * 0.06, cy + radius * 0.26),
                   (cx + radius * 0.06, cy + radius * 0.26)], fill=accent + (255,))
    elif symbol == "star":
        d.polygon(star(cx, cy, radius * 0.48, radius * 0.22, 8),
                  fill=mix(metal, (255, 255, 255), 0.25) + (255,), outline=accent + (255,))
        d.polygon(star(cx, cy, radius * 0.27, radius * 0.12, 8),
                  fill=accent + (245,), outline=(255, 255, 255, 220))
    elif symbol == "spiral":
        for j in range(4):
            box = (cx - radius * 0.42 + j * 5, cy - radius * 0.42 + j * 5,
                   cx + radius * 0.42 - j * 5, cy + radius * 0.42 - j * 5)
            d.arc(box, start=20 + j * 75, end=260 + j * 75,
                  fill=mix(accent, (255, 255, 255), j * 0.12) + (255,), width=line)
        d.ellipse((cx - radius * 0.12, cy - radius * 0.12, cx + radius * 0.12, cy + radius * 0.12),
                  fill=accent + (255,))
        glow(base, (cx, cy), int(radius * 0.20), accent, 140)
    elif symbol == "gem":
        gem = [(cx, cy - radius * 0.48), (cx + radius * 0.32, cy),
               (cx, cy + radius * 0.48), (cx - radius * 0.32, cy)]
        d.polygon(gem, fill=accent + (245,), outline=mix(metal, (255, 255, 255), 0.55) + (255,))
        d.line((cx, cy - radius * 0.48, cx, cy + radius * 0.48), fill=(255, 255, 255, 180), width=line)
        d.line((cx - radius * 0.32, cy, cx + radius * 0.32, cy), fill=(255, 255, 255, 120), width=line)
    elif symbol == "cross":
        p = [
            (cx - radius * 0.13, cy - radius * 0.47), (cx + radius * 0.13, cy - radius * 0.47),
            (cx + radius * 0.13, cy - radius * 0.14), (cx + radius * 0.43, cy - radius * 0.14),
            (cx + radius * 0.43, cy + radius * 0.14), (cx + radius * 0.13, cy + radius * 0.14),
            (cx + radius * 0.13, cy + radius * 0.47), (cx - radius * 0.13, cy + radius * 0.47),
            (cx - radius * 0.13, cy + radius * 0.14), (cx - radius * 0.43, cy + radius * 0.14),
            (cx - radius * 0.43, cy - radius * 0.14), (cx - radius * 0.13, cy - radius * 0.14),
        ]
        d.polygon(p, fill=metal + (255,), outline=(255, 244, 188, 255))
        d.polygon(polygon(cx, cy, radius * 0.16, 4, math.pi / 4),
                  fill=accent + (255,), outline=(255, 255, 255, 220))
    elif symbol == "core":
        d.ellipse((cx - radius * 0.42, cy - radius * 0.42, cx + radius * 0.42, cy + radius * 0.42),
                  outline=metal + (255,), width=line * 2)
        d.ellipse((cx - radius * 0.20, cy - radius * 0.20, cx + radius * 0.20, cy + radius * 0.20),
                  fill=accent + (255,), outline=(220, 245, 255, 255), width=line)
        glow(base, (cx, cy), int(radius * 0.24), accent, 150)
        d = ImageDraw.Draw(base)
        for angle in (45, 135, 225, 315):
            rad = math.radians(angle)
            x = cx + math.cos(rad) * radius * 0.33
            y = cy + math.sin(rad) * radius * 0.33
            d.ellipse((x - radius * 0.055, y - radius * 0.055, x + radius * 0.055, y + radius * 0.055),
                      fill=(232, 65, 75, 255), outline=(255, 180, 180, 255))
    else:
        d.polygon(star(cx, cy, radius * 0.48, radius * 0.19, 8),
                  fill=metal + (255,), outline=(255, 239, 170, 255))
        d.polygon([(cx, cy - radius * 0.23), (cx + radius * 0.16, cy),
                   (cx, cy + radius * 0.23), (cx - radius * 0.16, cy)],
                  fill=accent + (255,), outline=(255, 255, 255, 240))
        for angle in (0, 90, 180, 270):
            rad = math.radians(angle)
            x = cx + math.cos(rad) * radius * 0.35
            y = cy + math.sin(rad) * radius * 0.35
            d.ellipse((x - radius * 0.035, y - radius * 0.035, x + radius * 0.035, y + radius * 0.035),
                      fill=(74, 155, 255, 255))

    d.arc((cx - radius * 0.72, cy - radius * 0.72, cx + radius * 0.72, cy + radius * 0.72),
          195, 310, fill=(255, 255, 255, 150), width=max(2, int(scale * 0.009)))
    return base

def webp_bytes(image):
    out = io.BytesIO()
    image.save(out, "WEBP", quality=88, method=4)
    return out.getvalue()

def safe_directory(value):
    directory = value.rstrip("/").replace("\\", "/")
    segments = directory.split("/")
    return (
        directory.startswith("assets/images/levels/")
        and "//" not in directory
        and all(segment not in ("", ".", "..") and SEGMENT_RE.fullmatch(segment) for segment in segments)
    )

def validate_asset(asset):
    if not KEY_RE.fullmatch(asset["assetKey"]):
        raise RuntimeError(f"invalid asset key: {asset['assetKey']}")
    if not safe_directory(asset["directory"]):
        raise RuntimeError(f"invalid directory: {asset['directory']}")
    if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._-]{0,119}\.webp", asset["fileName"]):
        raise RuntimeError(f"invalid filename: {asset['fileName']}")
    if not (0 < len(asset["bytes"]) <= MAX_BYTES):
        raise RuntimeError(f"invalid byte size: {asset['fileName']}")
    image = Image.open(io.BytesIO(asset["bytes"]))
    if image.size != (asset["width"], asset["height"]):
        raise RuntimeError(f"dimension mismatch: {asset['fileName']} {image.size}")
    if image.format != "WEBP":
        raise RuntimeError(f"format mismatch: {asset['fileName']}")

def github_json(method, path, token, payload=None):
    response = requests.request(
        method,
        f"https://api.github.com/repos/{OWNER}/{REPO}{path}",
        headers={
            "accept": "application/vnd.github+json",
            "authorization": f"Bearer {token}",
            "x-github-api-version": "2022-11-28",
        },
        json=payload,
        timeout=60,
    )
    if not response.ok:
        raise RuntimeError(f"GitHub {method} {path} failed {response.status_code}: {response.text[:500]}")
    return response.json() if response.text else {}

def encode_value(value):
    if value is None:
        return {"nullValue": None}
    if isinstance(value, bool):
        return {"booleanValue": value}
    if isinstance(value, int):
        return {"integerValue": str(value)}
    if isinstance(value, float):
        return {"doubleValue": value}
    if isinstance(value, str):
        return {"stringValue": value}
    if isinstance(value, list):
        return {"arrayValue": {"values": [encode_value(v) for v in value]}}
    if isinstance(value, dict):
        return {"mapValue": {"fields": {k: encode_value(v) for k, v in value.items()}}}
    raise TypeError(type(value))

def firestore_patch(doc_root, token, path, data):
    response = requests.patch(
        f"{doc_root}/{path}",
        headers={"authorization": f"Bearer {token}", "content-type": "application/json"},
        json={"fields": {k: encode_value(v) for k, v in data.items()}},
        timeout=60,
    )
    if not response.ok:
        raise RuntimeError(f"Firestore patch failed {path} {response.status_code}: {response.text[:500]}")
    return response.json()

def main():
    github_token = os.environ["SHADOW_ASSET_GITHUB_TOKEN"].strip()
    service_account_raw = os.environ["FIREBASE_SERVICE_ACCOUNT"]
    service_account_info = json.loads(service_account_raw)
    if isinstance(service_account_info, str):
        service_account_info = json.loads(service_account_info)

    assets = []
    for index, (bucket, *_rest) in enumerate(TIERS):
        directory = f"assets/images/levels/attraction/{bucket}"
        for kind, size in (("main", (1024, 1024)), ("mini", (512, 256))):
            suffix = "main_badge" if kind == "main" else "mini_badge"
            key_suffix = "mainBadge" if kind == "main" else "miniBadge"
            file_name = f"attraction_{bucket}_{suffix}.webp"
            data = webp_bytes(draw_badge(index, size))
            asset = {
                "bucket": bucket,
                "kind": kind,
                "directory": directory,
                "fileName": file_name,
                "fullPath": f"{directory}/{file_name}",
                "assetKey": f"levels.attraction.{bucket}.{key_suffix}",
                "width": size[0],
                "height": size[1],
                "bytes": data,
            }
            validate_asset(asset)
            assets.append(asset)

    if len(assets) != 14:
        raise RuntimeError("Batch F must contain exactly 14 assets")
    print("PASS Generate + Validate: 14 assets")

    ref = github_json("GET", "/git/ref/heads/main", github_token)
    parent_sha = ref["object"]["sha"]
    commit = github_json("GET", f"/git/commits/{parent_sha}", github_token)
    base_tree = commit["tree"]["sha"]

    tree_entries = []
    for asset in assets:
        blob = github_json(
            "POST",
            "/git/blobs",
            github_token,
            {"content": base64.b64encode(asset["bytes"]).decode(), "encoding": "base64"},
        )
        asset["contentSha"] = blob["sha"]
        tree_entries.append({
            "path": asset["fullPath"],
            "mode": "100644",
            "type": "blob",
            "sha": blob["sha"],
        })

    manifest = {
        "batch": "F",
        "metric": "attraction",
        "publishedAt": now_iso(),
        "assets": [
            {k: asset[k] for k in ("assetKey", "fullPath", "width", "height", "contentSha")}
            for asset in assets
        ],
    }
    manifest_blob = github_json(
        "POST",
        "/git/blobs",
        github_token,
        {"content": json.dumps(manifest, ensure_ascii=False, indent=2), "encoding": "utf-8"},
    )
    tree_entries.append({
        "path": "assets/images/levels/attraction/BATCH_F_PUBLISHED.json",
        "mode": "100644",
        "type": "blob",
        "sha": manifest_blob["sha"],
    })

    tree = github_json(
        "POST",
        "/git/trees",
        github_token,
        {"base_tree": base_tree, "tree": tree_entries},
    )
    new_commit = github_json(
        "POST",
        "/git/commits",
        github_token,
        {
            "message": "Stage 08-B Batch F: publish attraction level assets",
            "tree": tree["sha"],
            "parents": [parent_sha],
        },
    )
    github_json(
        "PATCH",
        "/git/refs/heads/main",
        github_token,
        {"sha": new_commit["sha"], "force": False},
    )
    published_commit = new_commit["sha"]
    print(f"PASS Publish GitHub: {published_commit}")

    credentials = service_account.Credentials.from_service_account_info(
        service_account_info,
        scopes=["https://www.googleapis.com/auth/datastore"],
    )
    credentials.refresh(GoogleAuthRequest())
    access_token = credentials.token
    project_id = service_account_info["project_id"]
    doc_root = f"https://firestore.googleapis.com/v1/projects/{project_id}/databases/(default)/documents"
    actor = "github-actions:stage08b-batch-f"
    operation_id = f"batch_f_{os.environ.get('GITHUB_RUN_ID', published_commit[:12])}"
    published_at = now_iso()

    for asset in assets:
        raw_url = (
            f"https://raw.githubusercontent.com/{OWNER}/{REPO}/main/"
            f"{asset['fullPath']}?v={asset['contentSha']}"
        )
        registry = {
            "assetKey": asset["assetKey"],
            "directory": asset["directory"],
            "fileName": asset["fileName"],
            "fullPath": asset["fullPath"],
            "mimeType": "image/webp",
            "mode": "remote",
            "byteSize": len(asset["bytes"]),
            "contentSha": asset["contentSha"],
            "commitSha": published_commit,
            "rawUrl": raw_url,
            "published": True,
            "status": "published",
            "replaced": False,
            "hasDraft": False,
            "draft": None,
            "studioVersion": 1,
            "assetType": "badge",
            "templateId": "badge.base.v1",
            "templateVersion": 1,
            "channels": ["system"],
            "templateSpecs": {
                "width": None,
                "height": None,
                "dimensionsStatus": "tbd",
                "transparency": "required",
                "motion": "static",
                "maxBytes": MAX_BYTES,
                "extensions": ["webp", "png", "gif"],
            },
            "prompt": "Stage 08 Batch F approved attraction-level visual tier asset.",
            "publishedBy": actor,
            "publishedAt": published_at,
            "updatedBy": actor,
            "updatedAt": published_at,
        }
        firestore_patch(
            doc_root,
            access_token,
            f"app_asset_registry/{quote(asset['assetKey'], safe='')}",
            registry,
        )
        audit_id = re.sub(r"[^A-Za-z0-9_-]", "_", f"{operation_id}_{asset['assetKey']}")
        firestore_patch(
            doc_root,
            access_token,
            f"admin_audit_logs/{audit_id}",
            {
                "actorUid": actor,
                "action": "publishAppAssetBatch",
                "targetType": "app_asset",
                "targetId": asset["assetKey"],
                "reason": "Stage 08-B Batch F attraction level assets",
                "operationId": operation_id,
                "after": {
                    "published": True,
                    "status": "published",
                    "contentSha": asset["contentSha"],
                    "fullPath": asset["fullPath"],
                },
                "createdAt": published_at,
            },
        )

    firestore_patch(
        doc_root,
        access_token,
        f"control_operations/{operation_id}",
        {
            "action": "publishAppAssetBatch",
            "actorUid": actor,
            "targetId": "levels.attraction.batch_f",
            "status": "completed",
            "result": {
                "count": 14,
                "commitSha": published_commit,
                "assetKeys": [asset["assetKey"] for asset in assets],
            },
            "createdAt": published_at,
        },
    )
    print("PASS Registry + Audit: 14 bounded writes")

    failures = []
    for asset in assets:
        expected = asset["assetKey"]
        for attempt in range(6):
            response = requests.get(
                f"{WORKER_BASE}/api/app-assets",
                params={"key": expected},
                headers={"origin": "https://ashrafbusiness440-eng.github.io"},
                timeout=30,
            )
            if response.status_code == 200:
                body = response.json()
                if body.get("ok") is True and body.get("asset", {}).get("assetKey") == expected:
                    break
            time.sleep(2 + attempt)
        else:
            failures.append(f"{expected}:{response.status_code}:{response.text[:120]}")

    if failures:
        raise RuntimeError("public registry verification failed: " + " | ".join(failures))
    print("PASS Link + Verify: 14/14 public registry keys")
    print(json.dumps({
        "ok": True,
        "count": 14,
        "commitSha": published_commit,
        "operationId": operation_id,
        "keys": [asset["assetKey"] for asset in assets],
    }, ensure_ascii=False))

if __name__ == "__main__":
    main()
