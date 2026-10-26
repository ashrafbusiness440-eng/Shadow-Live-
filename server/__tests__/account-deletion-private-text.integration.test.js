import assert from "node:assert/strict";
import {after,test} from "node:test";
import {randomUUID} from "node:crypto";
import {deleteApp,getApps,initializeApp} from "firebase-admin/app";
import {getFirestore} from "firebase-admin/firestore";
import {cloudflareFirestoreAdapter} from "./helpers/cloudflare-firestore-adapter.js";
import {redactDeletedPrivateTextMessage} from "../../cloudflare-worker/src/account-deletion-private-text-stage.js";
import {seedEmulatorErasureCertificates}
  from "./helpers/account-erasure-synthetic-certificates.js";
import {REQUIRED_ERASURE_ADMISSION_DOMAINS as domains}
  from "../../cloudflare-worker/src/account-deletion-processing-admission.js";

const app=getApps()[0]||initializeApp({projectId:"shadow-live-economy-test"});
const db=getFirestore(app), workerDb=cloudflareFirestoreAdapter(db);
after(async()=>{await deleteApp(app);});
test("emulator: redact only a deleted sender's private text, retry-safe, hold-aware",async()=>{
 const suffix=randomUUID().replaceAll("-","").slice(0,16);
 const uid="eraser_"+suffix,other="counterpart_"+suffix;
 const requestId="account_delete_"+suffix,conversationId="conversation_"+suffix;
 const messageId="private_msg_"+suffix;
 const conversation=db.doc("conversations/"+conversationId);
 const own=conversation.collection("messages").doc(messageId);
 const theirs=conversation.collection("messages").doc("other_"+suffix);
 const request=db.doc("account_deletion_requests/"+uid);
 const checkpoint=db.doc("account_deletion_erasure_checkpoints/"+uid);
 const user=db.doc("users/"+uid);
 const evidence=db.doc("reports/report_"+suffix);
 const admission=db.doc("admin_audit_logs/erasure_processing_start_"+requestId);
 const opts={uid,requestId,conversationId,messageId};
 const nowMs=Date.now();
 const certs=await seedEmulatorErasureCertificates(db,{
   uid,requestId,nowMs,
 });
 await Promise.all([
   request.set({uid,requestId,status:"processing",
     requestedAt:new Date(nowMs-40*86400_000),
     eligibleAt:new Date(nowMs-10*86400_000)}),
   checkpoint.set({uid,requestId,phase:"private_text",destructiveAllowed:true,
     privateMessageRetentionCleared:true,legalEvidenceReviewComplete:true}),
   user.set({role:"user",accountStatus:"deletion_processing",diamonds:15}),
   conversation.set({participants:[uid,other],lastSenderId:uid,lastMessage:"Private contents"}),
   own.set({senderId:uid,receiverId:other,type:"text",text:"Private contents",
     vipLevel:1,createdAt:new Date("2026-10-01T00:00:00Z")}),
   theirs.set({senderId:other,receiverId:uid,type:"text",text:"Other person's message"}),
   evidence.set({reporterUid:other,targetUid:uid,evidence:"Unmodified evidence"}),
   admission.set({action:"accountErasureProcessingAdmitted",
     targetId:uid,requestId,certifiedDomains:[...domains]}),
 ]);
 try{
  const results=await Promise.all([
    redactDeletedPrivateTextMessage(workerDb,opts),
    redactDeletedPrivateTextMessage(workerDb,opts),
  ]);
  assert.deepEqual(results.map(x=>x.redacted).sort(),[false,true]);
  const privateRow=(await own.get()).data();
  assert.equal(privateRow.type,"deleted");
  assert.equal(privateRow.deletedForEveryone,true);
  assert.equal("text" in privateRow,false);
  assert.equal("vipLevel" in privateRow,false);
  assert.equal(privateRow.senderId,uid);
  assert.equal((await conversation.get()).data().lastMessage,"رسالة من حساب محذوف");
  assert.equal((await theirs.get()).data().text,"Other person's message");
  assert.equal((await user.get()).data().diamonds,15);
  assert.equal((await evidence.get()).data().evidence,"Unmodified evidence");
  // Revoking an independently audited Play signoff also blocks a
  // duplicate/tombstone retry; it cannot report certification success.
  const play= db.doc("account_deletion_erasure_approvals/"+
    requestId+"__play_billing");
  await play.update({decision:"revoked"});
  await assert.rejects(redactDeletedPrivateTextMessage(workerDb,opts),
    e=>e.code==="erasure_transactional_certification_blocked");
  assert.equal((await theirs.get()).data().text,"Other person's message");
  await play.update({decision:"approved"});
  await request.update({appealPending:true});
  await assert.rejects(redactDeletedPrivateTextMessage(workerDb,opts),
    e=>e.code==="private_text_erasure_blocked");
  assert.equal((await user.get()).data().diamonds,15);
  assert.equal((await theirs.get()).data().text,"Other person's message");
  await request.update({appealPending:false,status:"cancelled"});
  await assert.rejects(redactDeletedPrivateTextMessage(workerDb,opts),
    e=>e.code==="private_text_erasure_blocked");
 }finally{
  await Promise.all([own,theirs,conversation,request,checkpoint,user,evidence,
    admission,...certs].map(ref=>ref.delete()));
 }
});
