import assert from "node:assert/strict";
import test from "node:test";
import {readFileSync} from "node:fs";
import {inspectPersonalImageR2OrphanPage as inspect,
 MAX_PERSONAL_IMAGE_R2_ORPHAN_PAGE as MAX} from
 "../../cloudflare-worker/src/account-deletion-personal-image-r2-orphan-pages.js";

const uid="delete_image_owner_123",peer="foreign_image_owner_123";
const requestId="image_orphans_request_123";
const actor={owner:true,uid:"shadow_control_owner_123"};
const opts={uid,requestId,folder:"profile",actor};
const rp="account_deletion_requests/"+uid;
const cp="account_deletion_erasure_checkpoints/"+uid;
const up="users/"+uid;
const id=i=>i.toString(16).padStart(32,"0");
const key=(i,folder="profile",ext="jpg")=>
 "users/"+uid+"/"+folder+"/"+id(i)+"."+ext;
class Db{
 constructor(){
  this.docs=new Map([
   [rp,{uid,requestId,status:"review_ready"}],
   [cp,{uid,requestId,phase:"preflight_blocked",destructiveAllowed:false}],
   [up,{role:"user",coins:999}],
  ]);
  this.reads=[];this.writes=0;
 }
 metadata(i,folder="profile",patch={}){
  const scope=folder==="profile"?"profile_image":
    folder==="profile-animation"?"profile_avatar_animation":
    folder==="covers"?"profile_cover":"diary_image";
  const ext=folder==="profile-animation"?"gif":"jpg";
  this.docs.set("storage_objects/"+id(i),{
   objectId:id(i),ownerUid:uid,scope,targetId:uid,
   storageKey:key(i,folder,ext),bucket:"shadow-live-storage",
   mimeType:ext==="gif"?"image/gif":"image/jpeg",
   sizeBytes:1234,state:"active",...patch,
  });
  if(folder==="diaries")this.docs.set("diary_image_links/"+id(i),
   {ownerUid:uid,diaryId:"diary_123",state:"linked"});
 }
 async get(path){this.reads.push(path);
  return {exists:this.docs.has(path),data:this.docs.get(path)??null};}
}
class R2 {
 constructor(keys){this.keys=keys;this.calls=[];this.writes=0;}
 async list(x){
  this.calls.push(x);
  const start=x.cursor?Number(x.cursor.slice(1)):0;
  const slice=this.keys.slice(start,start+x.limit);
  const next=start+slice.length;
  return {objects:slice.map(key=>({key})),truncated:next<this.keys.length,
    ...(next<this.keys.length?{cursor:"c"+next}:{})};
 }
 async get(){this.writes++;throw Error("forbidden_get");}
 async head(){this.writes++;throw Error("forbidden_head");}
 async delete(){this.writes++;throw Error("forbidden_delete");}
}
test("5/3 owner-only pages detect potential orphan without any deletion",async()=>{
 const db=new Db(),r2=new R2(Array.from({length:8},(_,i)=>key(i+1)));
 for(let i=1;i<=7;i++)db.metadata(i);
 const first=await inspect(db,r2,opts);
 const second=await inspect(db,r2,{...opts,cursor:first.nextCursor});
 assert.equal(first.checked,5);
 assert.equal(second.checked,3);
 assert.equal(first.hasMore,true);
 assert.equal(second.hasMore,false);
 assert.equal(second.nextCursor,null);
 assert.deepEqual(r2.calls.map(x=>({prefix:x.prefix,limit:x.limit})),[
  {prefix:"users/"+uid+"/profile/",limit:5},
  {prefix:"users/"+uid+"/profile/",limit:5}]);
 assert.equal(second.items[2].possibleOrphan,true);
 assert.equal(second.items[2].metadataPresent,false);
 assert.equal(second.items[2].uploadTicketPresent,false);
 assert.equal(first.items.every(x=>x.referenceConsistent),true);
 assert.equal(first.items.every(x=>x.needsReview),true);
 assert.equal(first.erasureAllowed,false);
 assert.equal(first.completionVerified,false);
 assert.equal(first.exhaustive,false);
 assert.equal(JSON.stringify(second).includes("users/"),false);
 assert.equal(r2.writes,0);
 assert.equal(db.docs.get(up).coins,999);
});
test("ticket or pointer conflict never certifies an orphan",async()=>{
 const db=new Db(),r2=new R2([key(1),key(2)]);
 db.docs.set("storage_upload_tickets/"+id(1),{
  objectId:id(1),ownerUid:uid,storageKey:key(1)});
 db.metadata(2);
 db.docs.set("storage_active_objects/profile_image__"+uid,{
  objectId:id(1),ownerUid:uid,targetId:uid,scope:"profile_image"});
 const out=await inspect(db,r2,opts);
 assert.equal(out.items[0].uploadTicketPresent,true);
 assert.equal(out.items[0].possibleOrphan,false);
 assert.equal(out.items[1].referenceConsistent,false);
 assert.equal(out.items[1].needsReview,true);
});
test("four personal folders only; gif animation and diary reference checks",async()=>{
 const variants=[
  ["profile","jpg",false],
  ["profile-animation","gif",true],
  ["covers","jpg",false],
  ["diaries","jpg",false],
 ];
 for(const [folder,extension] of variants){
  const db=new Db(),r2=new R2([key(1,folder,extension)]);
  db.metadata(1,folder);
  const out=await inspect(db,r2,{...opts,folder});
  assert.equal(out.checked,1);
  assert.equal(out.items[0].recognizedFormat,true);
  assert.equal(out.items[0].referenceConsistent,true);
  assert.equal(r2.calls[0].prefix,"users/"+uid+"/"+folder+"/");
  assert.equal(out.erasureAllowed,false);
 }
});
test("legacy filenames are flagged without arbitrary Firestore access",async()=>{
 const db=new Db(),r2=new R2([
  "users/"+uid+"/profile/old-name.jpg",
  "users/"+uid+"/profile/subdir/"+id(1)+".jpg",
 ]);
 const out=await inspect(db,r2,opts);
 assert.equal(out.checked,2);
 assert.equal(out.items.every(x=>!x.recognizedFormat&&x.objectId===null),true);
 assert.equal(out.items.every(x=>x.needsReview),true);
 assert.equal(db.reads.some(x=>x.startsWith("storage_objects/")),false);
 assert.equal(JSON.stringify(out).includes("old-name"),false);
});
test("foreign metadata/ticket and R2 cross-account path stop safely",async()=>{
 for(const change of [
  db=>{db.metadata(1,"profile",{ownerUid:peer});},
  db=>{db.docs.set("storage_upload_tickets/"+id(1),
   {objectId:id(1),ownerUid:peer});},
 ]){
  const db=new Db(),r2=new R2([key(1)]);
  change(db);
  await assert.rejects(inspect(db,r2,opts),
   e=>e.code==="personal_image_orphan_owner_conflict");
  assert.equal(r2.writes,0);
 }
 const r2=new R2(["users/"+peer+"/profile/"+id(1)+".jpg"]);
 await assert.rejects(inspect(new Db(),r2,opts),
  e=>e.code==="personal_image_orphan_prefix_violation");
});
test("holds and bad owner hints stop before any R2 call",async()=>{
 for(const change of [
  d=>d.docs.get(rp).status="cancelled",
  d=>d.docs.get(cp).requestId="another_request_123",
  d=>d.docs.get(up).appealPending=true,
  d=>d.docs.get(rp).investigationHold=true,
  d=>d.docs.get(cp).evidenceHold=true,
  d=>d.docs.get(up).role="owner",
 ]){
  const db=new Db(),r2=new R2([key(1)]);change(db);
  await assert.rejects(inspect(db,r2,opts),
   e=>e.code==="personal_image_orphan_review_blocked");
  assert.equal(r2.calls.length,0);
 }
 for(const patch of [
  {uid:"../bad"},{requestId:"bad"},{folder:"../room"},
  {folder:"chat"},{folder:"profile/"},{cursor:"bad cursor"},
  {limit:0},{limit:MAX+1},{actor:{owner:false,uid:"user_123"}},
 ]){
  const db=new Db(),r2=new R2([key(1)]);
  db.get=async()=>{throw Error("unwanted_DB_read");};
  await assert.rejects(inspect(db,r2,{...opts,...patch}),
    e=>e.status===400||e.status===403);
  assert.equal(r2.calls.length,0);
 }
});
test("duplicate names, invalid truncation and provider errors fail closed",async()=>{
 const db=new Db();
 await assert.rejects(inspect(db,new R2([key(1),key(1)]),opts),
  e=>e.code==="personal_image_orphan_duplicate_object");
 const sameIdTwoExtensions=new R2([key(1),key(1,"profile","png")]);
 await assert.rejects(inspect(db,sameIdTwoExtensions,opts),
  e=>e.code==="personal_image_orphan_duplicate_id");
 const missingCursor=new R2([key(1)]);
 missingCursor.list=async()=>({objects:[{key:key(1)}],truncated:true});
 await assert.rejects(inspect(db,missingCursor,opts),
  e=>e.code==="personal_image_orphan_invalid_listing");
 const unavailable=new R2([]);
 unavailable.list=async()=>{throw Error("SENSITIVE users/"+uid);};
 await assert.rejects(inspect(db,unavailable,opts),
  e=>e.code==="r2_listing_unavailable"&&!e.message.includes(uid));
});
test("source forbids head/get/delete/queries, mutation and erasure signoff",()=>{
 const src=readFileSync(
  "cloudflare-worker/src/account-deletion-personal-image-r2-orphan-pages.js",
  "utf8");
 assert.match(src,/bucket.list\(/);
 assert.doesNotMatch(src,
  /bucket\.head\(|bucket\.get\(|bucket\.delete\(|db\.runQuery\(|db\.commit\(|writeDelete\(|deleteAuthUser\(|setInterval\(/);
 assert.match(src,/completionVerified:false/);
 assert.match(src,/erasureAllowed:false/);
});
