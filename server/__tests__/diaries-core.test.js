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
  listLatest,
  listUser,
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
    assert.equal(collectionPath, "diaries");
    const filter = (options.filters || []).find((item) => item.field === "ownerUid");
    let rows = [...this.docs.entries()]
      .filter(([path]) => /^diaries\/[^/]+$/.test(path))
      .map(([path, data]) => ({ id: path.split("/")[1], path, data: structuredClone(data) }));
    if (filter) rows = rows.filter((row) => row.data.ownerUid === filter.value);
    rows.sort((a, b) => Number(b.data.createdAtMs || 0) - Number(a.data.createdAtMs || 0));
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
  assert.equal(diary.ownerUid, "user_a");
  assert.equal(diary.ownerName, "USER_A");
  assert.equal(diary.images.length, 1);
  assert.equal(diary.likeCount, 0);
  assert.equal(diary.commentCount, 0);
  assert.equal(diary.viewCount, 0);
  assert.equal(db.docs.get(`diary_image_links/${imageId}`).state, "linked");
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
});

test("latest and user feeds stay bounded and expose cursors", async () => {
  const seed = {
    "diaries/d1": { ownerUid: "user_a", text: "1", createdAtMs: 300 },
    "diaries/d2": { ownerUid: "user_b", text: "2", createdAtMs: 200 },
    "diaries/d3": { ownerUid: "user_a", text: "3", createdAtMs: 100 },
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
    "diaries/u3": { ownerUid: "user_a", text: "3", createdAtMs: 300 },
    "diaries/u2": { ownerUid: "user_a", text: "2", createdAtMs: 200 },
    "diaries/u1": { ownerUid: "user_a", text: "1", createdAtMs: 100 },
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

test("Firestore deployment keeps diary composite indexes live", () => {
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

  assert.equal(firebaseConfig?.firestore?.indexes, "firestore.indexes.json");
  assert.equal(workflow.includes("'firestore.indexes.json'"), true);
  assert.equal(workflow.includes("--only firestore:indexes"), true);
  assert.equal(
    (indexConfig.indexes || []).some((index) =>
      index.collectionGroup === "diaries" &&
      Array.isArray(index.fields) &&
      index.fields.some((field) => field.fieldPath === "ownerUid") &&
      index.fields.some((field) => field.fieldPath === "createdAtMs")
    ),
    true,
  );
});

