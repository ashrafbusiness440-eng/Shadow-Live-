import assert from "node:assert/strict";
import test from "node:test";
import { createDecipheriv } from "node:crypto";
import { issueScopedPrivateCallVoiceToken } from "../src/voice-session-legacy.js";
import {
  startPrivateCall, respondPrivateCall, finishPrivateCall,
  renewPrivateCall, readPrivateCall, privateCallMediaSession, PrivateCallError,
} from "../src/private-call-signaling.js";

const origin = 1_790_000_000_000;

function fixture() {
  const docs = new Map([
    ["conversations/c1", { participants: ["alice", "bob"] }],
    ["follows/alice__bob", {}], ["follows/bob__alice", {}],
    ["users/alice", {}], ["users/bob", {}],
    ["system_config/messaging", { privateCallsEnabled: true }],
  ]);
  const writes = [];
  const db = {
    beginTransaction: async () => "transaction",
    rollback: async () => {},
    get: async (path) => ({
      exists: docs.has(path), data: docs.get(path) || {},
    }),
    writeUpdate: (path, data) => ({ op: "update", path, data }),
    writeCreate: (path, data) => ({ op: "create", path, data }),
    writeDelete: (path) => ({ op: "delete", path }),
    commit: async (_tx, actions) => {
      // Reject existing create preconditions BEFORE any writes, like Firestore.
      for (const action of actions) {
        if (action.op === "create" && docs.has(action.path)) {
          const error = new Error("ALREADY_EXISTS");
          error.status = 409;
          throw error;
        }
      }
      for (const action of actions) {
        if (action.op === "delete") docs.delete(action.path);
        else if (action.op === "create") docs.set(action.path, action.data);
        else docs.set(action.path, { ...(docs.get(action.path) || {}), ...action.data });
        writes.push(action);
      }
    },
  };
  return { db, docs, writes };
}
const request = (key = "private_call_operation_001") => ({
  otherUid: "bob", conversationId: "c1", idempotencyKey: key,
});
const start = (db, key, at = origin) =>
  startPrivateCall(db, "alice", request(key), at);

test("call starts once, writes incoming notification and occupies both account slots", async () => {
  const { db, docs, writes } = fixture();
  const call = await start(db, "operation_first_call");
  assert.equal(call.status, "ringing");
  assert.equal(call.ringDeadlineMs, origin + 30_000);
  assert.equal(docs.get("private_call_slots/alice").callId, call.callId);
  assert.equal(docs.get("private_call_slots/bob").callId, call.callId);
  assert.equal(docs.get("notifications/private_call_" + call.callId).userId, "bob");
  assert.equal(docs.get("private_call_ringing_queue/" + call.callId).callId, call.callId);
  const repeated = await start(db, "operation_first_call", origin + 1000);
  assert.equal(repeated.code, "duplicate");
  assert.equal(repeated.callId, call.callId);
  assert.equal(writes.filter((w) => w.path.startsWith("private_calls/")).length, 1);
  await assert.rejects(
    start(db, "operation_second_call", origin + 1000),
    (error) => error.code === "call_busy",
  );
  await assert.rejects(
    startPrivateCall(db, "bob", {
      otherUid: "alice", conversationId: "c1",
      idempotencyKey: "operation_reverse_call",
    }, origin + 1000),
    (error) => error.code === "call_busy",
  );
});

test("mutual follow, account consent, DND and blocks are server-enforced", async () => {
  for (const [path, data, expected] of [
    ["follows/bob__alice", null, "mutual_follow_required"],
    ["user_blocks/bob/items/alice", {}, "blocked"],
    ["users/bob", { allowPrivateCalls: false }, "calls_not_allowed"],
    ["users/bob", { doNotDisturbCalls: true }, "calls_not_allowed"],
    ["system_config/messaging", { privateCallsEnabled: false }, "private_calls_disabled"],
  ]) {
    const { db, docs } = fixture();
    if (data === null) docs.delete(path); else docs.set(path, data);
    await assert.rejects(start(db, "operation_policy_test"), (e) => e.code === expected);
    assert.equal([...docs.keys()].filter(k => k.startsWith("private_calls/")).length, 0);
  }
});

