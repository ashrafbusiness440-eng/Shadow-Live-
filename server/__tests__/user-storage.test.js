import assert from "node:assert/strict";
import fs from "node:fs";
import { syntheticErasureCertificateRows }
  from "./helpers/account-erasure-synthetic-certificates.js";
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
  diaryOrphanDeleteAt,
  DIARY_ORPHAN_DELETE_DELAY_MS,
  storageQueueObjectStillReferenced,
  cleanupQueuedStorageObject,
  storageActivePointerId,
  runDeletedAccountStorageCleanup,
  verifyAccountStorageCleanupJob,
  runFencedDeletedAccountStorageCleanup,
  ACCOUNT_ERASURE_R2_FENCE_READY,
  authorizeAgencyLogoManagement,
} from "../../cloudflare-worker/src/user-storage.js";
import {
  presignR2Put,
} from "../../cloudflare-worker/src/r2-presign.js";
import {
  isPublicMediaScope,
  publicMediaRedirect,
  publicMediaStorageKey,
  publicMediaUrl,
} from "../../cloudflare-worker/src/public-media.js";

// Test the existing object-transfer/deletion scenarios only behind the
// production-equivalent certified request + immutable queue audit gate.
function certifiedCleanupDb(baseDb, {hold=false}={}) {
  let ownerUid="",requestId="";
  const certificates=new Map();
  return {
    ...baseDb,
    async runQuery(path,options) {
      const items=await baseDb.runQuery(path,options);
      if(path!=="storage_account_cleanup_jobs" || !items.length) return items;
      const job=items[0];
      ownerUid=job.data.ownerUid;
      requestId="certified_cleanup_"+job.id;
      const signoffs=syntheticErasureCertificateRows({
        uid:ownerUid,requestId,nowMs:Date.now(),
      });
      for(const [path,record] of signoffs)certificates.set(path,record);
      return [{
        ...job,
        data:{...job.data,requestId,reason:"account_deleted_verified",status:"queued"},
      }];
    },
    // Test-only fake transaction: production uses Firestore read-write tx.
    async beginTransaction(){return "synthetic_cleanup_tx";},
    async rollback(){},
    async get(path,...rest) {
      if(certificates.has(path))return {
        exists:true,data:certificates.get(path),
      };
      if(ownerUid && requestId) {
        if(path==="account_deletion_requests/"+ownerUid) return {
          exists:true,data:{uid:ownerUid,requestId,status:"processing",reviewHold:hold,
            requestedAt:new Date(Date.now()-40*86400_000)},
        };
        if(path==="account_deletion_erasure_checkpoints/"+ownerUid) return {
          exists:true,data:{
            requestId,phase:"storage_media",destructiveAllowed:true,
            storageRetentionApproved:true,sharedMediaOwnershipReviewed:true,
            legalEvidenceReviewComplete:true,financialSettlementApproved:true,
            playBillingReviewComplete:true,
          },
        };
        if(path==="admin_audit_logs/r2_deletion_queue_"+requestId) return {
          exists:true,data:{requestId,targetId:ownerUid,action:"accountErasureR2QueueCertified"},
        };
        if(path==="users/"+ownerUid) {
          const existing=await baseDb.get(path,...rest);
          return {exists:true,data:{...(existing?.exists ? existing.data : {}),
            role:"user",accountStatus:"deletion_processing"}};
        }
      }
      return baseDb.get(path,...rest);
    },
  };
}

test("storage MIME allowlist only accepts supported image formats", () => {
  assert.equal(storageExtensionForMime("image/jpeg"), "jpg");
  assert.equal(storageExtensionForMime("image/png"), "png");
  assert.equal(storageExtensionForMime("image/webp"), "webp");
  assert.equal(storageExtensionForMime("image/gif"), "gif");
  assert.equal(storageExtensionForMime("application/pdf"), "");
});

test("storage size limits stay scope-specific", () => {
  assert.equal(storageMaxBytes("profile_image"), 2 * 1024 * 1024);
  assert.equal(storageMaxBytes("profile_avatar_animation"), 2 * 1024 * 1024);
  assert.equal(storageMaxBytes("profile_cover"), 3 * 1024 * 1024);
  assert.equal(storageMaxBytes("room_cover"), 3 * 1024 * 1024);
  assert.equal(storageMaxBytes("agency_logo"), 2 * 1024 * 1024);
  assert.equal(storageMaxBytes("agency_background"), 3 * 1024 * 1024);
  assert.equal(storageMaxBytes("agency_room_image"), 3 * 1024 * 1024);
  assert.equal(storageMaxBytes("chat_image"), 3 * 1024 * 1024);
  assert.equal(storageMaxBytes("diary_image"), 3 * 1024 * 1024);
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
    /gif_profile_only/,
  );

  assert.deepEqual(
    validateStoragePayload({
      scope: "profile_avatar_animation",
      mimeType: "image/gif",
      byteLength: 1024,
    }),
    {
      scope: "profile_avatar_animation",
      mimeType: "image/gif",
      extension: "gif",
      maxBytes: 2 * 1024 * 1024,
    },
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
      scope: "agency_logo",
      uid: "owner_1",
      targetId: "741201",
      objectId: "d".repeat(32),
      extension: "png",
    }),
    `agencies/741201/logo/${"d".repeat(32)}.png`,
  );

  assert.equal(
    buildStorageObjectKey({
      scope: "agency_background",
      uid: "owner_1",
      targetId: "741201",
      objectId: "8".repeat(32),
      extension: "webp",
    }),
    `agencies/741201/background/${"8".repeat(32)}.webp`,
  );

  assert.equal(
    buildStorageObjectKey({
      scope: "agency_room_image",
      uid: "owner_1",
      targetId: "741201",
      objectId: "7".repeat(32),
      extension: "webp",
    }),
    `agencies/741201/room-image/${"7".repeat(32)}.webp`,
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

  assert.equal(
    buildStorageObjectKey({
      scope: "diary_image",
      uid: "user_1",
      targetId: "user_1",
      objectId: "6".repeat(32),
      extension: "webp",
    }),
    `users/user_1/diaries/${"6".repeat(32)}.webp`,
  );
});

