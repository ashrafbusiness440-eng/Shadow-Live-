import assert from "node:assert/strict";
import test from "node:test";
import { validateVoiceUpload, validateVoiceWavHeader, VoiceMediaError, voiceSend, voiceRead } from "../src/private-voice-media.js";
test("voice upload rejects overlong or oversized audio and nonaudio files",()=>{
  const base={conversationId:"c1",otherUid:"u2",mimeType:"audio/wav",byteLength:35000,durationSeconds:60};
  assert.equal(validateVoiceUpload(base).extension,"wav");
  assert.throws(()=>validateVoiceUpload({...base,mimeType:"audio/mp4"}),VoiceMediaError);
  assert.throws(()=>validateVoiceUpload({...base,mimeType:"audio/webm"}),VoiceMediaError);
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
    writeDelete(path){return {op:"delete",path};},
    async commit(tx,changes){for(const w of changes){
      if(w.op==="create")docs.set(w.path,w.data);
      else if(w.op==="update")docs.set(w.path,{...(docs.get(w.path)||{}),...w.data});
      else if(w.op==="delete")docs.delete(w.path);
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

test("WAV header binds claimed duration to actual 16-kHz mono PCM payload",()=>{
  const bytes=32044;
  const h=new Uint8Array(44);
  const data=new DataView(h.buffer);
  function label(offset,s){for(let i=0;i<s.length;i++)h[offset+i]=s.charCodeAt(i);}
  label(0,"RIFF"); data.setUint32(4,bytes-8,true);
  label(8,"WAVE"); label(12,"fmt "); data.setUint32(16,16,true);
  data.setUint16(20,1,true); data.setUint16(22,1,true);
  data.setUint32(24,16000,true); data.setUint32(28,32000,true);
  data.setUint16(32,2,true); data.setUint16(34,16,true);
  label(36,"data"); data.setUint32(40,bytes-44,true);
  assert.equal(validateVoiceWavHeader(h,bytes,1),true);
  assert.throws(()=>validateVoiceWavHeader(h,bytes,2),VoiceMediaError);
  data.setUint32(24,8000,true);
  assert.throws(()=>validateVoiceWavHeader(h,bytes,1),VoiceMediaError);
});
