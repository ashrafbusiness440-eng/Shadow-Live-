import assert from "node:assert/strict";
import {test,after} from "node:test";
import {randomUUID} from "node:crypto";
import {getApps,initializeApp,deleteApp} from "firebase-admin/app";
import {getFirestore} from "firebase-admin/firestore";
import {cloudflareFirestoreAdapter} from "./helpers/cloudflare-firestore-adapter.js";
import {inspectAccountPrivateVoicePage as inspect}
  from "../../cloudflare-worker/src/account-deletion-private-voice-inventory.js";

const app=getApps()[0]||initializeApp({projectId:"shadow-live-economy-test"});
const store=getFirestore(app),db=cloudflareFirestoreAdapter(store);
after(async()=>{await deleteApp(app);});
const id=()=>randomUUID().replaceAll("-","");

test("emulator: index privately owned voice objects; preserve counterpart voice and report evidence",async()=>{
  const suffix=id().slice(0,18),uid="deleted_voice_"+suffix;
  const other="other_voice_"+suffix,requestId="voice_request_"+suffix;
  const chatId="voice_conversation_"+suffix;
  const actor={owner:true,uid:"shadow_verified_owner"};
  const request=store.doc("account_deletion_requests/"+uid);
  const checkpoint=store.doc("account_deletion_erasure_checkpoints/"+uid);
  const user=store.doc("users/"+uid);
  const chat=store.doc("conversations/"+chatId);
  const objectIds=Array.from({length:7},()=>id());
  const objects=objectIds.map(x=>store.doc("private_voice_objects/"+x));
  const drafts=objectIds.map((x,i)=>i<3
    ? store.doc("private_voice_drafts/"+x):null);
  const messageIds=objectIds.map(x=>"voice_"+x);
  const messages=objectIds.map((x,i)=>i>=3
    ? chat.collection("messages").doc(messageIds[i]):null);
  const evidence=store.doc("content_filter_flags/"+messageIds[3]);
  const otherObjId=id();
  const otherObj=store.doc("private_voice_objects/"+otherObjId);
  const refs=[request,checkpoint,user,chat,...objects,...drafts.filter(Boolean),
    ...messages.filter(Boolean),evidence,otherObj];
  const key=x=>`private-voice/${chatId}/${uid}/${x}.wav`;
  await Promise.all([
    request.set({uid,requestId,status:"review_ready"}),
    checkpoint.set({uid,requestId,phase:"preflight_blocked",
      destructiveAllowed:false}),
    user.set({role:"user",coins:321}),
    chat.set({participants:[uid,other],lastMessage:"🎤 Voice message"}),
    ...objects.map((ref,i)=>ref.set({
      objectId:objectIds[i],ownerUid:uid,otherUid:other,
      conversationId:chatId,storageKey:key(objectIds[i]),
      mimeType:"audio/wav",expectedSizeBytes:32044,durationSeconds:1,
      state:i<3?"uploaded":"sent",createdAt:new Date(),
      ...(i>=3?{messageId:messageIds[i],sentAt:new Date()}:{}),
    })),
    ...drafts.map((ref,i)=>ref?ref.set({
      objectId:objectIds[i],ownerUid:uid,storageKey:key(objectIds[i]),
      expiresAt:new Date(),createdAt:new Date(),
    }):Promise.resolve()),
    ...messages.map((ref,i)=>ref?ref.set({
      type:"voice_note",senderId:uid,receiverId:other,
      storageObjectId:objectIds[i],mimeType:"audio/wav",sizeBytes:32044,
      durationSeconds:1,createdAt:new Date(),
    }):Promise.resolve()),
    otherObj.set({objectId:otherObjId,ownerUid:other,
      otherUid:uid,conversationId:chatId,storageKey:
      `private-voice/${chatId}/${other}/${otherObjId}.wav`,
      mimeType:"audio/wav",expectedSizeBytes:32044,durationSeconds:1,
      state:"uploaded"}),
    evidence.set({evidenceHold:true}),
  ]);
  try{
    const all=[];let cursor=null;
    for(let i=0;i<3;i++){
      const result=await inspect(db,{uid,requestId,actor,cursor,limit:3});
      all.push(...result.items);
      cursor=result.nextCursor;
      assert.equal(result.completionVerified,false);
      assert.equal(result.erasureAllowed,false);
      assert.equal(result.exhaustive,false);
      assert.equal(JSON.stringify(result).includes("private-voice/"),false);
      assert.equal(JSON.stringify(result).includes(other),false);
    }
    assert.equal(all.length,7);
    assert.equal(new Set(all.map(x=>x.id)).size,7);
    assert.equal(cursor,null);
    assert.equal(all.filter(x=>x.evidenceMarkerPresent).length,1);
    assert.equal(all.filter(x=>x.needsReview).length,1);
    assert.equal((await otherObj.get()).data().ownerUid,other);
    assert.equal((await chat.get()).data().lastMessage,"🎤 Voice message");
    assert.equal((await user.get()).data().coins,321);
    await request.update({appealPending:true});
    await assert.rejects(inspect(db,{uid,requestId,actor}),
      e=>e.code==="private_voice_inventory_review_blocked");
    await request.update({appealPending:false});
    await chat.update({appealStatus:"under_review"});
    const heldPage=await inspect(db,{uid,requestId,actor,limit:3});
    assert.equal(heldPage.items.every(x=>x.needsReview),true);
    assert.equal(heldPage.erasureAllowed,false);
    assert.equal((await otherObj.get()).data().ownerUid,other);
    await chat.update({appealStatus:"closed"});
    await request.update({legalHold:true});
    await assert.rejects(inspect(db,{uid,requestId,actor}),
      e=>e.code==="private_voice_inventory_review_blocked");
  }finally{
    await Promise.all(refs.map(ref=>ref.delete()));
  }
});
