import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {test} from "node:test";
import {verifiedStoreSeatWave} from "../../cloudflare-worker/src/voice-session-legacy.js";

const uid="voice_wave_owner",now=1761740000000;
const id="200007";
const entitlement=(more={})=>({
  ownerUid:uid,productId:id,category:"voiceWaves",
  assetKey:"store.item."+id+".icon",status:"active",
  source:"reward",acquiredAtMs:now-1000,expiresAtMs:now+70000,
  equipped:true,...more,
});
function fixture(){
  const records=new Map([
    ["user_store_equipped/"+uid,{ownerUid:uid,slots:{voiceWaves:id}}],
    ["user_store_entitlements/"+uid+"/items/"+id,entitlement()],
    ["app_asset_registry/store.item."+id+".visual",
      {published:true,rawUrl:"https://example.test/wave.webp"}],
  ]);
  const reads=[];
  function ref(path){
    return {path,collection:part=>({doc:name=>ref(path+"/"+part+"/"+name)})};
  }
  const db={collection:part=>({doc:name=>ref(part+"/"+name)})};
  const tx={get:async reference=>{
    reads.push(reference.path);
    return {exists:records.has(reference.path),
      data:()=>records.get(reference.path)||{}};
  }};
  return {records,reads,db,tx};
}
test("seat wave is bound to trusted Store equipment inside Firestore transaction",async()=>{
  const f=fixture();
  const wave=await verifiedStoreSeatWave(f.db,f.tx,uid,now);
  assert.equal(wave.assetKey,"store.item.200007.visual");
  assert.equal(wave.imageUrl,"https://example.test/wave.webp");
  assert.equal(wave.expiresAtMs,now+70000);
  assert.deepEqual(f.reads,[
    "user_store_equipped/"+uid,
    "user_store_entitlements/"+uid+"/items/"+id,
    "app_asset_registry/store.item."+id+".visual",
  ]);
  assert.equal(f.reads.some(p=>p.includes(".icon")||
    p.startsWith("financial_ledger")||p.startsWith("users/")),false);
});
test("missing, expired, revoked, forged and wrong-category waves fall back",async()=>{
  for(const changes of [
    {expiresAtMs:now},{status:"revoked"},{equipped:false},
    {ownerUid:"other"},{category:"frames"},
    {assetKey:"store.item.200007.visual"},
  ]){
    const f=fixture();
    Object.assign(f.records.get("user_store_entitlements/"+uid+"/items/"+id),changes);
    assert.equal(await verifiedStoreSeatWave(f.db,f.tx,uid,now),null,
      JSON.stringify(changes));
  }
  for(const changes of [
    {published:false},{rawUrl:"http://invalid.example/wave.webp"},
  ]){
    const f=fixture();
    Object.assign(f.records.get("app_asset_registry/store.item."+id+".visual"),changes);
    assert.equal(await verifiedStoreSeatWave(f.db,f.tx,uid,now),null);
  }
  const f=fixture();
  f.records.get("user_store_equipped/"+uid).slots={};
  assert.equal(await verifiedStoreSeatWave(f.db,f.tx,uid,now),null);
  assert.deepEqual(f.reads,["user_store_equipped/"+uid]);
});
test("existing mic stage, VIP fallback and mysterious privacy remain",()=>{
  const read=path=>readFileSync(new URL(path,import.meta.url),"utf8");
  const server=read("../../cloudflare-worker/src/voice-session-legacy.js");
  const client=read("../../lib/main.dart");
  const control=read("../../lib/admin/store_catalog_control_page.dart");
  assert.match(server,/storeWave\?\.assetKey\|\|clean\(voiceWave\.assetKey\)\|\|vipWaveAssetKey/);
  assert.match(server,/storeWave\.expiresAtMs\?\?Number\.MAX_SAFE_INTEGER/);
  assert.match(server,/mysteriousActive\?null:/);
  assert.match(client,/seat\.voiceWaveActive && !seat\.mysteriousMode/);
  assert.match(client,/assetKey: seat\.voiceWaveAssetKey/);
  assert.match(control,/selectedCategory == 'voiceWaves'/);
});
