import assert from "node:assert/strict";
import test from "node:test";

import {
  buildStorageObjectKey,
  consumeStorageRateLimit,
  storageExtensionForMime,
  storageMaxBytes,
  validateStoragePayload,
} from "../../cloudflare-worker/src/user-storage.js";

test("storage MIME allowlist only accepts supported image formats", () => {
  assert.equal(storageExtensionForMime("image/jpeg"), "jpg");
  assert.equal(storageExtensionForMime("image/png"), "png");
  assert.equal(storageExtensionForMime("image/webp"), "webp");
  assert.equal(storageExtensionForMime("image/gif"), "");
  assert.equal(storageExtensionForMime("application/pdf"), "");
});

test("storage size limits stay scope-specific", () => {
  assert.equal(storageMaxBytes("profile_image"), 2 * 1024 * 1024);
  assert.equal(storageMaxBytes("profile_cover"), 4 * 1024 * 1024);
  assert.equal(storageMaxBytes("room_cover"), 4 * 1024 * 1024);
  assert.equal(storageMaxBytes("chat_image"), 8 * 1024 * 1024);
});

test("storage payload validation rejects unsupported types and oversized files", () => {
  assert.deepEqual(
    validateStoragePayload({
      scope: "profile_image",
      mimeType: "image/jpeg",
      byteLength: 1024,
    }),
    {
      scope: "profile_image",
      mimeType: "image/jpeg",
      extension: "jpg",
      maxBytes: 2 * 1024 * 1024,
    },
  );

  assert.throws(
    () => validateStoragePayload({
      scope: "profile_image",
      mimeType: "image/gif",
      byteLength: 1024,
    }),
    /invalid_file_type/,
  );

  assert.throws(
    () => validateStoragePayload({
      scope: "profile_image",
      mimeType: "image/jpeg",
      byteLength: 2 * 1024 * 1024 + 1,
    }),
    /invalid_file_size/,
  );
});

test("storage object keys follow canonical private prefixes", () => {
  assert.equal(
    buildStorageObjectKey({
      scope: "profile_image",
      uid: "user_1",
      targetId: "user_1",
      objectId: "a".repeat(32),
      extension: "jpg",
    }),
    `users/user_1/profile/${"a".repeat(32)}.jpg`,
  );

  assert.equal(
    buildStorageObjectKey({
      scope: "room_cover",
      uid: "user_1",
      targetId: "room_7",
      objectId: "b".repeat(32),
      extension: "webp",
    }),
    `rooms/room_7/covers/${"b".repeat(32)}.webp`,
  );

  assert.equal(
    buildStorageObjectKey({
      scope: "chat_image",
      uid: "user_1",
      targetId: "conversation_9",
      objectId: "c".repeat(32),
      extension: "png",
    }),
    `chat/conversation_9/user_1/${"c".repeat(32)}.png`,
  );
});

test("storage upload rate limiter caps burst requests", () => {
  const uid = "storage_test_rate_" + Date.now();
  const nowMs = 1000;
  for (let index = 0; index < 12; index++) {
    assert.equal(
      consumeStorageRateLimit(uid, "upload", nowMs).ok,
      true,
    );
  }
  const blocked = consumeStorageRateLimit(uid, "upload", nowMs);
  assert.equal(blocked.ok, false);
  assert.equal(blocked.retryAfterSeconds, 60);

  const reset = consumeStorageRateLimit(uid, "upload", nowMs + 60_001);
  assert.equal(reset.ok, true);
});
