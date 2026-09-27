import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import {
  buildStorageObjectKey,
  consumeStorageRateLimit,
  storageExtensionForMime,
  storageMaxBytes,
  validateStoragePayload,
  isReplaceableStorageScope,
  replacementDeleteAt,
  REPLACEMENT_DELETE_DELAY_MS,
  storageActivePointerId,
  runDeletedAccountStorageCleanup,
} from "../../cloudflare-worker/src/user-storage.js";
import {
  presignR2Put,
} from "../../cloudflare-worker/src/r2-presign.js";
import {
  isPublicMediaScope,
  publicMediaStorageKey,
  publicMediaUrl,
} from "../../cloudflare-worker/src/public-media.js";

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

test("replaced profile and room media wait 24 hours before cleanup", () => {
  assert.equal(isReplaceableStorageScope("profile_image"), true);
  assert.equal(isReplaceableStorageScope("profile_cover"), true);
  assert.equal(isReplaceableStorageScope("room_cover"), true);
  assert.equal(isReplaceableStorageScope("chat_image"), false);

  const nowMs = 1_758_975_200_000;
  assert.equal(REPLACEMENT_DELETE_DELAY_MS, 24 * 60 * 60 * 1000);
  assert.equal(
    replacementDeleteAt(nowMs).getTime(),
    nowMs + 24 * 60 * 60 * 1000,
  );
});

test("replaceable media uses deterministic active pointers", () => {
  assert.equal(
    storageActivePointerId("profile_image", "user_1"),
    "profile_image__user_1",
  );
  assert.equal(
    storageActivePointerId("room_cover", "room_7"),
    "room_cover__room_7",
  );
  assert.throws(
    () => storageActivePointerId("chat_image", "conversation_9"),
    /active_pointer_not_supported/,
  );
});


test("public media redirects only expose public R2 scopes", () => {
  assert.equal(isPublicMediaScope("profile_image"), true);
  assert.equal(isPublicMediaScope("profile_cover"), true);
  assert.equal(isPublicMediaScope("room_cover"), true);
  assert.equal(isPublicMediaScope("chat_image"), false);

  assert.equal(
    publicMediaStorageKey({
      scope: "profile_image",
      targetId: "user_1",
      filename: `${"e".repeat(32)}.jpg`,
    }),
    `users/user_1/profile/${"e".repeat(32)}.jpg`,
  );
  assert.equal(
    publicMediaStorageKey({
      scope: "profile_cover",
      targetId: "user_1",
      filename: `${"f".repeat(32)}.webp`,
    }),
    `users/user_1/covers/${"f".repeat(32)}.webp`,
  );
  assert.throws(
    () =>
      publicMediaStorageKey({
        scope: "chat_image",
        targetId: "conversation_1",
        filename: `${"a".repeat(32)}.png`,
      }),
    /invalid_public_media_scope/,
  );
});

test("public media URL stays stable while R2 bytes remain direct", () => {
  const request = new Request(
    "https://shadow-live.example/api/user-storage",
  );
  const url = publicMediaUrl(request, {
    scope: "profile_image",
    targetId: "user_1",
    objectId: "a".repeat(32),
    extension: "jpg",
  });
  assert.equal(
    url,
    `https://shadow-live.example/api/public-media/profile_image/user_1/${"a".repeat(32)}.jpg`,
  );
  assert.equal(
    publicMediaUrl(request, {
      scope: "chat_image",
      targetId: "conversation_1",
      objectId: "a".repeat(32),
      extension: "jpg",
    }),
    null,
  );
});

test("worker exposes the user-storage route", () => {
  const source = fs.readFileSync(
    new URL("../../cloudflare-worker/src/index.js", import.meta.url),
    "utf8",
  );
  assert.match(source, /url\.pathname === "\/api\/user-storage"/);
  assert.match(source, /url\.pathname\.startsWith\("\/api\/public-media\/"\)/);
});

test("storage upload rate limiter caps presign bursts", () => {
  const uid = "storage_test_rate_" + Date.now();
  const nowMs = 1000;
  for (let index = 0; index < 8; index++) {
    assert.equal(
      consumeStorageRateLimit(uid, "prepareUpload", nowMs).ok,
      true,
    );
  }
  const blocked = consumeStorageRateLimit(uid, "prepareUpload", nowMs);
  assert.equal(blocked.ok, false);
  assert.equal(blocked.retryAfterSeconds, 60);

  const reset = consumeStorageRateLimit(uid, "prepareUpload", nowMs + 60_001);
  assert.equal(reset.ok, true);
});

test("R2 PUT presign is short-lived and content-type bound", async () => {
  const signed = await presignR2Put(
    {
      R2_ACCOUNT_ID: "0123456789abcdef0123456789abcdef",
      R2_ACCESS_KEY_ID: "TESTACCESSKEY1234567890",
      R2_SECRET_ACCESS_KEY: "test-secret-access-key-value",
    },
    {
      key: "users/u/profile/" + "d".repeat(32) + ".png",
      mimeType: "image/png",
    },
  );
  const url = new URL(signed);
  assert.equal(url.hostname, "0123456789abcdef0123456789abcdef.r2.cloudflarestorage.com");
  assert.equal(url.searchParams.get("X-Amz-Expires"), "300");
  assert.ok(url.searchParams.get("X-Amz-Signature"));
  assert.ok(
    String(url.searchParams.get("X-Amz-SignedHeaders") || "")
      .toLowerCase()
      .includes("content-type"),
  );
});


