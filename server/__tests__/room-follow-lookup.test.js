import test from "node:test";
import assert from "node:assert/strict";
import {
  MAX_FOLLOW_TARGETS,
  mayOfferRoomFollow,
  resolveRoomFollowTargets,
} from "../../cloudflare-worker/src/room-follow-lookup.js";

function fixture({ present = true, room = {}, target = {}, ban = null, block = false } = {}) {
  const documents = {
    "users/viewer": {},
    "users/target": target,
    "user_room_index/target": { roomId: "room_one", confirmedAtMs: Date.now() },
    "rooms/room_one": { name: "غرفة الأصدقاء", visibility: "public", isActive: true, ...room },
    ...(block ? { "user_blocks/viewer/items/target": {} } : {}),
    ...(ban ? { "room_bans/room_one/users/viewer": ban } : {}),
  };
  const reads = [];
  const db = {
    async get(path) {
      reads.push(path);
      return {
        exists: Object.hasOwn(documents, path),
        data: documents[path] || {},
      };
    },
  };
  const checks = [];
  const namespace = {
    idFromName(id) { return id; },
    get(id) {
      return {
        async fetch(url) {
          const parsed = new URL(url);
          checks.push([id, parsed.pathname, parsed.searchParams.get("uid")]);
          return Response.json({ ok: true, present });
        },
      };
    },
  };
  return { db, namespace, reads, checks };
}

test("follow resolver confirms DO membership and only reveals a public room", async () => {
  const { db, namespace, reads, checks } = fixture();
  const result = await resolveRoomFollowTargets(db, namespace, "viewer", ["target"]);
  assert.equal(result.length, 1);
  assert.deepEqual(result[0], {
    targetUid: "target",
    roomId: "room_one",
    roomName: "غرفة الأصدقاء",
    requiresPassword: false,
  });
  assert.equal(reads.length, 7);
  assert.deepEqual(checks, [["room_one", "/presence/has", "target"]]);
});

test("stale locator cannot be used as proof of actual presence", async () => {
  const { db, namespace, reads } = fixture({ present: false });
  assert.deepEqual(await resolveRoomFollowTargets(db, namespace, "viewer", ["target"]), []);
  assert.equal(reads.length, 2);
});

test("hidden, blocked, banned, mysterious or ghost participants fail closed", async () => {
  for (const variation of [
    { room: { isHidden: true } },
    { room: { visibility: "hidden" } },
    { block: true },
    { ban: { permanent: true } },
    { target: { mysteriousId: "123456789", mysteriousEnabled: true,
      mysteriousPermanent: true } },
    { target: { hideRoomLocation: true } },
    { target: { disableRoomFollow: true } },
  ]) {
    const { db, namespace } = fixture(variation);
    assert.deepEqual(
      await resolveRoomFollowTargets(db, namespace, "viewer", ["target"]),
      [],
    );
  }
});

test("password room is exposed only as requiring the existing password gate", async () => {
  const { db, namespace } = fixture({ room: { visibility: "password" } });
  const result = await resolveRoomFollowTargets(db, namespace, "viewer", ["target"]);
  assert.equal(result[0]?.requiresPassword, true);
  assert.equal("ticket" in result[0], false);
});

test("bounded targets, no unknown-user lookup and no repeated scanner", async () => {
  const { db, namespace, reads } = fixture();
  assert.equal(MAX_FOLLOW_TARGETS, 8);
  await resolveRoomFollowTargets(db, namespace, "viewer", [
    "target", "target", "/invalid", "", "viewer",
    ...Array.from({ length: 25 }, (_, i) => `user_${i}`),
  ]);
  assert.ok(reads.length <= 1 + MAX_FOLLOW_TARGETS * 6);
});

test("client cannot track themselves, a private room or a suspended user", () => {
  const args = { viewerUid: "viewer", targetUid: "target", roomId: "room_one" };
  assert.equal(mayOfferRoomFollow({ ...args, viewerUid: "target" }), false);
  assert.equal(mayOfferRoomFollow({ ...args, room: { visibility: "private" } }), false);
  assert.equal(mayOfferRoomFollow({ ...args, target: { accountStatus: "banned" } }), false);
});
