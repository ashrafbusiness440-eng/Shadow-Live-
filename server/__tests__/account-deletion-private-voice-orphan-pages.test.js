import assert from "node:assert/strict";
import test from "node:test";
import {readFileSync} from "node:fs";
import {
  inspectPrivateVoiceOrphanPage as inspect,
  MAX_PRIVATE_VOICE_ORPHAN_PAGE,
} from "../../cloudflare-worker/src/account-deletion-private-voice-orphan-pages.js";

const uid="deleted_voice_member",peer="other_voice_member";
const requestId="voice_orphan_request_1234";
const conversationId="voice_chat_123";
const actor={owner:true,uid:"verified_owner_123"};
const prefix=`private-voice/${conversationId}/${uid}/`;
const objectId=i=>i.toString(16).padStart(32,"0");
const key=i=>prefix+objectId(i)+".wav";
const rp="account_deletion_requests/"+uid;
const cp="account_deletion_erasure_checkpoints/"+uid;
const up="users/"+uid;
const chat="conversations/"+conversationId;
class Db {
  constructor(){
    this.docs=new Map([
      [rp,{uid,requestId,status:"review_ready"}],
      [cp,{uid,requestId,phase:"preflight_blocked",destructiveAllowed:false}],
      [up,{role:"user",coins:123}],
      [chat,{participants:[uid,peer],lastMessage:"private"}],
    ]);
    this.reads=[];this.writes=0;
  }
  async get(path){this.reads.push(path);
    return {exists:this.docs.has(path),data:this.docs.get(path)||null};}
  meta(i,otherOverrides={}){
    this.docs.set("private_voice_objects/"+objectId(i),{
      objectId:objectId(i),ownerUid:uid,otherUid:peer,
      conversationId,storageKey:key(i),state:"sent",...otherOverrides,
    });
  }
}
class R2 {
  constructor(keys){this.keys=keys;this.calls=[];this.deleteCalls=0;}
  async list(opts){
    this.calls.push(opts);
    let start=0;
    if(opts.cursor){start=Number(opts.cursor.slice(1));}
    const chunk=this.keys.slice(start,start+opts.limit);
    const next=start+chunk.length;
    return {objects:chunk.map(key=>({key})),
      truncated:next<this.keys.length,
      ...(next<this.keys.length?{cursor:"c"+next}:{}),
    };
  }
  async delete(){this.deleteCalls++;throw Error("forbidden");}
  async get(){this.deleteCalls++;throw Error("forbidden");}
}
const opts={uid,requestId,conversationId,actor};
test("strict prefix-only 5/3 page detects orphaned R2 files",async()=>{
  const db=new Db(),r2=new R2(Array.from({length:8},(_,i)=>key(i+1)));
  for(let i=1;i<=7;i++)db.meta(i);
  const first=await inspect(db,r2,opts);
  const second=await inspect(db,r2,{...opts,cursor:first.nextCursor});
  assert.equal(first.checked,5);
  assert.equal(second.checked,3);
  assert.equal(first.hasMore,true);
  assert.equal(second.hasMore,false);
  assert.equal(second.nextCursor,null);
  assert.equal(second.items[2].metadataPresent,false);
  assert.equal(second.items[2].needsReview,true);
  assert.equal(first.items.every(item=>!item.needsReview),true);
  assert.deepEqual(r2.calls.map(x=>({prefix:x.prefix,limit:x.limit})),
    [{prefix,limit:5},{prefix,limit:5}]);
  assert.equal(r2.deleteCalls,0);
  assert.equal(db.writes,0);
  assert.equal(db.docs.get(up).coins,123);
  assert.equal(JSON.stringify(second).includes("private-voice/"),false);
  assert.equal(second.erasureAllowed,false);
  assert.equal(second.completionVerified,false);
});
test("held metadata is reported for review, other owner fails closed",async()=>{
  const db=new Db(),r2=new R2([key(1),key(2)]);
  db.meta(1,{legalHold:true});
  db.meta(2,{ownerUid:peer});
  await assert.rejects(inspect(db,r2,opts),
    e=>e.code==="private_voice_orphan_metadata_owner_conflict");
  db.docs.get("private_voice_objects/"+objectId(2)).ownerUid=uid;
  const result=await inspect(db,r2,opts);
  assert.equal(result.items[0].needsReview,true);
  assert.equal(result.items[1].needsReview,false);
});
test("R2 list wrong-prefix, malformed ID, duplicates and errors fail closed",async()=>{
  const cases=[
    ["private-voice/another_chat/"+uid+"/"+objectId(1)+".wav",
      "private_voice_orphan_scope_violation"],
    [prefix+"../unsafe.wav","private_voice_orphan_legacy_object_review"],
  ];
  for(const [bad,code] of cases){
    const db=new Db(),r2=new R2([bad]);
    await assert.rejects(inspect(db,r2,opts),e=>e.code===code);
  }
  const db=new Db(),dup=new R2([key(1),key(1)]);
  await assert.rejects(inspect(db,dup,opts),
    e=>e.code==="private_voice_orphan_legacy_object_review");
  const err=new R2([]);err.list=async()=>{throw Error("PRIVATE R2 PATH");};
  await assert.rejects(inspect(db,err,opts),e=>
    e.code==="r2_listing_unavailable" &&
    !e.message.includes("PRIVATE"));
  const invalid=new R2([]);invalid.list=async()=>({
    objects:[{key:key(1)}],truncated:true,
  });
  await assert.rejects(inspect(db,invalid,opts),
    e=>e.code==="private_voice_orphan_invalid_listing");
});
test("unauthorized request, holds and invalid chat block before R2 access",async()=>{
  const modifications=[
    d=>d.docs.get(rp).status="cancelled",
    d=>d.docs.get(cp).requestId="other_request_123456",
    d=>d.docs.get(up).role="owner",
    d=>d.docs.get(up).legalHold=true,
    d=>d.docs.get(chat).evidenceHold=true,
    d=>d.docs.get(chat).participants=[uid,uid],
  ];
  for(const edit of modifications){
    const db=new Db(),r2=new R2([key(1)]);edit(db);
    await assert.rejects(inspect(db,r2,opts),e=>e.status===409);
    assert.equal(r2.calls.length,0);
  }
  for(const patch of [
    {uid:"../../bad"},{requestId:"bad"},
    {conversationId:"../../bad"},{cursor:"bad cursor"},
    {limit:0},{limit:MAX_PRIVATE_VOICE_ORPHAN_PAGE+1},
    {actor:{owner:false,uid:"not_owner"}},
  ]){
    const db=new Db(),r2=new R2([key(1)]);
    db.get=async()=>{throw Error("unexpected IO");};
    await assert.rejects(inspect(db,r2,{...opts,...patch}),
      e=>e.status===400||e.status===403);
    assert.equal(r2.calls.length,0);
  }
});
test("source restricts R2 access to single scoped list without writes",()=>{
  const s=readFileSync(
    "cloudflare-worker/src/account-deletion-private-voice-orphan-pages.js",
    "utf8");
  assert.match(s,/prefix, limit/);
  assert.doesNotMatch(s,/bucket\.get\(|bucket\.delete\(|bucket\.head\(|db\.commit\(|writeDelete\(|deleteAuthUser\(|setInterval\(/);
  assert.match(s,/erasureAllowed: false/);
});