test("account deletion storage cleanup is metadata-indexed and bounded", () => {
  const accountSource = fs.readFileSync(
    new URL("../../cloudflare-worker/src/manage-user-account.js", import.meta.url),
    "utf8",
  );
  const storageSource = fs.readFileSync(
    new URL("../../cloudflare-worker/src/user-storage.js", import.meta.url),
    "utf8",
  );

  assert.match(accountSource, /storage_account_cleanup_jobs/);
  assert.match(storageSource, /runQuery\("storage_account_cleanup_jobs"/);
  assert.match(storageSource, /runQuery\("storage_objects"/);
  assert.match(storageSource, /field:\s*"ownerUid",\s*op:\s*"=="/);
  assert.match(storageSource, /STORAGE_DELETE_BATCH_LIMIT/);
  assert.doesNotMatch(storageSource, /bucket\.list\s*\(/);
});


test("public media redirects use bounded edge cache below signed URL TTL", () => {
  const source = fs.readFileSync(
    new URL("../../cloudflare-worker/src/public-media.js", import.meta.url),
    "utf8",
  );
  assert.match(source, /PUBLIC_MEDIA_SIGNED_TTL_SECONDS = 900/);
  assert.match(source, /PUBLIC_MEDIA_CACHE_SECONDS = 300/);
  assert.match(source, /cache\.match\(cacheKey\)/);
  assert.match(source, /cache\.put\(/);
  assert.match(source, /stale-while-revalidate=60/);
});


test("deleted-account cleanup processes at most 25 storage objects per run", async () => {
  const objects = Array.from({ length: 30 }, (_, index) => ({
    id: (index + 1).toString(16).padStart(32, "0"),
    data: {
      objectId: (index + 1).toString(16).padStart(32, "0"),
      storageKey: `chat/conversation/user/${index}.png`,
      ownerUid: "user_deleted",
      scope: "chat_image",
      targetId: "conversation",
      sizeBytes: 4,
    },
  }));
  const commits = [];
  const db = {
    async runQuery(collection, options = {}) {
      if (collection === "storage_account_cleanup_jobs") {
        return [{
          id: "delete_op_1",
          data: {
            ownerUid: "user_deleted",
            reason: "account_deleted",
            createdAt: new Date(0),
          },
        }];
      }
      if (collection === "storage_objects") {
        assert.deepEqual(options.filters, [
          { field: "ownerUid", op: "==", value: "user_deleted" },
        ]);
        assert.equal(options.limit, 25);
        return objects.slice(0, options.limit);
      }
      throw new Error("unexpected_collection:" + collection);
    },
    async get() {
      return { exists: false, data: null };
    },
    writeDelete(path) {
      return { op: "delete", path };
    },
    writeCreate(path, data) {
      return { op: "create", path, data };
    },
    async commit(_transaction, writes) {
      commits.push(...writes);
    },
  };
  const deletedKeys = [];
  const bucket = {
    async delete(key) {
      deletedKeys.push(key);
    },
  };

  const result = await runDeletedAccountStorageCleanup(
    db,
    bucket,
    { nowMs: 1_000, limit: 25 },
  );

  assert.equal(result.jobsChecked, 1);
  assert.equal(result.checked, 25);
  assert.equal(result.deleted, 25);
  assert.equal(result.failed, 0);
  assert.equal(deletedKeys.length, 25);
  assert.equal(
    commits.some(
      (write) =>
        write.op === "delete" &&
        write.path === "storage_account_cleanup_jobs/delete_op_1",
    ),
    false,
  );
  assert.equal(
    commits.filter(
      (write) =>
        write.op === "delete" &&
        write.path.startsWith("storage_objects/"),
    ).length,
    25,
  );
});

test("deleted-account cleanup closes the job after the final partial batch", async () => {
  const objects = [{
    id: "a".repeat(32),
    data: {
      objectId: "a".repeat(32),
      storageKey: "users/user_deleted/profile/a.jpg",
      ownerUid: "user_deleted",
      scope: "profile_image",
      targetId: "user_deleted",
      sizeBytes: 4,
    },
  }];
  const commits = [];
  const db = {
    async runQuery(collection) {
      if (collection === "storage_account_cleanup_jobs") {
        return [{
          id: "delete_op_final",
          data: { ownerUid: "user_deleted", reason: "account_deleted" },
        }];
      }
      if (collection === "storage_objects") return objects;
      throw new Error("unexpected_collection:" + collection);
    },
    async get(path) {
      if (path.startsWith("storage_active_pointers/")) {
        return { exists: true, data: { objectId: "a".repeat(32) } };
      }
      return { exists: false, data: null };
    },
    writeDelete(path) {
      return { op: "delete", path };
    },
    writeCreate(path, data) {
      return { op: "create", path, data };
    },
    async commit(_transaction, writes) {
      commits.push(...writes);
    },
  };
  const bucket = { async delete() {} };

  const result = await runDeletedAccountStorageCleanup(
    db,
    bucket,
    { nowMs: 2_000, limit: 25 },
  );

  assert.equal(result.checked, 1);
  assert.equal(result.deleted, 1);
  assert.equal(result.failed, 0);
  assert.equal(
    commits.some(
      (write) =>
        write.op === "delete" &&
        write.path === "storage_account_cleanup_jobs/delete_op_final",
    ),
    true,
  );
  assert.equal(
    commits.some(
      (write) =>
        write.op === "delete" &&
        write.path.startsWith("storage_active_pointers/"),
    ),
    true,
  );
});
