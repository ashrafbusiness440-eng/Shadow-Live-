import assert from "node:assert/strict";
import {test,after} from "node:test";
import {randomUUID} from "node:crypto";
import {getApps,initializeApp,deleteApp} from "firebase-admin/app";
import {getFirestore} from "firebase-admin/firestore";
import {cloudflareFirestoreAdapter} from "./helpers/cloudflare-firestore-adapter.js";
import {drainAccountPrivateTextPage as drain}
  from "../../cloudflare-worker/src/account-deletion-private-text-batches.js";
import {seedEmulatorErasureCertificates}
  from "./helpers/account-erasure-synthetic-certificates.js";
import {REQUIRED_ERASURE_ADMISSION_DOMAINS as domains}
  from "../../cloudflare-worker/src/account-deletion-processing-admission.js";

const app=getApps()[0]||initializeApp({projectId:"shadow-live-economy-test"});
const store=getFirestore(app),db=cloudflareFirestoreAdapter(store);
after(async()=>{await deleteApp(app);});
const id=()=>randomUUID().replaceAll("-","").slice(0,18);

test("emulator: 3/3/1 private text cursor pages redact author only; media and counterparty preserved",async()=>{
  const suffix=id(),uid="erase_text_"+suffix,other="other_text_"+suffix;
  const requestId="erase_message_req_"+suffix;
  const nowMs=Date.now();
  const certs=await seedEmulatorErasureCertificates(store,{
    uid,requestId,nowMs,
  });
  const conversationId="conversation_"+suffix;
  const request=store.doc("account_deletion_requests/"+uid);
  const checkpoint=store.doc("account_deletion_erasure_checkpoints/"+uid);
  const admission=store.doc("admin_audit_logs/erasure_processing_start_"+requestId);
  const user=store.doc("users/"+uid);
  const conversation=store.doc("conversations/"+conversationId);
  const messages=Array.from({length:7},(_,i)=>
    conversation.collection("messages").doc("owned_message_"+suffix+"_"+i));
  const theirMessage=conversation.collection("messages").doc("theirs_"+suffix);
  const heldMedia=conversation.collection("messages").doc("voice_"+suffix);
  const flag=store.doc("content_filter_flags/"+messages[0].id);
  const refs=[request,checkpoint,admission,user,conversation,...messages,
    theirMessage,heldMedia,flag,...certs];
  await Promise.all([
    request.set({uid,requestId,status:"processing",
      requestedAt:new Date(nowMs-40*86400_000),
      eligibleAt:new Date(nowMs-10*86400_000)}),
    checkpoint.set({uid,requestId,phase:"private_text",destructiveAllowed:true,
      privateMessageRetentionCleared:true,legalEvidenceReviewComplete:true}),
    admission.set({action:"accountErasureProcessingAdmitted",
      targetId:uid,requestId,certifiedDomains:[...domains]}),
    user.set({role:"user",accountStatus:"deletion_processing",coins:700,
      diamonds:13}),
    conversation.set({participants:[uid,other],lastSenderId:uid,
      lastMessage:"Sensitive sender preview",unreadCounts:{[other]:2}}),
    ...messages.map((ref,i)=>ref.set({
      senderId:uid,receiverId:other,type:"text",
      text:"private content "+i,createdAt:new Date("2026-10-01T00:00:00Z"),
    })),
    theirMessage.set({senderId:other,receiverId:uid,type:"text",
      text:"Counterparty untouched"}),
  ]);
  try{
    const opts={uid,requestId,conversationId};
    let cursor=null;
    const counts=[];
    for(let i=0;i<3;i++){
      const page=await drain(db,{...opts,cursor,limit:3});
      counts.push(page.redacted);
      cursor=page.nextCursor;
      assert.equal(page.completionVerified,false);
      assert.equal(page.erasureComplete,false);
    }
    assert.deepEqual(counts,[3,3,1]);
    assert.equal(cursor,null);
    for(const ref of messages){
      const data=(await ref.get()).data();
      assert.equal(data.type,"deleted");
      assert.equal(data.deletedForEveryone,true);
      assert.equal("text" in data,false);
    }
    assert.equal((await theirMessage.get()).data().text,
      "Counterparty untouched");
    assert.equal((await conversation.get()).data().lastMessage,
      "رسالة من حساب محذوف");
    assert.equal((await user.get()).data().coins,700);
    assert.equal((await user.get()).data().diamonds,13);
    const repeat=await drain(db,{...opts,limit:3});
    assert.equal(repeat.redacted,0);
    assert.equal(repeat.duplicate,3);
    await heldMedia.set({senderId:uid,receiverId:other,
      type:"voice_note",objectKey:"protected-asset"});
    await assert.rejects(drain(db,{...opts,cursor:messages[6].id}),
      e=>e.code==="private_text_batch_media_or_legacy_review");
    assert.equal((await heldMedia.get()).data().objectKey,"protected-asset");
    await request.update({investigationHold:true});
    await assert.rejects(drain(db,{...opts}),
      e=>e.code==="private_text_batch_not_authorized");
    await request.update({investigationHold:false});
    await flag.set({evidenceHold:true});
    await assert.rejects(drain(db,{...opts}),
      e=>e.code==="private_text_batch_protected_evidence");
  }finally{
    await Promise.all(refs.map(ref=>ref.delete()));
  }
});
