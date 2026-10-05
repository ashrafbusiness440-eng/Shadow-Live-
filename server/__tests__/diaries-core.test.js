import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { randomUUID, webcrypto } from "node:crypto";
import test from "node:test";

if (!globalThis.crypto) globalThis.crypto = webcrypto;
if (typeof globalThis.crypto.randomUUID !== "function") {
  globalThis.crypto.randomUUID = randomUUID;
}

import { diaryCoreTestHooks } from "../../cloudflare-worker/src/diaries.js";

const {
  diaryText,
  diaryImageIds,
  createDiary,
  deleteDiary,
  setCommentsEnabled,
  toggleLike,
  diaryCommentText,
  createComment,
  listComments,
  deleteComment,
  listLatest,
  listUser,
  listFollowing,
} = diaryCoreTestHooks;

class FakeDb {
  constructor(seed = {}) {
    this.docs = new Map(
      Object.entries(seed).map(([path, data]) => [path, structuredClone(data)]),
    );
  }

  async beginTransaction() { return "tx"; }
  async rollback() {}

  async get(path) {
    if (!this.docs.has(path)) return { exists: false, data: null };
    return { exists: true, data: structuredClone(this.docs.get(path)) };
  }

  writeCreate(path, fields) {
    return { kind: "create", path, fields: structuredClone(fields) };
  }

  writeUpdate(path, fields, fieldPaths = null) {
    return {
      kind: "update",
      path,
      fields: structuredClone(fields),
      fieldPaths: Array.isArray(fieldPaths) ? [...fieldPaths] : null,
    };
  }

  writeDelete(path) {
    return { kind: "delete", path };
  }

  async commit(_transaction, writes) {
    for (const write of writes) {
      if (write.kind === "create") {
        if (this.docs.has(write.path)) {
          const error = new Error("ALREADY_EXISTS");
          error.status = 409;
          throw error;
        }
        this.docs.set(write.path, structuredClone(write.fields));
      } else if (write.kind === "update") {
        const current = this.docs.get(write.path) || {};
        this.docs.set(write.path, {
          ...structuredClone(current),
          ...structuredClone(write.fields),
        });
      } else if (write.kind === "delete") {
        this.docs.delete(write.path);
      }
    }
  }

  async runQuery(collectionPath, options = {}) {
    if (collectionPath === "follows") {
      let rows = [...this.docs.entries()]
        .filter(([path]) => /^follows\/[^/]+$/.test(path))
        .map(([path, data]) => ({ id: path.split("/")[1], path, data: structuredClone(data) }));
      for (const filter of options.filters || []) {
        if (filter.op === "==") {
          rows = rows.filter((row) => row.data?.[filter.field] === filter.value);
        } else if (filter.op === "in") {
          const allowed = new Set(Array.isArray(filter.value) ? filter.value : []);
          rows = rows.filter((row) => allowed.has(row.data?.[filter.field]));
        }
      }
      return rows.slice(0, Number(options.limit || 100));
    }

    const commentMatch = /^diaries\/([^/]+)\/comments$/.exec(collectionPath);
    if (commentMatch) {
      let rows = [...this.docs.entries()]
        .filter(([path]) =>
          path.startsWith(collectionPath + "/") &&
          path.split("/").length === collectionPath.split("/").length + 1
        )
        .map(([path, data]) => ({
          id: path.split("/").pop(),
          path,
          data: structuredClone(data),
        }));
      rows.sort((a, b) => {
        const ms = Number(b.data.createdAtMs || 0) - Number(a.data.createdAtMs || 0);
        if (ms !== 0) return ms;
        return b.id.localeCompare(a.id);
      });
      const cursorMs = options.startAfter?.[0]?.value;
      const cursorRef = options.startAfter?.[1]?.referencePath || "";
      if (cursorMs) {
        const cursorId = String(cursorRef).split("/").pop() || "";
        rows = rows.filter((row) => {
          const ms = Number(row.data.createdAtMs || 0);
          if (ms < Number(cursorMs)) return true;
          if (ms > Number(cursorMs)) return false;
          return row.id < cursorId;
        });
      }
      return rows.slice(0, Number(options.limit || 100));
    }

    const rootDiaries = collectionPath === "diaries";
    const userDiaryMatch = /^users\/([^/]+)\/diaries$/.exec(collectionPath);
    assert.equal(rootDiaries || userDiaryMatch != null, true, collectionPath);
    const filter = (options.filters || []).find((item) => item.field === "ownerUid");
    let rows = [...this.docs.entries()]
      .filter(([path]) => rootDiaries
        ? /^diaries\/[^/]+$/.test(path)
        : path.startsWith(collectionPath + "/") &&
          path.split("/").length === collectionPath.split("/").length + 1)
      .map(([path, data]) => ({
        id: path.split("/").pop(),
        path,
        data: structuredClone(data),
      }));
    if (filter) rows = rows.filter((row) => row.data.ownerUid === filter.value);
    rows.sort((a, b) => {
      const ms = Number(b.data.createdAtMs || 0) - Number(a.data.createdAtMs || 0);
      if (ms !== 0) return ms;
      return b.id.localeCompare(a.id);
    });
    const cursorMs = options.startAfter?.[0]?.value;
    const cursorRef = options.startAfter?.[1]?.referencePath || "";
    if (cursorMs) {
      const cursorId = String(cursorRef).split("/").pop() || "";
      rows = rows.filter((row) => {
        const ms = Number(row.data.createdAtMs || 0);
        if (ms < Number(cursorMs)) return true;
        if (ms > Number(cursorMs)) return false;
        return row.id < cursorId;
      });
    }
    return rows.slice(0, Number(options.limit || 100));
  }
}

