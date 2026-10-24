import assert from "node:assert/strict";
import test from "node:test";
import {
  PrivateVoicePolicyError, requireMutualPrivateVoice,
  validVoiceDuration, PRIVATE_VOICE_RING_MS,
  validPrivateVoiceParties, assertPrivateVoiceAccountAvailable,
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
test("only 9 bounded exact reads for voice note (including call slot)", async()=>{
  const {db,reads}=fixture();
  const result=await requireMutualPrivateVoice(db,args("voice_note"));
  assert.equal(result.kind,"voice_note");
  assert.equal(reads.length,9);
  assert.equal(new Set(reads).size,9);
  assert.ok(reads.includes("private_call_slots/alice"));
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

test("voice notes reject active or ringing private calls but allow expired slots", async()=>{
  const t = 1800000000000;
  const live=fixture({"private_call_slots/alice":{callId:"call1",expiresAtMs:t+1000}});
  await assert.rejects(requireMutualPrivateVoice(live.db,{...args("voice_note"),nowMs:t}),
    e=>e.code==="voice_note_during_private_call" && e.status===409);
  const old=fixture({"private_call_slots/alice":{callId:"old",expiresAtMs:t-1}});
  const ok=await requireMutualPrivateVoice(old.db,{...args("voice_note"),nowMs:t});
  assert.equal(ok.kind,"voice_note");
  const readable=fixture({"private_call_slots/alice":{expiresAtMs:t+1000}});
  await requireMutualPrivateVoice(readable.db,{
    ...args("voice_note"),nowMs:t,allowReadDuringCall:true,
  });
  assert.equal(readable.reads.length,8);
  // Starting calls never introduces a lookup for a voice-note-only guard.
  const calls=fixture();
  await requireMutualPrivateVoice(calls.db,args("call"));
  assert.equal(calls.reads.length,8);
});

test("paid-mode call is blocked by server even if a direct write turns feature ON",async()=>{
  const {db,reads}=fixture({"system_config/messaging":{
    voiceNotesEnabled:true, privateCallsEnabled:true,
    privateCallPricingMode:"paid", privateCallPriceCoins:149,
  }});
  await assert.rejects(requireMutualPrivateVoice(db,args("call")),
    e=>e.code==="private_call_billing_not_ready" && e.status===409);
  assert.equal(reads.length,8);
});

test("deleted accounts cannot send, receive or answer private voice calls or notes", async () => {
  const retired = [
    { accountStatus: "deleted" },
    { accountStatus: "deletion_processing" },
    { accountStatus: "deletion_completed" },
    { authDeleted: true },
    { deletionProcessing: true },
  ];
  for (const status of retired) {
    for (const uid of [actorUid, otherUid]) {
      for (const kind of ["call", "voice_note"]) {
        const {db,reads} = fixture({[`users/${uid}`]:status});
        await assert.rejects(requireMutualPrivateVoice(db,args(kind)),
          e=>e.code==="private_voice_account_deleted" && e.status===409);
        assert.equal(reads.length,kind==="call"?8:9);
      }
    }
    assert.throws(()=>assertPrivateVoiceAccountAvailable(status),
      e=>e.code==="private_voice_account_deleted" && e.status===409);
  }
});
test("pending request and review-ready grace window retain normal voice eligibility", async () => {
  for (const status of [{accountStatus:"active"},{accountStatus:"pending"},
                        {accountStatus:"review_ready"},{}]) {
    assert.doesNotThrow(()=>assertPrivateVoiceAccountAvailable(status));
    const {db}=fixture({[`users/${otherUid}`]:status});
    const voice=await requireMutualPrivateVoice(db,args("voice_note"));
    assert.equal(voice.kind,"voice_note");
  }
});
