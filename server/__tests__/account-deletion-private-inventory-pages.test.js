import assert from "node:assert/strict";
import test from "node:test";
import {readFileSync} from "node:fs";
import {
  inspectAccountPrivateErasurePage as inspect,
  MAX_ACCOUNT_PRIVATE_INVENTORY_PAGE,
} from "../../cloudflare-worker/src/account-deletion-private-inventory-pages.js";

const uid="deleted_chat_user",other="other_chat_user";
const requestId="deletion_chat_request_1234";
const actor={uid:"control_owner_123",owner:true};
const conversationId="conversation_private_1234";
const rp="account_deletion_requests/"+uid;
const cp="account_deletion_erasure_checkpoints/"+uid;
const up="users/"+uid;
const chat="conversations/"+conversationId;
class Db{
  constructor(){
    this.docs=new Map([
      [rp,{uid,requestId,status:"review_ready"}],
      [cp,{uid,requestId,phase:"preflight_blocked",destructiveAllowed:false}],
      [up,{role:"user",coins:100}],
      [chat,{participants:[uid,other],lastMessage:"Secret chat"}],
    ]);
    this.queries=[];this.writes=0;
  }
  async get(path){return {exists:this.docs.has(path),data:this.docs.get(path)||null};}
  addMessage(i,sender=uid,type="text",extras={}){
    const id="message_private_"+String(i).padStart(3,"0");
    this.docs.set(chat+"/messages/"+id,{
      senderId:sender,receiverId:sender===uid?other:uid,type,
      text:"confidential",...extras,
    });
    return id;
  }
  async runQuery(path,opts){
    this.queries.push({path,opts});
    const prefix=path+"/";
    let rows=[...this.docs].filter(([key])=>key.startsWith(prefix)&&
      !key.slice(prefix.length).includes("/"))
      .map(([key,data])=>({id:key.slice(prefix.length),data}))
      .filter(row=>opts.filters[0].op==="array-contains"
        ? row.data?.participants?.includes(opts.filters[0].value)
        : row.data?.senderId===opts.filters[0].value)
      .sort((a,b)=>a.id.localeCompare(b.id));
    if(opts.startAfter.length){
      const cursor=opts.startAfter[0].referencePath.slice(prefix.length);
      rows=rows.filter(row=>row.id>cursor);
    }
    return rows.slice(0,opts.limit);
  }
}
const run=(db,patch={})=>inspect(db,{uid,requestId,actor,...patch});
test("read-only 5/5/1 authored-message pages; other person's messages remain unexposed",async()=>{
  const db=new Db();
  for(let i=0;i<11;i++)db.addMessage(i);
  db.addMessage(90,other);
  const items=[];let cursor=null;
  for(let i=0;i<3;i++){
    const page=await run(db,{
      kind:"authored_messages",conversationId,limit:5,cursor,
    });
    items.push(...page.items);cursor=page.nextCursor;
    assert.equal(page.exhaustive,false);
    assert.equal(page.completionVerified,false);
    assert.equal(page.erasureAllowed,false);
    assert.equal(JSON.stringify(page).includes("confidential"),false);
    assert.equal(db.queries[i].opts.limit,6);
  }
  assert.equal(items.length,11);
  assert.equal(new Set(items.map(x=>x.id)).size,11);
  assert.equal(cursor,null);
  assert.equal(db.docs.get(chat+"/messages/message_private_090").senderId,other);
  assert.equal(db.writes,0);
});
test("conversation discovery checks known membership without revealing identities or previews",async()=>{
  const db=new Db();const second="conversation_other_1234";
  db.docs.set("conversations/"+second,{participants:[uid,"counterpart_789"]});
  db.docs.set("conversations/not_mine_1234",
    {participants:[other,"counterpart_789"]});
  const page=await run(db);
  assert.equal(page.items.length,2);
  assert.equal(page.items.every(x=>x.needsReview===false),true);
  assert.equal(JSON.stringify(page).includes("Secret chat"),false);
  assert.equal(JSON.stringify(page).includes(other),false);
  assert.deepEqual(db.queries[0].opts.filters,
    [{field:"participants",op:"array-contains",value:uid}]);
});
test("protected evidence, voice and gifts require review rather than automatic erasure",async()=>{
  const db=new Db();
  db.addMessage(0,uid,"text");
  const flagged=db.addMessage(1,uid,"text");
  db.docs.set("content_filter_flags/"+flagged,{evidence:"protected"});
  db.addMessage(2,uid,"voice_note");
  db.addMessage(3,uid,"gift");
  db.addMessage(4,uid,"deleted");
  const page=await run(db,{kind:"authored_messages",conversationId});
  assert.deepEqual(page.items.map(x=>x.class),[
    "text_candidate","text_candidate","media_or_legacy_review",
    "media_or_legacy_review","tombstone_review",
  ]);
  assert.deepEqual(page.items.map(x=>x.needsReview),
    [false,true,true,true,true]);
  assert.equal(page.items[1].evidenceFlagPresent,true);
  assert.equal(page.needsReview,true);
});
test("late appeals on messages and conversations flag review without revealing text",async()=>{
  const db=new Db();
  db.addMessage(1,uid,"text",{appealPending:true});
  db.addMessage(2,uid,"text",{appealStatus:" Open "});
  const p=await run(db,{kind:"authored_messages",conversationId});
  assert.deepEqual(p.items.map(x=>x.needsReview),[true,true]);
  assert.equal(p.erasureAllowed,false);
  assert.equal(JSON.stringify(p).includes("confidential"),false);
  assert.equal(db.docs.get(chat).lastMessage,"Secret chat");
  db.docs.get(chat).appealStatus="under_review";
  assert.equal((await run(db)).items[0].needsReview,true);
});
test("mismatched recipient or unknown text schema is marked for separate review",async()=>{
  const db=new Db();
  db.addMessage(1,uid,"text",{receiverId:"third_party_123"});
  db.addMessage(2,uid,"text",{unexpectedPrivateMediaUrl:"secret"});
  const page=await run(db,{kind:"authored_messages",conversationId});
  assert.equal(page.items.length,2);
  assert.deepEqual(page.items.map(x=>x.needsReview),[true,true]);
  assert.equal(page.needsReview,true);
  assert.equal(JSON.stringify(page).includes("secret"),false);
});
test("holds, cancelled/stale requests and invalid conversation block query",async()=>{
  const cases=[
    d=>d.docs.get(rp).status="cancelled",
    d=>d.docs.get(rp).requestId="other_request_12345",
    d=>d.docs.get(cp).requestId="older_request_12345",
    d=>d.docs.get(cp).legalHold=true,
    d=>d.docs.get(rp).appealPending=true,
    d=>d.docs.get(cp).appealStatus="Under_Review",
    d=>d.docs.get(up).appealStatus="OPEN",
    d=>d.docs.get(chat).appealPending=true,
    d=>d.docs.get(up).role="owner",
    d=>d.docs.get(up).authDeleted=true,
    d=>d.docs.get(chat).participants=[other,"third_user_321"],
    d=>d.docs.get(chat).evidenceHold=true,
  ];
  for(const change of cases){
    const db=new Db();change(db);
    await assert.rejects(run(db,{kind:"authored_messages",conversationId}),
      e=>e.status===409);
    assert.equal(db.queries.length,0);
  }
});
test("invalid input rejected before reads",async()=>{
  for(const patch of [
    {uid:"../bad"}, {requestId:"bad"},
    {actor:{owner:false,uid:"other_owner"}},
    {kind:"all"},{kind:"authored_messages",conversationId:"../unsafe"},
    {cursor:"../bad"}, {limit:0},
    {limit:MAX_ACCOUNT_PRIVATE_INVENTORY_PAGE+1},
  ]){
    const db=new Db();db.get=()=>{throw Error("unexpected_read");};
    await assert.rejects(run(db,patch),e=>e.status===400||e.status===403);
    assert.equal(db.queries.length,0);
  }
});
test("corrupted returned owner fails closed and never exposes message",async()=>{
  const db=new Db();db.addMessage(1);
  db.runQuery=async()=>[{id:"message_private_001",
    data:{senderId:other,type:"text",text:"private"}}];
  await assert.rejects(run(db,{kind:"authored_messages",conversationId}),
    e=>e.code==="private_inventory_message_owner_conflict");
  assert.equal(db.writes,0);
});
test("module cannot mutate, scan globally or complete an erasure",()=>{
  const s=readFileSync(
    "cloudflare-worker/src/account-deletion-private-inventory-pages.js","utf8");
  assert.doesNotMatch(s,/db\.commit\(|writeDelete\(|deleteAuthUser\(|setInterval\(/);
  assert.match(s,/MAX_ACCOUNT_PRIVATE_INVENTORY_PAGE = 5/);
  assert.match(s,/completionVerified: false/);
});
