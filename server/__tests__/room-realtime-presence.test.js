import assert from "node:assert/strict";
import test from "node:test";

import {
  hasPresenceUid,
  presenceCountFromAttachments,
  presenceSnapshotFromAttachments,
} from "../../cloudflare-worker/src/room-realtime-presence.js";

test("open socket attachments define room presence", () => {
  const participants = presenceSnapshotFromAttachments([
    {
      uid: "u1",
      displayName: "One",
      profileImageUrl: "one.webp",
      joinedAtMs: 1000,
      connectedAtMs: 1000,
    },
    {
      uid: "u2",
      displayName: "Two",
      profileImageUrl: "",
      joinedAtMs: 2000,
      connectedAtMs: 2000,
    },
  ], 9000);

  assert.deepEqual(participants.map((item) => item.uid), ["u1", "u2"]);
  assert.equal(participants[0].lastSeenAtMs, 9000);
  assert.equal(hasPresenceUid(participants, "u1"), true);
  assert.equal(hasPresenceUid(participants, "missing"), false);
});

test("multiple sockets for one uid produce one participant", () => {
  const participants = presenceSnapshotFromAttachments([
    {
      uid: "u1",
      displayName: "One",
      profileImageUrl: "",
      joinedAtMs: 3000,
      connectedAtMs: 3000,
    },
    {
      uid: "u1",
      displayName: "One",
      profileImageUrl: "profile.webp",
      joinedAtMs: 1000,
      connectedAtMs: 4000,
    },
  ], 8000);

  assert.equal(participants.length, 1);
  assert.equal(participants[0].uid, "u1");
  assert.equal(participants[0].joinedAtMs, 1000);
  assert.equal(participants[0].profileImageUrl, "profile.webp");
});

test("invalid attachments never create phantom users", () => {
  const participants = presenceSnapshotFromAttachments([
    null,
    {},
    { uid: "" },
    { uid: "   " },
  ], 5000);
  assert.deepEqual(participants, []);
});


test("online count deduplicates multiple sockets for the same uid", () => {
  assert.equal(
    presenceCountFromAttachments([
      { uid: "u1", connectedAtMs: 1000 },
      { uid: "u1", connectedAtMs: 2000 },
      { uid: "u2", connectedAtMs: 3000 },
    ]),
    2,
  );
});
