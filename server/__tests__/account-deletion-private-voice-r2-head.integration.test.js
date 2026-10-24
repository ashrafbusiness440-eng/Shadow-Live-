import assert from "node:assert/strict";
import {test,after} from "node:test";
import {randomUUID} from "node:crypto";
import {getApps,initializeApp,deleteApp} from "firebase-admin/app";
import {getFirestore} from "firebase-admin/firestore";
import {cloudflareFirestoreAdapter} from "./helpers/cloudflare-firestore-adapter.js";
import {inspectPrivateVoiceR2Object as inspect}
  from "../../cloudflare-worker/src/account-deletion-private-voice-r2-head.js";

const app=getApps()[0]||initializeApp({projectId:"shadow-live-economy-test"});
const store=getFirestore(app),db=cloudflareFirestoreAdapter(store);
after(async()=>{await deleteApp(app);});
test("emulator: exact R2 HEAD check preserves other voice, chat, evidence and wallets",async()=>{
  const suffix=randomUUID().replaceAll("-","").slice(0,18);
  const objectId=randomUUID().replaceAll("-","");
  const uid="voice_deleted_"+suffix,other="other_voice_"+suffix;
  const requestId="voice_delete_req_"+suffix,chatId="voice_chat_"+suffix;
  const messageId="voice_"+objectId;
  const storageKey=`private-voice/${chatId}/${uid}/${objectId}.wav`;
  const request=store.doc("account_deletion_requests/"+uid);
  const checkpoint=store.doc("account_deletion_erasure_checkpoints/"+uid);
  const user=store.doc("users/"+uid);
  const chat=store.doc("conversations/"+chatId);
  const metadata=store.doc("private_voice_objects/"+objectId);
  const message=chat.collection("messages").doc(messageId);
  const theirs=chat.collection("messages").doc("their_voice_"+suffix);
  const flag=store.doc("content_filter_flags/"+messageId);
  const refs=[request,checkpoint,user,chat,metadata,message,theirs,flag];
  await Promise.all([
    request.set({uid,requestId,status:"review_ready"}),
    checkpoint.set({uid,requestId,phase:"preflight_blocked",
      destructiveAllowed:false}),
    user.set({role:"user",coins:300,diamonds:2}),
    chat.set({participants:[uid,other],lastMessage:"🎤 protected"}),
    metadata.set({objectId,ownerUid:uid,otherUid:other,conversationId:chatId,
      storageKey,mimeType:"audio/wav",expectedSizeBytes:32044,
      durationSeconds:1,state:"sent",messageId,
      createdAt:new Date(),sentAt:new Date()}),
    message.set({type:"voice_note",senderId:uid,receiverId:other,
      storageObjectId:objectId,mimeType:"audio/wav",
      sizeBytes:32044,durationSeconds:1,createdAt:new Date()}),
    theirs.set({type:"voice_note",senderId:other,receiverId:uid,
      storageObjectId:"another_safe_voice_id",text:"retain"}),
  ]);
  const calls=[];
  const bucket={
    head:async key=>{calls.push(key);return {
      size:32044,httpMetadata:{contentType:"audio/wav"},
    };},
    get:async()=>{throw Error("get forbidden");},
    delete:async()=>{throw Error("delete forbidden");},
  };
  const opts={uid,requestId,objectId,actor:{uid:"owner_control_999",owner:true}};
  try{
    const good=await inspect(db,bucket,opts);
    assert.equal(good.storagePresent,true);
    assert.equal(good.sizeMatches,true);
    assert.equal(good.needsReview,false);
    assert.equal(good.erasureAllowed,false);
    assert.deepEqual(calls,[storageKey]);
    assert.equal((await theirs.get()).data().text,"retain");
    assert.equal((await chat.get()).data().lastMessage,"🎤 protected");
    assert.equal((await user.get()).data().coins,300);
    await flag.set({evidenceHold:true});
    await assert.rejects(inspect(db,bucket,opts),
      error=>error.code==="private_voice_r2_sent_message_review_required");
    assert.equal(calls.length,1);
    await flag.delete();
    await request.update({legalHold:true});
    await assert.rejects(inspect(db,bucket,opts),
      error=>error.code==="private_voice_r2_review_blocked");
    assert.equal(calls.length,1);
  }finally{
    await Promise.all(refs.map(ref=>ref.delete()));
  }
});
