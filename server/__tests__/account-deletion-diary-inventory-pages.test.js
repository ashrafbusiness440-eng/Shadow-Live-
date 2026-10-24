import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import {
  inspectAccountDiaryErasurePage as inspect,
  MAX_DIARY_ERASURE_PAGE,
} from "../../cloudflare-worker/src/account-deletion-diary-inventory-pages.js";

const uid="deleted_diary_user", other="other_diary_user";
const requestId="deletion_diary_request_123";
const actor={uid:"control_owner",owner:true};
const diaryId="diary_audited_001";
class FakeDb {
  constructor(){
    this.docs=new Map([
      ["account_deletion_requests/"+uid,{uid,requestId,status:"review_ready"}],
      ["account_deletion_erasure_checkpoints/"+uid,{uid,requestId,
        phase:"preflight_blocked",destructiveAllowed:false}],
      ["users/"+uid,{role:"user",coins:900}],
    ]);
    this.queries=[];this.writes=0;
  }
  async get(path){return {exists:this.docs.has(path),
    data:this.docs.get(path)||null};}
  addDiary(id,ms){
    const data={diaryId:id,ownerUid:uid,createdAtMs:ms,text:"private"};
    this.docs.set("users/"+uid+"/diaries/"+id,data);
    this.docs.set("diaries/"+id,{...data});
  }
  addComment(diary,id,author,ms,flags={}){
    this.docs.set("diaries/"+diary+"/comments/"+id,
      {diaryId:diary,commentId:id,authorUid:author,createdAtMs:ms,
        text:"sensitive",...flags});
  }
  async runQuery(collection,{orderBy,limit,startAfter}){
    this.queries.push({collection,orderBy,limit,startAfter});
    const prefix=collection+"/";
    let rows=[...this.docs].filter(([path])=>
      path.startsWith(prefix) && !path.slice(prefix.length).includes("/"))
      .map(([path,data])=>({id:path.slice(prefix.length),data}));
    rows.sort((a,b)=>b.data.createdAtMs-a.data.createdAtMs||
      b.id.localeCompare(a.id));
    if(startAfter?.length){
      const ms=startAfter[0].value;
      const id=startAfter[1].referencePath.slice(prefix.length);
      rows=rows.filter(row=>row.data.createdAtMs<ms||
        (row.data.createdAtMs===ms&&row.id<id));
    }
    return rows.slice(0,limit);
  }
}
test("bounded pages enumerate mirrored diaries with stable cursor and no content",async()=>{
  const db=new FakeDb();
  for(let i=0;i<8;i++)db.addDiary("diary_owned_"+i,1000-i);
  const seen=[];
  let cursor=null;
  for(let i=0;i<3;i++){
    const result=await inspect(db,{uid,requestId,actor,limit:3,cursor});
    seen.push(...result.items.map(x=>x.id));
    cursor=result.nextCursor;
    assert.equal(result.exhaustive,false);
    assert.equal(result.completionVerified,false);
    assert.equal(result.erasureAllowed,false);
    assert.equal(JSON.stringify(result).includes("private"),false);
    assert.equal(db.queries[i].limit,4);
  }
  assert.equal(seen.length,8);
  assert.equal(new Set(seen).size,8);
  assert.equal(cursor,null);
  assert.deepEqual(db.queries.map(x=>x.collection),
    Array(3).fill("users/"+uid+"/diaries"));
  assert.equal(db.writes,0);
});
test("nested page preserves other authors and flags protected evidence",async()=>{
  const db=new FakeDb();db.addDiary(diaryId,99);
  db.addComment(diaryId,"comment_001",uid,80);
  db.addComment(diaryId,"comment_002",other,70,{legalHold:true});
  const result=await inspect(db,{uid,requestId,actor,kind:"comments",diaryId});
  assert.deepEqual(result.items,[
    {id:"comment_001",authoredByDeleted:true,needsReview:false},
    {id:"comment_002",authoredByDeleted:false,needsReview:true},
  ]);
  assert.equal(result.flaggedForReview,true);
  assert.equal(result.hasMore,false);
  assert.equal(db.queries[0].collection,"diaries/"+diaryId+"/comments");
});
test("missing original diary is flagged, never certified as absent",async()=>{
  const db=new FakeDb();db.addDiary(diaryId,50);
  db.docs.delete("diaries/"+diaryId);
  const result=await inspect(db,{uid,requestId,actor});
  assert.equal(result.items[0].mirrorPresent,false);
  assert.equal(result.items[0].needsReview,true);
  assert.equal(result.exhaustive,false);
});
test("owner, invalid cursors, and unbounded page are rejected before reads",async()=>{
  const cases=[
    {actor:{uid:"fake",owner:false}},
    {uid:"../bad"},
    {limit:MAX_DIARY_ERASURE_PAGE+1},
    {limit:0},
    {cursor:{createdAtMs:1,id:"../not_safe"}},
    {kind:"comments",diaryId:"../../bad"},
  ];
  for(const patch of cases){
    const db=new FakeDb();
    db.get=()=>{throw Error("unexpected read");};
    await assert.rejects(inspect(db,{uid,requestId,actor,...patch}),
      e=>e.status===400||e.status===403);
    assert.equal(db.queries.length,0);
  }
});
test("request rotation, holds and mismatched diary block read inventory",async()=>{
  const changes=[
    db=>db.docs.get("account_deletion_requests/"+uid).requestId="rotated",
    db=>db.docs.get("account_deletion_requests/"+uid).status="cancelled",
    db=>db.docs.get("account_deletion_erasure_checkpoints/"+uid).requestId="stale",
    db=>db.docs.get("account_deletion_requests/"+uid).legalHold=true,
    db=>db.docs.get("users/"+uid).role="owner",
    db=>db.docs.get("diaries/"+diaryId).ownerUid=other,
  ];
  for(const change of changes){
    const db=new FakeDb();db.addDiary(diaryId,100);
    change(db);
    await assert.rejects(inspect(db,{uid,requestId,actor,
      kind:"comments",diaryId}),e=>e.status===409);
    assert.equal(db.queries.length,0);
  }
});
test("corrupt fields fail closed, without exposing private text",async()=>{
  const db=new FakeDb();db.addDiary(diaryId,100);
  db.addComment(diaryId,"comment_001",other,60);
  db.docs.get("diaries/"+diaryId+"/comments/comment_001").authorUid="../bad";
  await assert.rejects(inspect(db,{uid,requestId,actor,
    kind:"comments",diaryId}),e=>e.code==="diary_inventory_legacy_schema_review");
  assert.equal(db.writes,0);
});
test("source stays non-destructive and cannot claim finalization",()=>{
  const source=readFileSync(
    "cloudflare-worker/src/account-deletion-diary-inventory-pages.js","utf8");
  assert.doesNotMatch(source,/db\.commit\(|writeDelete\(|deleteAuthUser\(|setInterval\(/);
  assert.match(source,/completionVerified: false/);
  assert.match(source,/MAX_DIARY_ERASURE_PAGE = 5/);
});
