import assert from "node:assert/strict";
import {test,after} from "node:test";
import {randomUUID} from "node:crypto";
import {getApps,initializeApp,deleteApp} from "firebase-admin/app";
import {getFirestore} from "firebase-admin/firestore";
import {cloudflareFirestoreAdapter} from "./helpers/cloudflare-firestore-adapter.js";
import {inspectAccountImageStoragePage as inspect}
 from "../../cloudflare-worker/src/account-deletion-image-storage-inventory.js";

const app=getApps()[0]||initializeApp({projectId:"shadow-live-economy-test"});
const store=getFirestore(app),db=cloudflareFirestoreAdapter(store);
after(async()=>{await deleteApp(app);});
const hex=()=>randomUUID().replaceAll("-","");

test("emulator: owned photos paginate and protect diary, shared rooms, chat and other-user data",async()=>{
 const suffix=hex().slice(0,18),uid="image_erase_"+suffix,other="peer_image_"+suffix;
 const requestId="erase_image_req_"+suffix,chatId="chat_"+suffix;
 const roomId="room_"+suffix,agencyId="agency_"+suffix;
 const req=store.doc("account_deletion_requests/"+uid);
 const checkpoint=store.doc("account_deletion_erasure_checkpoints/"+uid);
 const user=store.doc("users/"+uid);
 const conversation=store.doc("conversations/"+chatId);
 const room=store.doc("rooms/"+roomId);
 const agency=store.doc("agencies/"+agencyId);
 const objectIds=Array.from({length:7},()=>hex());
 const media=objectIds.map(id=>store.doc("storage_objects/"+id));
 const diary=store.doc("diary_image_links/"+objectIds[1]);
 const otherMedia=store.doc("storage_objects/"+hex());
 const evidence=store.doc("reports/report_image_"+suffix);
 const refs=[req,checkpoint,user,conversation,room,agency,...media,
  diary,otherMedia,evidence];
 const scopes=[
  "profile_image","diary_image","chat_image","room_cover",
  "agency_logo","profile_cover","profile_image",
 ];
 const targets=[uid,uid,chatId,roomId,agencyId,uid,uid];
 const key=(i)=>{
  const name=objectIds[i]+".jpg";
  switch(scopes[i]){
   case "profile_image":return "users/"+uid+"/profile/"+name;
   case "profile_cover":return "users/"+uid+"/covers/"+name;
   case "diary_image":return "users/"+uid+"/diaries/"+name;
   case "chat_image":return "chat/"+chatId+"/"+uid+"/"+name;
   case "room_cover":return "rooms/"+roomId+"/covers/"+name;
   case "agency_logo":return "agencies/"+agencyId+"/logo/"+name;
   default:throw Error("unrecognized");
  }
 };
 await Promise.all([
  req.set({uid,requestId,status:"review_ready"}),
  checkpoint.set({uid,requestId,phase:"preflight_blocked",
   destructiveAllowed:false}),
  user.set({role:"user",coins:700}),
  conversation.set({participants:[uid,other],lastMessage:"keep private"}),
  room.set({ownerUid:uid,participantCount:15}),
  agency.set({ownerUid:uid,memberCount:12}),
  ...media.map((ref,i)=>ref.set({
   objectId:objectIds[i],ownerUid:uid,scope:scopes[i],
   targetId:targets[i],storageKey:key(i),
   mimeType:"image/jpeg",sizeBytes:5000,
   state:"active",
  })),
  diary.set({ownerUid:uid,diaryId:"diary_"+suffix,state:"linked"}),
  otherMedia.set({objectId:hex(),ownerUid:other,scope:"profile_image",
   targetId:other,storageKey:"users/"+other+"/profile/x.jpg",
   mimeType:"image/jpeg",sizeBytes:100}),
  evidence.set({targetUid:uid,evidence:{private:"retained legal image"}}),
 ]);
 const opts={uid,requestId,
  actor:{owner:true,uid:"owner_control_321"}};
 try{
  const items=[];let cursor=null;
  for(let i=0;i<3;i++){
   const page=await inspect(db,{...opts,cursor,limit:3});
   items.push(...page.items);cursor=page.nextCursor;
   assert.equal(page.exhaustive,false);
   assert.equal(page.erasureAllowed,false);
   assert.equal(page.completionVerified,false);
   assert.equal(JSON.stringify(page).includes("users/"),false);
  }
  assert.equal(items.length,7);
  assert.equal(cursor,null);
  assert.equal(items.every(x=>x.schemaConsistent),true);
  assert.equal(items.filter(x=>x.sharedAssetReview).length,3);
  assert.equal(items.every(x=>x.needsReview),true);
  assert.equal((await room.get()).data().participantCount,15);
  assert.equal((await agency.get()).data().memberCount,12);
  assert.equal((await conversation.get()).data().lastMessage,"keep private");
  assert.equal((await evidence.get()).data().evidence.private,
   "retained legal image");
  assert.equal((await user.get()).data().coins,700);
  await req.update({investigationHold:true});
  await assert.rejects(inspect(db,opts),
   e=>e.code==="image_inventory_review_blocked");
 }finally{
  await Promise.all(refs.map(ref=>ref.delete()));
 }
});
