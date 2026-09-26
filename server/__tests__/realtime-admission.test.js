import assert from "node:assert/strict";
import test from "node:test";

import {
  REALTIME_ADMISSION_MAX_TTL_MS,
  REALTIME_ADMISSION_TTL_MS,
  issueRealtimeAdmission,
  verifyRealtimeAdmission,
} from "../../cloudflare-worker/src/realtime-admission.js";

const secret = "01234567890123456789012345678901";

test("realtime admission is short lived and bound to uid + room", () => {
  const nowMs = 1_000_000;
  const token = issueRealtimeAdmission(
    secret,
    {
      uid: "u1",
      roomId: "room_1",
      displayName: "User One",
      profileImageUrl: "https://example.test/u1.webp",
    },
    { nowMs },
  );

  const verified = verifyRealtimeAdmission(secret, token, {
    uid: "u1",
    roomId: "room_1",
    nowMs: nowMs + 100,
  });
  assert.equal(verified.uid, "u1");
  assert.equal(verified.roomId, "room_1");
  assert.equal(verified.displayName, "User One");
  assert.equal(verified.expiresAtMs - verified.issuedAtMs, REALTIME_ADMISSION_TTL_MS);
  assert.ok(REALTIME_ADMISSION_TTL_MS <= REALTIME_ADMISSION_MAX_TTL_MS);
});

test("realtime admission rejects tamper, uid mismatch, room mismatch, and expiry", () => {
  const nowMs = 2_000_000;
  const token = issueRealtimeAdmission(secret, { uid: "u1", roomId: "room_1" }, { nowMs });
  const [payload, sig] = token.split(".");

  assert.equal(
    verifyRealtimeAdmission(secret, payload + "x." + sig, {
      uid: "u1",
      roomId: "room_1",
      nowMs: nowMs + 1,
    }),
    null,
  );
  assert.equal(
    verifyRealtimeAdmission(secret, token, {
      uid: "u2",
      roomId: "room_1",
      nowMs: nowMs + 1,
    }),
    null,
  );
  assert.equal(
    verifyRealtimeAdmission(secret, token, {
      uid: "u1",
      roomId: "room_2",
      nowMs: nowMs + 1,
    }),
    null,
  );
  assert.equal(
    verifyRealtimeAdmission(secret, token, {
      uid: "u1",
      roomId: "room_1",
      nowMs: nowMs + REALTIME_ADMISSION_TTL_MS + 1,
    }),
    null,
  );
});

test("realtime admission uses a domain-separated signing key", () => {
  const nowMs = 3_000_000;
  const token = issueRealtimeAdmission(secret, { uid: "u1", roomId: "r1" }, { nowMs });
  assert.equal(
    verifyRealtimeAdmission("abcdefghijklmnopqrstuvwxyz123456", token, {
      uid: "u1",
      roomId: "r1",
      nowMs: nowMs + 1,
    }),
    null,
  );
});
