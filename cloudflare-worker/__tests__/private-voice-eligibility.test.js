import assert from "node:assert/strict";
import test from "node:test";
import {
  PrivateVoicePolicyError, requireMutualPrivateVoice,
  validVoiceDuration, PRIVATE_VOICE_RING_MS,
  validPrivateVoiceParties,
} from "../src/private-voice-eligibility.js";

const actorUid = "alice", otherUid = "bob", conversationId = "dm_alice_bob";
function fixture(overrides = {}) {
  const docs = new Map([
    [`conversations/${conversationId}`, {participants:[actorUid,otherUid]}],
    [`follows/${actorUid}__${otherUid}`, {}],
    [`follows/${otherUid}__${actorUid}`, {}],
    [`users/${actorUid}`, {role:"owner"}],
    [`users/${otherUid}`, {}],
    ["system_config/messaging", {voiceNotesEnabled:true, privateCallsEnabled:true}],
  ]);
  for (const [path, value] of Object.entries(overrides)) {
    if (value === null) docs.delete(path); else docs.set(path,value);
  }
  const reads=[];
  const db={async get(path){reads.push(path); return {
    exists:docs.has(path), data:docs.get(path) || {},
  };}};
  return {db,reads};
}
const args = (kind) => ({actorUid,otherUid,conversationId,kind});
test("exactly 8 bounded reads and mutual follow both ways", async()=>{
  const {db,reads}=fixture();
  const result=await requireMutualPrivateVoice(db,args("voice_note"));
  assert.equal(result.kind,"voice_note");
  assert.equal(reads.length,8);
  assert.equal(new Set(reads).size,8);
});
test("a single follow cannot send a voice note despite text allowance",async()=>{
  const {db}=fixture({[`follows/${otherUid}__${actorUid}`]:null});
  await assert.rejects(requireMutualPrivateVoice(db,args("voice_note")),
    e=>e instanceof PrivateVoicePolicyError && e.code==="mutual_follow_required");
});
test("single follow cannot call, even if owner",async()=>{
  const {db}=fixture({[`follows/${otherUid}__${actorUid}`]:null});
  await assert.rejects(requireMutualPrivateVoice(db,args("call")),
    e=>e.code==="mutual_follow_required");
});
test("both block directions stop voice even when followed",async()=>{
  for (const path of [`user_blocks/${actorUid}/items/${otherUid}`,
                       `user_blocks/${otherUid}/items/${actorUid}`]) {
    const {db}=fixture({[path]:{}});
    await assert.rejects(requireMutualPrivateVoice(db,args("call")),
      e=>e.code==="blocked");
  }
});
test("call opt-out and do not disturb prevent ringing",async()=>{
  for (const data of [{allowPrivateCalls:false},{doNotDisturbCalls:true}]) {
    const {db}=fixture({[`users/${otherUid}`]:data});
    await assert.rejects(requireMutualPrivateVoice(db,args("call")),
      e=>e.code==="calls_not_allowed");
  }
});
test("both features default disabled without server-side control toggle",async()=>{
  for (const kind of ["call","voice_note"]) {
    const {db}=fixture({"system_config/messaging":{}});
    await assert.rejects(requireMutualPrivateVoice(db,args(kind)),
      e=>e.code===(kind==="call"?"private_calls_disabled":"voice_notes_disabled"));
  }
});
test("private voice forbids removed conversations and spoofed members",async()=>{
  const {db}=fixture({[`conversations/${conversationId}`]:{participants:["eve","bob"]}});
  await assert.rejects(requireMutualPrivateVoice(db,args("voice_note")),
    e=>e.code==="private_voice_conversation_unavailable");
});
test("guest account cannot initiate or receive voice",async()=>{
  const {db}=fixture({[`users/${otherUid}`]:{isGuest:true}});
  await assert.rejects(requireMutualPrivateVoice(db,args("voice_note")),
    e=>e.code==="registered_account_required");
});
test("finite note and ringing bounds; reject invalid identifiers",()=>{
  assert.equal(PRIVATE_VOICE_RING_MS,30_000);
  assert.equal(validVoiceDuration(1),true);
  assert.equal(validVoiceDuration(60),true);
  for (const bad of [0,-1,61,1.4,NaN,Infinity]) assert.equal(validVoiceDuration(bad),false);
  assert.throws(()=>validPrivateVoiceParties("alice","alice","dm"),PrivateVoicePolicyError);
  assert.throws(()=>validPrivateVoiceParties("alice","bob","/bad"),PrivateVoicePolicyError);
});
