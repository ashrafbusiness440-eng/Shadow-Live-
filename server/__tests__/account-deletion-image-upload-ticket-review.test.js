import assert from "node:assert/strict";
import test from "node:test";
import {readFileSync} from "node:fs";
import {inspectAccountImageUploadTicketPage as inspect,
 MAX_IMAGE_UPLOAD_TICKET_REVIEW_PAGE as MAX} from
 "../../cloudflare-worker/src/account-deletion-image-upload-ticket-review.js";
const uid="image_ticket_owner_123",peer="image_ticket_peer_123";
const requestId="pending_image_tickets_123";
const actor={owner:true,uid:"control_owner_123"};
const opts={uid,requestId,actor,nowMs:1790000000000};
const id=i=>i.toString(16).padStart(32,"0");
const rp="account_deletion_requests/"+uid;
const cp="account_deletion_erasure_checkpoints/"+uid;
const up="users/"+uid;
const key=(i,folder="profile")=>"users/"+uid+"/"+folder+"/"+id(i)+".jpg";
class Db {
  constructor(){
    this.docs=new Map([
      [rp,{uid,requestId,status:"review_ready"}],
      [cp,{uid,requestId,destructiveAllowed:false,phase:"preflight_blocked"}],
      [up,{role:"user",coins:500}],
      ["users/"+peer,{role:"user",coins:1000}],
    ]);
    this.reads=[];this.queries=[];this.writes=0;
  }
  ticket(i,patch={}){
    this.docs.set("storage_upload_tickets/"+id(i),{
      ownerUid:uid,objectId:id(i),scope:"profile_image",
      targetId:uid,storageKey:key(i),publicStorageKey:key(i),
      bucket:"shadow-live-storage",mimeType:"image/jpeg",
      expectedSizeBytes:900,expiresAt:new Date(1700000000000),...patch,
    });
  }
  async get(path){
    this.reads.push(path);
    return {exists:this.docs.has(path),data:this.docs.get(path)||null};
  }
  async runQuery(collection,q){
    this.queries.push({collection,q});
    const ids=[...this.docs.keys()].filter(p=>p.startsWith(collection+"/"))
      .map(p=>p.slice(collection.length+1))
      .filter(x=>this.docs.get(collection+"/"+x)?.ownerUid===q.filters[0].value)
      .sort();
    const last=q.startAfter[0]?.referencePath?.split("/").pop();
    return ids.filter(x=>!last||x>last).slice(0,q.limit)
      .map(id=>({id,data:this.docs.get(collection+"/"+id)}));
  }
}
test("5/3 paged tickets remain unresolved even when expired",async()=>{
  const db=new Db();
  for(let i=1;i<=8;i++)db.ticket(i);
  const first=await inspect(db,opts);
  const second=await inspect(db,{...opts,cursor:first.nextCursor});
  assert.equal(first.checked,5);assert.equal(second.checked,3);
  assert.equal(first.hasMore,true);assert.equal(second.hasMore,false);
  assert.equal(first.items.every(x=>x.ticketExpired&&x.uploadFinalizationUnresolved),true);
  assert.equal(first.items.every(x=>x.ticketSchemaConsistent&&!x.metadataPresent),true);
  assert.equal(first.erasureAllowed,false);assert.equal(first.completionVerified,false);
  assert.equal(first.exhaustive,false);
  assert.equal(db.queries.length,2);
  assert.equal(db.queries[0].collection,"storage_upload_tickets");
  assert.equal(db.queries[0].q.limit,MAX+1);
  assert.equal(db.docs.get("users/"+peer).coins,1000);
  assert.equal(db.docs.get(up).coins,500);
  assert.equal(JSON.stringify(first).includes("users/"),false);
});
test("staging, active metadata, shared links and holds stay review-only",async()=>{
  const db=new Db();
  db.ticket(1,{storageKey:"moderation-staging/"+key(1)});
  db.ticket(2,{scope:"chat_image",targetId:"conversation_123",
    storageKey:"chat/conversation_123/"+uid+"/"+id(2)+".jpg",
    publicStorageKey:"chat/conversation_123/"+uid+"/"+id(2)+".jpg"});
  db.docs.set("conversations/conversation_123",{participants:[uid,peer]});
  db.docs.set("storage_objects/"+id(1),{ownerUid:uid,objectId:id(1),
    targetId:uid,scope:"profile_image",mimeType:"image/jpeg",
    bucket:"shadow-live-storage"});
  const out=await inspect(db,opts);
  assert.equal(out.items[0].ticketSchemaConsistent,true);
  assert.equal(out.items[0].metadataPresent,true);
  assert.equal(out.items[1].sharedAssetReview,true);
  assert.equal(out.items[1].sharedReferenceConsistent,true);
  assert.equal(out.items.every(x=>x.needsReview),true);
  assert.equal(out.items.every(x=>x.uploadFinalizationUnresolved),true);
  db.docs.get("conversations/conversation_123").appealPending=true;
  const held=await inspect(db,opts);
  assert.equal(held.items[1].legalOrAppealHold,true);
  assert.equal(held.erasureAllowed,false);
});
test("foreign metadata hard-stops; mismatched schemas never certify",async()=>{
  const db=new Db();db.ticket(1);
  db.docs.set("storage_objects/"+id(1),{ownerUid:peer,objectId:id(1)});
  await assert.rejects(inspect(db,opts),e=>e.code==="image_upload_ticket_owner_conflict");
  db.docs.get("storage_objects/"+id(1)).ownerUid=uid;
  db.docs.get("storage_upload_tickets/"+id(1)).storageKey="../bad";
  const result=await inspect(db,opts);
  assert.equal(result.items[0].ticketSchemaConsistent,false);
  assert.equal(result.items[0].needsReview,true);
});
test("request, checkpoint and legal holds gate BEFORE any enumeration",async()=>{
  for(const patch of [
    d=>d.docs.get(rp).status="cancelled",
    d=>d.docs.get(cp).requestId="stale_request_123",
    d=>d.docs.get(up).appealPending=true,
    d=>d.docs.get(rp).legalHold=true,
    d=>d.docs.get(up).authDeleted=true,
  ]){
    const db=new Db();patch(db);
    await assert.rejects(inspect(db,opts),
      e=>e.code==="image_upload_ticket_review_blocked");
    assert.equal(db.queries.length,0);
  }
  for(const patch of [
    {uid:"../wrong"},{requestId:"bad"},{cursor:"bad id"},
    {limit:MAX+1},{limit:0},{nowMs:-1},
    {actor:{owner:false,uid:"user_123"}},
  ]){
    const db=new Db();
    db.get=async()=>{throw Error("unexpected read");};
    await assert.rejects(inspect(db,{...opts,...patch}),
      e=>e.status===400||e.status===403);
  }
});
test("untrusted query rows and document ownership mismatch fail closed",async()=>{
  const db=new Db();db.ticket(1);
  db.runQuery=async()=>[{id:id(1),data:{ownerUid:peer,objectId:id(1)}}];
  await assert.rejects(inspect(db,opts),
    e=>e.code==="image_upload_ticket_owner_conflict");
  db.runQuery=async()=>Array(7).fill({id:id(1),data:{}});
  await assert.rejects(inspect(db,opts),
    e=>e.code==="image_upload_ticket_invalid_page");
});
test("source cannot perform R2 / Firebase writes / certifying erasure",()=>{
  const src=readFileSync(
    "cloudflare-worker/src/account-deletion-image-upload-ticket-review.js","utf8");
  assert.doesNotMatch(src,
    /bucket\.|\.delete\(|\.head\(|\.list\(|db\.commit\(|writeDelete\(|deleteAuthUser\(|setInterval\(/);
  assert.match(src,/erasureAllowed:false/);
  assert.match(src,/completionVerified:false/);
});
