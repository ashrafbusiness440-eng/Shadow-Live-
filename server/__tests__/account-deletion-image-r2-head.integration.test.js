import assert from "node:assert/strict";
import {test,after} from "node:test";
import {randomUUID} from "node:crypto";
import {getApps,initializeApp,deleteApp} from "firebase-admin/app";
import {getFirestore} from "firebase-admin/firestore";
import {cloudflareFirestoreAdapter} from "./helpers/cloudflare-firestore-adapter.js";
import {inspectAccountImageR2Object as inspect}
 from "../../cloudflare-worker/src/account-deletion-image-r2-head.js";

const app=getApps()[0]||initializeApp({projectId:"shadow-live-economy-test"});
const store=getFirestore(app),db=cloudflareFirestoreAdapter(store);
after(async()=>{await deleteApp(app);});
const hex=()=>randomUUID().replaceAll("-","");
test("emulator: exact photo R2 HEAD is read-only; held shared images and counterpart protected",async()=>{
 const suffix=hex().slice(0,14);
 const uid="img_head_user_"+suffix,peer="img_head_peer_"+suffix;
 const requestId="erase_image_head_"+suffix,objectId=hex();
 const chatId="chat_image_head_"+suffix,chatObjectId=hex();
 const canonical="users/"+uid+"/profile/"+objectId+".jpg";
 const shared="chat/"+chatId+"/"+uid+"/"+chatObjectId+".jpg";
 const paths=[
  "account_deletion_requests/"+uid,
  "account_deletion_erasure_checkpoints/"+uid,
  "users/"+uid,"users/"+peer,
  "storage_objects/"+objectId,"storage_objects/"+chatObjectId,
  "conversations/"+chatId,
  "reports/evidence_image_"+suffix,
 ];
 const refs=paths.map(path=>store.doc(path));
 const [req,checkpoint,user,other,photo,chatPhoto,chat,evidence]=refs;
 const image=(id,key,scope,target)=>({
  objectId:id,ownerUid:uid,scope,targetId:target,storageKey:key,
  publicStorageKey:key,bucket:"shadow-live-storage",
  mimeType:"image/jpeg",sizeBytes:2000,state:"active",
 });
 await Promise.all([
  req.set({uid,requestId,status:"review_ready"}),
  checkpoint.set({uid,requestId,phase:"preflight_blocked",destructiveAllowed:false}),
  user.set({role:"user",coins:750}),
  other.set({role:"user",coins:1100}),
  photo.set(image(objectId,canonical,"profile_image",uid)),
  chatPhoto.set(image(chatObjectId,shared,"chat_image",chatId)),
  chat.set({participants:[uid,peer],lastMessage:"keep private"}),
  evidence.set({targetUid:uid,privateEvidence:"retained"}),
 ]);
 const headCalls=[];
 const bucket={
  async head(path){headCalls.push(path);
   return {size:2000,httpMetadata:{contentType:"image/jpeg"}};},
  async list(){throw Error("unexpected_list");},
  async get(){throw Error("unexpected_get");},
  async delete(){throw Error("unexpected_delete");},
 };
 const common={uid,requestId,actor:{owner:true,uid:"control_owner_123"}};
 try{
  const first=await inspect(db,bucket,{...common,objectId});
  assert.equal(first.storagePresent,true);
  assert.equal(first.erasureAllowed,false);
  assert.equal(first.needsReview,true);
  const second=await inspect(db,bucket,{...common,objectId:chatObjectId});
  assert.equal(second.sharedAssetReview,true);
  assert.deepEqual(headCalls,[canonical,shared]);
  // A late hold must stop all further R2 operations without altering evidence.
  await chat.update({evidenceHold:true});
  await assert.rejects(
   inspect(db,bucket,{...common,objectId:chatObjectId}),
   e=>e.code==="image_r2_reference_review_required");
  assert.equal(headCalls.length,2);
  assert.equal((await other.get()).data().coins,1100);
  assert.equal((await user.get()).data().coins,750);
  assert.equal((await evidence.get()).data().privateEvidence,"retained");
  assert.equal((await chat.get()).data().lastMessage,"keep private");
  await req.update({appealPending:true});
  await assert.rejects(inspect(db,bucket,{...common,objectId}),
    e=>e.code==="image_r2_review_blocked");
  assert.equal(headCalls.length,2);
 }finally{
  await Promise.all(refs.map(ref=>ref.delete()));
 }
});
