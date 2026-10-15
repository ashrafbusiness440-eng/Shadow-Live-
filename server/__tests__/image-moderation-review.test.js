import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import {
  listImageReviewCases, readImageReviewPreview,
  rejectImageReview, ImageReviewError,
} from "../../cloudflare-worker/src/image-moderation-review.js";
const OBJECT_ID = "c".repeat(32);
const KEY = "u6l2_review_receipt_abc_123";
const STAGE = "moderation-staging/users/user_1/profile/" + OBJECT_ID + ".png";
const PUBLIC = "users/user_1/profile/" + OBJECT_ID + ".png";
class DB {
  constructor() { this.docs = new Map(); this.calls=[]; }
  async beginTransaction() { return "tx"; }
  async rollback() {}
  async get(path) {
    return {exists:this.docs.has(path),data:this.docs.get(path)||null};
  }
  writeUpdate(path, fields) { return {path,fields,kind:"update"}; }
  writeCreate(path, fields) { return {path,fields,kind:"create"}; }
  async commit(_, writes) {
    for(const w of writes) {
      if(w.kind==="create"&&this.docs.has(w.path))throw Error("exists");
      this.docs.set(w.path,{...(this.docs.get(w.path)||{}),...w.fields});
      this.calls.push(w);
    }
  }
  async runQuery(collection,options) {
    this.calls.push({collection,options});
    return [...this.docs.entries()]
      .filter(([p,v])=>p.startsWith(collection+"/") &&
        v.state===options.filters[0].value)
      .slice(0,options.limit)
      .map(([p,data])=>({id:p.split("/")[1],data}));
  }
}
const document = () => ({
  objectId:OBJECT_ID, ownerUid:"user_1", targetId:"user_1",
  scope:"profile_image", storageKey:STAGE,
  publicStorageKey:PUBLIC, mimeType:"image/png", sizeBytes:4,
  etag:"etag-1", state:"needs_review", createdAt:new Date(),
  moderation:{status:"needs_review",reason:"uncertain_visual_assessment"},
});
test("U6-L2/B queue is capped at three fixed-filter reads and has no storage key",async()=>{
  const db=new DB();
  db.docs.set("storage_objects/"+OBJECT_ID,document());
  const rows=await listImageReviewCases(db,99999);
  assert.equal(rows.length,1);
  assert.equal(rows[0].objectId,OBJECT_ID);
  assert.equal(JSON.stringify(rows).includes("moderation-staging/"),false);
  assert.equal(db.calls.filter(x=>x.collection==="storage_objects").length,3);
  assert.ok(db.calls.filter(x=>x.collection==="storage_objects")
    .every(x=>x.options.limit<=12));
});
test("U6-L2/B protected preview audits BEFORE opening private R2 bytes",async()=>{
  const db=new DB();
  db.docs.set("storage_objects/"+OBJECT_ID,document());
  let getCalls=0;
  const env={USER_STORAGE:{get:async key=>{
    assert.equal(key,STAGE);
    assert.equal(db.calls.some(x=>x.path?.startsWith(
      "admin_audit_logs/image_review_preview_")),true);
    getCalls++;
    return {size:4,etag:"etag-1",body:new Uint8Array([1,2,3,4])};
  }}};
  const req=new Request("https://worker.example/api/image-moderation-control",
    {method:"POST"});
  const resp=await readImageReviewPreview(req,env,db,"owner_1",OBJECT_ID);
  assert.equal(resp.status,200);
  assert.equal(resp.headers.get("Cache-Control").includes("no-store"),true);
  assert.equal(getCalls,1);
  await assert.rejects(()=>readImageReviewPreview(req,env,db,
    "owner_1","bad"), ImageReviewError);
  const altered= {...document(), storageKey:"users/user_1/profile/file.png"};
  db.docs.set("storage_objects/"+OBJECT_ID,altered);
  await assert.rejects(()=>readImageReviewPreview(req,env,db,
    "owner_1",OBJECT_ID),ImageReviewError);
});
test("U6-L2/B rejection is audited, user notified and idempotent",async()=>{
  const db=new DB();
  db.docs.set("storage_objects/"+OBJECT_ID,document());
  const body={objectId:OBJECT_ID,idempotencyKey:KEY,
    reason:"الصورة لا تستوفي معايير النشر"};
  const out=await rejectImageReview(db,"owner_1",body);
  assert.equal(out.status,"rejected");
  assert.equal(db.docs.get("storage_objects/"+OBJECT_ID).state,"rejected");
  assert.equal(db.docs.get("storage_objects/"+OBJECT_ID).storageKey,STAGE);
  assert.equal(db.docs.get("notifications/image_review_"+KEY).userId,"user_1");
  assert.equal(db.docs.get("admin_audit_logs/image_review_"+KEY).actorUid,"owner_1");
  const count=db.calls.length;
  const again=await rejectImageReview(db,"owner_1",body);
  assert.equal(again.duplicate,true);
  assert.equal(db.calls.length,count);
  await assert.rejects(()=>rejectImageReview(db,"other_owner",body),
    /idempotency_conflict/);
  await assert.rejects(()=>rejectImageReview(db,"owner_1",{
    ...body,idempotencyKey:"different_review_receipt_abc",
  }),/image_not_pending_review/);
});
test("U6-L2/B image review never auto-enables, auto-punishes, or opens a second service",()=>{
  const control=fs.readFileSync(
    "cloudflare-worker/src/image-moderation-control.js","utf8");
  const ui=fs.readFileSync(
    "lib/admin/image_moderation_settings_page.dart","utf8");
  assert.match(control,/recent_auth_required/);
  assert.match(control,/user\.data\?\.role\) !== "owner"/);
  assert.match(control,/readImageReviewPreview/);
  assert.match(control,/rejectImageReview/);
  assert.match(control,/IMAGE_MODERATION_PUBLICATION_GATE_READY = false/);
  assert.equal(control.includes("setInterval"),false);
  assert.equal(ui.includes("GOOGLE_VISION_API_KEY"),false);
});
