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

TIER_SPECS = {
    "lv01_05": {
        "metal": (190, 208, 212), "dark": (18, 55, 47), "accent": (39, 214, 149),
        "assets": ["main_badge","wealth_badge","upgrade_announcement","entry_effect","chat_bubble","profile_frame"],
    },
    "lv06_10": {
        "metal": (205, 217, 232), "dark": (24, 50, 91), "accent": (53, 128, 245),
        "assets": ["main_badge","wealth_badge","upgrade_announcement","entry_effect","chat_bubble","profile_frame","support_bar"],
    },
    "lv11_15": {
        "metal": (220, 220, 230), "dark": (82, 30, 69), "accent": (236, 72, 177),
        "assets": ["main_badge","wealth_badge","upgrade_announcement","entry_effect","chat_bubble","profile_frame","support_bar","gift_privilege"],
    },
    "lv16_20": {
        "metal": (213, 225, 239), "dark": (24, 50, 96), "accent": (61, 145, 255),
        "assets": ["main_badge","wealth_badge","upgrade_announcement","entry_effect","chat_bubble","profile_frame","support_bar","gift_privilege","entry_bar"],
    },
    "lv21_25": {
        "metal": (216, 211, 230), "dark": (62, 33, 102), "accent": (157, 78, 240),
        "assets": ["main_badge","wealth_badge","upgrade_announcement","entry_effect","chat_bubble","profile_frame","support_bar","gift_privilege","entry_bar","vehicle"],
    },
    "lv26_30": {
        "metal": (235, 195, 88), "dark": (92, 55, 23), "accent": (255, 158, 43),
        "assets": ["main_badge","wealth_badge","upgrade_announcement","entry_effect","chat_bubble","profile_frame","support_bar","gift_privilege","entry_bar","vehicle"],
    },
    "lv31_35": {
        "metal": (242, 202, 91), "dark": (98, 31, 25), "accent": (231, 53, 66),
        "assets": ["main_badge","wealth_badge","upgrade_announcement","entry_effect","chat_bubble","profile_frame","support_bar","gift_privilege","entry_bar","vehicle"],
    },
}

ASSET_META = {
    "main_badge": ("main_badge", "mainBadge", (1024,1024)),
    "wealth_badge": ("wealth_badge", "wealthBadge", (512,256)),
    "upgrade_announcement": ("upgrade_announcement", "upgradeAnnouncement", (1536,384)),
    "entry_effect": ("entry_effect", "entryEffect", (1536,512)),
    "chat_bubble": ("chat_bubble", "chatBubble", (1024,512)),
    "profile_frame": ("profile_frame", "profileFrame", (1024,1024)),
    "support_bar": ("support_bar", "supportBar", (1536,384)),
    "gift_privilege": ("gift_privilege", "giftPrivilege", (1024,1024)),
    "entry_bar": ("entry_bar", "entryBar", (1536,384)),
    "vehicle": ("vehicle", "vehicle", (1024,1024)),
}

def now_iso():
    return datetime.now(timezone.utc).isoformat().replace("+00:00","Z")

def mix(a,b,t):
    return tuple(int(a[i]*(1-t)+b[i]*t) for i in range(3))