function op(label) {
  return ("diary_" + label + "_0000000000000000000000").slice(0, 64);
}

function imageObject(id, uid = "user_a") {
  return [
    `storage_objects/${id}`,
    {
      objectId: id,
      scope: "diary_image",
      ownerUid: uid,
      targetId: uid,
      state: "active",
      publicUrl: `https://example.test/api/public-media/diary_image/${uid}/${id}.webp`,
      storageKey: `users/${uid}/diaries/${id}.webp`,
      mimeType: "image/webp",
      sizeBytes: 1200,
    },
  ];
}

function seedUser(uid = "user_a") {
  return {
    [`users/${uid}`]: {
      displayName: uid.toUpperCase(),
      publicId: "12345678",
      profileImageUrl: "",
      profileAvatarAsset: "",
    },
  };
}

test("diary text validates length and external links", () => {
  assert.equal(diaryText(" مرحبا بالعالم "), "مرحبا بالعالم");
  assert.throws(() => diaryText("x".repeat(501)), /diary_text_too_long/);
  assert.throws(() => diaryText("شوف https://example.com"), /external_links_not_allowed/);
  assert.throws(() => diaryText("example.com"), /external_links_not_allowed/);
});

test("diary image list is bounded, unique, and canonical", () => {
  const a = "a".repeat(32);
  const b = "b".repeat(32);
  assert.deepEqual(diaryImageIds([a, b]), [a, b]);
  assert.throws(() => diaryImageIds([a, b, "c".repeat(32)]), /invalid_diary_images/);
  assert.throws(() => diaryImageIds([a, a]), /duplicate_diary_image/);
  assert.throws(() => diaryImageIds(["bad"]), /invalid_diary_image/);
});

test("create rejects empty diary", async () => {
  const db = new FakeDb(seedUser());
  await assert.rejects(
    () => createDiary(db, "user_a", {
      text: "   ",
      imageObjectIds: [],
      idempotencyKey: op("empty"),
    }),
    /empty_diary/,
  );
});

