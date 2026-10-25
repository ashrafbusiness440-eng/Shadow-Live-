import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import {
  inspectAccountDiaryInteractions as inspect,
  MAX_DIARY_INTERACTION_INVENTORY_PAGE,
} from "../../cloudflare-worker/src/account-deletion-diary-interaction-inventory.js";

const uid="user_to_delete_1", other="counterparty_user_2";
const requestId="request_to_delete_12345";
const actor={uid:"control_owner_456",owner:true};
const key=uid=>Buffer.from(uid,"utf8").toString("hex");
class FakeDb {
  constructor(){
    this.docs=new Map([
      ["account_deletion_requests/"+uid,{uid,requestId,status:"review_ready"}],
      ["account_deletion_erasure_checkpoints/"+uid,
        {uid,requestId,phase:"preflight_blocked",destructiveAllowed:false}],
      ["users/"+uid,{role:"user",coins:350}],
    ]);
    this.queries=[];this.mutated=false;
  }
  add(kind,number,diaryOwner=other){
    const diaryId="diary_test_"+number;
    const path=(kind==="likes"?"diary_likes":"diary_view_keys")+
      "/"+diaryId+"__"+key(uid);
    this.docs.set(path,{diaryId,userUid:uid,createdAt:"secret"});
    this.docs.set("diaries/"+diaryId,
      {ownerUid:diaryOwner,text:"keep private",likeCount:7,viewCount:99});
  }
  async get(path){return {exists:this.docs.has(path),data:this.docs.get(path)||null};}
  async runQuery(collection,opts){
    this.queries.push({collection,opts});
    const prefix=collection+"/";
    let rows=[...this.docs].filter(([path])=>
      path.startsWith(prefix) && !path.slice(prefix.length).includes("/"))
      .map(([path,data])=>({id:path.slice(prefix.length),data}))
      .filter(row=>row.data?.userUid===opts.filters[0].value)
      .sort((a,b)=>a.id.localeCompare(b.id));
    if(opts.startAfter.length){
      const id=opts.startAfter[0].referencePath.slice(prefix.length);
      rows=rows.filter(row=>row.id>id);
    }
    return rows.slice(0,opts.limit);
  }
}
test("indexed 5-item pages discover 11 likes without reducing counterparty counts",async()=>{
  const db=new FakeDb();
  for(let i=0;i<11;i++)db.add("likes",i);
  db.docs.set("diary_likes/somebody_else_"+key(other),
    {diaryId:"diary_other",userUid:other});
  const ids=[];let cursor=null;
  for(let i=0;i<3;i++){
    const page=await inspect(db,{uid,requestId,actor,limit:5,cursor});
    ids.push(...page.items.map(x=>x.id));cursor=page.nextCursor;
    assert.equal(page.exhaustive,false);
    assert.equal(page.erasureAllowed,false);
    assert.equal(page.completionVerified,false);
    assert.equal(page.items.every(x=>x.onOtherUserDiary===true),true);
    assert.equal(JSON.stringify(page).includes("keep private"),false);
    assert.equal(db.queries[i].opts.limit,6);
    assert.deepEqual(db.queries[i].opts.filters,
      [{field:"userUid",op:"==",value:uid}]);
  }
  assert.equal(ids.length,11);
  assert.equal(new Set(ids).size,11);
  assert.equal(cursor,null);
  assert.equal(db.docs.get("diaries/diary_test_0").likeCount,7);
  assert.equal(db.docs.get("users/"+uid).coins,350);
  assert.equal(db.mutated,false);
});
test("view dedupe keys are discoverable even without diary_operations",async()=>{
  const db=new FakeDb();db.add("views",1,uid);db.add("views",2,other);
  const page=await inspect(db,{uid,requestId,actor,kind:"views"});
  assert.deepEqual(page.items.map(x=>x.onOtherUserDiary),[false,true]);
  assert.equal(db.queries[0].collection,"diary_view_keys");
  assert.equal(page.hasMore,false);
});
test("open appeals on owned like or counterpart diary require review",async()=>{
  for(const path of [
    "diary_likes/diary_test_1__"+key(uid),
    "diaries/diary_test_1",
  ]) {
    const db=new FakeDb();db.add("likes",1);
    db.docs.get(path).appealStatus=" OPEN ";
    const page=await inspect(db,{uid,requestId,actor});
    assert.equal(page.items[0].needsReview,true);
    assert.equal(page.erasureAllowed,false);
    assert.equal(db.docs.get("diaries/diary_test_1").likeCount,7);
    assert.equal(db.docs.get("users/"+uid).coins,350);
  }
});
test("missing diary and anomalous legacy key are flagged, not cleared",async()=>{
  const db=new FakeDb();db.add("likes",1);
  db.docs.delete("diaries/diary_test_1");
  db.docs.set("diary_likes/unusual_legacy_key",
    {diaryId:"diary_test_2",userUid:uid});
  const page=await inspect(db,{uid,requestId,actor});
  assert.equal(page.needsReview,true);
  assert.equal(page.items.length,2);
  assert.ok(page.items.every(x=>x.needsReview));
  assert.equal(page.exhaustive,false);
});
test("hold and request rotation prevent discovery, not treated as empty",async()=>{
  const edits=[
    db=>db.docs.get("account_deletion_requests/"+uid).status="cancelled",
    db=>db.docs.get("account_deletion_requests/"+uid).requestId="rotated",
    db=>db.docs.get("account_deletion_erasure_checkpoints/"+uid).requestId="old",
    db=>db.docs.get("account_deletion_requests/"+uid).legalHold=true,
    db=>db.docs.get("account_deletion_requests/"+uid).appealPending=true,
    db=>db.docs.get("account_deletion_erasure_checkpoints/"+uid).appealStatus="Under_Review",
    db=>db.docs.get("users/"+uid).appealPending=true,
    db=>db.docs.get("users/"+uid).role="owner",
  ];
  for(const edit of edits){
    const db=new FakeDb();edit(db);
    await assert.rejects(inspect(db,{uid,requestId,actor}),
      e=>e.code==="diary_interaction_inventory_blocked");
    assert.equal(db.queries.length,0);
  }
});
test("invalid authorization, page and cursor fail before database calls",async()=>{
  for(const patch of [
    {actor:{owner:false,uid:"not_owner"}},
    {uid:"../invalid"},
    {requestId:"short"},
    {kind:"all"},
    {limit:0},
    {limit:MAX_DIARY_INTERACTION_INVENTORY_PAGE+1},
    {cursor:"bad/thing"},
  ]){
    const db=new FakeDb();
    db.get=()=>{throw Error("must not read");};
    await assert.rejects(inspect(db,{uid,requestId,actor,...patch}),
      e=>e.status===400||e.status===403);
    assert.equal(db.queries.length,0);
  }
});
test("unexpected indexed record owner fails closed",async()=>{
  const db=new FakeDb();db.add("likes",1);
  db.runQuery=async()=>[{id:"fake_record",data:{userUid:other,
    diaryId:"diary_test_1"}}];
  await assert.rejects(inspect(db,{uid,requestId,actor}),
    e=>e.code==="invalid_diary_interaction_page");
});
test("source never mutates, schedules, deletes Auth or claims full inventory",()=>{
  const source=readFileSync(
    "cloudflare-worker/src/account-deletion-diary-interaction-inventory.js",
    "utf8");
  assert.doesNotMatch(source,/writeDelete\(|db\.commit\(|deleteAuthUser\(|setInterval\(/);
  assert.match(source,/MAX_DIARY_INTERACTION_INVENTORY_PAGE = 5/);
  assert.match(source,/exhaustive: false/);
});
