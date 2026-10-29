import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {test} from "node:test";
import {resolveStoreVisuals} from "../../cloudflare-worker/src/store-presentation.js";

const uid="room_chat_owner";
const now=1761740000000;
const item=(id,category,more={})=>({
  ownerUid:uid,productId:id,category,source:"purchase",
  nameAr:"مقتنى المحادثة",assetKey:"store.item."+id+".icon",
  acquiredAtMs:now-1000,expiresAtMs:now+60000,
  status:"active",equipped:true,...more,
});
const collection=()=>{
  const records=new Map([
    ["user_store_equipped/"+uid,{ownerUid:uid,
      slots:{chatBubbles:"200004",nameEffects:"200005"}}],
    ["user_store_entitlements/"+uid+"/items/200004",item("200004","chatBubbles")],
    ["user_store_entitlements/"+uid+"/items/200005",item("200005","nameEffects",{expiresAtMs:null})],
    ["app_asset_registry/store.item.200004.visual",
      {published:true,rawUrl:"https://example.test/bubble.webp"}],
    ["app_asset_registry/store.item.200005.visual",
      {published:true,rawUrl:"https://example.test/name.webp"}],
  ]);
  const reads=[];
  const db={async get(path){reads.push(path);
    return {exists:records.has(path),data:records.get(path)};
  }};
  return {records,reads,db};
};

test("verified room chat cosmetics require owner selection and standalone Studio visuals",async()=>{
  const state=collection();
  const visuals=await resolveStoreVisuals(state.db,uid,now);
  assert.equal(visuals.chatBubbles.assetKey,"store.item.200004.visual");
  assert.equal(visuals.nameEffects.assetKey,"store.item.200005.visual");
  assert.equal(visuals.chatBubbles.expiresAtMs,now+60000);
  assert.equal(visuals.nameEffects.expiresAtMs,null);
  assert.equal(state.reads.length,5);
  assert.equal(state.reads.some(p=>p.endsWith(".icon")),false);
  assert.equal(state.reads.some(p=>p.startsWith("financial_ledger")),false);
  assert.equal(state.reads.some(p=>p.startsWith("users/")),false);
});

test("expired, revoked, wrong category, foreign-owner and unpublished cosmetics are hidden",async()=>{
  for(const change of [
    {expiresAtMs:now},{status:"revoked"},{equipped:false},
    {ownerUid:"other"},{category:"frames"},
  ]){
    const state=collection();
    Object.assign(state.records.get(
      "user_store_entitlements/"+uid+"/items/200004"),change);
    const visuals=await resolveStoreVisuals(state.db,uid,now);
    assert.equal(visuals.chatBubbles,undefined,JSON.stringify(change));
    assert.ok(visuals.nameEffects);
  }
  const state=collection();
  state.records.get("app_asset_registry/store.item.200005.visual").published=false;
  assert.equal((await resolveStoreVisuals(state.db,uid,now)).nameEffects,undefined);
});

test("room chat uses only server admission attested identity and not socket text",()=>{
  const read=path=>readFileSync(new URL(path,import.meta.url),"utf8");
  const room=read("../../cloudflare-worker/src/room-realtime.js");
  const object=read("../../cloudflare-worker/src/room-realtime-object.js");
  const model=read("../../lib/features/room/services/room_chat_service.dart");
  const ui=read("../../lib/features/room/widgets/room_chat_panel.dart");
  const mystery=read("../../cloudflare-worker/src/mysterious-identity.js");
  const control=read("../../lib/admin/store_catalog_control_page.dart");
  assert.match(room,/storeChatBubbleKey: String\(identityPresentation.storeChatBubbleKey/);
  assert.match(room,/storeNameEffectKey: String\(identityPresentation.storeNameEffectKey/);
  assert.match(object,/storeChatBubbleKey:String\(record.storeChatBubbleKey/);
  assert.match(object,/storeNameEffectKey:String\(record.storeNameEffectKey/);
  assert.match(object,/storeChatBubbleKey:\s*\n\s*!attachment.mysteriousMode/);
  assert.match(object,/storeNameEffectKey:\s*\n\s*!attachment.mysteriousMode/);
  assert.match(object,/storeChatBubbleExpiresAtMs\|\|0\)>nowMs/);
  assert.match(object,/storeNameEffectExpiresAtMs\|\|0\)>nowMs/);
  assert.match(model,/storeChatBubbleKey:/);
  assert.match(model,/storeNameEffectKey:/);
  assert.match(ui,/verifiedStoreChatVisualKey/);
  assert.match(ui,/message.storeChatBubbleKey/);
  assert.match(ui,/message.storeNameEffectKey/);
  assert.match(mystery,/storeChatBubbleKey: ""/);
  assert.match(mystery,/storeNameEffectKey: ""/);
  assert.match(control,/selectedCategory == 'chatBubbles'/);
  assert.match(control,/selectedCategory == 'nameEffects'/);
});
