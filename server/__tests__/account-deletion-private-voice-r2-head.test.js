import assert from "node:assert/strict";
import test from "node:test";
import {readFileSync} from "node:fs";
import {inspectPrivateVoiceR2Object as inspect}
  from "../../cloudflare-worker/src/account-deletion-private-voice-r2-head.js";

const uid="deleted_voice_user",other="other_voice_user";
const requestId="voice_delete_request_1234";
const chatId="voice_conversation_1234";
const objectId="a".repeat(32),messageId="voice_"+objectId;
const key=`private-voice/${chatId}/${uid}/${objectId}.wav`;
const rp="account_deletion_requests/"+uid;
const cp="account_deletion_erasure_checkpoints/"+uid;
const up="users/"+uid;
const op="private_voice_objects/"+objectId;
const chat="conversations/"+chatId;
const msg=chat+"/messages/"+messageId;
const draft="private_voice_drafts/"+objectId;
const actor={owner:true,uid:"shadow_owner_999"};
const opts={uid,requestId,objectId,actor};
class Db{
  constructor(state="sent"){
    this.docs=new Map([
      [rp,{uid,requestId,status:"review_ready"}],
      [cp,{uid,requestId,phase:"preflight_blocked",destructiveAllowed:false}],
      [up,{role:"user",coins:99}],
      [op,{objectId,ownerUid:uid,otherUid:other,
        conversationId:chatId,storageKey:key,mimeType:"audio/wav",
        expectedSizeBytes:32044,durationSeconds:1,state,
        createdAt:new Date(),...(state==="sent"?{messageId,sentAt:new Date()}: {})}],
      [chat,{participants:[uid,other],lastMessage:"Sensitive preview"}],
    ]);
    if(state==="sent")this.docs.set(msg,{
      type:"voice_note",senderId:uid,receiverId:other,
      storageObjectId:objectId,mimeType:"audio/wav",
      sizeBytes:32044,durationSeconds:1,createdAt:new Date(),
    });
    else this.docs.set(draft,{objectId,ownerUid:uid,storageKey:key,
      expiresAt:new Date(),createdAt:new Date()});
    this.reads=[];this.writes=0;
  }
  async get(path){this.reads.push(path);
    return {exists:this.docs.has(path),data:this.docs.get(path)||null};}
}
class Bucket{
  constructor(head={size:32044,httpMetadata:{contentType:"audio/wav"}}){
    this.result=head;this.headCalls=[];this.writeCalls=0;
  }
  async head(path){this.headCalls.push(path);return this.result;}
  async get(){this.writeCalls++;throw Error("forbidden_get");}
  async list(){this.writeCalls++;throw Error("forbidden_list");}
  async delete(){this.writeCalls++;throw Error("forbidden_delete");}
}
test("sent note: exact metadata HEAD, no bytes or keys returned",async()=>{
  const db=new Db(),bucket=new Bucket();
  const result=await inspect(db,bucket,opts);
  assert.deepEqual(result,{
    ok:true,objectId,state:"sent",storagePresent:true,
    sizeMatches:true,mimeMatches:true,needsReview:false,
    exhaustive:false,completionVerified:false,erasureAllowed:false,
  });
  assert.deepEqual(bucket.headCalls,[key]);
  assert.equal(bucket.writeCalls,0);
  assert.equal(db.docs.get(up).coins,99);
  assert.equal(db.docs.get(chat).lastMessage,"Sensitive preview");
  assert.equal(JSON.stringify(result).includes("private-voice/"),false);
  assert.equal(JSON.stringify(result).includes(other),false);
});
test("unsent draft: missing and mismatched R2 objects marked for review",async()=>{
  for(const head of [
    null,
    {size:31900,httpMetadata:{contentType:"audio/wav"}},
    {size:32044,httpMetadata:{contentType:"audio/mpeg"}},
    {size:32044},
  ]){
    const db=new Db("uploaded"),bucket=new Bucket(head);
    const result=await inspect(db,bucket,opts);
    assert.equal(result.needsReview,true);
    assert.equal(result.erasureAllowed,false);
    assert.equal(bucket.headCalls.length,1);
  }
});
test("protected and wrong-linked sent message block before R2 access",async()=>{
  const mutations=[
    d=>d.docs.set("content_filter_flags/"+messageId,{evidence:"protected"}),
    d=>d.docs.get(msg).legalHold=true,
    d=>d.docs.get(msg).receiverId="third_person_123",
    d=>d.docs.get(msg).sizeBytes=100,
    d=>d.docs.get(msg).unexpectedAttachment="private_url",
    d=>d.docs.get(chat).investigationHold=true,
    d=>d.docs.get(chat).participants=[uid,uid],
    d=>d.docs.set(draft,{ownerUid:uid}),
    d=>d.docs.get(op).storageKey="other/account/secret.wav",
    d=>d.docs.get(op).evidenceHold=true,
    d=>d.docs.get(op).unexpected="old_media",
    d=>d.docs.get(op).ownerUid=other,
    d=>d.docs.get(op).state="deleting",
  ];
  for(const edit of mutations){
    const db=new Db(),bucket=new Bucket();edit(db);
    await assert.rejects(inspect(db,bucket,opts),e=>e.status===409);
    assert.equal(bucket.headCalls.length,0);
  }
});
test("invalid draft and stale/held request block R2",async()=>{
  const modifications=[
    d=>d.docs.delete(draft),
    d=>d.docs.get(draft).storageKey="different_path",
    d=>d.docs.get(draft).legalHold=true,
    d=>d.docs.get(draft).extraPrivateField="x",
  ];
  for(const mutate of modifications){
    const db=new Db("pending_upload"),bucket=new Bucket();mutate(db);
    await assert.rejects(inspect(db,bucket,opts),e=>e.status===409);
    assert.equal(bucket.headCalls.length,0);
  }
  for(const modify of [
    d=>d.docs.get(rp).status="cancelled",
    d=>d.docs.get(rp).requestId="other_request_12345",
    d=>d.docs.get(cp).uid="unknown_user_321",
    d=>d.docs.get(cp).evidenceHold=true,
    d=>d.docs.get(up).role="owner",
    d=>d.docs.get(up).authDeleted=true,
  ]){
    const db=new Db(),bucket=new Bucket();modify(db);
    await assert.rejects(inspect(db,bucket,opts),
      e=>e.code==="private_voice_r2_review_blocked");
    assert.equal(bucket.headCalls.length,0);
  }
});
test("R2 provider failures fail closed without leaking storage keys",async()=>{
  const db=new Db(),bucket=new Bucket();
  bucket.head=async()=>{throw Error("private-voice/secret internal error");};
  await assert.rejects(inspect(db,bucket,opts),e=>
    e.code==="r2_head_unavailable" &&
    !e.message.includes("private-voice/"));
  const bad=new Bucket({size:"32044",httpMetadata:{contentType:"audio/wav"}});
  await assert.rejects(inspect(db,bad,opts),
    e=>e.code==="r2_head_invalid_response");
  await assert.rejects(inspect(db,null,opts),
    e=>e.code==="r2_head_unavailable");
});
test("invalid targets and unauthenticated Owner hint block before database IO",async()=>{
  for(const patch of [
    {uid:"../unsafe"},{requestId:"bad"},{objectId:"../bad"},
    {actor:{owner:false,uid:"not_owner_123"}},
  ]){
    const db=new Db();db.get=async()=>{throw Error("unexpected IO");};
    await assert.rejects(inspect(db,new Bucket(),{...opts,...patch}),
      e=>e.status===400||e.status===403);
  }
});
test("source never mutates, downloads, enumerates, schedules or certifies erasure",()=>{
  const source=readFileSync(
    "cloudflare-worker/src/account-deletion-private-voice-r2-head.js","utf8");
  assert.doesNotMatch(source,/bucket\.get\(|bucket\.delete\(|bucket\.list\(|writeDelete\(|db\.commit\(|deleteAuthUser\(|setInterval\(/);
  assert.match(source,/bucket\.head\(key\)/);
  assert.match(source,/completionVerified: false/);
});
