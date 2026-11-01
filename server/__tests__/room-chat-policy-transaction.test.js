import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";

const legacy = readFileSync(
  new URL("../../cloudflare-worker/src/voice-session-legacy.js", import.meta.url),
  "utf8",
);
const start = legacy.indexOf("async function setRoomChatEnabled(");
const end = legacy.indexOf("async function closePersonalRoom(", start);
assert.ok(start > 0 && end > start, "locate the actual chat-policy transaction");
const actionSource = legacy.slice(start, end);

class ApiError extends Error {
  constructor(code, status) {
    super(code);
    this.status = status;
  }
}

function fixture({ allowed = true, present = true } = {}) {
  const calls = { reads: [], writes: [], audit: [], synced: [], invalidated: [] };
  const room = { ownerUid: "owner", chatEnabled: true };
  const actor = { role: "owner" };
  const db = {
    collection(collection) {
      return {
        doc(id) {
          return {
            collectionName: collection, id,
            collection(subcollection) {
              return { doc() { return { collectionName: subcollection, id: "audit-1" }; } };
            },
          };
        },
      };
    },
    async runTransaction(action) {
      const tx = {
        get(ref) {
          calls.reads.push(ref.collectionName + "/" + ref.id);
          if (ref.collectionName === "rooms") {
            return Promise.resolve({ exists: present, data: () => room });
          }
          if (ref.collectionName === "users") {
            return Promise.resolve({ exists: true, data: () => actor });
          }
          throw Error("unexpected target or unbounded Firestore read");
        },
        update(ref, data) { calls.writes.push({ ref, data }); },
        create(ref, data) { calls.audit.push({ ref, data }); },
      };
      return action(tx);
    },
  };
  const fn = runInNewContext(
    actionSource + "; setRoomChatEnabled",
    {
      ApiError,
      Promise,
      clean: value => String(value ?? "").trim(),
      canManageRoomAction: () => allowed,
      FieldValue: { serverTimestamp: () => ({ serverTime: true }) },
      absoluteRoomAccessAudit: () => ({}),
      invalidateRoomRealtimeAdmissionCache: id => calls.invalidated.push(id),
      setRoomRealtimeChatPolicy: async (_env, id, enabled) =>
        calls.synced.push({ id, enabled }),
      legacyEnv: {},
    },
  );
  return { fn, db, calls };
}

test("authorized chat toggle reads only room and actor and updates room audit/DO", async () => {
  const { fn, db, calls } = fixture();
  const result = await fn(db, "owner", { roomId: "room_42", enabled: false });
  assert.equal(result.ok, true);
  assert.equal(result.roomId, "room_42");
  assert.equal(result.chatEnabled, false);
  assert.deepEqual(calls.reads.sort(), ["rooms/room_42", "users/owner"]);
  assert.equal(calls.writes.length, 1);
  assert.equal(calls.writes[0].data.chatEnabled, false);
  assert.equal(calls.audit.length, 1);
  assert.equal(calls.audit[0].data.action, "setRoomChatEnabled");
  assert.deepEqual(calls.invalidated, ["room_42"]);
  assert.equal(calls.synced.length, 1);
  assert.equal(calls.synced[0].enabled, false);
});

test("unauthorized actor cannot toggle policy or write audit", async () => {
  const { fn, db, calls } = fixture({ allowed: false });
  await assert.rejects(fn(db, "visitor", { roomId: "room_42", enabled: false }),
    error => error.message === "forbidden" && error.status === 403);
  assert.equal(calls.writes.length, 0);
  assert.equal(calls.audit.length, 0);
  assert.equal(calls.synced.length, 0);
});

test("invalid room ID and absent room fail closed", async () => {
  const invalid = fixture();
  await assert.rejects(invalid.fn(invalid.db, "owner", {
    roomId: "../other", enabled: false,
  }), error => error.message === "invalid_room_id");
  assert.equal(invalid.calls.reads.length, 0);
  const missing = fixture({ present: false });
  await assert.rejects(missing.fn(missing.db, "owner", {
    roomId: "missing", enabled: false,
  }), error => error.message === "room_not_found");
  assert.equal(missing.calls.writes.length, 0);
});
