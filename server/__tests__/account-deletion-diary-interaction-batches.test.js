import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import {
  drainAccountDiaryInteractions as drain,
  MAX_DIARY_ERASURE_BATCH_ITEMS,
} from "../../cloudflare-worker/src/account-deletion-diary-interaction-batches.js";

const uid="erased_diarist_123", other="other_diarist_999";
const requestId="diary_erasure_request_123456";
const req="account_deletion_requests/"+uid;
const cp="account_deletion_erasure_checkpoints/"+uid;
const user="users/"+uid;
const hx=u=>Buffer.from(u,"utf8").toString("hex");

class Db {
  constructor(){
    this.docs=new Map([
      [req,{uid,requestId,status:"processing"}],
      [cp,{uid,requestId,phase:"diary_interactions",
        destructiveAllowed:true,diaryInteractionRetentionCleared:true,
        legalEvidenceReviewComplete:true,historicalDiaryCountersReviewed:true}],
      [user,{role:"user",accountStatus:"deletion_processing",
        coins:99,diamonds:1}],
    ]);
    this.queries=[];this.commits=[];this.failAt=0;
  }
  add(kind,count){
    const collection=kind==="likes"?"diary_likes":"diary_view_keys";
    for(let i=0;i<count;i++){
      const id="owned_diary_"+kind+"_"+String(i).padStart(3,"0");
      this.docs.set("diaries/"+id,
        {ownerUid:other,likeCount:9,viewCount:80,giftCoins:500});
      const key=collection+"/"+id+"__"+hx(uid);
      this.docs.set(key,kind==="likes"
        ? {userUid:uid,diaryId:id,createdAt:new Date()}
        : {userUid:uid,diaryId:id,lastCountedAt:new Date(),
          lastCountedAtMs:100,nextEligibleAtMs:900});
    }
    this.docs.set(collection+"/other_diary_"+hx(other),
      {userUid:other,diaryId:"other_diary"});
  }
  async get(path){return {exists:this.docs.has(path),
    data:this.docs.get(path)??null};}
  async beginTransaction(){return "tx";}
  async rollback(){}
  writeDelete(path){return {type:"delete",path};}
  async commit(_tx,writes){
    if(this.failAt && ++this.failAt===3)
      throw Error("network_outage");
    const next=new Map(this.docs);
    for(const row of writes)next.delete(row.path);
    this.docs=next;this.commits.push(writes);
  }
  async runQuery(collection,opts){
    this.queries.push({collection,opts});
    const prefix=collection+"/";
    return [...this.docs].filter(([path,data])=>
      path.startsWith(prefix)&&!path.slice(prefix.length).includes("/")&&
      data?.userUid===opts.filters[0].value)
      .map(([path,data])=>({id:path.slice(prefix.length),data}))
      .sort((a,b)=>a.id.localeCompare(b.id))
      .slice(0,opts.limit);
  }
}
const run=(db,kind="likes",opts={})=>drain(db,{uid,requestId,kind,...opts});
test("drain 12 likes in 5/5/2, preserve all counterparties and aggregates",async()=>{
  const db=new Db();db.add("likes",12);
  const counts=[];
  for(let i=0;i<3;i++){
    const result=await run(db);counts.push(result.erased);
    assert.equal(result.completionVerified,false);
  }
  assert.deepEqual(counts,[5,5,2]);
  assert.deepEqual(db.queries.map(x=>x.opts.limit),[6,6,6]);
  assert.deepEqual(db.queries[0].opts.filters,
    [{field:"userUid",op:"==",value:uid}]);
  assert.equal(db.docs.get(user).coins,99);
  assert.equal(db.docs.get("diaries/owned_diary_likes_000").likeCount,9);
  assert.equal(db.docs.get("diaries/owned_diary_likes_000").giftCoins,500);
  assert.equal(db.docs.has("diary_likes/other_diary_"+hx(other)),true);
  assert.equal((await run(db)).checked,0);
  assert.equal(db.commits.length,12);
});
test("drain view dedupe keys without touching likes or other user views",async()=>{
  const db=new Db();db.add("views",7);db.add("likes",2);
  const counts=[];
  for(let i=0;i<3;i++)counts.push((await run(db,"views",{limit:3})).erased);
  assert.deepEqual(counts,[3,3,1]);
  assert.equal(db.queries.every(q=>q.collection==="diary_view_keys"),true);
  assert.equal(db.docs.has("diary_view_keys/other_diary_"+hx(other)),true);
  assert.ok([...db.docs.keys()].some(k=>k.startsWith("diary_likes/")));
  assert.equal(db.docs.get("diaries/owned_diary_views_000").viewCount,80);
});
test("malformed or held second row blocks batch before any deletion",async()=>{
  for(const change of [
    d=>d.docs.get("diary_likes/owned_diary_likes_001__"+hx(uid)).diaryId=
      "unexpected_diary_001",
    d=>d.docs.get("diary_likes/owned_diary_likes_001__"+hx(uid)).legalHold=true,
    d=>d.docs.get("diary_likes/owned_diary_likes_001__"+hx(uid)).appealPending=true,
    d=>d.docs.get("diary_likes/owned_diary_likes_001__"+hx(uid)).appealStatus="open",
  ]){
    const db=new Db();db.add("likes",3);change(db);
    await assert.rejects(run(db),e=>
      e.code==="diary_erasure_batch_legacy_or_protected_record");
    assert.equal(db.commits.length,0);
    assert.equal(db.docs.has("diary_likes/owned_diary_likes_000__"+hx(uid)),true);
  }
});
test("network failure mid-page safely retries remaining rows",async()=>{
  const db=new Db();db.add("likes",4);
  db.failAt=1;
  await assert.rejects(run(db),/network_outage/);
  assert.equal(db.commits.length,1);
  db.failAt=0;
  assert.equal((await run(db)).erased,3);
  assert.equal(db.commits.length,4);
});
test("request/certification holds block before query",async()=>{
  const mods=[
    d=>d.docs.get(req).status="cancelled",
    d=>d.docs.get(req).requestId="rotated_req_123456",
    d=>d.docs.get(cp).requestId="old_req_123456",
    d=>d.docs.get(cp).destructiveAllowed=false,
    d=>d.docs.get(cp).phase="notifications",
    d=>d.docs.get(cp).legalEvidenceReviewComplete=false,
    d=>d.docs.get(cp).historicalDiaryCountersReviewed=false,
    d=>d.docs.get(cp).diaryInteractionRetentionCleared=false,
    d=>d.docs.get(cp).evidenceHold=true,
    d=>d.docs.get(req).appealPending=true,
    d=>d.docs.get(cp).appealStatus="Under_Review",
    d=>d.docs.get(user).appealPending=true,
    d=>d.docs.get(user).role="owner",
    d=>d.docs.get(user).authDeleted=true,
  ];
  for(const mod of mods){
    const db=new Db();db.add("likes",2);mod(db);
    await assert.rejects(run(db),e=>
      e.code==="diary_erasure_batch_not_authorized");
    assert.equal(db.queries.length,0);
    assert.equal(db.commits.length,0);
  }
});
test("invalid kind, uid or limit fails before any read",async()=>{
  for(const bad of [
    {uid:"../bad"},{kind:"all"},{limit:0},
    {limit:MAX_DIARY_ERASURE_BATCH_ITEMS+1},{limit:"5"},
    {requestId:"bad"},
  ]){const db=new Db();
    db.get=async()=>{throw Error("unexpected_read");};
    await assert.rejects(run(db,"likes",bad),e=>e.status===400);
    assert.equal(db.queries.length,0);
  }
});
test("source cannot create receipt, Auth deletion, scheduled work or global scans",()=>{
  const s=readFileSync(
    "cloudflare-worker/src/account-deletion-diary-interaction-batches.js",
    "utf8");
  assert.doesNotMatch(s,/deleteAuthUser\(|setInterval\(|bucket\.delete\(/);
  assert.match(s,/completionVerified: false/);
  assert.match(s,/limit: limit \+ 1/);
});
