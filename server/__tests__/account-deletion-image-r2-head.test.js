import assert from "node:assert/strict";
import test from "node:test";
import {readFileSync} from "node:fs";
import {inspectAccountImageR2Object as inspect}
 from "../../cloudflare-worker/src/account-deletion-image-r2-head.js";

const uid="image_deletion_user_123",other="counterpart_user_123";
const requestId="image_r2_request_12345",id="a".repeat(32);
const actor={owner:true,uid:"shadow_owner_123"};
const rp="account_deletion_requests/"+uid;
const cp="account_deletion_erasure_checkpoints/"+uid;
const up="users/"+uid;
const op="storage_objects/"+id;
const name=id+".jpg";
const key="users/"+uid+"/profile/"+name;
const opts={uid,requestId,objectId:id,actor};
class Db {
 constructor(){
  this.docs=new Map([
   [rp,{uid,requestId,status:"review_ready"}],
   [cp,{uid,requestId,destructiveAllowed:false,phase:"preflight_blocked"}],
   [up,{role:"user",coins:1000}],
   [op,{objectId:id,ownerUid:uid,targetId:uid,scope:"profile_image",
     storageKey:key,publicStorageKey:key,bucket:"shadow-live-storage",
     sizeBytes:2456,mimeType:"image/jpeg",state:"active"}],
  ]);
  this.reads=[];this.writes=0;
 }
 async get(path){this.reads.push(path);
  return {exists:this.docs.has(path),data:this.docs.get(path)??null};}
}
class R2 {
 constructor(response={size:2456,httpMetadata:{contentType:"image/jpeg"}}){
  this.response=response;this.calls=[];this.mutations=0;
 }
 async head(k){this.calls.push(k);return this.response;}
 async list(){this.mutations++;throw Error("unexpected_list");}
 async get(){this.mutations++;throw Error("unexpected_get");}
 async delete(){this.mutations++;throw Error("unexpected_delete");}
}
test("one canonical profile HEAD, private result and no destructive operations",async()=>{
 const db=new Db(),bucket=new R2();
 db.docs.set("storage_active_objects/profile_image__"+uid,{
  objectId:id,ownerUid:uid,targetId:uid,scope:"profile_image"});
 const r=await inspect(db,bucket,opts);
 assert.deepEqual(bucket.calls,[key]);
 assert.equal(r.storagePresent,true);
 assert.equal(r.sizeMatches,true);
 assert.equal(r.mimeMatches,true);
 assert.equal(r.activePointerPresent,true);
 assert.equal(r.needsReview,true);
 assert.equal(r.erasureAllowed,false);
 assert.equal(r.completionVerified,false);
 assert.equal(r.exhaustive,false);
 assert.equal(bucket.mutations,0);
 assert.equal(db.docs.get(up).coins,1000);
 assert.equal(JSON.stringify(r).includes(key),false);
 assert.equal(JSON.stringify(r).includes(other),false);
});
test("missing, different-size and different-MIME images only flag review",async()=>{
 for(const value of [null,{size:123,httpMetadata:{contentType:"image/jpeg"}},
   {size:2456,httpMetadata:{contentType:"image/png"}},{size:2456}]){
  const db=new Db(),bucket=new R2(value),r=await inspect(db,bucket,opts);
  assert.equal(r.needsReview,true);
  assert.equal(r.erasureAllowed,false);
  assert.equal(bucket.calls.length,1);
  assert.equal(!value?r.storagePresent===false:
    !r.sizeMatches||!r.mimeMatches,true);
 }
});
test("all supported owner scopes use exact canonical read-only paths",async()=>{
 const cases=[
  ["profile_cover",uid,"users/"+uid+"/covers/"+name],
  ["profile_avatar_animation",uid,"users/"+uid+"/profile-animation/"+id+".gif"],
  ["diary_image",uid,"users/"+uid+"/diaries/"+name],
  ["chat_image","chat_123","chat/chat_123/"+uid+"/"+name],
  ["room_cover","room_123","rooms/room_123/covers/"+name],
  ["agency_logo","agency_123","agencies/agency_123/logo/"+name],
  ["agency_background","agency_123","agencies/agency_123/background/"+name],
  ["agency_room_image","agency_123","agencies/agency_123/room-image/"+name],
 ];
 for(const [scope,target,storageKey] of cases){
  const db=new Db(),bucket=new R2(),meta=db.docs.get(op);
  Object.assign(meta,{scope,targetId:target,storageKey,publicStorageKey:storageKey});
  if(scope==="profile_avatar_animation"){meta.mimeType="image/gif";
   bucket.response.httpMetadata.contentType="image/gif";}
  if(scope==="diary_image")db.docs.set("diary_image_links/"+id,
   {ownerUid:uid,diaryId:"diary_123",state:"linked"});
  if(scope==="chat_image")db.docs.set("conversations/"+target,
   {participants:[uid,other],lastMessage:"do not touch"});
  if(scope==="room_cover")db.docs.set("rooms/"+target,
   {ownerUid:uid,activeUsers:8});
  if(scope.startsWith("agency_"))db.docs.set("agencies/"+target,
   {ownerUid:uid,hostCount:9});
  const r=await inspect(db,bucket,opts);
  assert.deepEqual(bucket.calls,[storageKey],scope);
  assert.equal(r.sharedAssetReview,["chat_image","room_cover"].includes(scope)||
    scope.startsWith("agency_"));
  assert.equal(r.erasureAllowed,false);
  assert.equal(bucket.mutations,0);
 }
});
test("evidence, legal, appeal, stale request and owner role fail BEFORE HEAD",async()=>{
 for(const mutate of [
  d=>d.docs.get(rp).status="cancelled",
  d=>d.docs.get(cp).requestId="different_request_12345",
  d=>d.docs.get(cp).appealPending=true,
  d=>d.docs.get(rp).evidenceHold=true,
  d=>d.docs.get(up).investigationHold=true,
  d=>d.docs.get(up).role="owner",
  d=>d.docs.get(op).legalHold=true,
  d=>d.docs.get(op).moderation={status:"appeal_pending"},
  d=>d.docs.get(op).state="pending_delete",
  d=>d.docs.get(op).storageKey="moderation-staging/"+key,
  d=>d.docs.get(op).storageKey="users/"+other+"/profile/"+name,
  d=>d.docs.get(op).bucket="unknown_bucket",
  d=>d.docs.get(op).ownerUid=other,
  d=>d.docs.set("storage_upload_tickets/"+id,{ownerUid:uid,storageKey:key}),
  d=>d.docs.set("storage_active_objects/profile_image__"+uid,
   {ownerUid:other,scope:"profile_image",targetId:uid,objectId:id}),
 ]){
  const db=new Db(),bucket=new R2();mutate(db);
  await assert.rejects(inspect(db,bucket,opts),e=>e.status===409);
  assert.equal(bucket.calls.length,0);
 }
});
test("foreign or protected room, agency, chat and diary references block HEAD",async()=>{
 for(const scope of ["room_cover","agency_logo","chat_image","diary_image"]){
  const db=new Db(),bucket=new R2(),meta=db.docs.get(op);
  const target=scope==="diary_image"?uid:"related_123";
  meta.scope=scope;meta.targetId=target;
  meta.storageKey=scope==="room_cover"?"rooms/"+target+"/covers/"+name:
   scope==="agency_logo"?"agencies/"+target+"/logo/"+name:
   scope==="chat_image"?"chat/"+target+"/"+uid+"/"+name:
   "users/"+uid+"/diaries/"+name;
  meta.publicStorageKey=meta.storageKey;
  const path=scope==="room_cover"?"rooms/"+target:
   scope==="agency_logo"?"agencies/"+target:
   scope==="chat_image"?"conversations/"+target:
   "diary_image_links/"+id;
  db.docs.set(path,scope==="chat_image"?
   {participants:[other,"third_person_123"]}:
   scope==="diary_image"?{ownerUid:other,diaryId:"diary_2",state:"linked"}:
   {ownerUid:other});
  await assert.rejects(inspect(db,bucket,opts),e=>e.status===409);
  assert.equal(bucket.calls.length,0);
  db.docs.get(path).legalHold=true;
  await assert.rejects(inspect(db,bucket,opts),e=>e.status===409);
  assert.equal(bucket.calls.length,0);
 }
});
test("R2 provider failure and malformed response do not leak paths",async()=>{
 const bad=new R2();
 bad.head=async()=>{throw Error("SECRET "+key);};
 await assert.rejects(inspect(new Db(),bad,opts),e=>
  e.code==="r2_head_unavailable"&&!e.message.includes(key));
 await assert.rejects(inspect(new Db(),new R2({size:"2456"}),opts),
  e=>e.code==="r2_head_invalid_response");
 await assert.rejects(inspect(new Db(),null,opts),
  e=>e.code==="r2_head_unavailable");
});
test("invalid authorization hints and identifiers never access Firestore",async()=>{
 for(const patch of [{uid:"../bad"},{requestId:"short"},
  {objectId:"bad"},{actor:{owner:false,uid:"ordinary_user_123"}}]){
  const db=new Db();db.get=async()=>{throw Error("unexpected_IO");};
  await assert.rejects(inspect(db,new R2(),{...opts,...patch}),
   e=>e.status===400||e.status===403);
 }
});
test("code does not enumerate, fetch, delete, mutate, certify or schedule",()=>{
 const code=readFileSync(
  "cloudflare-worker/src/account-deletion-image-r2-head.js","utf8");
 assert.match(code,/bucket.head\(canonical\)/);
 assert.doesNotMatch(code,
  /bucket\.list\(|bucket\.get\(|bucket\.delete\(|db\.runQuery\(|db\.commit\(|writeDelete\(|deleteAuthUser\(|setInterval\(/);
 assert.match(code,/completionVerified:false,erasureAllowed:false/);
});
