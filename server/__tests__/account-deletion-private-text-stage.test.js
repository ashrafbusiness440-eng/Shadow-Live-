import assert from "node:assert/strict";
import {test} from "node:test";
import {readFileSync} from "node:fs";
import {redactDeletedPrivateTextMessage} from "../../cloudflare-worker/src/account-deletion-private-text-stage.js";

const uid="deleted_member_123", other="other_member_456";
const requestId="account_request_1234567890", conversationId="conversation_012345", messageId="message_01234567890";
const requestPath="account_deletion_requests/"+uid;
const checkpointPath="account_deletion_erasure_checkpoints/"+uid;
const userPath="users/"+uid;
const conversationPath="conversations/"+conversationId;
const messagePath=conversationPath+"/messages/"+messageId;
class Db{
 constructor(){
   this.docs=new Map([
     [requestPath,{uid,requestId,status:"processing"}],
     [checkpointPath,{requestId,phase:"private_text",destructiveAllowed:true,
       privateMessageRetentionCleared:true,legalEvidenceReviewComplete:true}],
     [userPath,{role:"user",accountStatus:"deletion_processing",coins:700}],
     [conversationPath,{participants:[uid,other],lastSenderId:uid,lastMessage:"Sensitive preview",
       unreadCounts:{[other]:1}}],
     [messagePath,{senderId:uid,receiverId:other,type:"text",text:"Private contents",
       vipLevel:1,createdAt:new Date("2026-10-01T12:00:00Z")}],
     [conversationPath+"/messages/their_message_012345",{senderId:other,receiverId:uid,text:"Their text"}],
   ]);
   this.commits=[];this.rollbacks=0;
 }
 async beginTransaction(){return "tx";}
 async get(path,tx){assert.equal(tx,"tx");return {exists:this.docs.has(path),data:this.docs.get(path)??null};}
 writeMaskedUpdate(path,fields,fieldPaths){return {kind:"masked",path,fields,fieldPaths};}
 writeUpdate(path,fields,fieldPaths){return {kind:"update",path,fields,fieldPaths};}
 async commit(tx,writes){
  assert.equal(tx,"tx");
  const updated=new Map(this.docs);
  for(const w of writes){
    const previous=updated.get(w.path)||{},next={...previous};
    if(w.kind==="masked"){
      for(const k of w.fieldPaths){if(Object.hasOwn(w.fields,k))next[k]=w.fields[k];else delete next[k];}
    }else{for(const [k,v] of Object.entries(w.fields))next[k]=v;}
    updated.set(w.path,next);
  }
  this.docs=updated;this.commits.push(writes);
 }
 async rollback(tx){assert.equal(tx,"tx");this.rollbacks++;}
}
const run=(db,extra={})=>redactDeletedPrivateTextMessage(db,{uid,requestId,conversationId,messageId,...extra});

test("redacts only own text and its last-preview, not counterpart messages or financial records",async()=>{
 const db=new Db();
 const result=await run(db);
 assert.deepEqual(result,{ok:true,redacted:true,duplicate:false});
 const msg=db.docs.get(messagePath);
 assert.equal(msg.type,"deleted");assert.equal(msg.deletedForEveryone,true);
 assert.equal("text" in msg,false);assert.equal("vipLevel" in msg,false);
 assert.equal(msg.senderId,uid);assert.equal(msg.receiverId,other);
 assert.equal(db.docs.get(conversationPath).lastMessage,"رسالة من حساب محذوف");
 assert.equal(db.docs.get(conversationPath).unreadCounts[other],1);
 assert.equal(db.docs.get(conversationPath+"/messages/their_message_012345").text,"Their text");
 assert.equal(db.docs.get(userPath).coins,700);
 assert.equal(db.commits.length,1);assert.equal(db.commits[0].length,2);
 assert.deepEqual(await run(db),{ok:true,redacted:false,duplicate:true});
 assert.equal(db.commits.length,1);
});
test("each unapproved hold, cancellation or uncertified checkpoint prevents erasure",async()=>{
 const muts=[
 d=>d.docs.get(requestPath).status="review_ready",
 d=>d.docs.get(requestPath).requestId="obsolete_request_999",
 d=>d.docs.get(requestPath).reviewHold=true,
 d=>d.docs.get(requestPath).appealPending=true,
 d=>d.docs.get(checkpointPath).appealStatus="Under_Review",
 d=>d.docs.get(userPath).appealPending=true,
 d=>d.docs.get(checkpointPath).phase="preflight_blocked",
 d=>d.docs.get(checkpointPath).destructiveAllowed=false,
 d=>d.docs.get(checkpointPath).legalEvidenceReviewComplete=false,
 d=>d.docs.get(checkpointPath).privateMessageRetentionCleared=false,
 d=>d.docs.get(checkpointPath).requestId="obsolete_request_999",
 d=>d.docs.get(userPath).legalHold=true,
 d=>d.docs.get(userPath).role="owner",
 d=>d.docs.get(userPath).accountStatus="active",
 d=>d.docs.delete(userPath),
 ];
 for(const mutate of muts){
   const db=new Db();mutate(db);
   await assert.rejects(run(db),e=>e.code==="private_text_erasure_blocked");
   assert.equal(db.commits.length,0);
   assert.equal(db.docs.get(messagePath).text,"Private contents");
 }
});
test("other user's message, image, unknown fields or any moderation flag fail closed",async()=>{
 const mutations=[
 d=>d.docs.get(messagePath).senderId=other,
 d=>d.docs.get(messagePath).receiverId=uid,
 d=>d.docs.get(messagePath).type="voice_note",
 d=>d.docs.get(messagePath).type="gift",
 d=>d.docs.get(messagePath).unexpectedAttachmentUrl="https://private",
 d=>d.docs.get(messagePath).legalHold=true,
 d=>d.docs.get(messagePath).investigationHold=true,
 d=>d.docs.get(messagePath).appealStatus="OPEN",
 d=>d.docs.get(conversationPath).appealPending=true,
 d=>d.docs.get(conversationPath).evidenceHold=true,
 d=>d.docs.get(conversationPath).participants=[uid,uid],
 d=>d.docs.set("content_filter_flags/"+messageId,{evidence:{text:"retain"}}),
 d=>d.docs.get(conversationPath).participants=[uid,"unknown"],
 ];
 for(const mutate of mutations){
  const db=new Db();mutate(db);
  await assert.rejects(run(db),/private_message_owner_mismatch|private_message_type_requires_review|unknown_private_message_fields|protected_private_message|private_conversation_invalid/);
  assert.equal(db.commits.length,0);
  assert.equal(db.docs.get(messagePath).text,"Private contents");
 }
});
test("invalid target or failed transaction does not erase",async()=>{
 const db=new Db();
 await assert.rejects(run(db,{messageId:"../bad"}),e=>e.status===400);
 db.commit=async()=>{throw Error("transaction_commit_failure");};
 await assert.rejects(run(db),/transaction_commit_failure/);
 assert.equal(db.docs.get(messagePath).text,"Private contents");
});
test("stage cannot enumerate chats, call Auth/R2 or delete counterpart",()=>{
 const source=readFileSync("cloudflare-worker/src/account-deletion-private-text-stage.js","utf8");
 assert.doesNotMatch(source,/runQuery\(|\.list\(|deleteAuthUser\(|writeDelete\(/);
 assert.match(source,/writeMaskedUpdate\(/);
 assert.match(source,/privateMessageRetentionCleared!==true/);
 assert.match(source,/legalEvidenceReviewComplete!==true/);
});