test("create accepts image-only diary and snapshots author without per-card profile reads", async () => {
  const imageId = "a".repeat(32);
  const db = new FakeDb({
    ...seedUser(),
    [imageObject(imageId)[0]]: imageObject(imageId)[1],
  });
  const result = await createDiary(db, "user_a", {
    text: "",
    imageObjectIds: [imageId],
    commentsEnabled: true,
    idempotencyKey: op("image_only"),
  });
  assert.equal(result.ok, true);
  const diary = db.docs.get(`diaries/${result.diaryId}`);
  const mirror = db.docs.get(`users/user_a/diaries/${result.diaryId}`);
  assert.equal(diary.ownerUid, "user_a");
  assert.equal(mirror?.diaryId, result.diaryId);
  assert.equal(mirror?.ownerUid, "user_a");
  assert.equal(diary.ownerName, "USER_A");
  assert.equal(diary.images.length, 1);
  assert.equal(diary.likeCount, 0);
  assert.equal(diary.commentCount, 0);
  assert.equal(diary.viewCount, 0);
  assert.equal(db.docs.get(`diary_image_links/${imageId}`).state, "linked");
});

test("publishing claims an orphan upload and deletion re-queues its R2 object", async () => {
  const imageId = "9".repeat(32);
  const [objectPath, objectData] = imageObject(imageId);
  const db = new FakeDb({
    ...seedUser(),
    [objectPath]: objectData,
    [`storage_delete_queue/${imageId}`]: {
      objectId: imageId,
      storageKey: objectData.storageKey,
      ownerUid: "user_a",
      scope: "diary_image",
      targetId: "user_a",
      sizeBytes: objectData.sizeBytes,
      deleteAfter: new Date(Date.now() + 60_000),
      reason: "diary_orphan_timeout",
    },
  });

  const created = await createDiary(db, "user_a", {
    text: "مع صورة",
    imageObjectIds: [imageId],
    idempotencyKey: op("claim_orphan"),
  });

  assert.equal(db.docs.has(`storage_delete_queue/${imageId}`), false);
  assert.equal(
    db.docs.get(`diary_image_links/${imageId}`)?.state,
    "linked",
  );
  assert.equal(
    db.docs.get(`storage_objects/${imageId}`)?.linkedDiaryId,
    created.diaryId,
  );

  const deleted = await deleteDiary(db, "user_a", {
    diaryId: created.diaryId,
    idempotencyKey: op("delete_with_image"),
  });

  assert.equal(deleted.queuedImages, 1);
  assert.equal(
    db.docs.get(`diary_image_links/${imageId}`)?.state,
    "pending_cleanup",
  );
  assert.equal(
    db.docs.get(`storage_objects/${imageId}`)?.state,
    "pending_delete",
  );
  const queue = db.docs.get(`storage_delete_queue/${imageId}`);
  assert.equal(queue?.reason, "diary_deleted");
  assert.equal(queue?.storageKey, objectData.storageKey);
  assert.equal(queue?.scope, "diary_image");
});

test("create rejects diary image owned by another account", async () => {
  const imageId = "b".repeat(32);
  const db = new FakeDb({
    ...seedUser(),
    [imageObject(imageId, "user_b")[0]]: imageObject(imageId, "user_b")[1],
  });
  await assert.rejects(
    () => createDiary(db, "user_a", {
      text: "نص",
      imageObjectIds: [imageId],
      idempotencyKey: op("wrong_owner"),
    }),
    /invalid_diary_image/,
  );
});

test("same uploaded object cannot be linked to two diaries", async () => {
  const imageId = "c".repeat(32);
  const db = new FakeDb({
    ...seedUser(),
    [imageObject(imageId)[0]]: imageObject(imageId)[1],
  });
  await createDiary(db, "user_a", {
    text: "الأولى",
    imageObjectIds: [imageId],
    idempotencyKey: op("first_link"),
  });
  await assert.rejects(
    () => createDiary(db, "user_a", {
      text: "الثانية",
      imageObjectIds: [imageId],
      idempotencyKey: op("second_link"),
    }),
    /diary_image_already_linked/,
  );
});

test("create operation is idempotent", async () => {
  const db = new FakeDb(seedUser());
  const body = {
    text: "يوميتي",
    imageObjectIds: [],
    idempotencyKey: op("idempotent"),
  };
  const first = await createDiary(db, "user_a", body);
  const second = await createDiary(db, "user_a", body);
  assert.equal(second.code, "duplicate");
  assert.equal(second.diaryId, first.diaryId);
});

