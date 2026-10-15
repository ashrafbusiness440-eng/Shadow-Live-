import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import {
  approvePrivateDiaryImage, prepareApprovedDiaryPublication,
  moderatedDiaryProtectedKey, claimApprovedDiaryImage,
  releaseApprovedDiaryClaim,
} from "../../cloudflare-worker/src/image-moderation-diary.js";
import {
  publicMediaStorageKey, approvedDiaryMediaLinked,
} from "../../cloudflare-worker/src/public-media.js";
import {
  cleanupQueuedStorageObject, claimDueApprovedDiaryCleanup,
} from "../../cloudflare-worker/src/user-storage.js";

const id = "a".repeat(32);
const key = "private_diary_review_001";
const operationKey = "diary_author_link_operation_001";
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
  writeDelete(path) { return { kind: "delete", path }; }
  async commit(_tx, writes) {
    for (const w of writes) {
      if (w.kind === "create" && this.docs.has(w.path)) throw Error("exists");
      if (w.kind === "delete") {
        this.docs.delete(w.path);
        this.writes.push(w);
        continue;
      }
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

test("U6-L4/A protected copy is never accessible until linked and active", async () => {
  const { db } = fixture("approved_pending_diary_link");
  const doc = db.docs.get("storage_objects/" + id);
  doc.moderation.status = "approved";
  doc.state = "diary_linking";
  doc.diaryLinkOperationKey = operationKey;
  const stored = [];
  const bucket = {
    get: async k => {
      assert.equal(k, stage);
      return { etag: "reviewed-etag", size: 4,
        body: new Uint8Array([1, 2, 3, 4]) };
    },
    put: async (...args) => { stored.push(args); },
  };
  const prepared = await prepareApprovedDiaryPublication(bucket, doc, id, operationKey);
  assert.equal(prepared.protectedKey, "moderated-diary/" + pub);
  assert.equal(moderatedDiaryProtectedKey(pub), prepared.protectedKey);
  assert.equal(publicMediaStorageKey({
    scope: "moderated_diary_image", targetId: "u1", filename: id + ".png",
  }), prepared.protectedKey);
  assert.equal(stored.length, 1);
  assert.equal(stored[0][0], prepared.protectedKey);
  assert.equal(await approvedDiaryMediaLinked(
    db, id, "u1", prepared.protectedKey), false);
  db.docs.set("diary_image_links/" + id, {
    ownerUid: "u1", state: "linked", diaryId: "diary_1",
  });
  doc.state = "active";
  doc.storageKey = prepared.protectedKey;
  doc.linkedDiaryId = "diary_1";
  assert.equal(await approvedDiaryMediaLinked(
    db, id, "u1", prepared.protectedKey), true);
  doc.linkedDiaryId = "another";
  assert.equal(await approvedDiaryMediaLinked(
    db, id, "u1", prepared.protectedKey), false);
});
test("U6-L4/A wrong reviewed fingerprint or hold cannot publish image", async () => {
  const { db } = fixture("approved_pending_diary_link");
  const doc = db.docs.get("storage_objects/" + id);
  doc.moderation.status = "approved";
  doc.state = "diary_linking";
  doc.diaryLinkOperationKey = operationKey;
  const calls = [];
  const bucket = {
    get: async () => ({ etag: "different", size: 4,
      body: new Uint8Array([1, 2, 3, 4]) }),
    put: async (...args) => calls.push(args),
  };
  await assert.rejects(() =>
    prepareApprovedDiaryPublication(bucket, doc, id, operationKey));
  doc.evidenceHold = true;
  await assert.rejects(() =>
    prepareApprovedDiaryPublication(bucket, doc, id, operationKey));
  assert.equal(calls.length, 0);
});
test("U6-L4/A seven-day orphan cleanup removes BOTH private R2 copies", async () => {
  const { db } = fixture("approved_pending_diary_link");
  const deleted = [];
  const queueItem = { id, data: {
    objectId: id, scope: "diary_image", ownerUid: "u1",
    targetId: "u1", storageKey: stage, sizeBytes: 4,
    reason: "diary_approved_unlinked",
    deleteAfter: new Date(Date.now() - 1000),
  }};
  db.docs.set("storage_delete_queue/" + id, queueItem.data);
  const result = await cleanupQueuedStorageObject(db, {
    delete: async k => deleted.push(k),
  }, queueItem, Date.now());
  assert.equal(result.status, "deleted");
  assert.deepEqual(deleted, ["moderated-diary/" + pub, stage]);
  assert.equal(db.docs.has("storage_objects/" + id), false);
});
test("U6-L4/A active author link claim blocks orphan deletion until released", async()=>{
  const {db}=fixture("approved_pending_diary_link");
  const doc=db.docs.get("storage_objects/"+id);
  doc.moderation.status="approved";
  const item={id,data:{
    objectId:id,scope:"diary_image",ownerUid:"u1",
    targetId:"u1",storageKey:stage,sizeBytes:4,
    reason:"diary_approved_unlinked",
    deleteAfter:new Date(Date.now()-1000),
  }};
  db.docs.set("storage_delete_queue/"+id,item.data);
  const now=new Date();
  const claim=await claimApprovedDiaryImage(db,"u1",id,operationKey,now);
  assert.equal(claim.state,"diary_linking");
  const deletions=[];
  const bucket={delete:async key=>deletions.push(key)};
  const blocked=await cleanupQueuedStorageObject(db,bucket,item,now.getTime());
  assert.equal(blocked.status,"deferred");
  assert.deepEqual(deletions,[]);
  assert.equal(await releaseApprovedDiaryClaim(db,"u1",id,operationKey),true);
  const completed=await cleanupQueuedStorageObject(db,bucket,item,now.getTime());
  assert.equal(completed.status,"deleted");
  assert.deepEqual(deletions,["moderated-diary/"+pub,stage]);
});
test("U6-L4/A expired author claim may be reclaimed by bounded sweeper",async()=>{
  const {db}=fixture("approved_pending_diary_link");
  const doc=db.docs.get("storage_objects/"+id);
  doc.moderation.status="approved";
  const item={id,data:{
    objectId:id,scope:"diary_image",ownerUid:"u1",
    targetId:"u1",storageKey:stage,sizeBytes:4,
    reason:"diary_approved_unlinked",
    deleteAfter:new Date(Date.now()-1000),
  }};
  db.docs.set("storage_delete_queue/"+id,item.data);
  const before=new Date(Date.now()-20*60*1000);
  await claimApprovedDiaryImage(db,"u1",id,operationKey,before);
  const deletions=[];
  const status=await cleanupQueuedStorageObject(db,
    {delete:async key=>deletions.push(key)},item,Date.now());
  assert.equal(status.status,"deleted");
  assert.deepEqual(deletions,["moderated-diary/"+pub,stage]);
});
test("U6-L4/A cleanup receipt only deletes stage, not active published image",async()=>{
  const {db}=fixture("active");
  db.docs.set("storage_objects/"+id,{
    ...db.docs.get("storage_objects/"+id),
    state:"active",
    storageKey:"moderated-diary/"+pub,
    linkedDiaryId:"diary_123",
    moderation:{status:"approved",reviewStatus:"approved"},
  });
  db.docs.set("diary_image_links/"+id,{
    objectId:id,ownerUid:"u1",diaryId:"diary_123",state:"linked",
  });
  const receiptId="diary_stage_"+id;
  const receipt={objectId:id,storageKey:stage,ownerUid:"u1",
    targetId:"u1",mimeType:"image/png",scope:"diary_stage_only",
    reason:"diary_published_stage_cleanup"};
  db.docs.set("storage_delete_queue/"+receiptId,receipt);
  const removed=[];
  const result=await cleanupQueuedStorageObject(db,{
    delete:async key=>removed.push(key),
  },{id:receiptId,data:receipt},Date.now());
  assert.equal(result.status,"deleted");
  assert.deepEqual(removed,[stage]);
  assert.equal(db.docs.has("storage_delete_queue/"+receiptId),false);
  assert.equal(db.docs.get("storage_objects/"+id).state,"active");
  assert.equal(db.docs.get("storage_objects/"+id).storageKey,
    "moderated-diary/"+pub);
  assert.equal(db.docs.get("diary_image_links/"+id).state,"linked");
});
test("U6-L4/A stage cleanup rejects forged R2 storage keys",async()=>{
  const {db}=fixture("active");
  const receiptId="diary_stage_"+id;
  const item={id:receiptId,data:{
    objectId:id,storageKey:"moderation-staging/other/forged.png",
    ownerUid:"u1",targetId:"u1",mimeType:"image/png",
    scope:"diary_stage_only",reason:"diary_published_stage_cleanup",
  }};
  const deletes=[];
  await assert.rejects(()=>cleanupQueuedStorageObject(db,{
    delete:async key=>deletes.push(key),
  },item,Date.now()),/invalid_diary_stage_cleanup/);
  assert.deepEqual(deletes,[]);
});
test("U6-L4/A author diary post cannot link an unapproved staged image", () => {
  const code = fs.readFileSync("cloudflare-worker/src/diaries.js", "utf8");
  assert.match(code, /approved_pending_diary_link/);
  assert.match(code, /prepareApprovedDiaryPublication/);
  assert.match(code, /linkedDiaryId: diaryId/);
  assert.match(code, /publicMediaUrl/);
  const media = fs.readFileSync("cloudflare-worker/src/public-media.js", "utf8");
  assert.match(media, /scope === "moderated_diary_image"/);
  assert.match(media, /Cache-Control", "no-store"/);
});
