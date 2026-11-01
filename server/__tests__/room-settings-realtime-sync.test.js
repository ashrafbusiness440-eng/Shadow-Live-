import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";

const legacy = readFileSync(
  new URL("../../cloudflare-worker/src/voice-session-legacy.js", import.meta.url),
  "utf8",
);
const start = legacy.indexOf("async function updateRoomSettings(");
const end = legacy.indexOf("async function setRoomChatEnabled(", start);
assert.ok(start > 0 && end > start);
const source = legacy.slice(start, end);

class ApiError extends Error {
  constructor(code, status) { super(code); this.status = status; }
}

const validBody = () => ({
  roomId: "room_101",
  name: "Updated room",
  description: "",
  category: "دردشة",
  tags: ["friends"],
  visibility: "public",
  chatEnabled: false,
  roomImageUrl: "",
});

function fixture({ owner = true, failCommit = false } = {}) {
  const calls = { reads: [], updates: [], audits: [], invalidations: [], sync: [] };
  const room = { ownerUid: owner ? "actor" : "someone-else",
    visibility: "public", chatEnabled: true, name: "Old room" };
  const doc = (name, id) => ({
    collectionName: name, id,
    collection(sub) { return { doc() { return doc(sub, "audit_1"); } }; },
  });
  const db = {
    collection(name) { return { doc(id) { return doc(name, id); } }; },
    async runTransaction(cb) {
      const tx = {
        get(ref) {
          calls.reads.push(ref.collectionName + "/" + ref.id);
          if (ref.collectionName === "rooms") {
            return Promise.resolve({ exists: true, data: () => room });
          }
          if (ref.collectionName === "users") {
            return Promise.resolve({ exists: true, data: () => ({ role: "user" }) });
          }
          throw Error("unexpected database read");
        },
        update(ref, value) {
          if (failCommit) throw Error("write_failed");
          calls.updates.push({ ref, value });
        },
        create(ref, value) { calls.audits.push({ ref, value }); },
      };
      return cb(tx);
    },
  };
  const fn = runInNewContext(
    source + "; updateRoomSettings",
    {
      ApiError,
      Promise,
      clean: value => String(value ?? "").trim(),
      roomPermissions: () => ({ manageRooms: false, hidden: false }),
      agencyRoomManagementCapabilities: () => [],
      nextRoomPasswordLockVersion: () => 5,
      hashRoomPassword: () => ({ salt: "salt", hash: "hashed" }),
      FieldValue: {
        serverTimestamp: () => ({ timestamp: true }),
        delete: () => ({ deleted: true }),
      },
      searchTokens: () => ["indexed"],
      absoluteRoomAccessAudit: () => ({}),
      roomResponse: (roomId, value) => ({ roomId, ...value }),
      invalidateRoomRealtimeAdmissionCache: id => calls.invalidations.push(id),
      setRoomRealtimeChatPolicy: async (_env, id, enabled) =>
        calls.sync.push({ id, enabled }),
      legacyEnv: {},
    },
  );
  return { db, fn, calls };
}

test("a committed settings change invalidates admission and syncs DO chat policy", async () => {
  const { db, fn, calls } = fixture();
  const result = await fn(db, "actor", validBody());
  assert.equal(result.ok, true);
  assert.equal(result.room.chatEnabled, false);
  assert.deepEqual(calls.reads.sort(), ["rooms/room_101", "users/actor"]);
  assert.equal(calls.updates.length, 1);
  assert.equal(calls.updates[0].value.chatEnabled, false);
  assert.equal(calls.audits.length, 1);
  assert.equal(calls.audits[0].value.action, "updateRoomSettings");
  assert.deepEqual(calls.invalidations, ["room_101"]);
  assert.equal(calls.sync.length, 1);
  assert.equal(calls.sync[0].id, "room_101");
  assert.equal(calls.sync[0].enabled, false);
});

test("failed writes and forbidden edits cause no DO or cache mutation", async () => {
  const denied = fixture({ owner: false });
  await assert.rejects(
    denied.fn(denied.db, "actor", validBody()),
    error => error.message === "forbidden" && error.status === 403,
  );
  assert.equal(denied.calls.updates.length, 0);
  assert.equal(denied.calls.sync.length, 0);
  assert.equal(denied.calls.invalidations.length, 0);

  const failed = fixture({ failCommit: true });
  await assert.rejects(
    failed.fn(failed.db, "actor", validBody()), /write_failed/,
  );
  assert.equal(failed.calls.sync.length, 0);
  assert.equal(failed.calls.invalidations.length, 0);
});

test("password lock changes also evict previous admission metadata", async () => {
  const { db, fn, calls } = fixture();
  const result = await fn(db, "actor", {
    ...validBody(), visibility: "password", password: "1234",
  });
  assert.equal(result.room.visibility, "password");
  assert.equal(result.room.passwordLockVersion, 5);
  assert.equal(result.room.passwordSalt, "salt");
  assert.deepEqual(calls.invalidations, ["room_101"]);
  assert.equal(calls.sync.length, 1);
});
