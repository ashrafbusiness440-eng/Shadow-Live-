import assert from "node:assert/strict";
import test from "node:test";
import { filterDiscoveryPeople } from "../../cloudflare-worker/src/chat-safety-actions.js";

function database(records, captures = []) {
  return {
    async getMany(paths) {
      captures.push(paths);
      return paths.map((path) =>
        records[path] === undefined
          ? { exists: false, data: null }
          : { exists: true, data: records[path] },
      );
    },
  };
}

function profile(uid, attributes = {}) {
  return {
    [`public_profiles/${uid}`]: { displayName: uid, ...attributes },
    [`users/${uid}`]: { displayName: uid, ...attributes },
  };
}

test("discovery suggests only unfollowed, unblocked, public, enabled accounts", async () => {
  const records = {
    ...profile("available"),
    ...profile("followed"),
    ...profile("blocked"),
    ...profile("blockedMe"),
    ...profile("secret", { isPrivate: true }),
    ...profile("hidden", { isHidden: true }),
    ...profile("mystery", { mysteriousEnabled: true }),
    ...profile("suspended", { isSuspended: true }),
    ...profile("missing"),
    "follows/viewer__followed": {},
    "user_blocks/viewer/items/blocked": {},
    "user_blocks/blockedMe/items/viewer": {},
  };
  delete records["public_profiles/missing"];
  const batches = [];
  const result = await filterDiscoveryPeople(
    database(records, batches),
    "viewer",
    { targetUserIds: [
      "available", "followed", "blocked", "blockedMe", "secret",
      "hidden", "mystery", "suspended", "missing", "viewer",
    ] },
  );
  assert.deepEqual(result, { ok: true, allowedIds: ["available"] });
  assert.equal(batches.length, 1);
  assert.ok(batches[0].length <= 50);
  assert.ok(batches[0].includes("follows/viewer__followed"));
  assert.ok(batches[0].includes("user_blocks/blockedMe/items/viewer"));
});

test("discovery batches are bounded, de-duplicated and reject invalid input", async () => {
  const calls = [];
  const records = profile("eligible");
  const db = database(records, calls);
  const r = await filterDiscoveryPeople(db, "viewer", {
    targetUserIds: ["eligible", "eligible", "viewer"],
  });
  assert.deepEqual(r.allowedIds, ["eligible"]);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].length, 5);

  await assert.rejects(
    filterDiscoveryPeople(db, "viewer", {
      targetUserIds: Array(11).fill("someone"),
    }),
    { message: "invalid_request" },
  );
  await assert.rejects(
    filterDiscoveryPeople(db, "viewer", {
      targetUserIds: ["users/other"],
    }),
    { message: "invalid_request" },
  );
  assert.equal(calls.length, 1);
});

test("a privacy read failure never returns an unverified candidate", async () => {
  await assert.rejects(
    filterDiscoveryPeople({
      async getMany() {
        throw new Error("firestore_unavailable");
      },
    }, "viewer", { targetUserIds: ["someone"] }),
    { message: "firestore_unavailable" },
  );
});