test("replaced profile and room media wait 24 hours before cleanup", () => {
  assert.equal(isReplaceableStorageScope("profile_image"), true);
  assert.equal(isReplaceableStorageScope("profile_cover"), true);
  assert.equal(isReplaceableStorageScope("room_cover"), true);
  assert.equal(isReplaceableStorageScope("agency_logo"), true);
  assert.equal(isReplaceableStorageScope("agency_background"), true);
  assert.equal(isReplaceableStorageScope("agency_room_image"), true);
  assert.equal(isReplaceableStorageScope("chat_image"), false);

  const nowMs = 1_758_975_200_000;
  assert.equal(REPLACEMENT_DELETE_DELAY_MS, 24 * 60 * 60 * 1000);
  assert.equal(
    replacementDeleteAt(nowMs).getTime(),
    nowMs + 24 * 60 * 60 * 1000,
  );
});

test("diary orphan media waits 24 hours before cleanup", () => {
  const nowMs = 1_758_975_200_000;
  assert.equal(DIARY_ORPHAN_DELETE_DELAY_MS, 24 * 60 * 60 * 1000);
  assert.equal(
    diaryOrphanDeleteAt(nowMs).getTime(),
    nowMs + 24 * 60 * 60 * 1000,
  );
});

test("diary cleanup safety defers linked images and allows pending cleanup", async () => {
  const objectId = "6".repeat(32);
  const linkedDb = {
    async get(path) {
      assert.equal(path, "diary_image_links/" + objectId);
      return { exists: true, data: { state: "linked" } };
    },
  };
  assert.equal(
    await storageQueueObjectStillReferenced(
      linkedDb,
      { scope: "diary_image", targetId: "user_1" },
      objectId,
    ),
    true,
  );

  const pendingDb = {
    async get(path) {
      assert.equal(path, "diary_image_links/" + objectId);
      return { exists: true, data: { state: "pending_cleanup" } };
    },
  };
  assert.equal(
    await storageQueueObjectStillReferenced(
      pendingDb,
      { scope: "diary_image", targetId: "user_1" },
      objectId,
    ),
    false,
  );

  const orphanDb = {
    async get(path) {
      assert.equal(path, "diary_image_links/" + objectId);
      return { exists: false, data: null };
    },
  };
  assert.equal(
    await storageQueueObjectStillReferenced(
      orphanDb,
      { scope: "diary_image", targetId: "user_1" },
      objectId,
    ),
    false,
  );
});

