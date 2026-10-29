import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {test} from "node:test";
import {resolveStoreVisuals} from "../../cloudflare-worker/src/store-presentation.js";

const uid="room_cosmetics_owner";
const now=1761740000000;
const categories=["roomFrames","backgrounds"];
const ids={roomFrames:"200008",backgrounds:"200009"};
const item=(category,more={})=>({
  ownerUid:uid,productId:ids[category],category,source:"reward",
  status:"active",equipped:true,assetKey:`store.item.${ids[category]}.icon`,
  acquiredAtMs:now-1,expiresAtMs:now+50000,...more,
});
function fixture(){
  const data=new Map([
    ["user_store_equipped/"+uid,{ownerUid:uid,slots:{...ids}}],
    ...categories.map(cat=>[
      `user_store_entitlements/${uid}/items/${ids[cat]}`,item(cat)]),
    ...categories.map(cat=>[
      `app_asset_registry/store.item.${ids[cat]}.visual`,
      {published:true,rawUrl:`https://cdn.example.test/${cat}.webp`}]),
  ]);
  const reads=[];
  return {data,reads,db:{get:async path=>{
    reads.push(path);
    return {exists:data.has(path),data:data.get(path)};
  }}};
}
const resolve=(db)=>resolveStoreVisuals(db,uid,now,categories);

test("owner-scoped room frame and wallpaper use published Studio visuals only",async()=>{
  const x=fixture();
  const result=await resolve(x.db);
  for(const cat of categories){
    assert.equal(result[cat]?.assetKey,`store.item.${ids[cat]}.visual`);
    assert.equal(result[cat]?.imageUrl,`https://cdn.example.test/${cat}.webp`);
    assert.equal(result[cat]?.expiresAtMs,now+50000);
  }
  assert.equal(x.reads.length,5);
  assert.equal(x.reads.filter(p=>p.includes(".visual")).length,2);
  assert.equal(x.reads.some(p=>p.includes(".icon")||
    p.startsWith("financial_ledger")||p.startsWith("users/")),false);
  assert.equal(JSON.stringify(result).includes("ownerUid"),false);
});
test("per-category revocation, expiry, wrong owner and unlisted visual fail closed",async()=>{
  for(const category of categories){
    const record=`user_store_entitlements/${uid}/items/${ids[category]}`;
    const visual=`app_asset_registry/store.item.${ids[category]}.visual`;
    for(const patch of [
      {expiresAtMs:now},{status:"revoked"},{equipped:false},
      {ownerUid:"foreign_owner"},{category:"frames"},
      {assetKey:"store.item.200099.icon"},
    ]){
      const x=fixture();
      Object.assign(x.data.get(record),patch);
      assert.equal((await resolve(x.db))[category],undefined,
        `${category}: ${JSON.stringify(patch)}`);
      assert.ok((await resolve(x.db))[categories.find(c=>c!==category)]);
    }
    for(const patch of [
      {published:false},{rawUrl:"http://insecure.example.test/art.webp"},
      {rawUrl:""},
    ]){
      const x=fixture();
      Object.assign(x.data.get(visual),patch);
      assert.equal((await resolve(x.db))[category],undefined);
    }
  }
  const x=fixture();
  x.data.get("user_store_equipped/"+uid).slots={};
  assert.deepEqual(await resolve(x.db),{});
  assert.deepEqual(x.reads,["user_store_equipped/"+uid]);
});
test("room socket admission still uses its old four-category bounded projection",async()=>{
  const x=fixture();
  assert.deepEqual(await resolveStoreVisuals(x.db,uid,now),{});
  assert.deepEqual(x.reads,["user_store_equipped/"+uid]);
});
test("room UI uses verified owner visuals, never caller-supplied Store keys",()=>{
  const read=p=>readFileSync(new URL(p,import.meta.url),"utf8");
  const server=read("../../cloudflare-worker/src/store-presentation.js");
  const service=read("../../lib/features/store/services/store_visual_presentation_service.dart");
  const room=read("../../lib/main.dart");
  const control=read("../../lib/admin/store_catalog_control_page.dart");
  assert.match(server,/PROFILE_VISUAL_CATEGORIES=Object\.freeze/);
  assert.match(server,/"roomFrames","backgrounds"/);
  assert.match(service,/loadRoomDecorations\(String uid\)/);
  assert.match(room,/service\.loadRoomDecorations\(uid\)/);
  assert.match(room,/storeRoomFrame\.activeNow/);
  assert.match(room,/snapshot\.data\?\['backgrounds'\]/);
  assert.match(room,/CosmeticAssetVisual\(/);
  assert.match(control,/selectedCategory == 'roomFrames'/);
  assert.match(control,/selectedCategory == 'backgrounds'/);
});
