import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import {
  approvePrivateChatImage, verifyPrivateChatImageMessage,
} from "../../cloudflare-worker/src/image-moderation-chat.js";
import { rejectImageReview } from "../../cloudflare-worker/src/image-moderation-review.js";
import { cleanupQueuedStorageObject } from "../../cloudflare-worker/src/user-storage.js";

const id = "b".repeat(32);
const key = "review_chat_private_001";
const original = "chat/c1/u1/" + id + ".png";
const stage = "moderation-staging/" + original;
class DB {
  constructor() {
    this.docs = new Map();
    this.messages = [{ id:"m1",data:{
      senderId:"u1",receiverId:"u2",type:"image",
      storageObjectId:id,moderationStatus:"pending",
    }}];
    this.calls = [];
  }
  async beginTransaction() { return "tx"; }
  async rollback() {}
  async get(path) {
    this.calls.push({kind:"get",path});
    return {exists:this.docs.has(path),data:this.docs.get(path)||null};
  }
  async runQuery(collection, options) {
    this.calls.push({kind:"query",collection,options});
    if (collection !== "conversations/c1/messages") return [];
    return this.messages.filter(x =>
      x.data.storageObjectId === options.filters?.[0]?.value).slice(0,options.limit);
  }
  writeCreate(path,fields) {return {action:"create",path,fields};}
  writeUpdate(path,fields) {return {action:"update",path,fields};}
  writeDelete(path) {return {action:"delete",path};}
  async commit(_,writes) {
    for (const w of writes) {
      if(w.action==="create"&&this.docs.has(w.path))throw Error("exists");
      if(w.action==="delete"){this.docs.delete(w.path);continue;}
      if(w.path==="conversations/c1/messages/m1") {
        this.messages[0].data={...this.messages[0].data,...w.fields};
        continue;
      }
      this.docs.set(w.path,{...(this.docs.get(w.path)||{}),...w.fields});
    }
  }
}
function fixture(state="needs_review") {
  const db = new DB();
  db.docs.set("conversations/c1",{participants:["u1","u2"]});
  db.docs.set("storage_objects/"+id,{
    objectId:id,scope:"chat_image",ownerUid:"u1",
    targetId:"c1",mimeType:"image/png",sizeBytes:4,
    storageKey:stage,publicStorageKey:original,etag:"etag-1",
    state,moderation:{status:state,reviewStatus:state},
  });
  const used={get:[],put:[],delete:[]};
  const bucket={
    get:async k=>{used.get.push(k);return{
      size:4,etag:"etag-1",body:new Uint8Array([1,2,3,4])};},
    put:async(k,data,opts)=>{used.put.push(k);return{};},
    delete:async k=>{used.delete.push(k);},
  };
  return {db,bucket,used};
}
const payload={objectId:id,idempotencyKey:key,reason:"تمت مراجعة الصورة بأمان"};
test("U6-L4/B approves only matching sent private chat image",async()=>{
  const {db,bucket,used}=fixture();
  const result=await approvePrivateChatImage(db,bucket,"owner1",payload);
  assert.equal(result.status,"approved");
  assert.deepEqual(used.put,[original]);
  assert.deepEqual(used.get,[stage]);
  assert.deepEqual(used.delete,[stage]);
  const doc=db.docs.get("storage_objects/"+id);
  assert.equal(doc.state,"active");
  assert.equal(doc.storageKey,original);
  assert.equal(doc.publicUrl,undefined);
  assert.equal(doc.moderation.status,"approved");
  assert.equal(db.messages[0].data.moderationStatus,"approved");
  assert.equal(db.docs.get("storage_delete_queue/chat_stage_"+id).storageKey,stage);
  const again=await approvePrivateChatImage(db,bucket,"owner1",payload);
  assert.equal(again.duplicate,true);
  assert.equal(used.put.length,1);
});
test("U6-L4/B cannot approve an image missing a valid sent message",async()=>{
  const {db,bucket,used}=fixture();
  for (const altered of [
    {senderId:"u2"}, {receiverId:"u9"}, {type:"text"},
    {storageObjectId:"bad"},
  ]) {
    db.messages[0].data={senderId:"u1",receiverId:"u2",
      type:"image",storageObjectId:id,...altered};
    await assert.rejects(()=>approvePrivateChatImage(
      db,bucket,"owner1",payload),/chat_image_message_unavailable/);
  }
  assert.equal(used.put.length,0);
});
test("U6-L4/B forbids removed members, wrong scope or owner",async()=>{
  for(const wrong of [
    {conversation:["u2","u3"]}, {scope:"diary_image"},
    {ownerUid:"u3"}, {state:"blocked"}, {evidenceHold:true},
  ]) {
    const {db,bucket,used}=fixture();
    if(wrong.conversation) {
      db.docs.set("conversations/c1",{participants:wrong.conversation});
    } else {
      db.docs.set("storage_objects/"+id,{
        ...db.docs.get("storage_objects/"+id),...wrong,
      });
    }
    await assert.rejects(()=>approvePrivateChatImage(
      db,bucket,"owner1",payload));
    assert.equal(used.put.length,0);
  }
});
test("U6-L4/B changed private R2 bytes cannot be published",async()=>{
  const {db,bucket,used}=fixture();
  bucket.get=async k=>({size:4,etag:"changed",body:new Uint8Array(4)});
  await assert.rejects(()=>approvePrivateChatImage(
    db,bucket,"owner1",payload),/chat_image_copy_failed/);
  assert.equal(db.docs.get("storage_objects/"+id).state,
    "chat_approval_publishing");
  assert.equal(db.docs.get("storage_objects/"+id).storageKey,stage);
  assert.equal(used.put.length,0);
});
test("U6-L4/B failed private copy resumes exactly once",async()=>{
  const {db,bucket,used}=fixture();
  const originalPut=bucket.put;
  bucket.put=async()=>{throw Error("r2 timeout")};
  await assert.rejects(()=>approvePrivateChatImage(db,bucket,"owner1",payload),
    /chat_image_copy_failed/);
  bucket.put=originalPut;
  const result=await approvePrivateChatImage(db,bucket,"owner1",payload);
  assert.equal(result.status,"approved");
  assert.deepEqual(used.put,[original]);
});
test("U6-L4/B image rejection resolves pending placeholder without leak",async()=>{
  const {db,used}=fixture();
  const result=await rejectImageReview(db,"owner1",{
    objectId:id,idempotencyKey:"chat_reject_image_001",
    reason:"المحتوى غير مناسب",
  });
  assert.equal(result.status,"rejected");
  assert.equal(db.messages[0].data.moderationStatus,"rejected");
  assert.equal(db.docs.get("storage_objects/"+id).storageKey,stage);
  assert.equal(used.put.length,0);
});
test("U6-L4/B stage cleanup never deletes active approved chat media",async()=>{
  const {db,used}=fixture();
  db.docs.set("storage_objects/"+id,{
    ...db.docs.get("storage_objects/"+id),
    state:"active",storageKey:original,
  });
  const entry={
    id:"chat_stage_"+id,
    data:{objectId:id,ownerUid:"u1",targetId:"c1",
      scope:"chat_stage_only",storageKey:stage,mimeType:"image/png",
      reason:"chat_published_stage_cleanup"},
  };
  db.docs.set("storage_delete_queue/"+entry.id,entry.data);
  const status=await cleanupQueuedStorageObject(db,{
    delete:async k=>used.delete.push(k),
  },entry,Date.now());
  assert.equal(status.status,"deleted");
  assert.deepEqual(used.delete,[stage]);
  assert.equal(db.docs.get("storage_objects/"+id).storageKey,original);
});
test("U6-L4/B bad cleanup key is rejected before R2 deletion",async()=>{
  const {db,used}=fixture();
  const entry={
    id:"chat_stage_"+id,
    data:{objectId:id,ownerUid:"u1",targetId:"c1",
      scope:"chat_stage_only",storageKey:"moderation-staging/forged",
      mimeType:"image/png",reason:"chat_published_stage_cleanup"},
  };
  await assert.rejects(()=>cleanupQueuedStorageObject(db,{
    delete:async k=>used.delete.push(k),
  },entry,Date.now()),/invalid_chat_stage_cleanup/);
  assert.deepEqual(used.delete,[]);
});
test("U6-L4/B private read authorizes exact message and never public media",async()=>{
  const {db}=fixture();
  const association=await verifyPrivateChatImageMessage(
    db,db.docs.get("storage_objects/"+id),id);
  assert.equal(association.messageId,"m1");
  const userStorage=fs.readFileSync(
    "cloudflare-worker/src/user-storage.js","utf8");
  const ui=fs.readFileSync(
    "lib/features/chat/screens/private_chat_screen.dart","utf8");
  assert.match(userStorage,/chat_image_message_unavailable/);
  assert.match(userStorage,/verifyPrivateChatImageMessage/);
  assert.match(ui,/الصورة قيد المراجعة/);
  assert.match(ui,/moderationStatus/);
  const media=fs.readFileSync("cloudflare-worker/src/public-media.js","utf8");
  assert.doesNotMatch(media,/"chat_image",/);
  const control=fs.readFileSync(
    "cloudflare-worker/src/image-moderation-control.js","utf8");
  assert.match(control,/approve_chat_private/);
  assert.match(control,/export \\{ IMAGE_MODERATION_PUBLICATION_GATE_READY \\}/);
});