def glow(base, center, radius, color, strength=130):
    layer=Image.new("RGBA",base.size,(0,0,0,0))
    d=ImageDraw.Draw(layer)
    d.ellipse((center[0]-radius,center[1]-radius,center[0]+radius,center[1]+radius),fill=color+(strength,))
    base.alpha_composite(layer.filter(ImageFilter.GaussianBlur(max(1,radius//3))))

def star(cx,cy,outer,inner,count=8):
    out=[]
    for i in range(count*2):
        r=outer if i%2==0 else inner
        a=-math.pi/2+i*math.pi/count
        out.append((cx+math.cos(a)*r,cy+math.sin(a)*r))
    return out

def draw_emblem(size, metal, dark, accent, compact=False):
    w,h=size; s=min(w,h); cx,cy=w//2,h//2
    base=Image.new("RGBA",size,(0,0,0,0))
    d=ImageDraw.Draw(base)
    r=int(s*(0.34 if not compact else 0.31))
    glow(base,(cx,cy),int(s*0.30),accent,95); d=ImageDraw.Draw(base)
    d.ellipse((cx-r,cy-r,cx+r,cy+r),fill=dark+(245,),outline=mix(metal,(255,255,255),0.35)+(255,),width=max(5,int(s*0.035)))
    d.ellipse((cx-r*0.82,cy-r*0.82,cx+r*0.82,cy+r*0.82),outline=metal+(255,),width=max(4,int(s*0.026)))
    for side in (-1,1):
        pts=[
            (cx+side*r*0.65,cy-r*0.50),(cx+side*r*1.08,cy-r*0.26),
            (cx+side*r*0.83,cy-r*0.02),(cx+side*r*1.02,cy+r*0.24),
            (cx+side*r*0.62,cy+r*0.43),(cx+side*r*0.52,cy+r*0.13)
        ]
        d.polygon(pts,fill=metal+(255,),outline=mix(metal,(255,255,255),0.45)+(255,))
        d.line([(x+(cx-x)*0.13,y+(cy-y)*0.13) for x,y in pts],fill=accent+(215,),width=max(3,int(s*0.014)),joint="curve")
    shield=[(cx,cy-r*0.48),(cx+r*0.31,cy-r*0.22),(cx+r*0.25,cy+r*0.23),(cx,cy+r*0.48),(cx-r*0.25,cy+r*0.23),(cx-r*0.31,cy-r*0.22)]
    d.polygon(shield,fill=mix(dark,accent,0.16)+(255,),outline=mix(metal,(255,255,255),0.5)+(255,))
    d.polygon(star(cx,cy,r*0.25,r*0.11,6),fill=accent+(255,),outline=(255,255,255,210))
    d.polygon(star(cx,cy-r*0.74,r*0.14,r*0.06,5),fill=metal+(255,),outline=accent+(210,))
    d.arc((cx-r*0.70,cy-r*0.70,cx+r*0.70,cy+r*0.70),195,310,fill=(255,255,255,140),width=max(2,int(s*0.009)))
    return base

def draw_banner(size, metal, dark, accent, kind):
    w,h=size; s=min(w,h); cx,cy=w//2,h//2
    base=Image.new("RGBA",size,(0,0,0,0)); d=ImageDraw.Draw(base)
    glow(base,(cx,cy),int(h*0.58),accent,70); d=ImageDraw.Draw(base)
    y0=int(h*0.17); y1=int(h*0.83)
    poly=[(int(w*0.08),cy),(int(w*0.17),y0),(int(w*0.83),y0),(int(w*0.92),cy),(int(w*0.83),y1),(int(w*0.17),y1)]
    d.polygon(poly,fill=dark+(228,),outline=metal+(255,))
    inner=[(int(w*0.11),cy),(int(w*0.19),int(h*0.25)),(int(w*0.81),int(h*0.25)),(int(w*0.89),cy),(int(w*0.81),int(h*0.75)),(int(w*0.19),int(h*0.75))]
    d.line(inner+[inner[0]],fill=accent+(210,),width=max(3,int(s*0.018)),joint="curve")
    for x in (int(w*0.13),int(w*0.87)):
        d.polygon(star(x,cy,int(h*0.22),int(h*0.09),6),fill=metal+(255,),outline=accent+(230,))
    # preserve a clean transparent-friendly center region for dynamic content
    if kind in ("entry_effect","entry_bar","support_bar"):
        d.rounded_rectangle((int(w*0.28),int(h*0.31),int(w*0.72),int(h*0.69)),radius=int(h*0.12),fill=(0,0,0,0),outline=mix(metal,(255,255,255),0.25)+(160,),width=max(2,int(s*0.008)))
    return base

def draw_chat(size, metal, dark, accent):
    w,h=size; s=min(w,h)
    base=Image.new("RGBA",size,(0,0,0,0)); d=ImageDraw.Draw(base)
    glow(base,(w//2,h//2),int(h*0.45),accent,60); d=ImageDraw.Draw(base)
    box=(int(w*0.08),int(h*0.15),int(w*0.90),int(h*0.78))
    d.rounded_rectangle(box,radius=int(h*0.18),fill=dark+(235,),outline=metal+(255,),width=max(5,int(s*0.035)))
    d.rounded_rectangle((int(w*0.12),int(h*0.22),int(w*0.86),int(h*0.70)),radius=int(h*0.13),outline=accent+(205,),width=max(3,int(s*0.018)))
    tail=[(int(w*0.70),int(h*0.77)),(int(w*0.84),int(h*0.94)),(int(w*0.82),int(h*0.73))]
    d.polygon(tail,fill=metal+(255,),outline=accent+(190,))
    return base

def draw_frame(size, metal, dark, accent):
    w,h=size; s=min(w,h); cx,cy=w//2,h//2; r=int(s*0.38)
    base=Image.new("RGBA",size,(0,0,0,0)); d=ImageDraw.Draw(base)
    glow(base,(cx,cy),int(s*0.36),accent,75); d=ImageDraw.Draw(base)
    for rr,color,width in [(r,metal,int(s*0.045)),(int(r*0.88),accent,int(s*0.018)),(int(r*0.80),mix(metal,(255,255,255),0.3),int(s*0.025))]:
        d.ellipse((cx-rr,cy-rr,cx+rr,cy+rr),outline=color+(255,),width=max(3,width))
    # center intentionally transparent
    for a in (-0.75,-0.25,0.25,0.75):
        x=cx+math.cos(a)*r*0.93; y=cy+math.sin(a)*r*0.93
        d.polygon(star(x,y,int(s*0.055),int(s*0.022),5),fill=metal+(255,),outline=accent+(230,))
    return base

def draw_privilege(size, metal, dark, accent):
    base=draw_emblem(size,metal,dark,accent)
    d=ImageDraw.Draw(base); w,h=size; s=min(w,h)
    d.polygon(star(w//2,h//2,int(s*0.18),int(s*0.07),8),fill=mix(accent,(255,255,255),0.2)+(235,),outline=(255,255,255,220))
    return base

def draw_vehicle(size, metal, dark, accent):
    w,h=size; s=min(w,h); base=Image.new("RGBA",size,(0,0,0,0)); d=ImageDraw.Draw(base)
    glow(base,(w//2,int(h*0.58)),int(s*0.34),accent,80); d=ImageDraw.Draw(base)
    body=[(int(w*0.20),int(h*0.58)),(int(w*0.34),int(h*0.42)),(int(w*0.68),int(h*0.42)),(int(w*0.83),int(h*0.58)),(int(w*0.75),int(h*0.70)),(int(w*0.26),int(h*0.70))]
    d.polygon(body,fill=dark+(250,),outline=metal+(255,))
    d.polygon([(int(w*0.39),int(h*0.44)),(int(w*0.47),int(h*0.32)),(int(w*0.62),int(h*0.32)),(int(w*0.68),int(h*0.44))],fill=mix(dark,accent,0.18)+(245,),outline=accent+(220,))
    for x in (int(w*0.31),int(w*0.69)):
        d.ellipse((x-int(s*0.075),int(h*0.64)-int(s*0.075),x+int(s*0.075),int(h*0.64)+int(s*0.075)),fill=(16,18,24,255),outline=metal+(255,),width=max(4,int(s*0.018)))
        d.ellipse((x-int(s*0.035),int(h*0.64)-int(s*0.035),x+int(s*0.035),int(h*0.64)+int(s*0.035)),fill=accent+(255,))
    return base

def render(kind,size,metal,dark,accent):
    if kind=="main_badge": return draw_emblem(size,metal,dark,accent)
    if kind=="wealth_badge": return draw_emblem(size,metal,dark,accent,compact=True)
    if kind in ("upgrade_announcement","entry_effect","support_bar","entry_bar"): return draw_banner(size,metal,dark,accent,kind)
    if kind=="chat_bubble": return draw_chat(size,metal,dark,accent)
    if kind=="profile_frame": return draw_frame(size,metal,dark,accent)
    if kind=="gift_privilege": return draw_privilege(size,metal,dark,accent)
    if kind=="vehicle": return draw_vehicle(size,metal,dark,accent)
    raise RuntimeError(kind)

def webp_bytes(image):
    out=io.BytesIO(); image.save(out,"WEBP",quality=88,method=4); return out.getvalue()

def safe_directory(value):
    directory=value.rstrip("/").replace("\\","/"); segs=directory.split("/")
    return directory.startswith("assets/images/levels/wealth/") and "//" not in directory and all(s not in ("",".","..") and SEGMENT_RE.fullmatch(s) for s in segs)

def validate_asset(asset):
    if not KEY_RE.fullmatch(asset["assetKey"]): raise RuntimeError("invalid key "+asset["assetKey"])
    if not safe_directory(asset["directory"]): raise RuntimeError("invalid directory "+asset["directory"])
    if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._-]{0,119}\.webp",asset["fileName"]): raise RuntimeError("invalid filename")
    if not (0 < len(asset["bytes"]) <= MAX_BYTES): raise RuntimeError("invalid size")
    image=Image.open(io.BytesIO(asset["bytes"]))
    if image.size != (asset["width"],asset["height"]) or image.format!="WEBP": raise RuntimeError("render validation failed")

def github_json(method,path,token,payload=None):
    res=requests.request(method,f"https://api.github.com/repos/{OWNER}/{REPO}{path}",headers={"accept":"application/vnd.github+json","authorization":f"Bearer {token}","x-github-api-version":"2022-11-28"},json=payload,timeout=60)
    if not res.ok: raise RuntimeError(f"GitHub {method} {path} {res.status_code}: {res.text[:400]}")
    return res.json() if res.text else {}

def encode_value(v):
    if v is None:return {"nullValue":None}
    if isinstance(v,bool):return {"booleanValue":v}
    if isinstance(v,int):return {"integerValue":str(v)}
    if isinstance(v,float):return {"doubleValue":v}
    if isinstance(v,str):return {"stringValue":v}
    if isinstance(v,list):return {"arrayValue":{"values":[encode_value(x) for x in v]}}
    if isinstance(v,dict):return {"mapValue":{"fields":{k:encode_value(x) for k,x in v.items()}}}
    raise TypeError(type(v))

def fs_patch(root,token,path,data):
    res=requests.patch(f"{root}/{path}",headers={"authorization":f"Bearer {token}","content-type":"application/json"},json={"fields":{k:encode_value(v) for k,v in data.items()}},timeout=60)
    if not res.ok: raise RuntimeError(f"Firestore {path} {res.status_code}: {res.text[:400]}")

def main():
    tier=os.environ.get("WEALTH_TIER","").strip()
    if tier not in TIER_SPECS: raise RuntimeError("invalid WEALTH_TIER")
    spec=TIER_SPECS[tier]
    gh=os.environ["SHADOW_ASSET_GITHUB_TOKEN"].strip()
    raw=os.environ["FIREBASE_SERVICE_ACCOUNT"]; sa=json.loads(raw)
    if isinstance(sa,str): sa=json.loads(sa)

    directory=f"assets/images/levels/wealth/{tier}"
    assets=[]
    for kind in spec["assets"]:
        file_suffix,key_suffix,size=ASSET_META[kind]
        file_name=f"wealth_{tier}_{file_suffix}.webp"
        data=webp_bytes(render(kind,size,spec["metal"],spec["dark"],spec["accent"]))
        asset={"kind":kind,"directory":directory,"fileName":file_name,"fullPath":f"{directory}/{file_name}","assetKey":f"levels.wealth.{tier}.{key_suffix}","width":size[0],"height":size[1],"bytes":data}
        validate_asset(asset); assets.append(asset)
    print(f"PASS Generate + Validate: {tier} {len(assets)} assets")

    ref=github_json("GET","/git/ref/heads/main",gh); parent=ref["object"]["sha"]
    commit=github_json("GET",f"/git/commits/{parent}",gh); base_tree=commit["tree"]["sha"]
    entries=[]
    for a in assets:
        blob=github_json("POST","/git/blobs",gh,{"content":base64.b64encode(a["bytes"]).decode(),"encoding":"base64"})
        a["contentSha"]=blob["sha"]; entries.append({"path":a["fullPath"],"mode":"100644","type":"blob","sha":blob["sha"]})
    manifest={"batch":"E","metric":"wealth","tier":tier,"publishedAt":now_iso(),"assets":[{k:a[k] for k in ("assetKey","fullPath","width","height","contentSha")} for a in assets]}
    mb=github_json("POST","/git/blobs",gh,{"content":json.dumps(manifest,ensure_ascii=False,indent=2),"encoding":"utf-8"})
    entries.append({"path":f"{directory}/PUBLISHED.json","mode":"100644","type":"blob","sha":mb["sha"]})
    tree=github_json("POST","/git/trees",gh,{"base_tree":base_tree,"tree":entries})
    nc=github_json("POST","/git/commits",gh,{"message":f"Stage 08-B Batch E: publish wealth {tier} assets","tree":tree["sha"],"parents":[parent]})
    github_json("PATCH","/git/refs/heads/main",gh,{"sha":nc["sha"],"force":False})
    published=nc["sha"]; print("PASS Publish GitHub:",published)

    creds=service_account.Credentials.from_service_account_info(sa,scopes=["https://www.googleapis.com/auth/datastore"]); creds.refresh(GoogleAuthRequest())
    token=creds.token; root=f"https://firestore.googleapis.com/v1/projects/{sa['project_id']}/databases/(default)/documents"
    actor="github-actions:stage08b-batch-e"; op=f"batch_e_{tier}_{os.environ.get('GITHUB_RUN_ID',published[:12])}"; at=now_iso()
    for a in assets:
        raw_url=f"https://raw.githubusercontent.com/{OWNER}/{REPO}/main/{a['fullPath']}?v={a['contentSha']}"
        reg={"assetKey":a["assetKey"],"directory":a["directory"],"fileName":a["fileName"],"fullPath":a["fullPath"],"mimeType":"image/webp","mode":"remote","byteSize":len(a["bytes"]),"contentSha":a["contentSha"],"commitSha":published,"rawUrl":raw_url,"published":True,"status":"published","replaced":False,"hasDraft":False,"draft":None,"studioVersion":1,"assetType":"badge","templateId":"badge.base.v1","templateVersion":1,"channels":["system"],"templateSpecs":{"width":None,"height":None,"dimensionsStatus":"tbd","transparency":"required","motion":"static","maxBytes":MAX_BYTES,"extensions":["webp","png","gif"]},"prompt":f"Stage 08 Batch E approved wealth {tier} cosmetic asset.","publishedBy":actor,"publishedAt":at,"updatedBy":actor,"updatedAt":at}
        fs_patch(root,token,f"app_asset_registry/{quote(a['assetKey'],safe='')}",reg)
        audit=re.sub(r"[^A-Za-z0-9_-]","_",f"{op}_{a['assetKey']}")
        fs_patch(root,token,f"admin_audit_logs/{audit}",{"actorUid":actor,"action":"publishAppAssetBatch","targetType":"app_asset","targetId":a["assetKey"],"reason":f"Stage 08-B Batch E wealth {tier} assets","operationId":op,"after":{"published":True,"status":"published","contentSha":a["contentSha"],"fullPath":a["fullPath"]},"createdAt":at})
    fs_patch(root,token,f"control_operations/{op}",{"action":"publishAppAssetBatch","actorUid":actor,"targetId":f"levels.wealth.{tier}","status":"completed","result":{"count":len(assets),"commitSha":published,"assetKeys":[a["assetKey"] for a in assets]},"createdAt":at})
    print(f"PASS Registry + Audit: {len(assets)} bounded writes")

    fails=[]
    for a in assets:
        for attempt in range(6):
            res=requests.get(f"{WORKER_BASE}/api/app-assets",params={"key":a["assetKey"]},headers={"origin":"https://ashrafbusiness440-eng.github.io"},timeout=30)
            if res.status_code==200:
                body=res.json()
                if body.get("ok") is True and body.get("asset",{}).get("assetKey")==a["assetKey"]: break
            time.sleep(2+attempt)
        else:fails.append(f"{a['assetKey']}:{res.status_code}:{res.text[:100]}")
    if fails: raise RuntimeError("verify failed: "+" | ".join(fails))
    print(f"PASS Link + Verify: {len(assets)}/{len(assets)} public registry keys")
    print(json.dumps({"ok":True,"tier":tier,"count":len(assets),"commitSha":published,"operationId":op,"keys":[a["assetKey"] for a in assets]},ensure_ascii=False))

if __name__=="__main__":
    main()