test("only recipient may accept or reject, and only participants may inspect", async () => {
  const { db } = fixture();
  const call = await start(db, "operation_permissions_test");
  await assert.rejects(
    respondPrivateCall(db, "alice", { callId: call.callId, decision: "accept" }, origin + 2000),
    (e) => e.code === "not_call_recipient",
  );
  await assert.rejects(
    readPrivateCall(db, "eve", { callId: call.callId }, origin + 2000),
    (e) => e.code === "not_a_call_participant",
  );
  const active = await respondPrivateCall(db, "bob", {
    callId: call.callId, decision: "accept",
  }, origin + 2000);
  assert.equal(active.status, "active");
  const repeated = await respondPrivateCall(db, "bob", {
    callId: call.callId, decision: "accept",
  }, origin + 3000);
  assert.equal(repeated.code, "already_accepted");
  const lease = await renewPrivateCall(db, "alice", { callId: call.callId }, origin + 3000);
  assert.equal(lease.status, "active");
  const ended = await finishPrivateCall(db, "bob", { callId: call.callId }, origin + 6200);
  assert.equal(ended.status, "completed");
  assert.equal(ended.durationSeconds, 4);
  const done = await finishPrivateCall(db, "bob", { callId: call.callId }, origin + 7200);
  assert.equal(done.code, "already_finished");
});

test("rejected and missed calls yield exactly one call event; missed notification is private", async () => {
  const a = fixture();
  const rejected = await start(a.db, "operation_rejection_test");
  const res = await respondPrivateCall(a.db, "bob", {
    callId: rejected.callId, decision: "reject",
  }, origin + 2000);
  assert.equal(res.status, "rejected");
  assert.equal(a.docs.get("conversations/c1/messages/call_" + rejected.callId).status, "rejected");
  assert.equal(a.docs.has("private_call_slots/bob"), false);
  const b = fixture();
  const missed = await start(b.db, "operation_timeout_test");
  const status = await readPrivateCall(b.db, "alice", {
    callId: missed.callId,
  }, origin + 30_001);
  assert.equal(status.status, "missed");
  assert.equal(b.docs.get("notifications/private_call_missed_" + missed.callId).userId, "bob");
  assert.equal(b.docs.get("conversations/c1/messages/call_" + missed.callId).status, "missed");
  assert.equal(b.docs.has("private_call_ringing_queue/" + missed.callId), false);
  const repeated = await finishPrivateCall(b.db, "alice", { callId: missed.callId }, origin + 40_000);
  assert.equal(repeated.code, "already_finished");
  assert.equal(b.writes.filter(w => w.path === "conversations/c1/messages/call_" + missed.callId).length, 1);
});

test("active call ends safely when mutual follow is revoked", async () => {
  const { db, docs } = fixture();
  const started = await start(db, "operation_revocation_test");
  await respondPrivateCall(db, "bob", {
    callId: started.callId, decision: "accept",
  }, origin + 1000);
  docs.delete("follows/bob__alice");
  const final = await renewPrivateCall(db, "alice", {
    callId: started.callId,
  }, origin + 2500);
  assert.equal(final.status, "interrupted");
  assert.equal(docs.has("private_call_slots/alice"), false);
  assert.equal(docs.has("private_call_slots/bob"), false);
});

test("rate limit applies even when calls are repeatedly cancelled", async () => {
  const { db } = fixture();
  for (let index = 0; index < 4; index++) {
    const at = origin + index * 1000;
    const call = await start(db, "operation_rate_limited_" + index, at);
    const cancelled = await finishPrivateCall(db, "alice", {
      callId: call.callId,
    }, at + 100);
    assert.equal(cancelled.status, "cancelled");
  }
  await assert.rejects(
    start(db, "operation_fifth_call", origin + 5000),
    (error) => error instanceof PrivateCallError && error.code === "call_rate_limited",
  );
});


