import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import {inspectAccountCrossDiaryComments as inspect}
  from "../../cloudflare-worker/src/account-deletion-cross-diary-comment-inventory.js";

const uid="deleted_comment_author", other="other_diary_owner";
const requestId="delete_request_comment_author_123";
const actor={uid:"control_owner",owner:true};
class Db{
  constructor(){
    this.docs=new Map([
      ["account_deletion_requests/"+uid,{uid,requestId,status:"review_ready"}],
      ["account_deletion_erasure_checkpoints/"+uid,
        {uid,requestId,phase:"preflight_blocked",destructiveAllowed:false}],
      ["users/"+uid,{role:"user",coins:100}],
    ]);
    this.queries=[];this.writes=0;
  }
  putOperation(i,action="createComment",data={}){
    const id="operation_000000"+String(i).padStart(2,"0");
    this.docs.set("diary_operations/"+id,
      {actorUid:uid,action,diaryId:"diary_other",
        result:{commentId:"comment_"+i},...data});
    return id;
  }
  async get(path){return {exists:this.docs.has(path),data:this.docs.get(path)||null};}
  async runQuery(collection,opts){
    this.queries.push({collection,opts});
    const prefix=collection+"/";
    let rows=[...this.docs].filter(([path])=>
      path.startsWith(prefix)&&!path.slice(prefix.length).includes("/"))
      .map(([path,data])=>({id:path.slice(prefix.length),data}))
      .filter(row=>row.data[opts.filters[0].field]===opts.filters[0].value)
      .sort((a,b)=>a.id.localeCompare(b.id));
    if(opts.startAfter.length){
      const cursor=opts.startAfter[0].referencePath.slice(prefix.length);
      rows=rows.filter(row=>row.id>cursor);
    }
    return rows.slice(0,opts.limit);
  }
}
test("pages operations and discovers another owner's comment without exposing text",async()=>{
  const db=new Db();db.docs.set("diaries/diary_other",
    {ownerUid:other,text:"other person's private post"});
  for(let i=0;i<9;i++){
    db.putOperation(i,i===3?"createDiary":"createComment");
    db.docs.set("diaries/diary_other/comments/comment_"+i,
      {authorUid:uid,diaryId:"diary_other",text:"hidden"});
  }
  let cursor=null;const results=[];
  for(let i=0;i<3;i++){
    const page=await inspect(db,{uid,requestId,actor,limit:4,cursor});
    results.push(...page.comments);
    cursor=page.nextCursor;
    assert.equal(page.completionVerified,false);
    assert.equal(page.erasureAllowed,false);
    assert.equal(JSON.stringify(page).includes("hidden"),false);
    assert.equal(db.queries[i].opts.limit,5);
  }
  assert.equal(results.length,8);
  assert.ok(results.every(x=>x.onOtherDiary===true));
  assert.equal(cursor,null);
  assert.equal(db.writes,0);
});
test("retention flag or missing operation metadata cannot be mistaken for clearance",async()=>{
  const db=new Db();db.docs.set("diaries/diary_other",{ownerUid:other});
  db.putOperation(1);db.putOperation(2,"createComment",{result:{}});
  db.docs.set("diaries/diary_other/comments/comment_1",
    {authorUid:uid,diaryId:"diary_other",text:"evidence"});
  db.docs.set("content_filter_flags/comment_1",{evidenceHold:true});
  const page=await inspect(db,{uid,requestId,actor});
  assert.equal(page.needsReview,true);
  assert.equal(page.comments[0].needsReview,true);
  assert.equal(page.comments[1].needsReview,true);
  assert.equal(page.exhaustive,false);
});
test("owner mismatches block and never modify counterparties",async()=>{
  const db=new Db();db.docs.set("diaries/diary_other",{ownerUid:other});
  db.putOperation(1);
  db.docs.set("diaries/diary_other/comments/comment_1",
    {authorUid:other,diaryId:"diary_other",text:"retain"});
  await assert.rejects(inspect(db,{uid,requestId,actor}),
    e=>e.code==="cross_diary_comment_owner_conflict");
  assert.equal(db.writes,0);
});
test("stale requests, holds and unauthorized or oversized cursors block before query",async()=>{
  const modifications=[
    db=>db.docs.get("account_deletion_requests/"+uid).status="cancelled",
    db=>db.docs.get("account_deletion_requests/"+uid).requestId="rotated",
    db=>db.docs.get("account_deletion_erasure_checkpoints/"+uid).requestId="stale",
    db=>db.docs.get("account_deletion_requests/"+uid).legalHold=true,
    db=>db.docs.get("users/"+uid).role="owner",
  ];
  for(const change of modifications){
    const db=new Db();change(db);
    await assert.rejects(inspect(db,{uid,requestId,actor}),
      e=>e.status===409);
    assert.equal(db.queries.length,0);
  }
  for(const patch of [
    {actor:{owner:false,uid:"not_owner"}},
    {limit:6},
    {cursor:"../../bad"},
    {requestId:"short"},
  ]){
    const db=new Db();db.get=()=>{throw Error("unexpected read");};
    await assert.rejects(inspect(db,{uid,requestId,actor,...patch}),
      e=>e.status===400||e.status===403);
  }
});
test("no destructive code, no completion claim",()=>{
  const source=readFileSync(
    "cloudflare-worker/src/account-deletion-cross-diary-comment-inventory.js",
    "utf8");
  assert.doesNotMatch(source,/db\.commit\(|writeDelete\(|deleteAuthUser\(|setInterval\(/);
  assert.match(source,/exhaustive: false/);
  assert.match(source,/MAX_CROSS_DIARY_OPERATION_PAGE = 5/);
});
