import assert from "node:assert/strict";
import test from "node:test";
import {readFileSync} from "node:fs";
import {
 inspectAccountImageStoragePage as inspect,
 MAX_IMAGE_STORAGE_INVENTORY_PAGE,
} from "../../cloudflare-worker/src/account-deletion-image-storage-inventory.js";

const uid="delete_image_user",other="other_image_user";
const requestId="image_delete_request_1234";
const actor={owner:true,uid:"control_owner_123"};
const req="account_deletion_requests/"+uid;
const cp="account_deletion_erasure_checkpoints/"+uid;
const user="users/"+uid;
const chat="conversations/chat_image_123";
const agency="agencies/agency_image_123";
const room="rooms/room_image_123";
const obj=i=>i.toString(16).padStart(32,"0");
const key=(id,scope="profile_image",target=uid)=>{
 const name=id+".jpg";
 if(scope==="profile_image")return "users/"+uid+"/profile/"+name;
 if(scope==="diary_image")return "users/"+uid+"/diaries/"+name;
 if(scope==="room_cover")return "rooms/"+target+"/covers/"+name;
 if(scope==="agency_logo")return "agencies/"+target+"/logo/"+name;
 if(scope==="chat_image")return "chat/"+target+"/"+uid+"/"+name;
 return "invalid";
};
class Db{
 constructor(){
  this.docs=new Map([
   [req,{uid,requestId,status:"review_ready"}],
   [cp,{uid,requestId,phase:"preflight_blocked",destructiveAllowed:false}],
   [user,{role:"user",coins:900}],
   [chat,{participants:[uid,other],lastMessage:"private"}],
   [agency,{ownerUid:uid,hostCount:4}],
   [room,{ownerUid:uid,ownerId:uid,participantCount:12}],
  ]);
  this.queries=[];this.writes=0;
 }
 add(i,scope="profile_image",target=uid,patch={}){
  this.docs.set("storage_objects/"+obj(i),{
   objectId:obj(i),ownerUid:uid,scope,targetId:target,
   mimeType:"image/jpeg",sizeBytes:4000,
   storageKey:key(obj(i),scope,target),state:"active",...patch,
  });
 }
 async get(path){return {exists:this.docs.has(path),data:this.docs.get(path)??null};}
 async runQuery(collection,opts){
  this.queries.push({collection,opts});
  const prefix=collection+"/";
  let rows=[...this.docs].filter(([p,d])=>
   p.startsWith(prefix)&&!p.slice(prefix.length).includes("/")&&
   d.ownerUid===opts.filters[0].value)
   .map(([p,data])=>({id:p.slice(prefix.length),data}))
   .sort((a,b)=>a.id.localeCompare(b.id));
  if(opts.startAfter.length){
   const from=opts.startAfter[0].referencePath.slice(prefix.length);
   rows=rows.filter(x=>x.id>from);
  }
  return rows.slice(0,opts.limit);
 }
}
const run=(db,patch={})=>inspect(db,{uid,requestId,actor,...patch});
test("eight image metadata docs paginate 5/3 without keys or financial data",async()=>{
 const db=new Db();
 for(let i=1;i<=8;i++)db.add(i);
 const one=await run(db);
 const two=await run(db,{cursor:one.nextCursor});
 assert.deepEqual([one.checked,two.checked],[5,3]);
 assert.equal(two.nextCursor,null);
 assert.deepEqual(db.queries.map(x=>x.opts.limit),[6,6]);
 assert.equal(one.items.every(x=>x.schemaConsistent),true);
 assert.equal(one.items.every(x=>x.needsReview),true);
 assert.equal(one.exhaustive,false);
 assert.equal(one.erasureAllowed,false);
 assert.equal(JSON.stringify(one).includes("users/"),false);
 assert.equal(JSON.stringify(one).includes("900"),false);
 assert.equal(db.writes,0);
 assert.equal(db.docs.get(user).coins,900);
});
test("profile/diary/chat/room/agency links are reviewed without touching others",async()=>{
 const db=new Db();
 db.add(1);
 db.add(2,"diary_image");
 db.docs.set("diary_image_links/"+obj(2),{
  ownerUid:uid,diaryId:"diary_123456",state:"linked",
 });
 db.add(3,"chat_image","chat_image_123");
 db.add(4,"room_cover","room_image_123");
 db.add(5,"agency_logo","agency_image_123");
 const result=await run(db);
 assert.equal(result.items.every(x=>x.schemaConsistent),true);
 assert.deepEqual(result.items.map(x=>x.sharedAssetReview),
  [false,false,true,true,true]);
 assert.equal(result.items[1].linkedReferencePresent,true);
 assert.equal(db.docs.get(chat).lastMessage,"private");
 assert.equal(db.docs.get(agency).hostCount,4);
 assert.equal(db.docs.get(room).participantCount,12);
});
test("moderation staging/holds, wrong paths and foreign assets remain review only",async()=>{
 const db=new Db();
 db.add(1,"profile_image",uid,{storageKey:"someone/private.jpg"});
 db.add(2,"diary_image",uid,{state:"appeal_pending",
  storageKey:"moderation-staging/"+key(obj(2),"diary_image"),
  publicStorageKey:key(obj(2),"diary_image"),evidenceHold:true});
 db.add(3,"chat_image","chat_image_123");
 db.docs.get(chat).participants=[other,"third_participant_123"];
 db.add(4,"room_cover","room_image_123");
 db.docs.get(room).ownerUid=other;
 db.add(5,"agency_logo","agency_image_123");
 db.docs.get(agency).legalHold=true;
 const result=await run(db);
 assert.deepEqual(result.items.map(x=>x.schemaConsistent),
  [false,false,false,false,true]);
 assert.equal(result.items[1].moderationOrLegalHold,true);
 assert.equal(result.items[4].moderationOrLegalHold,true);
 assert.equal(result.items.every(x=>x.needsReview),true);
});
test("wrong-owner indexed document fails closed without resource mutation",async()=>{
 const db=new Db();db.add(1);
 db.runQuery=async()=>[{
  id:obj(1),data:{...db.docs.get("storage_objects/"+obj(1)),ownerUid:other},
 }];
 await assert.rejects(run(db),e=>e.code==="image_inventory_owner_conflict");
 assert.equal(db.writes,0);
});
test("cancelled or held deletions and invalid cursor block before query",async()=>{
 for(const edit of [
  d=>d.docs.get(req).status="cancelled",
  d=>d.docs.get(req).requestId="other_request_12345",
  d=>d.docs.get(cp).requestId="other_request_12345",
  d=>d.docs.get(cp).investigationHold=true,
  d=>d.docs.get(user).role="owner",
  d=>d.docs.get(user).authDeleted=true,
  d=>d.docs.get(user).reported=true,
 ]){
  const db=new Db();edit(db);
  await assert.rejects(run(db),e=>e.code==="image_inventory_review_blocked");
  assert.equal(db.queries.length,0);
 }
 for(const patch of [
  {uid:"../bad"},{requestId:"bad"},{cursor:"not_uuid"},
  {limit:0},{limit:MAX_IMAGE_STORAGE_INVENTORY_PAGE+1},
  {actor:{owner:false,uid:"ordinary_actor"}},
 ]){
  const db=new Db();db.get=async()=>{throw Error("unwanted IO");};
  await assert.rejects(run(db,patch),e=>e.status===400||e.status===403);
  assert.equal(db.queries.length,0);
 }
});
test("strictly read-only: no Auth, R2 operation, mutation or timer",()=>{
 const code=readFileSync(
  "cloudflare-worker/src/account-deletion-image-storage-inventory.js","utf8");
 assert.doesNotMatch(code,/db\.commit\(|writeDelete\(|writeUpdate\(|bucket\.delete\(|bucket\.get\(|deleteAuthUser\(|setInterval\(/);
 assert.match(code,/completionVerified:false/);
 assert.match(code,/MAX_IMAGE_STORAGE_INVENTORY_PAGE=5/);
});