test("call media tokens deny ringing, third-party, ended and revoked calls", async () => {
  const { db, docs } = fixture();
  const ring = await start(db, "operation_media_guard");
  const body = { callId: ring.callId };
  const mint = (uid, roomId) => ({
    token: "safe-test-token", appId: 1234, roomId,
    userId: uid, streamId: roomId + "_" + uid,
  });
  await assert.rejects(
    privateCallMediaSession(db, "alice", body, mint, origin + 100),
    (error) => error.code === "call_not_active",
  );
  await respondPrivateCall(db, "bob", { ...body, decision: "accept" }, origin + 1000);
  await assert.rejects(
    privateCallMediaSession(db, "eve", body, mint, origin + 2000),
    (error) => error.code === "not_a_call_participant",
  );
  const caller = await privateCallMediaSession(db, "alice", body, mint, origin + 2000);
  const callee = await privateCallMediaSession(db, "bob", body, mint, origin + 2000);
  assert.equal(caller.roomId, "private_call_" + ring.callId);
  assert.equal(caller.roomId, callee.roomId);
  assert.notEqual(caller.userId, callee.userId);
  docs.delete("follows/alice__bob");
  await assert.rejects(
    privateCallMediaSession(db, "bob", body, mint, origin + 3000),
    (error) => error.code === "mutual_follow_required",
  );
  await finishPrivateCall(db, "bob", body, origin + 4000);
  await assert.rejects(
    privateCallMediaSession(db, "alice", body, mint, origin + 5000),
    (error) => error.code === "call_not_active",
  );
});

test("call media issuance refuses expired or replaced live account leases", async () => {
  const { db, docs } = fixture();
  const started = await start(db, "operation_expired_slots");
  await respondPrivateCall(db, "bob", {
    callId: started.callId, decision: "accept",
  }, origin + 1000);
  docs.set("private_call_slots/bob", {
    callId: "replaced", expiresAtMs: origin + 100_000,
  });
  await assert.rejects(
    privateCallMediaSession(
      db, "alice", { callId: started.callId },
      () => ({ token: "wrong" }), origin + 2000,
    ),
    (error) => error.code === "call_no_longer_available",
  );
});

test("ZEGO Token04 is bound to call room and only the authenticated stream", () => {
  const secret = "0123456789abcdef0123456789abcdef";
  const roomId = "private_call_abcdef0123456789abcdef0123456789";
  const token = issueScopedPrivateCallVoiceToken({
    ZEGO_APP_ID: "123456",
    ZEGO_SERVER_SECRET: secret,
  }, "alice", roomId);
  assert.equal(token.appId, 123456);
  assert.equal(token.roomId, roomId);
  assert.equal(token.streamId, roomId + "_" + token.userId);
  assert.ok(token.token.startsWith("04"));
  const packed = Buffer.from(token.token.slice(2), "base64");
  const expire = Number(packed.readBigInt64BE(0));
  const ivLength = packed.readUInt16BE(8);
  assert.equal(ivLength, 16);
  const iv = packed.subarray(10, 10 + ivLength);
  const len = packed.readUInt16BE(10 + ivLength);
  const encrypted = packed.subarray(12 + ivLength, 12 + ivLength + len);
  const decipher = createDecipheriv("aes-256-cbc", Buffer.from(secret), iv);
  const payload = JSON.parse(Buffer.concat([
    decipher.update(encrypted), decipher.final(),
  ]).toString("utf8"));
  assert.equal(payload.app_id, 123456);
  assert.equal(payload.user_id, token.userId);
  assert.equal(payload.expire, expire);
  const rights = JSON.parse(payload.payload);
  assert.deepEqual(rights, {
    room_id: roomId, privilege: { "1": 1, "2": 1 },
    stream_id_list: [token.streamId],
  });
  assert.ok(expire > Date.now() / 1000);
  assert.ok(expire <= Date.now() / 1000 + 301);
});
