import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {test} from "node:test";
import {
  refreshRevokedStoreGrantInLiveRoom,scrubRevokedStoreWaveSeat,
} from "../../cloudflare-worker/src/store-grant-revoke-live.js";

const uid="user_a",roomId="room_one",productId="200007";
const result=(category="voiceWaves")=>({
  targetUid:uid,productId,category,revoked:true,
});
const seat=(owner,asset)=>({
  index:0,uid:owner,muted:false,
  voiceWaveAssetKey:asset,voiceWaveImageUrl:"https://cdn.example/old",
  voiceWaveExpiresAtMs:9999999999999,
});
function fakeDb({room=true,index=true,seats=[
  seat(uid,"store.item.200007.visual"),
  seat("other","store.item.299999.visual"),
]}={}){
  const docs=new Map();
  if(index) docs.set("user_room_index/"+uid,{roomId});
  if(room) docs.set("rooms/"+roomId,{isActive:true,seats,
    keep:"must_remain"});
  const reads=[],writes=[];
  let rollbackCount=0;
  return {
    docs,reads,writes,
    get rollbackCount(){return rollbackCount;},
    async beginTransaction(){return {}},
    async rollback(){rollbackCount++},
    async get(path){reads.push(path);return {
      exists:docs.has(path),data:docs.get(path),
    }},
    writeUpdate(path,value,fields){return {path,value,fields}},
    async commit(_tx,changes){
      for(const change of changes){
        writes.push(change);
        docs.set(change.path,{...docs.get(change.path),...change.value});
      }
    },
  };
}
function fakeEnv({delivered=true}={}){
  const requests=[];
  const env={ROOM_REALTIME:{
    idFromName:name=>name,
    get:name=>({async fetch(url,options){
      requests.push({name,url,body:JSON.parse(options.body)});
      return Response.json({ok:true,present:delivered,delivered:delivered?2:0});
    }}),
  }};
  return {env,requests};
}

test("verified current room: exact revoked wave is scrubbed; other seats intact",async()=>{
  const db=fakeDb(),{env,requests}=fakeEnv();
  let membership=0,identity=0;
  const value=await refreshRevokedStoreGrantInLiveRoom(db,env,result(),{
    isPresent:async(_n,room,who)=>{
      membership++;assert.equal(room,roomId);assert.equal(who,uid);
      return true;
    },
    refreshIdentity:async(_env,_db,room,who)=>{
      identity++;assert.equal(room,roomId);assert.equal(who,uid);
    },
  });
  assert.equal(value.status,"refreshed");
  assert.equal(value.seatCleared,true);
  assert.equal(identity,1);
  assert.equal(membership,1);
  assert.equal(db.writes.length,1);
  assert.deepEqual(db.writes[0].fields,["seats"]);
  const room=db.docs.get("rooms/"+roomId);
  assert.equal(room.keep,"must_remain");
  assert.equal(room.seats[0].uid,uid);
  assert.equal(room.seats[0].muted,false);
  assert.equal(room.seats[0].voiceWaveAssetKey,"");
  assert.equal(room.seats[0].voiceWaveImageUrl,"");
  assert.equal(room.seats[1].voiceWaveAssetKey,"store.item.299999.visual");
  assert.equal(requests.length,1);
  assert.equal(requests[0].name,roomId);
  assert.deepEqual(requests[0].body,{roomId,uid,category:"voiceWaves"});
});

test("other item and non-wave category never erase unrelated mic or wealth",async()=>{
  const db=fakeDb();
  assert.equal(await scrubRevokedStoreWaveSeat(db,roomId,uid,"200008"),true);
  assert.equal(db.writes.length,0);
  let identity=0;
  const {env}=fakeEnv();
  const output=await refreshRevokedStoreGrantInLiveRoom(db,env,result("frames"),{
    isPresent:async()=>true,
    refreshIdentity:async()=>{identity++},
  });
  assert.equal(output.status,"refreshed");
  assert.equal(db.writes.length,0);
  assert.equal(identity,1);
});

