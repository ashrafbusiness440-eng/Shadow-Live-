import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import { approvePrivateDiaryImage } from "../../cloudflare-worker/src/image-moderation-diary.js";

const id = "a".repeat(32);
const key = "private_diary_review_001";
const pub = "users/u1/diaries/" + id + ".png";
const stage = "moderation-staging/" + pub;

class DB {
  constructor() { this.docs = new Map(); this.writes = []; }
  async beginTransaction() { return "tx"; }
  async rollback() {}
  async get(path) {
    return { exists: this.docs.has(path), data: this.docs.get(path) || null };
  }
  writeCreate(path, fields) { return { kind: "create", path, fields }; }
  writeUpdate(path, fields) { return { kind: "update", path, fields }; }
  async commit(_tx, writes) {
    for (const w of writes) {
      if (w.kind === "create" && this.docs.has(w.path)) throw Error("exists");
      this.docs.set(w.path, { ...(this.docs.get(w.path) || {}), ...w.fields });
      this.writes.push(w);
    }
  }
}
function fixture(state = "needs_review") {
  const db = new DB();
  db.docs.set("users/u1", { displayName: "Test" });
  db.docs.set("storage_objects/" + id, {
    objectId: id, ownerUid: "u1", targetId: "u1",
    scope: "diary_image", state, mimeType: "image/png",
    sizeBytes: 4, etag: "reviewed-etag", storageKey: stage,
    publicStorageKey: pub,
    moderation: { status: state, reviewStatus: state },
  });
  const counters = { head: 0, get: 0, put: 0, delete: 0 };
  const bucket = {
    head: async k => {
      counters.head++;
      assert.equal(k, stage);
      return { etag: "reviewed-etag", size: 4 };
    },
    get: async () => { counters.get++; throw Error("not allowed"); },
    put: async () => { counters.put++; throw Error("not allowed"); },
    delete: async () => { counters.delete++; throw Error("not allowed"); },
  };
  return { db, bucket, counters };
}
test("U6-L4/A approves diary image privately without copying public bytes", async () => {
  const { db, bucket, counters } = fixture();
  const result = await approvePrivateDiaryImage(db, bucket, "owner1", {
    objectId: id, idempotencyKey: key, reason: "محتوى الصورة مناسب للنشر",
  });
  assert.equal(result.status, "approved_pending_diary_link");
  const doc = db.docs.get("storage_objects/" + id);
  assert.equal(doc.state, "approved_pending_diary_link");
  assert.equal(doc.storageKey, stage);
  assert.equal(doc.publicUrl, undefined);
  assert.equal(doc.moderation.reviewStatus, "approved_pending_diary_link");
  assert.equal(db.docs.get("notifications/image_diary_review_" + key).userId, "u1");
  assert.deepEqual(counters, { head: 1, get: 0, put: 0, delete: 0 });
  const written = db.writes.length;
  const replay = await approvePrivateDiaryImage(db, bucket, "owner1", {
    objectId: id, idempotencyKey: key, reason: "محتوى الصورة مناسب للنشر",
  });
  assert.equal(replay.duplicate, true);
  assert.equal(db.writes.length, written);
});
test("U6-L4/A rejects tampered R2 ETag and never issues a public write", async () => {
  const { db, bucket, counters } = fixture();
  bucket.head = async () => ({ etag: "tampered-etag", size: 4 });
  await assert.rejects(() => approvePrivateDiaryImage(db, bucket, "owner1", {
    objectId: id, idempotencyKey: key, reason: "مراجعة صحيحة",
  }), /image_integrity_conflict/);
  assert.equal(db.docs.get("storage_objects/" + id).state, "needs_review");
  assert.equal(counters.put, 0);
});
test("U6-L4/A requires owner identity, safe storage key and correct scope", async () => {
  for (const update of [
    { ownerUid: "another" }, { scope: "chat_image" }, { state: "blocked" },
    { publicStorageKey: "users/another/diaries/" + id + ".png" },
    { evidenceHold: true },
  ]) {
    const { db, bucket } = fixture();
    db.docs.set("storage_objects/" + id, {
      ...db.docs.get("storage_objects/" + id), ...update,
    });
    await assert.rejects(() => approvePrivateDiaryImage(db, bucket, "owner1", {
      objectId: id, idempotencyKey: key, reason: "مراجعة صحيحة",
    }));
  }
});
test("U6-L4/A appeal approval finalizes receipt but still keeps private bytes", async () => {
  const { db, bucket, counters } = fixture("appeal_pending");
  db.docs.set("image_moderation_appeals/" + id, {
    ownerUid: "u1", status: "under_review",
  });
  const result = await approvePrivateDiaryImage(db, bucket, "owner1", {
    objectId: id, idempotencyKey: key, reason: "تم قبول الاعتراض بشريًا",
  });
  assert.equal(result.status, "approved_pending_diary_link");
  assert.equal(db.docs.get("image_moderation_appeals/" + id).status, "approved");
  assert.equal(counters.put, 0);
});
test("U6-L4/A control remains owner+recent-auth; no automatic gate activation", () => {
  const control = fs.readFileSync(
    "cloudflare-worker/src/image-moderation-control.js", "utf8");
  const ui = fs.readFileSync(
    "lib/admin/image_moderation_settings_page.dart", "utf8");
  assert.match(control, /recent_auth_required/);
  assert.match(control, /approve_diary_private/);
  assert.match(control, /IMAGE_MODERATION_PUBLICATION_GATE_READY = false/);
  assert.match(ui, /الموافقة دون نشر/);
});