test("queued linked diary image is deferred without deleting R2", async () => {
  const objectId = "7".repeat(32);
  const writes = [];
  let bucketDeletes = 0;
  const db = {
    async get(path) {
      assert.equal(path, "diary_image_links/" + objectId);
      return { exists: true, data: { state: "linked" } };
    },
    writeUpdate(path, data, fields) { return { op: "update", path, data, fields }; },
    writeDelete(path) { return { op: "delete", path }; },
    writeCreate(path, data) { return { op: "create", path, data }; },
    async commit(_tx, batch) { writes.push(...batch); },
  };
  const bucket = { async delete() { bucketDeletes += 1; } };
  const result = await cleanupQueuedStorageObject(db, bucket, {
    id: objectId,
    data: {
      objectId,
      storageKey: "users/user_1/diaries/" + objectId + ".webp",
      scope: "diary_image",
      targetId: "user_1",
      reason: "diary_orphan_timeout",
    },
  }, 10_000);
  assert.equal(result.status, "deferred");
  assert.equal(bucketDeletes, 0);
  assert.equal(writes.length, 1);
  assert.equal(writes[0].op, "update");
  assert.equal(writes[0].path, "storage_delete_queue/" + objectId);
  assert.equal(writes[0].data.deferReason, "still_referenced");
});
test("queued pending diary image deletes R2 object queue link and writes audit", async () => {
  const objectId = "8".repeat(32);
  const writes = [];
  const deletedKeys = [];
  const db = {
    async get(path) {
      assert.equal(path, "diary_image_links/" + objectId);
      return { exists: true, data: { state: "pending_cleanup" } };
    },
    writeUpdate(path, data, fields) { return { op: "update", path, data, fields }; },
    writeDelete(path) { return { op: "delete", path }; },
    writeCreate(path, data) { return { op: "create", path, data }; },
    async commit(_tx, batch) { writes.push(...batch); },
  };
  const storageKey = "users/user_1/diaries/" + objectId + ".webp";
  const bucket = { async delete(key) { deletedKeys.push(key); } };
  const result = await cleanupQueuedStorageObject(db, bucket, {
    id: objectId,
    data: {
      objectId,
      storageKey,
      scope: "diary_image",
      targetId: "user_1",
      ownerUid: "user_1",
      sizeBytes: 1234,
      reason: "diary_deleted",
    },
  }, 20_000);
  assert.equal(result.status, "deleted");
  assert.deepEqual(deletedKeys, [storageKey]);
  assert.equal(writes.some((w) => w.op === "delete" && w.path === "storage_objects/" + objectId), true);
  assert.equal(writes.some((w) => w.op === "delete" && w.path === "storage_delete_queue/" + objectId), true);
  assert.equal(writes.some((w) => w.op === "delete" && w.path === "diary_image_links/" + objectId), true);
  assert.equal(writes.some((w) => w.op === "create" && w.data?.action === "cleanupDiaryImage"), true);
});
test("diary upload and cleanup reuse the existing bounded storage queue", () => {
  const source = fs.readFileSync(
    new URL("../../cloudflare-worker/src/user-storage.js", import.meta.url),
    "utf8",
  );
  assert.match(source, /reason:\s*"diary_orphan_timeout"/);
  assert.match(source, /cleanupDiaryImage/);
  assert.match(source, /diary_image_links/);
  assert.match(source, /STORAGE_DELETE_BATCH_LIMIT = 25/);
  assert.doesNotMatch(source, /bucket\.list\s*\(/);
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
  assert.equal(isPublicMediaScope("agency_logo"), true);
  assert.equal(isPublicMediaScope("agency_background"), true);
  assert.equal(isPublicMediaScope("agency_room_image"), true);
  assert.equal(isPublicMediaScope("chat_image"), false);
  assert.equal(isPublicMediaScope("diary_image"), true);

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
  assert.equal(
    publicMediaStorageKey({
      scope: "agency_logo",
      targetId: "741201",
      filename: `${"9".repeat(32)}.webp`,
    }),
    `agencies/741201/logo/${"9".repeat(32)}.webp`,
  );

  assert.equal(
    publicMediaStorageKey({
      scope: "agency_background",
      targetId: "741201",
      filename: `${"8".repeat(32)}.webp`,
    }),
    `agencies/741201/background/${"8".repeat(32)}.webp`,
  );

  assert.equal(
    publicMediaStorageKey({
      scope: "agency_room_image",
      targetId: "741201",
      filename: `${"7".repeat(32)}.webp`,
    }),
    `agencies/741201/room-image/${"7".repeat(32)}.webp`,
  );

  assert.equal(
    publicMediaStorageKey({
      scope: "diary_image",
      targetId: "user_1",
      filename: `${"6".repeat(32)}.webp`,
    }),
    `users/user_1/diaries/${"6".repeat(32)}.webp`,
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

test("chat image upload gate checks mutual follow and both block directions", () => {
  const source = fs.readFileSync(
    new URL("../../cloudflare-worker/src/user-storage.js", import.meta.url),
    "utf8",
  );
  assert.match(source, /follows\/\$\{uid\}__\$\{otherUid\}/);
  assert.match(source, /follows\/\$\{otherUid\}__\$\{uid\}/);
  assert.match(source, /user_blocks\/\$\{uid\}\/items\/\$\{otherUid\}/);
  assert.match(source, /user_blocks\/\$\{otherUid\}\/items\/\$\{uid\}/);
  assert.match(source, /StorageApiError\("blocked", 403\)/);
  assert.match(source, /StorageApiError\("follow_required", 403\)/);
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


test("storage cleanup stays bounded and is not queued by unsafe direct delete", () => {
  const accountSource = fs.readFileSync(
    new URL("../../cloudflare-worker/src/manage-user-account.js", import.meta.url),
    "utf8",
  );
  const storageSource = fs.readFileSync(
    new URL("../../cloudflare-worker/src/user-storage.js", import.meta.url),
    "utf8",
  );

  // Direct admin deletion no longer queues cleanup AFTER deleting Auth.
  // The eventual verified erasure executor must authorize this queue safely.
  assert.doesNotMatch(accountSource, /storage_account_cleanup_jobs/);
  assert.match(accountSource, /account_deletion_lifecycle_required/);
  assert.match(storageSource, /runQuery\("storage_account_cleanup_jobs"/);
  assert.match(storageSource, /runQuery\("storage_objects"/);
  assert.match(storageSource, /field:\s*"ownerUid",\s*op:\s*"=="/);
  assert.match(storageSource, /STORAGE_DELETE_BATCH_LIMIT/);
  assert.doesNotMatch(storageSource, /bucket\.list\s*\(/);
});


test("public media streams R2 bytes through Worker with PWA CORS", async () => {
  const objectId = "a".repeat(32);
  let requestedKey = "";
  const response = await publicMediaRedirect(
    new Request(
      `https://shadow-live.example/api/public-media/profile_image/user_1/${objectId}.png`,
      {
        headers: {
          Origin: "https://ashrafbusiness440-eng.github.io",
        },
      },
    ),
    {
      USER_STORAGE: {
        async get(key) {
          requestedKey = key;
          return {
            body: new Uint8Array([1, 2, 3, 4]),
            size: 4,
            etag: "profile-etag",
            httpMetadata: { contentType: "image/png" },
          };
        },
      },
    },
  );

  assert.equal(
    requestedKey,
    `users/user_1/profile/${objectId}.png`,
  );
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("Location"), null);
  assert.equal(response.headers.get("Content-Type"), "image/png");
  assert.equal(
    response.headers.get("Access-Control-Allow-Origin"),
    "https://ashrafbusiness440-eng.github.io",
  );
  assert.match(
    response.headers.get("Cache-Control") || "",
    /max-age=300/,
  );
  assert.equal(
    response.headers.get("Cross-Origin-Resource-Policy"),
    "cross-origin",
  );
  assert.deepEqual(
    Array.from(new Uint8Array(await response.arrayBuffer())),
    [1, 2, 3, 4],
  );
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
    certifiedCleanupDb(db),
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

test("account R2 page exhaustion cannot forge completion or remove queued job", async () => {
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
      if (path.startsWith("storage_active_objects/")) {
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
    certifiedCleanupDb(db),
    bucket,
    { nowMs: 2_000, limit: 25 },
  );

  assert.equal(result.checked, 1);
  assert.equal(result.deleted, 1);
  assert.equal(result.failed, 0);
  assert.equal(result.blocked,true);
  assert.equal(result.pendingReconciliation,true);
  assert.equal(result.completionVerified,false);
  assert.equal(result.reason,
    "account_storage_final_inventory_reconciliation_required");
  assert.equal(
    commits.some(
      (write) =>
        write.op === "delete" &&
        write.path === "storage_account_cleanup_jobs/delete_op_final",
    ),
    false,
  );
  assert.equal(
    commits.some(write=>write.data?.action==="completeDeletedAccountStorageCleanup"),
    false,
  );
  assert.equal(
    commits.some(
      (write) =>
        write.op === "delete" &&
        write.path.startsWith("storage_active_objects/"),
    ),
    true,
  );
});


test("deleted-account cleanup transfers an active shared room cover instead of deleting it", async () => {
  const objectId = "b".repeat(32);
  const writes = [];
  const db = {
    async runQuery(collection) {
      if (collection === "storage_account_cleanup_jobs") {
        return [{
          id: "delete_shared_room_uploader",
          data: { ownerUid: "deleted_moderator", reason: "account_deleted" },
        }];
      }
      if (collection === "storage_objects") {
        return [{
          id: objectId,
          data: {
            objectId,
            storageKey: "rooms/room_shared/covers/b.webp",
            ownerUid: "deleted_moderator",
            scope: "room_cover",
            targetId: "room_shared",
            sizeBytes: 4,
          },
        }];
      }
      throw new Error("unexpected_collection:" + collection);
    },
    async get(path) {
      if (path === "rooms/room_shared") {
        return {
          exists: true,
          data: {
            ownerUid: "room_owner",
            coverImageObjectId: objectId,
          },
        };
      }
      if (path.startsWith("storage_active_objects/")) {
        return { exists: true, data: { objectId, ownerUid: "deleted_moderator" } };
      }
      return { exists: false, data: null };
    },
    writeDelete(path) {
      return { op: "delete", path };
    },
    writeUpdate(path, data, fields) {
      return { op: "update", path, data, fields };
    },
    writeCreate(path, data) {
      return { op: "create", path, data };
    },
    async commit(_transaction, batch) {
      writes.push(...batch);
    },
  };
  let bucketDeletes = 0;
  const bucket = { async delete() { bucketDeletes += 1; } };

  const result = await runDeletedAccountStorageCleanup(
    certifiedCleanupDb(db),
    bucket,
    { nowMs: 3_000, limit: 25 },
  );

  assert.equal(result.checked, 1);
  assert.equal(result.deleted, 0);
  assert.equal(result.transferred, 1);
  assert.equal(result.failed, 0);
  assert.equal(bucketDeletes, 0);
  assert.equal(
    writes.some(
      (write) =>
        write.op === "update" &&
        write.path === `storage_objects/${objectId}` &&
        write.data.ownerUid === "room_owner",
    ),
    true,
  );
  assert.equal(
    writes.some(
      (write) =>
        write.op === "delete" &&
        write.path === "storage_account_cleanup_jobs/delete_shared_room_uploader",
    ),
    true,
  );
});

test("deleted-account profile cleanup clears active Firestore image references", async () => {
  const objectId = "c".repeat(32);
  const writes = [];
  const db = {
    async runQuery(collection) {
      if (collection === "storage_account_cleanup_jobs") {
        return [{
          id: "delete_profile_media",
          data: { ownerUid: "deleted_user", reason: "account_deleted" },
        }];
      }
      if (collection === "storage_objects") {
        return [{
          id: objectId,
          data: {
            objectId,
            storageKey: "users/deleted_user/profile/c.jpg",
            ownerUid: "deleted_user",
            scope: "profile_image",
            targetId: "deleted_user",
            sizeBytes: 4,
          },
        }];
      }
      throw new Error("unexpected_collection:" + collection);
    },
    async get(path) {
      if (path === "users/deleted_user") {
        return {
          exists: true,
          data: { profileImageObjectId: objectId },
        };
      }
      if (path === "public_profiles/deleted_user") {
        return {
          exists: true,
          data: { profileImageObjectId: objectId },
        };
      }
      if (path.startsWith("storage_active_objects/")) {
        return { exists: true, data: { objectId } };
      }
      return { exists: false, data: null };
    },
    writeDelete(path) {
      return { op: "delete", path };
    },
    writeUpdate(path, data, fields) {
      return { op: "update", path, data, fields };
    },
    writeCreate(path, data) {
      return { op: "create", path, data };
    },
    async commit(_transaction, batch) {
      writes.push(...batch);
    },
  };
  const bucket = { async delete() {} };

  const result = await runDeletedAccountStorageCleanup(
    certifiedCleanupDb(db),
    bucket,
    { nowMs: 4_000, limit: 25 },
  );

  assert.equal(result.deleted, 1);
  assert.equal(result.failed, 0);
  assert.equal(
    writes.some(
      (write) =>
        write.op === "update" &&
        write.path === "users/deleted_user" &&
        write.data.profileImageObjectId === "" &&
        write.data.profileImageUrl === "",
    ),
    true,
  );
  assert.equal(
    writes.some(
      (write) =>
        write.op === "update" &&
        write.path === "public_profiles/deleted_user" &&
        write.data.profileImageObjectId === "",
    ),
    true,
  );
});


test("deleted official-room host does not delete the active room cover", async () => {
  const objectId = "d".repeat(32);
  const writes = [];
  const db = {
    async runQuery(collection) {
      if (collection === "storage_account_cleanup_jobs") {
        return [{
          id: "delete_official_host",
          data: { ownerUid: "deleted_host", reason: "account_deleted" },
        }];
      }
      if (collection === "storage_objects") {
        return [{
          id: objectId,
          data: {
            objectId,
            storageKey: "rooms/official_room/covers/d.webp",
            ownerUid: "deleted_host",
            scope: "room_cover",
            targetId: "official_room",
            sizeBytes: 4,
          },
        }];
      }
      throw new Error("unexpected_collection:" + collection);
    },
    async get(path) {
      if (path === "rooms/official_room") {
        return {
          exists: true,
          data: {
            systemOwned: true,
            ownerUid: "",
            hostId: "deleted_host",
            coverImageObjectId: objectId,
          },
        };
      }
      if (path.startsWith("storage_active_objects/")) {
        return { exists: true, data: { objectId, ownerUid: "deleted_host" } };
      }
      return { exists: false, data: null };
    },
    writeDelete(path) {
      return { op: "delete", path };
    },
    writeUpdate(path, data, fields) {
      return { op: "update", path, data, fields };
    },
    writeCreate(path, data) {
      return { op: "create", path, data };
    },
    async commit(_transaction, batch) {
      writes.push(...batch);
    },
  };
  let bucketDeletes = 0;
  const bucket = { async delete() { bucketDeletes += 1; } };

  const result = await runDeletedAccountStorageCleanup(
    certifiedCleanupDb(db),
    bucket,
    { nowMs: 5_000, limit: 25 },
  );

  assert.equal(result.deleted, 0);
  assert.equal(result.transferred, 1);
  assert.equal(result.failed, 0);
  assert.equal(bucketDeletes, 0);
  assert.equal(
    writes.some(
      (write) =>
        write.op === "update" &&
        write.path === `storage_objects/${objectId}` &&
        write.data.ownerUid === "room:official_room",
    ),
    true,
  );
});

test("room settings validation is room-scoped rather than uploader-scoped", () => {
  const source = fs.readFileSync(
    new URL("../../cloudflare-worker/src/voice-session-legacy.js", import.meta.url),
    "utf8",
  );
  const settingsStart = source.indexOf("async function updateRoomSettings");
  const settingsEnd = source.indexOf("async function", settingsStart + 20);
  const settingsSource = source.slice(
    settingsStart,
    settingsEnd > settingsStart ? settingsEnd : undefined,
  );
  assert.match(settingsSource, /permissions\.manageRooms/);
  assert.doesNotMatch(settingsSource, /clean\(media\.ownerUid\)!==uid/);
});


test("agency logo management requires the current active Agency owner", async () => {
  const activeDb = {
    async get(path) {
      assert.equal(path, "agencies/741201");
      return {
        exists: true,
        data: {
          agencyId: "741201",
          ownerUid: "owner_1",
          status: "active",
        },
      };
    },
  };
  const allowed = await authorizeAgencyLogoManagement(
    activeDb,
    "owner_1",
    "741201",
  );
  assert.equal(allowed.targetId, "741201");

  await assert.rejects(
    authorizeAgencyLogoManagement(activeDb, "other_user", "741201"),
    /agency_owner_required/,
  );

  const closedDb = {
    async get() {
      return {
        exists: true,
        data: {
          agencyId: "741201",
          ownerUid: "owner_1",
          status: "closed",
        },
      };
    },
  };
  await assert.rejects(
    authorizeAgencyLogoManagement(closedDb, "owner_1", "741201"),
    /agency_closed/,
  );
});

test("agency background stays card-only while Agency room image owns linked room cover", () => {
  const source = fs.readFileSync(
    new URL("../../cloudflare-worker/src/user-storage.js", import.meta.url),
    "utf8",
  );
  const publicMedia = fs.readFileSync(
    new URL("../../cloudflare-worker/src/public-media.js", import.meta.url),
    "utf8",
  );

  assert.equal(source.includes('"agency_background"'), true);
  assert.equal(source.includes("backgroundObjectId"), true);
  assert.equal(source.includes("replaceAgencyBackground"), true);
  assert.equal(
    source.includes("transferDeletedAccountAgencyBackgroundOwnership"),
    true,
  );

  const backgroundStart = source.indexOf(
    'if (metadata.scope === "agency_background")',
  );
  const roomImageStart = source.indexOf(
    'if (metadata.scope === "agency_room_image")',
    backgroundStart,
  );
  const backgroundBlock = source.slice(backgroundStart, roomImageStart);
  assert.ok(backgroundStart >= 0 && roomImageStart > backgroundStart);
  assert.equal(backgroundBlock.includes("backgroundUrl: stablePublicUrl"), true);
  assert.equal(backgroundBlock.includes("coverUrl: stablePublicUrl"), true);
  assert.equal(backgroundBlock.includes("coverImageUrl: stablePublicUrl"), false);
  assert.equal(backgroundBlock.includes("agencyCoverUrl: stablePublicUrl"), false);

  const roomImageEnd = source.indexOf(
    "let previousDeleteAt = null;",
    roomImageStart,
  );
  const roomImageBlock = source.slice(roomImageStart, roomImageEnd);
  assert.equal(roomImageBlock.includes("roomImageUrl: stablePublicUrl"), true);
  assert.equal(roomImageBlock.includes("roomImageObjectId: objectId"), true);
  assert.equal(roomImageBlock.includes("agencyRoomImageUrl: stablePublicUrl"), true);
  assert.equal(roomImageBlock.includes("agencyRoomImageObjectId: objectId"), true);
  assert.equal(roomImageBlock.includes("coverImageUrl: stablePublicUrl"), false);
  assert.equal(roomImageBlock.includes("agencyCoverUrl: stablePublicUrl"), false);
  assert.equal(roomImageBlock.includes("backgroundUrl: stablePublicUrl"), false);
  assert.equal(
    source.includes("transferDeletedAccountAgencyRoomImageOwnership"),
    true,
  );
  assert.equal(publicMedia.includes('"agency_room_image"'), true);
});

test("agency logo storage stays owner-authorized audited and delayed-replacement safe", () => {
  const source = fs.readFileSync(
    new URL("../../cloudflare-worker/src/user-storage.js", import.meta.url),
    "utf8",
  );
  assert.equal(source.includes("authorizeAgencyLogoManagement"), true);
  assert.equal(source.includes('"agency_logo"'), true);
  assert.equal(source.includes("agency_owner_required"), true);
  assert.equal(source.includes("replaceAgencyLogo"), true);
  assert.equal(source.includes("logoObjectId"), true);
  assert.equal(source.includes("transferDeletedAccountAgencyLogoOwnership"), true);
  assert.equal(source.includes("REPLACEMENT_DELETE_DELAY_MS"), true);
});


test("VIP4 animated avatar storage is isolated and entitlement-gated", () => {
  const source = fs.readFileSync(
    new URL("../../cloudflare-worker/src/user-storage.js", import.meta.url),
    "utf8",
  );
  assert.match(source, /profile_avatar_animation/);
  assert.match(source, /image\/gif/);
  assert.match(source, /vip4_required_for_animated_avatar/);
  assert.match(source, /activeEffectiveVipLevelFromUser/);
  assert.match(source, /profileAvatarAnimationObjectId/);
});

test("uncertified legacy R2 job is blocked before any object lookup or deletion", async () => {
  const rows=[];
  const db={
    async runQuery(collection){
      rows.push(collection);
      if(collection==="storage_account_cleanup_jobs") return [{
        id:"legacy_direct_delete_job",
        data:{ownerUid:"deleted_member_123",reason:"account_deleted"},
      }];
      throw Error("storage_scanned_without_verification");
    },
    async get(){throw Error("should_not_read_for_invalid_job");},
    async commit(){throw Error("must_never_commit");},
  };
  const bucket={async delete(){throw Error("R2 deletion must not happen");}};
  const result=await runDeletedAccountStorageCleanup(db,bucket,{limit:25});
  assert.equal(result.jobsChecked,1);
  assert.equal(result.checked,0);
  assert.equal(result.deleted,0);
  assert.equal(result.blocked,true);
  assert.deepEqual(rows,["storage_account_cleanup_jobs"]);
});

test("verified queued R2 job is blocked again when Owner adds a review hold", async () => {
  const db={
    async runQuery(collection){
      if(collection==="storage_account_cleanup_jobs")return [{
        id:"verified_job_123",data:{
          ownerUid:"deleted_member_123",requestId:"verified_req_123456",
          reason:"account_deleted_verified",status:"queued",
        },
      }];
      throw Error("storage_objects_must_not_be_scanned");
    },
    async get(path){
      if(path==="account_deletion_requests/deleted_member_123")return {
        exists:true,data:{uid:"deleted_member_123",requestId:"verified_req_123456",
          status:"processing",reviewHold:true},
      };
      if(path==="account_deletion_erasure_checkpoints/deleted_member_123")return {
        exists:true,data:{requestId:"verified_req_123456",phase:"storage_media",
          destructiveAllowed:true,storageRetentionApproved:true,
          sharedMediaOwnershipReviewed:true,legalEvidenceReviewComplete:true,
          financialSettlementApproved:true,playBillingReviewComplete:true},
      };
      if(path==="users/deleted_member_123")return {
        exists:true,data:{role:"user",accountStatus:"deletion_processing"},
      };
      if(path==="admin_audit_logs/r2_deletion_queue_verified_req_123456")return {
        exists:true,data:{targetId:"deleted_member_123",
          requestId:"verified_req_123456",
          action:"accountErasureR2QueueCertified"},
      };
      throw Error("unexpected_lookup_"+path);
    },
    async commit(){throw Error("must_not_commit");},
  };
  const result=await runDeletedAccountStorageCleanup(db,{
    async delete(){throw Error("must_not_delete_bucket");},
  },{limit:25});
  assert.equal(result.blocked,true);
  assert.equal(result.checked,0);
  assert.equal(result.deleted,0);
});

test("queued R2 cleanup refuses new report, evidence and appeal holds before any media query", async () => {
  const uid="deleted_member_123",requestId="verified_req_123456";
  const scenarios=[
    {location:"request",hold:{investigationHold:true}},
    {location:"request",hold:{reported:true}},
    {location:"request",hold:{appealPending:true}},
    {location:"checkpoint",hold:{evidenceHold:true}},
    {location:"checkpoint",hold:{investigationHold:true}},
    {location:"user",hold:{reported:true}},
    {location:"user",hold:{appealStatus:"under_review"}},
  ];
  for(const scenario of scenarios){
    const queries=[];
    const db={
      async runQuery(collection){
        queries.push(collection);
        if(collection==="storage_account_cleanup_jobs")return [{
          id:"verified_job_123",data:{ownerUid:uid,requestId,
            reason:"account_deleted_verified",status:"queued"},
        }];
        throw Error("media_objects_must_not_be_scanned");
      },
      async get(path){
        if(path==="account_deletion_requests/"+uid)return {
          exists:true,data:{uid,requestId,status:"processing",
            ...(scenario.location==="request"?scenario.hold:{})},
        };
        if(path==="account_deletion_erasure_checkpoints/"+uid)return {
          exists:true,data:{requestId,phase:"storage_media",
            destructiveAllowed:true,storageRetentionApproved:true,
            sharedMediaOwnershipReviewed:true,
            legalEvidenceReviewComplete:true,
            financialSettlementApproved:true,
            playBillingReviewComplete:true,
            ...(scenario.location==="checkpoint"?scenario.hold:{})},
        };
        if(path==="users/"+uid)return {
          exists:true,data:{role:"user",
            accountStatus:"deletion_processing",
            ...(scenario.location==="user"?scenario.hold:{})},
        };
        if(path==="admin_audit_logs/r2_deletion_queue_"+requestId)return {
          exists:true,data:{requestId,targetId:uid,
            action:"accountErasureR2QueueCertified"},
        };
        throw Error("unexpected_ref_"+path);
      },
      async commit(){throw Error("must_never_commit");},
    };
    let deletions=0;
    const result=await runDeletedAccountStorageCleanup(db,{
      async delete(){deletions++;},
    },{limit:5});
    assert.equal(result.blocked,true);
    assert.equal(result.checked,0);
    assert.equal(result.deleted,0);
    assert.equal(deletions,0);
    assert.deepEqual(queries,["storage_account_cleanup_jobs"]);
  }
});


test("revocation after the first R2 file halts the remaining account batch",async()=>{
  const ownerUid="deleted_member_late",ids=["1".repeat(32),"2".repeat(32)];
  const pending=[];
  let bucketDeletes=0,revoked=false,readObjectPage=false;
  const base={
    async runQuery(path,opts={}){
      if(path==="storage_account_cleanup_jobs")return [{
        id:"late_revoke_cleanup",data:{ownerUid,reason:"account_deleted"},
      }];
      if(path==="storage_objects"){
        readObjectPage=true;
        return ids.map(id=>({id,data:{
          objectId:id,ownerUid,scope:"chat_image",
          storageKey:"chat/room/"+ownerUid+"/"+id+".png",
          targetId:"room_123",
        }}));
      }
      throw Error("unexpected_scan_"+path);
    },
    async get(){return {exists:false,data:null};},
    writeDelete(path){return {op:"delete",path};},
    writeCreate(path,data){return {op:"create",path,data};},
    async commit(_tx,items){pending.push(...items);},
  };
  const db=certifiedCleanupDb(base);
  const previousGet=db.get.bind(db);
  db.get=async(path,tx)=>{
    const document=await previousGet(path,tx);
    if(revoked && path.includes("account_deletion_erasure_approvals/") &&
       path.endsWith("__retention_policy")){
      return {exists:true,data:{...document.data,decision:"revoked"}};
    }
    return document;
  };
  const result=await runDeletedAccountStorageCleanup(db,{
    async delete(){bucketDeletes++;revoked=true;},
  },{limit:5});
  assert.equal(readObjectPage,true);
  assert.equal(result.deleted,1);
  assert.equal(result.failed,1);
  assert.equal(bucketDeletes,1);
  assert.equal(pending.some(w=>
    w.path==="storage_account_cleanup_jobs/late_revoke_cleanup"),false);
});

test("pending revocation-intent after first R2 object blocks the rest of the batch",async()=>{
  // Old isolated primitive remains test-only: the production scheduler is
  // fully OFF pending an external-operation lease and reconciliation protocol.
  const ownerUid="deleted_member_stop_after_first";
  const ids=["3".repeat(32),"4".repeat(32)];
  let deletes=0,stopPending=false,pageEnumerated=false;
  const writes=[];
  const base={
    async runQuery(path){
      if(path==="storage_account_cleanup_jobs")return [{
        id:"stop_after_first_job",data:{
          ownerUid,reason:"account_deleted",
        },
      }];
      if(path==="storage_objects"){
        pageEnumerated=true;
        return ids.map(id=>({id,data:{
          objectId:id,ownerUid,scope:"chat_image",
          storageKey:"chat/room/"+ownerUid+"/"+id+".png",
          targetId:"room_123",
        }}));
      }
      throw Error("unexpected_query_"+path);
    },
    async get(){return {exists:false,data:null};},
    writeDelete(path){return {op:"delete",path};},
    writeCreate(path,data){return {op:"create",path,data};},
    async commit(_tx,ops){writes.push(...ops);},
  };
  const db=certifiedCleanupDb(base);
  const originalGet=db.get.bind(db);
  db.get=async (path,tx)=>{
    if(path==="account_erasure_external_io_revocation_intents/"+
      ownerUid+"__certified_cleanup_stop_after_first_job"){
      return stopPending ? {exists:true,data:{
        status:"pending_reconciliation",revocationEffective:false,
      }} : {exists:false,data:null};
    }
    return originalGet(path,tx);
  };
  const result=await runDeletedAccountStorageCleanup(db,{
    async delete(){deletes++;stopPending=true;},
  },{limit:5});
  assert.equal(pageEnumerated,true);
  assert.equal(deletes,1);
  assert.equal(result.deleted,1);
  assert.equal(result.failed,1);
  assert.equal(writes.some(write=>
    write.path==="storage_account_cleanup_jobs/stop_after_first_job"),false);
});

test("valid looking R2 job without independent six-domain signoffs cannot enumerate media",async()=>{
  const uid="uncertified_storage_user",requestId="uncertified_queue_request_12345";
  const queries=[];
  const db={
    async beginTransaction(){return "tx";},
    async rollback(){},
    async runQuery(path){
      queries.push(path);
      if(path==="storage_account_cleanup_jobs")return [{
        id:"uncertified_job_123",data:{ownerUid:uid,requestId,
          reason:"account_deleted_verified",status:"queued"},
      }];
      throw Error("cannot_scan_media_without_certificates");
    },
    async get(path){
      const docs={
        ["account_deletion_requests/"+uid]:{uid,requestId,status:"processing",
          requestedAt:new Date(Date.now()-40*86400_000)},
        ["account_deletion_erasure_checkpoints/"+uid]:{
          requestId,phase:"storage_media",destructiveAllowed:true,
          storageRetentionApproved:true,sharedMediaOwnershipReviewed:true,
          legalEvidenceReviewComplete:true,financialSettlementApproved:true,
          playBillingReviewComplete:true,
        },
        ["users/"+uid]:{role:"user",accountStatus:"deletion_processing"},
        ["admin_audit_logs/r2_deletion_queue_"+requestId]:{
          targetId:uid,requestId,action:"accountErasureR2QueueCertified",
        },
      };
      return {exists:Object.hasOwn(docs,path),data:docs[path]||null};
    },
  };
  const result=await runDeletedAccountStorageCleanup(db,{
    async delete(){throw Error("never_delete_without_signoffs");},
  },{limit:5});
  assert.equal(result.blocked,true);
  assert.equal(result.deleted,0);
  assert.deepEqual(queries,["storage_account_cleanup_jobs"]);
});

test("live scheduled account-erasure R2 requires an unimplemented external revocation fence",async()=>{
  assert.equal(ACCOUNT_ERASURE_R2_FENCE_READY,false);
  let reads=0,commits=0,deletes=0;
  const db={
    async runQuery(){reads++;throw Error("account_erasure_scan_must_be_blocked");},
    async beginTransaction(){reads++;throw Error("account_erasure_tx_must_be_blocked");},
    async commit(){commits++;throw Error("account_erasure_commit_must_be_blocked");},
  };
  const bucket={async delete(){deletes++;throw Error("r2_delete_must_be_blocked");}};
  const result=await runFencedDeletedAccountStorageCleanup(db,bucket,{
    nowMs:Date.now(),limit:25,
  });
  assert.deepEqual(result,{
    jobsChecked:0,checked:0,deleted:0,transferred:0,
    failed:0,blocked:true,reason:"external_io_fence_not_ready",
  });
  assert.equal(reads,0);
  assert.equal(commits,0);
  assert.equal(deletes,0);
  // Verify the actual hourly entrypoint uses the guarded wrapper rather than
  // the older directly invocable, intentionally retained test primitive.
  const source=fs.readFileSync(
    new URL("../../cloudflare-worker/src/user-storage.js",import.meta.url),"utf8");
  const live=source.slice(source.indexOf("export async function runDueStorageCleanup("));
  assert.match(live,/await runFencedDeletedAccountStorageCleanup\(/);
  assert.doesNotMatch(live,/await runDeletedAccountStorageCleanup\(/);
});

test("queued R2 job stops on pending external-I/O revocation intent BEFORE media reads",async()=>{
  const uid="owner_stop_intent_123",requestId="certified_cleanup_stop_intent_job";
  for(const forged of [
    {exists:true,data:{uid,requestId,status:"pending_reconciliation"}},
    null,
    {exists:"false",data:null},
  ]){
    const queries=[],base={
      async runQuery(path){
        queries.push(path);
        if(path==="storage_account_cleanup_jobs")return [{
          id:"stop_intent_job",data:{ownerUid:uid,reason:"account_deleted"},
        }];
        throw Error("must_not_enumerate_storage_on_pending_stop");
      },
      async get(){return {exists:false,data:null};},
      async commit(){throw Error("no_commit_allowed");},
    };
    const db=certifiedCleanupDb(base);
    const read=db.get.bind(db);
    db.get=async (path,tx)=>{
      if(path==="account_erasure_external_io_revocation_intents/"+
          uid+"__"+requestId)return forged;
      return read(path,tx);
    };
    let deletes=0;
    const result=await runDeletedAccountStorageCleanup(db,{
      async delete(){deletes++;throw Error("bucket_delete_forbidden");},
    },{limit:5});
    assert.equal(result.blocked,true);
    assert.equal(result.deleted,0);
    assert.equal(deletes,0);
    assert.deepEqual(queries,["storage_account_cleanup_jobs"]);
  }
});

test("queued R2 job verification batches six exact current-state reads before twelve signoffs",async()=>{
  const uid="bounded_cleanup_member_123",queries=[],sizes=[],transactions=[];
  const base={
    async runQuery(path){
      queries.push(path);
      if(path==="storage_account_cleanup_jobs")return [{
        id:"batch_receipt_123",data:{ownerUid:uid,reason:"account_deleted"},
      }];
      throw Error("unapproved_storage_query");
    },
    async get(){return {exists:false,data:null};},
    async commit(){throw Error("read_only_verification_must_not_commit");},
  };
  const db=certifiedCleanupDb(base);
  const [job]=await db.runQuery("storage_account_cleanup_jobs",{limit:1});
  db.getMany=async(paths,tx)=>{
    sizes.push(paths.length);
    transactions.push(tx);
    return Promise.all(paths.map(path=>db.get(path,tx)));
  };
  assert.equal(await verifyAccountStorageCleanupJob(db,job),true);
  assert.deepEqual(sizes,[6,12]);
  assert.ok(transactions.every(tx=>tx==="synthetic_cleanup_tx"));
  assert.deepEqual(queries,["storage_account_cleanup_jobs"]);
});

test("empty account R2 inventory never issues a completion receipt",async()=>{
  const uid="empty_storage_user_123456",writes=[];
  const db={
    async runQuery(path) {
      if(path==="storage_account_cleanup_jobs")return [{
        id:"empty_storage_final",data:{ownerUid:uid,reason:"account_deleted"},
      }];
      if(path==="storage_objects")return [];
      throw Error("unexpected_collection_"+path);
    },
    async get(){return {exists:false,data:null};},
    writeCreate(path,data){return {op:"create",path,data};},
    writeDelete(path){return {op:"delete",path};},
    async commit(_,rows){writes.push(...rows);},
  };
  const result=await runDeletedAccountStorageCleanup(certifiedCleanupDb(db),{
    async delete(){throw Error("bucket_must_never_be_touched");},
  },{limit:5});
  assert.equal(result.checked,0);
  assert.equal(result.deleted,0);
  assert.equal(result.blocked,true);
  assert.equal(result.completionVerified,false);
  assert.equal(result.pendingReconciliation,true);
  assert.deepEqual(writes,[]);
});

test("request-wide non-permissive R2 holder blocks legacy job before media enumeration",async()=>{
  const uid="fenced_storage_user_123456",requestId="certified_cleanup_blocked_hold_123";
  const queries=[];
  const base={
    async runQuery(path){
      queries.push(path);
      if(path==="storage_account_cleanup_jobs")return [{
        id:"blocked_hold_123",data:{ownerUid:uid,reason:"account_deleted"},
      }];
      if(path==="storage_objects")throw Error("must_not_enumerate_media");
      throw Error("unexpected_query");
    },
    async get(){return {exists:false,data:null};},
    async commit(){throw Error("must_never_commit");},
  };
  const db=certifiedCleanupDb(base);
  const real=db.get.bind(db);
  db.get=async(path,tx)=>{
    if(path==="account_erasure_external_io_coordination_holds/"+
      uid+"__"+requestId) {
      return {exists:true,data:{
        uid,requestId,state:"claimed_requires_external_interlock",
        externalIoAllowed:false,completionVerified:false,
      }};
    }
    return real(path,tx);
  };
  let deletes=0;
  const result=await runDeletedAccountStorageCleanup(db,{
    async delete(){deletes++;},
  },{limit:5});
  assert.equal(result.blocked,true);
  assert.equal(result.deleted,0);
  assert.equal(result.checked,0);
  assert.equal(deletes,0);
  assert.deepEqual(queries,["storage_account_cleanup_jobs"]);
});