test("comment text enforces 200 chars and blocks links", () => {
  assert.equal(diaryCommentText(" تعليق بسيط "), "تعليق بسيط");
  assert.throws(() => diaryCommentText(""), /empty_comment/);
  assert.throws(() => diaryCommentText("x".repeat(201)), /comment_text_too_long/);
  assert.throws(() => diaryCommentText("example.com"), /external_links_not_allowed/);
});

test("comments create/list/delete stay bounded and mirror counters", async () => {
  const db = new FakeDb({
    ...seedUser(),
    ...seedUser("user_b"),
    ...seedUser("user_c"),
  });
  const created = await createDiary(db, "user_a", {
    text: "يومية للتعليقات",
    imageObjectIds: [],
    idempotencyKey: op("comment_diary"),
  });

  const comment = await createComment(db, "user_b", {
    diaryId: created.diaryId,
    text: "أول تعليق",
    idempotencyKey: op("comment_create"),
  });
  assert.equal(comment.commentCount, 1);
  assert.equal(comment.comment.authorUid, "user_b");
  assert.equal(db.docs.get(`diaries/${created.diaryId}`)?.commentCount, 1);
  assert.equal(
    db.docs.get(`users/user_a/diaries/${created.diaryId}`)?.commentCount,
    1,
  );

  const duplicate = await createComment(db, "user_b", {
    diaryId: created.diaryId,
    text: "أول تعليق",
    idempotencyKey: op("comment_create"),
  });
  assert.equal(duplicate.code, "duplicate");
  assert.equal(db.docs.get(`diaries/${created.diaryId}`)?.commentCount, 1);

  const listed = await listComments(db, {
    diaryId: created.diaryId,
    limit: 10,
  });
  assert.equal(listed.items.length, 1);
  assert.equal(listed.items[0].commentId, comment.commentId);

  await assert.rejects(
    () => deleteComment(db, "user_c", {
      diaryId: created.diaryId,
      commentId: comment.commentId,
      idempotencyKey: op("comment_wrong_delete"),
    }),
    /forbidden/,
  );

  const deletedByOwner = await deleteComment(db, "user_a", {
    diaryId: created.diaryId,
    commentId: comment.commentId,
    idempotencyKey: op("comment_owner_delete"),
  });
  assert.equal(deletedByOwner.commentCount, 0);
  assert.equal(
    db.docs.has(`diaries/${created.diaryId}/comments/${comment.commentId}`),
    false,
  );
  assert.equal(db.docs.get(`diaries/${created.diaryId}`)?.commentCount, 0);
});

test("comments disabled blocks new comments without deleting existing data", async () => {
  const db = new FakeDb({ ...seedUser(), ...seedUser("user_b") });
  const created = await createDiary(db, "user_a", {
    text: "تعليقات مغلقة",
    imageObjectIds: [],
    commentsEnabled: false,
    idempotencyKey: op("comments_disabled_diary"),
  });

  await assert.rejects(
    () => createComment(db, "user_b", {
      diaryId: created.diaryId,
      text: "لن يمر",
      idempotencyKey: op("comments_disabled_create"),
    }),
    /comments_disabled/,
  );
});

test("comment list cursor is deterministic without a composite index", async () => {
  const diaryId = "diary_test";
  const db = new FakeDb({
    [`diaries/${diaryId}`]: {
      diaryId,
      ownerUid: "user_a",
      createdAtMs: 1,
      commentsEnabled: true,
    },
    [`diaries/${diaryId}/comments/c3`]: {
      commentId: "c3", diaryId, authorUid: "user_a", text: "3", createdAtMs: 300,
    },
    [`diaries/${diaryId}/comments/c2`]: {
      commentId: "c2", diaryId, authorUid: "user_a", text: "2", createdAtMs: 300,
    },
    [`diaries/${diaryId}/comments/c1`]: {
      commentId: "c1", diaryId, authorUid: "user_a", text: "1", createdAtMs: 200,
    },
  });

  const first = await listComments(db, { diaryId, limit: 1 });
  assert.equal(first.items[0].commentId, "c3");
  assert.equal(first.nextCursor, "300|c3");

  const second = await listComments(db, {
    diaryId,
    limit: 1,
    cursor: first.nextCursor,
  });
  assert.equal(second.items[0].commentId, "c2");
});