test("stale room index never authorizes an arbitrary DO room mutation",async()=>{
  const db=fakeDb();const {env,requests}=fakeEnv();
  let identity=0;
  const output=await refreshRevokedStoreGrantInLiveRoom(db,env,result(),{
    isPresent:async()=>false,
    refreshIdentity:async()=>{identity++},
  });
  assert.equal(output.status,"not_in_room");
  assert.equal(identity,0);
  assert.equal(requests.length,0);
  assert.equal(db.writes.length,0);
  assert.deepEqual(db.reads,["user_room_index/"+uid]);
  const noIndex=fakeDb({index:false});
  const miss=await refreshRevokedStoreGrantInLiveRoom(noIndex,env,result());
  assert.equal(miss.status,"not_in_room");
  assert.equal(noIndex.reads.length,1);
});
test("unavailable room membership must fail closed, not treat stale index as presence",async()=>{
  const db=fakeDb(),{env,requests}=fakeEnv();
  const output=await refreshRevokedStoreGrantInLiveRoom(db,env,result(),{
    isPresent:async()=>null,
  });
  assert.equal(output.status,"unavailable");
  assert.equal(requests.length,0);
  assert.equal(db.writes.length,0);
});
test("DO notification or identity failure is reported as pending, not fake success",async()=>{
  const db=fakeDb({seats:[]}),{env}=fakeEnv({delivered:false});
  const output=await refreshRevokedStoreGrantInLiveRoom(db,env,
    result("backgrounds"),{
      isPresent:async()=>true,
      refreshIdentity:async()=>{throw Error("unavailable")},
    });
  assert.equal(output.status,"pending_refresh");
  assert.equal(output.notified,false);
  assert.equal(output.identityRefreshed,false);
});
test("invalid targets/categories and oversized seats fail closed without writes",async()=>{
  const db=fakeDb(),{env}=fakeEnv();
  assert.equal((await refreshRevokedStoreGrantInLiveRoom(db,env,{
    ...result(),targetUid:"../unsafe",
  })).status,"invalid");
  assert.equal((await refreshRevokedStoreGrantInLiveRoom(db,env,{
    ...result(),category:"wallet",
  })).status,"invalid");
  const oversized=fakeDb({seats:Array.from({length:51},()=>
    seat(uid,"store.item.200007.visual"))});
  assert.equal(await scrubRevokedStoreWaveSeat(oversized,roomId,uid,productId),false);
  assert.equal(oversized.writes.length,0);
});
test("source guards enforce live revocation after commit and privacy-safe room event",()=>{
  const handler=readFileSync(new URL(
    "../../cloudflare-worker/src/manage-store-grant-revoke.js",import.meta.url),"utf8");
  const doSource=readFileSync(new URL(
    "../../cloudflare-worker/src/room-realtime-object.js",import.meta.url),"utf8");
  const controller=readFileSync(new URL(
    "../../lib/features/voice/services/voice_room_session_controller.dart",import.meta.url),"utf8");
  const live=readFileSync(new URL(
    "../../cloudflare-worker/src/store-grant-revoke-live.js",import.meta.url),"utf8");
  const ownerUi=readFileSync(new URL(
    "../../lib/admin/store_grant_revoke_action.dart",import.meta.url),"utf8");
  assert.ok(handler.indexOf("commitStoreGrantRevokeOffline(") <
    handler.indexOf("refreshRevokedStoreGrantInLiveRoom("));
  assert.match(handler,/\.catch\(\(\)=>\(\{status:"pending_refresh"\}\)\)/);
  assert.match(doSource,/\/presence\/store-invalidated/);
  assert.match(doSource,/attachment\.ghostMode===true/);
  assert.match(doSource,/attachment\.mysteriousMode===true/);
  assert.match(doSource,/room\.store_cosmetics_invalidated/);
  assert.match(controller,/event\.type == 'room\.store_cosmetics_invalidated'/);
  assert.match(controller,/_storeCosmeticsRevision\+\+/);
  assert.match(controller,/_seatService\.refreshStoreCosmetics\(id\)/);
  assert.match(live,/user_room_index\//);
  assert.match(live,/realtimeUserPresentFromNamespace/);
  assert.match(ownerUi,/liveStatus == 'pending_refresh'/);
  assert.match(ownerUi,/تحديث مؤثراتها داخل الغرفة لم يتأكد بعد/);
  assert.doesNotMatch(live,/db\.list\(|db\.runQuery\(|setInterval\(/);
});
