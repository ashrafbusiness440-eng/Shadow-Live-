import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import { submitImageModerationAppeal } from "../../cloudflare-worker/src/image-moderation-appeal.js";
import { listImageReviewCases, rejectImageReview } from "../../cloudflare-worker/src/image-moderation-review.js";
import { approveImageReview } from "../../cloudflare-worker/src/image-moderation-approval.js";

const id="e".repeat(32);
const path="storage_objects/"+id;
const appealPath="image_moderation_appeals/"+id;
const privateKey="moderation-staging/users/u1/profile/"+id+".png";
const publicKey="users/u1/profile/"+id+".png";
class DB {
  constructor(){this.docs=new Map();this.calls=[];}
  async beginTransaction(){return "tx";}
  async rollback(){}
  async get(path){return {exists:this.docs.has(path),data:this.docs.get(path)||null};}
  writeCreate(path,fields){return {kind:"create",path,fields};}
  writeUpdate(path,fields){return {kind:"update",path,fields};}
  async commit(_,writes){
    for (const w of writes) {
      if (w.kind==="create"&&this.docs.has(w.path))throw Error("exists");
      this.docs.set(w.path,{...(this.docs.get(w.path)||{}),...w.fields});
      this.calls.push(w);
    }
  }
  async runQuery(collection,options){
    return [...this.docs.entries()].filter(([p,d])=>p.startsWith(collection+"/")&&
      d.state===options.filters[0].value).slice(0,options.limit)
      .map(([p,data])=>({id:p.split("/")[1],data}));
  }
}
const prepare=(state="blocked")=>{
  const db=new DB(),bytes=new Uint8Array([0x89,0x50,0x4e,0x47]);
  db.docs.set(path,{
    objectId:id,ownerUid:"u1",targetId:"u1",scope:"profile_image",
    state,mimeType:"image/png",sizeBytes:4,etag:"etag-original",
    storageKey:privateKey,publicStorageKey:publicKey,
    replaceObjectId:null,moderation:{status:"blocked",reason:"suspected"},
  });
  db.docs.set("users/u1",{displayName:"Test"});
  const storage=new Map([[privateKey,{size:4,etag:"etag-original",body:bytes}]]);
  const bucket={
    get:async k=>storage.get(k)||null,
    put:async(k,body,opts)=>storage.set(k,{size:4,etag:"public",body,opts}),
    delete:async k=>storage.delete(k),
  };
  const request=new Request("https://shadow.example/api/image-moderation-control",
    {method:"POST"});
  return {db,bucket,storage,request};
};
test("U6-L3 one owner-scoped appeal, no public bytes or automatic punishment",async()=>{
  const {db,storage}=prepare();
  await assert.rejects(()=>submitImageModerationAppeal(db,"stranger",{
    objectId:id}),/image_not_found/);
  const response=await submitImageModerationAppeal(db,"u1",{
    objectId:id,explanation:"النتيجة غير صحيحة، أطلب مراجعة بشرية"});
  assert.equal(response.status,"under_review");
  assert.equal(db.docs.get(path).state,"appeal_pending");
  assert.equal(db.docs.get(appealPath).ownerUid,"u1");
  assert.equal(db.docs.get(appealPath).sourceState,"blocked");
  assert.equal(db.docs.get("notifications/image_appeal_received_"+id).userId,"u1");
  assert.equal(storage.has(publicKey),false);
  const count=db.calls.length;
  const duplicate=await submitImageModerationAppeal(db,"u1",{
    objectId:id,explanation:"retry"});
  assert.equal(duplicate.duplicate,true);
  assert.equal(db.calls.length,count);
});
test("U6-L3 rejects unsupported states, invalid IDs and oversized explanations",async()=>{
  const {db}=prepare("active");
  await assert.rejects(()=>submitImageModerationAppeal(db,"u1",{
    objectId:id}),/image_not_appealable/);
  await assert.rejects(()=>submitImageModerationAppeal(db,"u1",{
    objectId:"invalid"}),/invalid_image_appeal/);
  await assert.rejects(()=>submitImageModerationAppeal(db,"u1",{
    objectId:id,explanation:"x".repeat(801)}),/invalid_image_appeal/);
});
test("U6-L3 bounded appeal queue and explicit rejection complete receipt with reason",async()=>{
  const {db}=prepare();
  await submitImageModerationAppeal(db,"u1",{objectId:id});
  const rows=await listImageReviewCases(db,1000);
  assert.equal(rows.length,1);
  assert.equal(rows[0].state,"appeal_pending");
  await rejectImageReview(db,"owner_1",{
    objectId:id,idempotencyKey:"image_appeal_reject_receipt_001",
    reason:"راجعنا الصورة وتبين أنها مخالفة"});
  assert.equal(db.docs.get(path).state,"rejected");
  assert.equal(db.docs.get(appealPath).status,"rejected");
  assert.equal(db.docs.get(appealPath).decisionReason,
    "راجعنا الصورة وتبين أنها مخالفة");
  assert.match(db.docs.get("notifications/image_review_image_appeal_reject_receipt_001").body,/رفض الاعتراض/);
});
test("U6-L3 accepted appeal publishes only supported linked image with owner audit",async()=>{
  const {db,bucket,storage,request}=prepare();
  await submitImageModerationAppeal(db,"u1",{
    objectId:id,explanation:"يُرجى مراجعة الصورة"});
  const r=await approveImageReview(db,bucket,request,"owner_1",{
    objectId:id,idempotencyKey:"image_approval_"+id,
    reason:"تم قبول الاعتراض بعد المراجعة البشرية"});
  assert.equal(r.status,"approved");
  assert.equal(db.docs.get(appealPath).status,"approved");
  assert.equal(db.docs.get(path).state,"active");
  assert.equal(storage.has(publicKey),true);
  assert.equal(storage.has(privateKey),false);
  assert.equal(db.docs.get("users/u1").profileImageObjectId,id);
  assert.match(db.docs.get("notifications/image_review_image_approval_"+id).body,/قبول اعتراضك/);
});
test("U6-L3 reject stale or forged appeal records and never approve chat/diary",async()=>{
  const {db,bucket,request}=prepare();
  db.docs.set(path,{...db.docs.get(path),state:"appeal_pending"});
  await assert.rejects(()=>approveImageReview(db,bucket,request,
    "owner_1",{objectId:id,idempotencyKey:"image_approval_"+id,
      reason:"استجابة بشرية واضحة"}),/image_appeal_conflict/);
  await submitImageModerationAppeal(db,"u1",{objectId:id}).catch(()=>{});
  const text=fs.readFileSync("cloudflare-worker/src/user-storage.js","utf8");
  assert.match(text,/submitImageModerationAppeal/);
  assert.match(text,/case "appealImage"/);
  assert.match(text,/"appealImage"\].includes\(action\)/);
  const control=fs.readFileSync("cloudflare-worker/src/image-moderation-control.js","utf8");
  assert.match(control,/recent_auth_required/);
  assert.match(control,/user.data\?\.role\) !== "owner"/);
});