test("like toggle is one-per-user, reversible, mirrored, and idempotent", async () => {
  const db = new FakeDb({ ...seedUser(), ...seedUser("user_b") });
  const created = await createDiary(db, "user_a", {
    text: "اختبار إعجاب",
    imageObjectIds: [],
    idempotencyKey: op("like_create"),
  });

  const first = await toggleLike(db, "user_b", {
    diaryId: created.diaryId,
    idempotencyKey: op("like_on"),
  });
  assert.equal(first.liked, true);
  assert.equal(first.likeCount, 1);
  assert.equal(db.docs.get(`diaries/${created.diaryId}`)?.likeCount, 1);
  assert.equal(
    db.docs.get(`users/user_a/diaries/${created.diaryId}`)?.likeCount,
    1,
  );

  const duplicate = await toggleLike(db, "user_b", {
    diaryId: created.diaryId,
    idempotencyKey: op("like_on"),
  });
  assert.equal(duplicate.code, "duplicate");
  assert.equal(duplicate.liked, true);
  assert.equal(db.docs.get(`diaries/${created.diaryId}`)?.likeCount, 1);

  const second = await toggleLike(db, "user_b", {
    diaryId: created.diaryId,
    idempotencyKey: op("like_off"),
  });
  assert.equal(second.liked, false);
  assert.equal(second.likeCount, 0);
  assert.equal(db.docs.get(`diaries/${created.diaryId}`)?.likeCount, 0);
  assert.equal(
    db.docs.get(`users/user_a/diaries/${created.diaryId}`)?.likeCount,
    0,
  );
});

test("like idempotency key cannot be reused for another diary", async () => {
  const db = new FakeDb({ ...seedUser(), ...seedUser("user_b") });
  const first = await createDiary(db, "user_a", {
    text: "الأولى",
    imageObjectIds: [],
    idempotencyKey: op("like_conflict_create1"),
  });
  const second = await createDiary(db, "user_a", {
    text: "الثانية",
    imageObjectIds: [],
    idempotencyKey: op("like_conflict_create2"),
  });
  const key = op("like_conflict");
  await toggleLike(db, "user_b", {
    diaryId: first.diaryId,
    idempotencyKey: key,
  });
  await assert.rejects(
    () => toggleLike(db, "user_b", {
      diaryId: second.diaryId,
      idempotencyKey: key,
    }),
    /idempotency_conflict/,
  );
});

test("owner can toggle comments and delete; other users cannot", async () => {
  const db = new FakeDb({ ...seedUser(), ...seedUser("user_b") });
  const created = await createDiary(db, "user_a", {
    text: "اختبار",
    imageObjectIds: [],
    idempotencyKey: op("lifecycle_create"),
  });

  const toggled = await setCommentsEnabled(db, "user_a", {
    diaryId: created.diaryId,
    enabled: false,
    idempotencyKey: op("comments_off"),
  });
  assert.equal(toggled.commentsEnabled, false);
  assert.equal(db.docs.get(`diaries/${created.diaryId}`).commentsEnabled, false);
  assert.equal(
    db.docs.get(`users/user_a/diaries/${created.diaryId}`)?.commentsEnabled,
    false,
  );

  await assert.rejects(
    () => deleteDiary(db, "user_b", {
      diaryId: created.diaryId,
      idempotencyKey: op("wrong_delete"),
    }),
    /forbidden/,
  );

  const deleted = await deleteDiary(db, "user_a", {
    diaryId: created.diaryId,
    idempotencyKey: op("right_delete"),
  });
  assert.equal(deleted.ok, true);
  assert.equal(db.docs.has(`diaries/${created.diaryId}`), false);
  assert.equal(
    db.docs.has(`users/user_a/diaries/${created.diaryId}`),
    false,
  );
});

