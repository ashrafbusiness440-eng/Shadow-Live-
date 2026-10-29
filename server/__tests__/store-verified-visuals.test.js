import assert from "node:assert/strict";
import {test} from "node:test";
import {readFileSync} from "node:fs";
import {
  resolveStoreVisuals,storePresentation,
} from "../../cloudflare-worker/src/store-presentation.js";

const uid="store_visual_owner_1";
const now=1700000000000;
const ent=(productId,category,extra={})=>({
  ownerUid:uid,productId,category,
  nameAr:"مقتنى بصري",source:"purchase",status:"active",equipped:true,
  assetKey:"store.item."+productId+".icon",
  acquiredAtMs:now-10000,expiresAtMs:now+60000,...extra,
});
function setup(){
  const docs=new Map([
    ["user_store_equipped/"+uid,{ownerUid:uid,
      slots:{frames:"200001",entranceEffects:"200002"}}],
    ["user_store_entitlements/"+uid+"/items/200001",ent("200001","frames")],
    ["user_store_entitlements/"+uid+"/items/200002",
      ent("200002","entranceEffects",{expiresAtMs:null})],
    ["app_asset_registry/store.item.200001.visual",
      {published:true,rawUrl:"https://cdn.example.com/frame.webp"}],
    ["app_asset_registry/store.item.200002.visual",
      {published:true,rawUrl:"https://cdn.example.com/entrance.webp"}],
  ]);
  const reads=[];
  const db={async get(path){reads.push(path);return {
    exists:docs.has(path),data:docs.get(path),
  };}};
  return {db,docs,reads};
}
test("verified owner selection resolves visual—not catalogue thumbnail",async()=>{
  const c=setup();
  const out=await resolveStoreVisuals(c.db,uid,now);
  assert.equal(out.frames.assetKey,"store.item.200001.visual");
  assert.equal(out.frames.imageUrl,"https://cdn.example.com/frame.webp");
  assert.equal(out.frames.expiresAtMs,now+60000);
  assert.equal(out.entranceEffects.assetKey,"store.item.200002.visual");
  assert.equal(out.entranceEffects.expiresAtMs,null);
  assert.equal(c.reads.some(p=>p.endsWith(".icon")),false);
  assert.equal(c.reads.some(p=>p.startsWith("users/")),false);
  assert.equal(c.reads.some(p=>p.startsWith("financial_ledger/")),false);
  assert.equal(c.reads.some(p=>p.startsWith("store_grant_")),false);
  assert.equal(JSON.stringify(out).includes(uid),false);
  assert.equal(Object.keys(out.frames).length,4);
});

test("expired revoked unequipped wrong-owner category and unpublished stay hidden",async()=>{
  for(const change of [
    {expiresAtMs:now},
    {status:"revoked"},
    {equipped:false},
    {ownerUid:"attacker"},
    {category:"entranceEffects"},
    {assetKey:"store.item.200002.icon"},
  ]){
    const c=setup();
    Object.assign(c.docs.get("user_store_entitlements/"+uid+"/items/200001"),change);
    const out=await resolveStoreVisuals(c.db,uid,now);
    assert.equal(out.frames,undefined,JSON.stringify(change));
    assert.ok(out.entranceEffects);
  }
  const c=setup();
  c.docs.get("app_asset_registry/store.item.200001.visual").published=false;
  assert.equal((await resolveStoreVisuals(c.db,uid,now)).frames,undefined);
  const d=setup();
  d.docs.get("app_asset_registry/store.item.200001.visual").rawUrl="http://unsafe.test";
  assert.equal((await resolveStoreVisuals(d.db,uid,now)).frames,undefined);
});

test("legacy and malformed equipment fail closed without breaking other cosmetics",async()=>{
  const c=setup();
  c.docs.delete("user_store_equipped/"+uid);
  assert.deepEqual(await resolveStoreVisuals(c.db,uid,now),{});
  const d=setup();
  d.docs.get("user_store_equipped/"+uid).ownerUid="not-owner";
  assert.deepEqual(await resolveStoreVisuals(d.db,uid,now),{});
  const e=setup();
  e.docs.get("user_store_equipped/"+uid).slots.forged="200004";
  assert.deepEqual(await resolveStoreVisuals(e.db,uid,now),{});
  assert.deepEqual(await resolveStoreVisuals(e.db,"../../other",now),{});
});

test("Admin-style legacy room reader uses bounded direct document gets",async()=>{
  const c=setup();
  const db={
    doc(path){
      return {get:async()=>{
        const value=c.docs.get(path);
        return {exists:c.docs.has(path),data:()=>value};
      }};
    },
  };
  const out=await resolveStoreVisuals(db,uid,now);
  assert.equal(out.frames.assetKey,"store.item.200001.visual");
  assert.equal(out.entranceEffects.productId,"200002");
});

test("store presentation is read only and room renders verified visuals before mystery",async()=>{
  const method=await storePresentation(
    new Request("https://example.com/api/store-presentation"),{});
  assert.equal(method.status,405);
  const route=readFileSync(new URL(
    "../../cloudflare-worker/src/index.js",import.meta.url),"utf8");
  const room=readFileSync(new URL(
    "../../cloudflare-worker/src/room-realtime.js",import.meta.url),"utf8");
  const legacy=readFileSync(new URL(
    "../../cloudflare-worker/src/voice-session-legacy.js",import.meta.url),"utf8");
  const source=readFileSync(new URL(
    "../../cloudflare-worker/src/store-presentation.js",import.meta.url),"utf8");
  assert.match(route,/url\.pathname === "\/api\/store-presentation"/);
  assert.match(room,/resolveStoreVisuals\(db,uid\)/);
  assert.match(room,/storeEntrance\?\.assetKey \|\| vipCosmetics/);
  assert.match(room,/storeFrame\?\.assetKey/);
  assert.match(room,/applyMysteriousIdentityPresentation/);
  assert.match(room,/safeLegacyFrameKey/);
  assert.match(legacy,/hasStoreEntrance/);
  assert.match(legacy,/storeEntrance\.assetKey/);
  assert.match(legacy,/resolveStoreVisuals\(db,uid\)/);
  assert.match(legacy,/mysteriousMode[\s\S]*hasStoreEntrance/);
  assert.doesNotMatch(source,/db\.commit\(|writeCreate\(|writeUpdate\(/);
  assert.doesNotMatch(source,/db\.list\(|runQuery\(/);
});
