import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import {
  moderatedStagingKey, uploadModerationSnapshot,
  reserveModerationAttempt, recordModerationOutcome,
  animatedImageNeedsReview,
  classifyModeratedUpload, publishModeratedUpload,
} from "../../cloudflare-worker/src/image-moderation-gate.js";

class Db {
  constructor() { this.docs = new Map(); this.writes = []; }
  async beginTransaction() { return "test-transaction"; }
  async rollback() {}
  async get(path) { return { exists: this.docs.has(path),
    data: this.docs.get(path) || null }; }
  writeCreate(path, fields) { return { path, fields, op: "create" }; }
  writeUpdate(path, fields) { return { path, fields, op: "update" }; }
  async commit(_tx, writes) {
    for (const write of writes) {
      if (write.op === "create" && this.docs.has(write.path))
        throw Error("already_exists");
      this.docs.set(write.path,
        { ...(this.docs.get(write.path) || {}), ...write.fields });
      this.writes.push(write);
    }
  }
}
const policy = {
  enabled: true, scope: "public", provider: "cloudflare_vision",
  mode: "free", dailyLimit: 1, version: 3,
};

test("U6-L2 mode remains opt-in and only eligible new scopes use staging", async () => {
  const db = new Db();
  assert.equal(await uploadModerationSnapshot(db, "profile_image"), null);
  db.docs.set("system_config/image_moderation", policy);
  const selected = await uploadModerationSnapshot(db, "profile_image");
  assert.equal(selected.enabled, true);
  assert.equal(selected.version, 3);
  assert.equal(await uploadModerationSnapshot(db, "chat_image"), null);
  const key = "users/one/profile/1234.jpg";
  assert.equal(moderatedStagingKey(key), "moderation-staging/" + key);
  assert.throws(() => moderatedStagingKey("moderation-staging/x"));
});

test("U6-L2 daily free cap is transactional and replay does not charge twice", async () => {
  const db = new Db();
  const now = new Date("2026-10-15T01:00:00Z");
  assert.equal((await reserveModerationAttempt(db,"a".repeat(32),policy,now))
    .reserved,true);
  assert.equal((await reserveModerationAttempt(db,"a".repeat(32),policy,now))
    .reason,"already_reserved");
  assert.equal((await reserveModerationAttempt(db,"b".repeat(32),policy,now))
    .reason,"daily_quota_reached");
  assert.equal(db.docs.get("image_moderation_usage/20261015_cloudflare_vision")
    .attempted,1);
});

test("U6-L2 per-image outcomes count once without fabricating external billing", async () => {
  const db = new Db();
  const when = new Date("2026-10-15T01:00:00Z");
  const id = "e".repeat(32);
  assert.equal(await recordModerationOutcome(db,id,policy,
    {status:"needs_review", reason:"provider_unavailable"},when),true);
  assert.equal(await recordModerationOutcome(db,id,policy,
    {status:"approved", reason:"retry"},when),false);
  const usage=db.docs.get("image_moderation_usage/20261015_cloudflare_vision");
  assert.equal(usage.needsReview,1);
  assert.equal(usage.approved,undefined);
  assert.equal(usage.attempted,0);
});

test("U6-L2 unsupported motion cannot silently clear one frame", () => {
  assert.equal(animatedImageNeedsReview(Uint8Array.from([1,2,3]),"image/gif"),true);
  const webp = new Uint8Array(32);
  webp.set(Buffer.from("RIFF"),0);
  webp.set(Buffer.from("WEBP"),8);
  webp.set(Buffer.from("VP8X"),12);
  webp[20] = 0x02;
  assert.equal(animatedImageNeedsReview(webp,"image/webp"),true);
  webp[20] = 0;
  assert.equal(animatedImageNeedsReview(webp,"image/webp"),false);
  assert.equal(animatedImageNeedsReview(Buffer.from("invalid"),"image/webp"),true);
  const png = new Uint8Array(32);
  png.set(Buffer.from("acTL"),12);
  assert.equal(animatedImageNeedsReview(png,"image/png"),true);
});

test("U6-L2 quota exhaustion and unavailable provider stay pending", async () => {
  const db = new Db();
  const bytes = Buffer.from([0xff,0xd8,0xff,0xd9]);
  const bucket = { get: async () => ({
    size: bytes.length, arrayBuffer: async () => bytes,
  }) };
  const ticket = { moderationPolicy: policy, mimeType: "image/jpeg",
    storageKey: "moderation-staging/users/one/profile/id.jpg" };
  const env = { AI: { run: async () => ({response:"SAFE"}) } };
  const a=await classifyModeratedUpload({
    db,bucket,env,ticket,objectId:"a".repeat(32),
  });
  assert.equal(a.status,"approved");
  const b=await classifyModeratedUpload({
    db,bucket,env,ticket,objectId:"b".repeat(32),
  });
  assert.equal(b.status,"needs_review");
  assert.equal(b.reason,"daily_quota_reached");
  const noProvider=await classifyModeratedUpload({
    db:new Db(),bucket,env:{},ticket,objectId:"c".repeat(32),
  });
  assert.equal(noProvider.status,"needs_review");
});

test("U6-L2 publish copies ONLY the approved staged key; removal is post-commit", async () => {
  const staged="moderation-staging/users/u/profile/id.png";
  const published="users/u/profile/id.png";
  const objects=new Map([[staged, {size:5,body:Buffer.from("image")}]]);
  const bucket={
    get: async k=>objects.get(k)||null,
    put: async(k,body,metadata)=>{ objects.set(k,{body,metadata,size:5}); },
    delete: async k=>objects.delete(k),
  };
  await assert.rejects(()=>publishModeratedUpload(bucket,
    "unrelated",published,"image/png"));
  await publishModeratedUpload(bucket,staged,published,"image/png");
  assert.equal(objects.has(published),true);
  assert.equal(objects.has(staged),true);
  assert.equal(objects.get(published).metadata.httpMetadata.contentType,"image/png");
});

test("U6-L2 source guard: pending is never linked or presigned for reading", () => {
  const source=fs.readFileSync("cloudflare-worker/src/user-storage.js","utf8");
  const publicMedia=fs.readFileSync("cloudflare-worker/src/public-media.js","utf8");
  assert.match(source,/moderatedStagingKey\(publicStorageKey\)/);
  assert.match(source,/moderationDecision\.status !== "approved"/);
  assert.match(source,/publicationPending: true/);
  assert.match(source,/image_pending_moderation/);
  assert.match(source,/await auth\.db\.commit\(transaction, writes\);/);
  assert.match(source,/await bucket\.delete\(clean\(ticket\.storageKey\)\)/);
  assert.match(publicMedia,/publicMediaStorageKey\(/);
  assert.equal(publicMedia.includes("moderation-staging/"),false);
  const control=fs.readFileSync(
    "cloudflare-worker/src/image-moderation-control.js","utf8");
  assert.match(control,/IMAGE_MODERATION_PUBLICATION_GATE_READY = false/);
});