test("following feed filters a bounded latest window without per-user scans", async () => {
  const db = new FakeDb({
    "diaries/d4": { ownerUid: "user_b", text: "b newest", createdAtMs: 400 },
    "diaries/d3": { ownerUid: "user_c", text: "c", createdAtMs: 300 },
    "diaries/d2": { ownerUid: "user_b", text: "b older", createdAtMs: 200 },
    "diaries/d1": { ownerUid: "user_d", text: "d", createdAtMs: 100 },
    "follows/user_a__user_b": {
      followerUid: "user_a",
      followingUid: "user_b",
    },
  });

  const first = await listFollowing(db, "user_a", { limit: 2 });
  assert.deepEqual(first.items.map((item) => item.diaryId), ["d4"]);
  assert.equal(first.hasMore, true);
  assert.equal(first.nextCursor, "300|d3");

  const second = await listFollowing(db, "user_a", {
    limit: 2,
    cursor: first.nextCursor,
  });
  assert.deepEqual(second.items.map((item) => item.diaryId), ["d2"]);
  assert.equal(second.hasMore, false);
});

test("latest and user feeds stay bounded and expose cursors", async () => {
  const seed = {
    "diaries/d1": { diaryId: "d1", ownerUid: "user_a", text: "1", createdAtMs: 300 },
    "diaries/d2": { diaryId: "d2", ownerUid: "user_b", text: "2", createdAtMs: 200 },
    "diaries/d3": { diaryId: "d3", ownerUid: "user_a", text: "3", createdAtMs: 100 },
    "users/user_a/diaries/d1": { diaryId: "d1", ownerUid: "user_a", text: "1", createdAtMs: 300 },
    "users/user_a/diaries/d3": { diaryId: "d3", ownerUid: "user_a", text: "3", createdAtMs: 100 },
  };
  const db = new FakeDb(seed);
  const latest = await listLatest(db, { limit: 2 });
  assert.equal(latest.items.length, 2);
  assert.equal(latest.hasMore, true);
  assert.equal(latest.nextCursor, "200|d2");

  const user = await listUser(db, { userId: "user_a", limit: 10 });
  assert.deepEqual(user.items.map((item) => item.diaryId), ["d1", "d3"]);
  assert.equal(user.hasMore, false);
});


test("reusing an idempotency key with different create content is rejected", async () => {
  const db = new FakeDb(seedUser());
  const key = op("conflict");
  await createDiary(db, "user_a", {
    text: "الأولى",
    imageObjectIds: [],
    idempotencyKey: key,
  });
  await assert.rejects(
    () => createDiary(db, "user_a", {
      text: "الثانية",
      imageObjectIds: [],
      idempotencyKey: key,
    }),
    /idempotency_conflict/,
  );
});

test("diary core stays bounded and Firestore access is server-authoritative", () => {
  const source = readFileSync(
    new URL("../../cloudflare-worker/src/diaries.js", import.meta.url),
    "utf8",
  );
  const rules = readFileSync(
    new URL("../../firestore.rules", import.meta.url),
    "utf8",
  );
  assert.equal(source.includes("MAX_PAGE_SIZE = 30"), true);
  assert.equal(source.includes(".list("), false);
  assert.equal(source.includes('db.runQuery("diaries"'), true);
  for (const collection of [
    "diaries",
    "diary_operations",
    "diary_image_links",
    "diary_audit_logs",
    "diary_comments",
    "diary_likes",
    "diary_view_keys",
  ]) {
    assert.equal(rules.includes(`match /${collection}/{`), true, collection);
  }
});

test("user feed cursor includes diary id and paginates correctly", async () => {
  const db = new FakeDb({
    "users/user_a/diaries/u3": { diaryId: "u3", ownerUid: "user_a", text: "3", createdAtMs: 300 },
    "users/user_a/diaries/u2": { diaryId: "u2", ownerUid: "user_a", text: "2", createdAtMs: 200 },
    "users/user_a/diaries/u1": { diaryId: "u1", ownerUid: "user_a", text: "1", createdAtMs: 100 },
  });

  const first = await listUser(db, { userId: "user_a", limit: 1 });
  assert.equal(first.items[0].diaryId, "u3");
  assert.equal(first.nextCursor, "300|u3");
  assert.equal(first.hasMore, true);

  const second = await listUser(db, {
    userId: "user_a",
    limit: 1,
    cursor: first.nextCursor,
  });
  assert.equal(second.items[0].diaryId, "u2");
});

