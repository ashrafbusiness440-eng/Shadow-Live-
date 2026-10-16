import assert from "node:assert/strict";
import test from "node:test";
import { validateVoiceUpload, VoiceMediaError, voiceSend, voiceRead } from "../src/private-voice-media.js";
test("voice upload rejects overlong or oversized audio and nonaudio files",()=>{
  const base={conversationId:"c1",otherUid:"u2",mimeType:"audio/webm",byteLength:35000,durationSeconds:60};
  assert.equal(validateVoiceUpload(base).extension,"webm");
  assert.equal(validateVoiceUpload({...base,mimeType:"audio/mp4"}).extension,"m4a");
  for(const body of [{...base,durationSeconds:61},{...base,byteLength:4*1024*1024},
    {...base,mimeType:"image/png"},{...base,durationSeconds:0}]){
    assert.throws(()=>validateVoiceUpload(body),VoiceMediaError);
  }
});
function fixture(objectData, settings={voiceNotesEnabled:true}) {
  const docs=new Map([
    ["conversations/c1",{participants:["u1","u2"],unreadCounts:{u1:0,u2:2}}],
    ["follows/u1__u2",{}],["follows/u2__u1",{}],
    ["users/u1",{}],["users/u2",{}],["system_config/messaging",settings],
    ["private_voice_objects/"+("a".repeat(32)),objectData],
  ]);
  const writes=[];
  const db={
    async beginTransaction(){return "t";},async rollback(){},
    async get(path){return {exists:docs.has(path),data:docs.get(path)||{}};},
    writeCreate(path,data){return {op:"create",path,data};},
    writeUpdate(path,data){return {op:"update",path,data};},
    async commit(tx,changes){for(const w of changes){
      if(w.op==="create")docs.set(w.path,w.data);
      else if(w.op==="update")docs.set(w.path,{...(docs.get(w.path)||{}),...w.data});
      writes.push(w);
    }},
  };
  return {db,docs,writes};
}
const id="a".repeat(32);
const request={otherUid:"u2",conversationId:"c1",objectId:id,idempotencyKey:"voice_test_operation_0001"};
const data={ownerUid:"u1",otherUid:"u2",conversationId:"c1",state:"uploaded",mimeType:"audio/webm",expectedSizeBytes:32000,durationSeconds:40,storageKey:"private-voice/c1/u1/key.webm"};
test("sending voice records one transaction-bound message and dedupes retries",async()=>{
  const {db,writes}=fixture(data);
  const sent=await voiceSend(db,"u1",request);
  assert.equal(sent.ok,true);
  assert.equal(writes.filter(x=>x.path.includes("/messages/")).length,1);
  assert.equal((await voiceSend(db,"u1",request)).code,"duplicate");
  assert.equal(writes.filter(x=>x.path.includes("/messages/")).length,1);
});
test("mutual follow revoked before send blocks transaction",async()=>{
  const {db,docs}=fixture(data);
  docs.delete("follows/u2__u1");
  await assert.rejects(voiceSend(db,"u1",request),e=>e.code==="mutual_follow_required");
});
test("recipient cannot read unpublished R2 objects",async()=>{
  const {db}=fixture(data);
  await assert.rejects(voiceRead(db,{},"u2",{objectId:id}),e=>e.code==="voice_message_unavailable");
});
