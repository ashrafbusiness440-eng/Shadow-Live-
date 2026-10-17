import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  tokenDigest, updatePrivateCallPushDevice,
  buildPrivateCallFcmMessage, dispatchPrivateCallPush,
} from "../src/private-call-push.js";

const token = "fcm-token-abcdefghijklmnopqrstuvwxyz1234567890";
const callId = "abcdef0123456789abcdef0123456789";
const now = 1_800_000_000_000;
const env = {
  PRIVATE_CALL_MEDIA_READY: "true",
  PRIVATE_CALL_PUSH_READY: "true",
  FIREBASE_SERVICE_ACCOUNT: JSON.stringify({
    client_email: "server@example.test",
    project_id: "shadow-live",
    private_key: "test-key",
  }),
};
const call = {
  callId, status: "ringing", callerUid: "alice", calleeUid: "bob",
  ringDeadlineMs: now + 30_000,
};

function fixture() {
  const docs = new Map();
  const hash = tokenDigest(token);
  const db = {
    beginTransaction: async () => "tx",
    rollback: async () => {},
    get: async (path) => ({
      exists: docs.has(path), data: docs.get(path) || null,
    }),
    writeUpdate: (path, data) => ({ path, data, op: "upsert" }),
    writeCreate: (path, data) => ({ path, data, op: "create" }),
    writeDelete: (path) => ({ path, op: "delete" }),
    commit: async (_tx, writes) => {
      for (const write of writes) {
        if (write.op === "create" && docs.has(write.path)) {
          throw Error("ALREADY_EXISTS");
        }
      }
      for (const write of writes) {
        if (write.op === "delete") docs.delete(write.path);
        else docs.set(write.path, {
          ...(write.op === "upsert" ? docs.get(write.path) || {} : {}),
          ...write.data,
        });
      }
    },
    runQuery: async (path, {limit}) => {
      assert.ok(limit <= 4);
      return [...docs].filter(([p]) => p.startsWith(path + "/"))
        .slice(0, limit).map(([p, data]) => ({
          id: p.split("/").pop(), data,
        }));
    },
  };
  return {db, docs, hash};
}

test("default OFF blocks all push lookup, even if the call is ringing", async () => {
  const {db} = fixture();
  db.get = async () => { throw Error("should not touch Firestore"); };
  assert.deepEqual(await dispatchPrivateCallPush({}, "bob", callId, {db}), {
    code: "push_disabled", sent: 0,
  });
  assert.deepEqual(await dispatchPrivateCallPush({
    ...env, PRIVATE_CALL_PUSH_READY: "false",
  }, "bob", callId, {db}), {
    code: "push_disabled", sent: 0,
  });
});

test("a device can belong to one authenticated account only", async () => {
  const {db,docs,hash} = fixture();
  const input = {action:"register", token, platform:"android"};
  await updatePrivateCallPushDevice(db, "alice", input, now);
  assert.equal(docs.get("private_call_push_token_owners/" + hash).uid, "alice");
  await updatePrivateCallPushDevice(db, "bob", input, now + 100);
  assert.equal(docs.has("private_call_push_devices/alice/tokens/" + hash), false);
  assert.equal(docs.get("private_call_push_devices/bob/tokens/" + hash).token, token);
  await updatePrivateCallPushDevice(db, "alice", {
    action:"unregister",token,
  }, now + 200);
  assert.equal(docs.get("private_call_push_token_owners/" + hash).uid, "bob");
  await updatePrivateCallPushDevice(db, "bob", {
    action:"unregister",token,
  }, now + 300);
  assert.equal(docs.has("private_call_push_token_owners/" + hash),false);
  assert.equal(docs.has("private_call_push_devices/bob/tokens/" + hash),false);
});

test("FCM payload is a short-lived generic call alert, not message contents", () => {
  const msg=buildPrivateCallFcmMessage(token,call,now);
  assert.equal(msg.message.data.type,"private_call_incoming");
  assert.equal(msg.message.data.callId,callId);
  assert.equal(msg.message.android.ttl,"30s");
  assert.equal(msg.message.android.notification.channel_id,"shadow_private_calls");
  assert.equal(msg.message.android.priority,"HIGH");
  assert.equal(msg.message.webpush.headers.TTL,"30");
  const json=JSON.stringify(msg);
  for(const forbidden of ["conversationId","secret","senderId","coins","callerUid"]) {
    assert.equal(json.includes(forbidden),false);
  }
  assert.equal(buildPrivateCallFcmMessage(token,call,now+30_000),null);
  assert.throws(()=>buildPrivateCallFcmMessage(token,
    {...call,status:"completed"},now));
});

test("sends only live ring to a fresh token still owned by the callee",async()=>{
  const {db,docs,hash}=fixture();
  docs.set("private_calls/"+callId,call);
  docs.set("private_call_push_devices/bob/tokens/"+hash,{
    token,platform:"android",updatedAtMs:now,
  });
  docs.set("private_call_push_token_owners/"+hash,{uid:"alice"});
  let sent=0;
  let result=await dispatchPrivateCallPush(env,"bob",callId,{
    db,nowMs:now,send:async()=>{sent++;return true;},
  });
  assert.equal(result.sent,0);
  assert.equal(sent,0);
  docs.set("private_call_push_token_owners/"+hash,{uid:"bob"});
  result=await dispatchPrivateCallPush(env,"bob",callId,{
    db,nowMs:now,send:async msg=>{
      assert.equal(msg.message.token,token);sent++;return true;
    },
  });
  assert.equal(result.sent,1);
  assert.equal(sent,1);
  docs.set("private_calls/"+callId,{...call,status:"active"});
  result=await dispatchPrivateCallPush(env,"bob",callId,{
    db,nowMs:now,send:async()=>{sent++;return true;},
  });
  assert.equal(result.code,"not_ringing");
  assert.equal(sent,1);
});

test("registration validates token lengths and platforms; no unbounded send loop",async()=>{
  const {db}=fixture();
  await assert.rejects(updatePrivateCallPushDevice(db,"bob",{
    action:"register",token:"bad",platform:"android",
  }),e=>e.code==="invalid_push_token");
  await assert.rejects(updatePrivateCallPushDevice(db,"bob",{
    action:"register",token,platform:"unknown",
  }),e=>e.code==="invalid_push_platform");
  const src=readFileSync("cloudflare-worker/src/private-call-push.js","utf8");
  const callSrc=readFileSync("cloudflare-worker/src/private-call-signaling.js","utf8");
  const index=readFileSync("cloudflare-worker/src/index.js","utf8");
  assert.ok(src.includes('verifyFirebaseIdToken(request, env)'));
  assert.ok(src.includes('sign_in_provider === "anonymous"'));
  assert.ok(src.includes('maxDevices = 4'));
  assert.ok(src.includes('AbortSignal.timeout(5000)'));
  assert.ok(src.includes("firebase.messaging"));
  assert.ok(callSrc.includes('result.code !== "duplicate"'));
  assert.ok(callSrc.includes('ctx.waitUntil(dispatchPrivateCallPush('));
  assert.ok(index.includes('"/api/private-call-push-devices"'));
  assert.ok(!src.includes("console.log("));
});