test("same millisecond pagination is deterministic by diary id", async () => {
  const db = new FakeDb({
    "diaries/d3": { ownerUid: "user_a", text: "3", createdAtMs: 300 },
    "diaries/d2": { ownerUid: "user_a", text: "2", createdAtMs: 300 },
    "diaries/d1": { ownerUid: "user_a", text: "1", createdAtMs: 200 },
  });

  const first = await listLatest(db, { limit: 1 });
  assert.equal(first.items.length, 1);
  assert.equal(first.items[0].diaryId, "d3");
  assert.equal(first.nextCursor, "300|d3");

  const second = await listLatest(db, { limit: 1, cursor: first.nextCursor });
  assert.equal(second.items.length, 1);
  assert.equal(second.items[0].diaryId, "d2");
});

test("create idempotency key rejects a different payload", async () => {
  const db = new FakeDb(seedUser());
  const idempotencyKey = op("payload_conflict");
  await createDiary(db, "user_a", {
    text: "الأولى",
    imageObjectIds: [],
    idempotencyKey,
  });
  await assert.rejects(
    () => createDiary(db, "user_a", {
      text: "مختلفة",
      imageObjectIds: [],
      idempotencyKey,
    }),
    /idempotency_conflict/,
  );
});

test("diary route and Firestore collections stay server-authoritative", () => {
  const source = readFileSync(
    new URL("../../cloudflare-worker/src/diaries.js", import.meta.url),
    "utf8",
  );
  const worker = readFileSync(
    new URL("../../cloudflare-worker/src/index.js", import.meta.url),
    "utf8",
  );
  const rules = readFileSync(
    new URL("../../firestore.rules", import.meta.url),
    "utf8",
  );

  assert.equal(worker.includes('"/api/diaries"'), true);
  assert.equal(source.includes("MAX_IMAGES = 2"), true);
  assert.equal(source.includes("MAX_TEXT_LENGTH = 500"), true);
  assert.equal(source.includes('field: "__name__"'), true);
  for (const collection of [
    "diaries",
    "diary_operations",
    "diary_image_links",
    "diary_audit_logs",
    "diary_comments",
    "diary_likes",
    "diary_view_keys",
  ]) {
    assert.equal(rules.includes(`match /${collection}/{`), true, collection);
  }
});

test("Firestore deployment keeps diaries indexless in production", () => {
  const workflow = readFileSync(
    new URL("../../.github/workflows/deploy-firestore-rules.yml", import.meta.url),
    "utf8",
  );
  const firebaseConfig = JSON.parse(
    readFileSync(new URL("../../firebase.json", import.meta.url), "utf8"),
  );
  const indexConfig = JSON.parse(
    readFileSync(new URL("../../firestore.indexes.json", import.meta.url), "utf8"),
  );
  const source = readFileSync(
    new URL("../../cloudflare-worker/src/diaries.js", import.meta.url),
    "utf8",
  );
  const rules = readFileSync(
    new URL("../../firestore.rules", import.meta.url),
    "utf8",
  );

  assert.equal(firebaseConfig?.firestore?.indexes, "firestore.indexes.json");
  assert.deepEqual(indexConfig.indexes || [], []);
  assert.equal(source.includes('users/${userId}/diaries'), true);
  assert.equal(source.includes('users/${uid}/diaries/${diaryId}'), true);
  assert.equal(
    rules.includes("match /users/{userId}/diaries/{diaryId}"),
    true,
  );
  assert.equal(workflow.includes("firebase-tools@"), false);
  assert.equal(workflow.includes("serviceusage.googleapis.com"), false);
  assert.equal(workflow.includes("pageSize', '200'"), false);
});

