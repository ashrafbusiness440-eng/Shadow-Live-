import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {test} from "node:test";
import {verifiedStoreSeatWave} from "../../cloudflare-worker/src/voice-session-legacy.js";

const read=path=>readFileSync(new URL(path,import.meta.url),"utf8");
const backend=read("../../cloudflare-worker/src/voice-session-legacy.js");
const seatService=read("../../lib/features/room/services/room_seat_service.dart");
const roomController=read("../../lib/features/voice/services/voice_room_session_controller.dart");
const ownedScreen=read("../../lib/features/store/screens/store_owned_items_screen.dart");
const roomUI=read("../../lib/main.dart");

test("room cosmetics refresh only mutates the authenticated caller's occupied seat",()=>{
  assert.match(backend,/action==="refreshStoreCosmetics"/);
  assert.match(backend,/seats\.findIndex\(seat=>seat\.uid===uid\)/);
  assert.match(backend,/mySeatIndex<0\)throw new ApiError\("speaker_seat_required",403\)/);
  assert.match(backend,/verifiedStoreSeatWave\(db,tx,uid\)/);
  assert.match(backend,/voiceWaveAssetKey:storeWave\?\.assetKey/);
  assert.match(backend,/legacyWaveActive/);
  assert.match(backend,/tx\.update\(roomRef,\{/);
  assert.doesNotMatch(
    backend.slice(backend.indexOf('}else if(action==="refreshStoreCosmetics"){'),
      backend.indexOf('}else if(action==="muteSeat"')),
    /targetUid|coins|ledger|wallet|priceCoins|equipped:true/,
  );
});

test("Flutter refresh occurs once after success and uses existing room transport",()=>{
  assert.match(seatService,/seatAction: 'refreshStoreCosmetics'/);
  assert.match(roomController,/refreshStoreRoomCosmetics\(\) async/);
  assert.match(roomController,/_presenceService\.refreshIdentity\(id\)/);
  assert.match(roomController,/_seatService\.refreshStoreCosmetics\(id\)/);
  assert.match(ownedScreen,/VoiceRoomSessionController\.instance\.refreshStoreRoomCosmetics\(\)/);
  const equip=ownedScreen.indexOf('await _service.setEquipped(item');
  const refresh=ownedScreen.indexOf('await VoiceRoomSessionController.instance.refreshStoreRoomCosmetics()');
  assert.ok(equip>=0&&refresh>equip);
  assert.match(roomUI,/\$\{_voiceSession\.storeCosmeticsRevision\}/);
  assert.doesNotMatch(roomController.slice(
    roomController.indexOf("Future<void> refreshStoreRoomCosmetics()"),
    roomController.indexOf("void setMysteriousModeEnabled",roomController.indexOf("Future<void> refreshStoreRoomCosmetics()"))),
    /Timer\(|\.periodic\(|poll|fetchAll|\.getDocuments\(/);
});

test("refresh resolver denies forged user, expired and revoked ownership",async()=>{
  const uid="member";
  const now=1761740000000;
  const entries=new Map([
    ["user_store_equipped/"+uid,{ownerUid:uid,slots:{voiceWaves:"200007"}}],
    ["user_store_entitlements/"+uid+"/items/200007",{
      ownerUid:uid,productId:"200007",category:"voiceWaves",
      assetKey:"store.item.200007.icon",status:"revoked",
      equipped:true,expiresAtMs:now+5000,
    }],
    ["app_asset_registry/store.item.200007.visual",{
      published:true,rawUrl:"https://example.test/wave.webp",
    }],
  ]);
  const ref=p=>({p,collection:k=>({doc:id=>ref(p+"/"+k+"/"+id)})});
  const db={collection:k=>({doc:id=>ref(k+"/"+id)})};
  const tx={get:async r=>({exists:entries.has(r.p),data:()=>entries.get(r.p)||{}})};
  assert.equal(await verifiedStoreSeatWave(db,tx,uid,now),null);
  entries.get("user_store_entitlements/"+uid+"/items/200007").status="active";
  entries.get("user_store_entitlements/"+uid+"/items/200007").ownerUid="forged";
  assert.equal(await verifiedStoreSeatWave(db,tx,uid,now),null);
  entries.get("user_store_entitlements/"+uid+"/items/200007").ownerUid=uid;
  entries.get("user_store_entitlements/"+uid+"/items/200007").expiresAtMs=now;
  assert.equal(await verifiedStoreSeatWave(db,tx,uid,now),null);
});
