import assert from "node:assert/strict";
import {test} from "node:test";
import {readFileSync} from "node:fs";
import {seedSyntheticErasureCertificates}
  from "./helpers/account-erasure-synthetic-certificates.js";
import {REQUIRED_ERASURE_ADMISSION_DOMAINS as domains}
  from "../../cloudflare-worker/src/account-deletion-processing-admission.js";
import {
  drainAccountPrivateTextPage as drain,
  MAX_PRIVATE_TEXT_ERASURE_BATCH_ITEMS,
} from "../../cloudflare-worker/src/account-deletion-private-text-batches.js";

const uid="deleted_sender_123",other="counterparty_456";
const requestId="delete_private_request_123456";
const conversationId="private_conversation_1234";
const rp="account_deletion_requests/"+uid;
const cp="account_deletion_erasure_checkpoints/"+uid;
const up="users/"+uid;
const chat="conversations/"+conversationId;
const msgPath="conversations/"+conversationId+"/messages/";
const msgId=i=>"private_msg_"+String(i).padStart(4,"0");

class Db {
  constructor(){
    this.docs=new Map([
      [rp,{uid,requestId,status:"processing",
        requestedAt:new Date(Date.now()-40*86400_000),
        eligibleAt:new Date(Date.now()-10*86400_000)}],
      [cp,{uid,requestId,phase:"private_text",destructiveAllowed:true,
        privateMessageRetentionCleared:true,legalEvidenceReviewComplete:true}],
      [up,{role:"user",accountStatus:"deletion_processing",coins:500}],
      ["admin_audit_logs/erasure_processing_start_"+requestId,{
        action:"accountErasureProcessingAdmitted",targetId:uid,requestId,
        certifiedDomains:[...domains],
      }],
      [chat,{participants:[uid,other],lastSenderId:uid,
        lastMessage:"Private last preview",unreadCounts:{[other]:4}}],
    ]);
    seedSyntheticErasureCertificates(this.docs,{uid,requestId,nowMs:Date.now()});
    this.queries=[];this.commits=[];this.txCalls=0;this.failOn=0;
  }
  add(n=12){
    for(let i=0;i<n;i++)this.docs.set(msgPath+msgId(i),{
      senderId:uid,receiverId:other,type:"text",
      text:"secret "+i,createdAt:new Date("2026-10-01T00:00:00Z"),
    });
    this.docs.set(msgPath+"counterparty_msg_9999",{
      senderId:other,receiverId:uid,type:"text",text:"theirs",
    });
  }
  async get(path){return {exists:this.docs.has(path),data:this.docs.get(path)??null};}
  async beginTransaction(){this.txCalls++;return "tx";}
  async rollback(){}
  writeMaskedUpdate(path,fields,fieldPaths){
    return {type:"masked",path,fields,fieldPaths};}
  writeUpdate(path,fields,fieldPaths){
    return {type:"update",path,fields,fieldPaths};}
  async commit(_tx,writes){
    if(this.failOn && this.commits.length+1===this.failOn)
      throw Error("network_outage");
    const next=new Map(this.docs);
    for(const write of writes){
      const previous=next.get(write.path)??{},data={...previous};
      if(write.type==="masked"){
        for(const key of write.fieldPaths){
          if(Object.hasOwn(write.fields,key))data[key]=write.fields[key];
          else delete data[key];
        }
      }else Object.assign(data,write.fields);
      next.set(write.path,data);
    }
    this.docs=next;this.commits.push(writes);
  }
  async runQuery(collection,opts){
    this.queries.push({collection,opts});
    const prefix=collection+"/";
    let rows=[...this.docs].filter(([p,d])=>p.startsWith(prefix)&&
      !p.slice(prefix.length).includes("/")&&
      d.senderId===opts.filters[0].value)
      .map(([p,d])=>({id:p.slice(prefix.length),data:d}))
      .sort((a,b)=>a.id.localeCompare(b.id));
    if(opts.startAfter.length){
      const cursor=opts.startAfter[0].referencePath.slice(prefix.length);
      rows=rows.filter(row=>row.id>cursor);
    }
    return rows.slice(0,opts.limit);
  }
}
const run=(db,patch={})=>drain(db,{
  uid,requestId,conversationId,...patch,
});
test("5/5/2 authored text redactions with stable name cursor, no counterparty writes",async()=>{
  const db=new Db();db.add(12);
  const counts=[];let cursor=null;
  for(let page=0;page<3;page++){
    const result=await run(db,{cursor});
    counts.push(result.redacted);
    assert.equal(result.completionVerified,false);
    assert.equal(result.erasureComplete,false);
    cursor=result.nextCursor;
  }
  assert.deepEqual(counts,[5,5,2]);
  assert.equal(cursor,null);
  assert.deepEqual(db.queries.map(q=>q.opts.limit),[6,6,6]);
  assert.equal(db.queries.every(q=>q.opts.filters[0].value===uid),true);
  assert.equal(db.docs.get(msgPath+"counterparty_msg_9999").text,"theirs");
  assert.equal(db.docs.get(up).coins,500);
  assert.equal(db.docs.get(chat).unreadCounts[other],4);
  for(let i=0;i<12;i++){
    const row=db.docs.get(msgPath+msgId(i));
    assert.equal(row.type,"deleted");
    assert.equal("text" in row,false);
    assert.equal(row.erasureRequestId,requestId);
  }
  assert.equal(db.commits.length,12);
});
test("replaying a page only returns tombstone duplicates without new writes",async()=>{
  const db=new Db();db.add(6);
  const first=await run(db);
  assert.equal(first.redacted,5);
  assert.equal(first.hasMore,true);
  const second=await run(db);
  assert.equal(second.redacted,0);
  assert.equal(second.duplicate,5);
  assert.equal(second.nextCursor,first.nextCursor);
  assert.equal(db.commits.length,5);
});
test("media, protected evidence or malformed text block entire selected page",async()=>{
  const cases=[
    d=>d.docs.get(msgPath+msgId(1)).type="voice_note",
    d=>d.docs.get(msgPath+msgId(1)).type="gift",
    d=>d.docs.get(msgPath+msgId(1)).type="deleted",
    d=>d.docs.get(msgPath+msgId(1)).legacyMediaKey="secret",
    d=>d.docs.get(msgPath+msgId(1)).receiverId="third_user_567",
    d=>d.docs.get(msgPath+msgId(1)).investigationHold=true,
    d=>d.docs.get(msgPath+msgId(1)).appealPending=true,
    d=>d.docs.get(msgPath+msgId(1)).appealStatus="OPEN",
    d=>d.docs.set("content_filter_flags/"+msgId(1),{evidence:"retain"}),
  ];
  for(const edit of cases){
    const db=new Db();db.add(5);edit(db);
    await assert.rejects(run(db),e=>e.code.startsWith("private_text_batch_"));
    assert.equal(db.commits.length,0);
    assert.equal(db.docs.get(msgPath+msgId(0)).text,"secret 0");
  }
});
test("cancelled request, role, holds, policies and invalid participants stop before any query",async()=>{
  const edits=[
    d=>d.docs.get(rp).status="cancelled",
    d=>d.docs.get(rp).requestId="different_req_12345678",
    d=>d.docs.get(cp).phase="other",
    d=>d.docs.get(cp).destructiveAllowed=false,
    d=>d.docs.get(cp).privateMessageRetentionCleared=false,
    d=>d.docs.get(cp).legalEvidenceReviewComplete=false,
    d=>d.docs.get(cp).evidenceHold=true,
    d=>d.docs.get(cp).appealStatus="Under_Review",
    d=>d.docs.get(rp).appealPending=true,
    d=>d.docs.get(up).appealPending=true,
    d=>d.docs.get(chat).appealStatus="open",
    d=>d.docs.get(up).accountStatus="active",
    d=>d.docs.get(up).role="owner",
    d=>d.docs.get(up).authDeleted=true,
    d=>d.docs.get(chat).legalHold=true,
    d=>d.docs.get(chat).participants=[uid,uid],
    d=>d.docs.get(chat).participants=[uid,other,"third_member_789"],
  ];
  for(const edit of edits){
    const db=new Db();db.add(2);edit(db);
    await assert.rejects(run(db),e=>e.status===409);
    assert.equal(db.queries.length,0);
    assert.equal(db.commits.length,0);
  }
});
test("transient failure halfway resumes safely at identical cursor",async()=>{
  const db=new Db();db.add(5);db.failOn=3;
  await assert.rejects(run(db),/network_outage/);
  assert.equal(db.commits.length,2);
  assert.equal(db.docs.get(msgPath+msgId(0)).type,"deleted");
  db.failOn=0;
  const retry=await run(db);
  assert.equal(retry.redacted,3);
  assert.equal(retry.duplicate,2);
  assert.equal(db.commits.length,5);
  assert.equal(db.docs.get(msgPath+"counterparty_msg_9999").text,"theirs");
});
test("mid-page newly added legal hold stops subsequent exact-record transaction",async()=>{
  const db=new Db();db.add(3);
  const original=db.commit.bind(db);
  db.commit=async(tx,writes)=>{
    await original(tx,writes);
    if(db.commits.length===1)db.docs.get(chat).legalHold=true;
  };
  await assert.rejects(run(db),e=>e.code==="private_conversation_invalid");
  assert.equal(db.commits.length,1);
  db.docs.get(chat).legalHold=false;
  const result=await run(db);
  assert.equal(result.redacted,2);
  assert.equal(result.duplicate,1);
  assert.equal(db.commits.length,3);
});
test("invalid identifiers, cursor, limit, timestamp rejected before reading",async()=>{
  for(const patch of [
    {uid:"../../unsafe"},{requestId:"bad"},
    {conversationId:"../unsafe"},{cursor:"unsafe"},
    {limit:0},{limit:MAX_PRIVATE_TEXT_ERASURE_BATCH_ITEMS+1},
    {limit:"5"},{now:new Date("bad")},
  ]){
    const db=new Db();db.get=async()=>{throw Error("unexpected_io");};
    await assert.rejects(run(db,patch),e=>e.status===400);
    assert.equal(db.queries.length,0);
  }
});
test("code cannot scan, automatically schedule, erase Auth/R2 or certify deletion",()=>{
  const code=readFileSync(
    "cloudflare-worker/src/account-deletion-private-text-batches.js",
    "utf8");
  assert.doesNotMatch(code,/deleteAuthUser\(|setInterval\(|bucket\.delete\(/);
  assert.match(code,/completionVerified: false/);
  assert.match(code,/orderBy: \[\{ field: "__name__"/);
});

test("private text preflight refuses to enumerate before admission and grace",async()=>{
 const audit="admin_audit_logs/erasure_processing_start_"+requestId;
 const changes=[
  db=>db.docs.delete(audit),
  db=>db.docs.get(audit).targetId="not_this_account",
  db=>db.docs.get(audit).certifiedDomains=["retention_policy"],
  db=>db.docs.get(audit).legalHold=true,
  db=>db.docs.get(rp).eligibleAt=new Date(Date.now()+86400_000),
  db=>db.docs.get(rp).requestedAt=new Date(Date.now()-86400_000),
  db=>db.docs.get(cp).uid="someone_else",
 ];
 for(const change of changes){
  const db=new Db();db.add(2);change(db);
  await assert.rejects(run(db),e=>[
    "private_text_batch_not_authorized",
    "private_text_batch_grace_not_elapsed",
  ].includes(e.code));
  assert.equal(db.queries.length,0);
  assert.equal(db.commits.length,0);
  assert.equal(db.docs.get(msgPath+msgId(0)).text,"secret 0");
  assert.equal(db.docs.get(msgPath+"counterparty_msg_9999").text,"theirs");
 }
});
