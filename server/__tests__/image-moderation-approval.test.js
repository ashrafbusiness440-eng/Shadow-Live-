import assert from "node:assert/strict";
import test from "node:test";
import {
  approveImageReview,
} from "../../cloudflare-worker/src/image-moderation-approval.js";

const id="f".repeat(32);
const receipt="image_approval_"+id;
const privateKey="moderation-staging/users/u1/profile/"+id+".png";
const publicKey="users/u1/profile/"+id+".png";
class DB {
  constructor() {this.docs=new Map();this.logs=[];}
  async beginTransaction(){return "transaction";}
  async rollback(){}
  async get(path){return {exists:this.docs.has(path),data:this.docs.get(path)||null};}
  writeUpdate(path,fields){return {type:"update",path,fields};}
  writeCreate(path,fields){return {type:"create",path,fields};}
  async commit(_tx,writes){
    for (const w of writes){
      if(w.type==="create"&&this.docs.has(w.path))throw Error("exists");
      this.docs.set(w.path,{...(this.docs.get(w.path)||{}),...w.fields});
      this.logs.push(w);
    }
  }
}
const prepare = ({old=""}={}) => {
  const db=new DB();
  const bytes=new Uint8Array([0x89,0x50,0x4e,0x47]);
  db.docs.set("storage_objects/"+id,{
    objectId:id,ownerUid:"u1",targetId:"u1",scope:"profile_image",
    mimeType:"image/png",sizeBytes:4,etag:"etag-fixed",
    storageKey:privateKey,publicStorageKey:publicKey,
    replaceObjectId:old||null,state:"needs_review",
    moderation:{reason:"uncertain_visual_assessment"},
  });
  db.docs.set("users/u1",{displayName:"Test user",
    profileImageObjectId:old||null});
  db.docs.set("public_profiles/u1",{displayName:"Test user"});
  if(old) {
    db.docs.set("storage_active_objects/profile_image__u1",{
      objectId:old,ownerUid:"u1",scope:"profile_image",targetId:"u1",
    });
    db.docs.set("storage_objects/"+old,{
      objectId:old,ownerUid:"u1",targetId:"u1",
      scope:"profile_image",storageKey:"users/u1/profile/old.jpg",
      sizeBytes:3,state:"active",
    });
  }
  const objects=new Map([[privateKey,{size:4,etag:"etag-fixed",body:bytes}]]);
  const bucket={
    get:async key=>objects.get(key)||null,
    put:async(key,body,opts)=>{
      objects.set(key,{size:4,etag:"new-etag",body,opts});
    },
    delete:async key=>objects.delete(key),
  };
  const request=new Request("https://shadow.example/api/image-moderation-control",
    {method:"POST"});
  return {db,bucket,objects,request};
};
const payload={objectId:id,idempotencyKey:receipt,
  reason:"تم فحص الصورة واعتمادها يدويًا"};

test("U6-L2/B manual approval activates profile only after explicit review",async()=>{
  const {db,bucket,objects,request}=prepare();
  const first=await approveImageReview(db,bucket,request,"owner_1",payload);
  assert.equal(first.status,"approved");
  assert.equal(db.docs.get("storage_objects/"+id).state,"active");
  assert.equal(db.docs.get("storage_active_objects/profile_image__u1").objectId,id);
  assert.equal(db.docs.get("users/u1").profileImageObjectId,id);
  assert.equal(db.docs.get("public_profiles/u1").profileImageObjectId,id);
  assert.equal(db.docs.get("notifications/image_review_"+receipt).userId,"u1");
  assert.equal(db.docs.get("admin_audit_logs/image_review_"+receipt)
    .actorUid,"owner_1");
  assert.equal(objects.has(publicKey),true);
  assert.equal(objects.has(privateKey),false);
  const count=db.logs.length;
  const replay=await approveImageReview(db,bucket,request,"owner_1",payload);
  assert.equal(replay.duplicate,true);
  assert.equal(db.logs.length,count);
});
test("U6-L2/B stale replacement never copies or replaces previous profile",async()=>{
  const old="a".repeat(32);
  const {db,bucket,objects,request}=prepare({old});
  db.docs.set("storage_active_objects/profile_image__u1",{
    objectId:"b".repeat(32),
  });
  await assert.rejects(()=>approveImageReview(db,bucket,request,
    "owner_1",payload),/stale_image_replacement/);
  assert.equal(objects.has(publicKey),false);
  assert.equal(db.docs.get("users/u1").profileImageObjectId,old);
});
test("U6-L2/B copied bytes must match the server-captured R2 ETag",async()=>{
  const {db,bucket,objects,request}=prepare();
  objects.set(privateKey,{size:4,etag:"tampered",body:Uint8Array.of(1,2,3,4)});
  await assert.rejects(()=>approveImageReview(db,bucket,request,
    "owner_1",payload),/approved_image_copy_failed/);
  assert.equal(objects.has(publicKey),false);
  assert.equal(db.docs.get("users/u1").profileImageObjectId,null);
  assert.equal(db.docs.get("storage_objects/"+id).state,"approved_pending_copy");
});
test("U6-L2/B approval of non-linkable diary and chat assets fails closed",async()=>{
  for(const scope of ["diary_image","chat_image"]){
    const {db,bucket,request}=prepare();
    const current=db.docs.get("storage_objects/"+id);
    db.docs.set("storage_objects/"+id,{...current,scope});
    await assert.rejects(()=>approveImageReview(db,bucket,request,
      "owner_1",payload),/approval_requires_linkable_image/);
  }
});
test("U6-L2/B approved replacement defers old deletion until new commit",async()=>{
  const old="a".repeat(32);
  const {db,bucket,request}=prepare({old});
  await approveImageReview(db,bucket,request,"owner_1",payload);
  assert.equal(db.docs.get("storage_objects/"+old).state,"pending_delete");
  assert.equal(db.docs.get("storage_delete_queue/"+old).reason,"replaced");
  assert.equal(db.docs.get("users/u1").profileImageObjectId,id);
});
