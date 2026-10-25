import assert from "node:assert/strict";
import test from "node:test";
import {readFileSync} from "node:fs";
import {eraseDeletedDiaryInteraction as erase}
  from "../../cloudflare-worker/src/account-deletion-diary-interaction-stage.js";
import { seedSyntheticErasureCertificates }
  from "./helpers/account-erasure-synthetic-certificates.js";

const uid="delete_me_123",other="other_user_999",requestId="delete_request_123456789";
const diaryId="diary_other_123";
const hex=uid=>Buffer.from(uid,"utf8").toString("hex");
const req="account_deletion_requests/"+uid;
const cp="account_deletion_erasure_checkpoints/"+uid;
const user="users/"+uid;
const diary="diaries/"+diaryId;
const like="diary_likes/"+diaryId+"__"+hex(uid);
const view="diary_view_keys/"+diaryId+"__"+hex(uid);
const unrelated="diary_likes/"+diaryId+"__"+hex(other);
class Db{
  constructor(){
    this.docs=new Map([
      [req,{uid,requestId,status:"processing",
        requestedAt:new Date(Date.now()-40*86400_000)}],
      [cp,{uid,requestId,phase:"diary_interactions",
        destructiveAllowed:true,diaryInteractionRetentionCleared:true,
        legalEvidenceReviewComplete:true,historicalDiaryCountersReviewed:true}],
      [user,{role:"user",accountStatus:"deletion_processing",
        coins:500,diamonds:21}],
      [diary,{ownerUid:other,text:"protected counterparty diary",
        likeCount:83,viewCount:970,giftCount:7}],
      [like,{userUid:uid,diaryId,createdAt:new Date()}],
      [view,{userUid:uid,diaryId,lastCountedAt:new Date(),
        lastCountedAtMs:100,nextEligibleAtMs:999}],
      [unrelated,{userUid:other,diaryId,createdAt:new Date()}],
    ]);
    seedSyntheticErasureCertificates(this.docs,{uid,requestId});
    this.commits=[];this.reads=0;
  }
  async beginTransaction(){return "tx";}
  async get(path,tx){assert.equal(tx,"tx");this.reads++;
    return {exists:this.docs.has(path),data:this.docs.get(path)??null};}
  writeDelete(path){return {type:"delete",path};}
  async commit(_tx,writes){const next=new Map(this.docs);
    for(const write of writes)next.delete(write.path);
    this.docs=next;this.commits.push(writes);}
  async rollback(){}
}
const run=(db,kind="likes",patch={})=>erase(db,{
  uid,requestId,diaryId,kind,...patch,
});
test("one owned like removed, aggregate/gift/coins and other liker preserved",async()=>{
  const db=new Db();const before={...db.docs.get(diary)};
  assert.deepEqual(await run(db),{ok:true,erased:true,duplicate:false});
  assert.equal(db.docs.has(like),false);
  assert.equal(db.docs.has(unrelated),true);
  assert.deepEqual(db.docs.get(diary),before);
  assert.equal(db.docs.get(user).coins,500);
  assert.equal(db.docs.get(user).diamonds,21);
  assert.equal(db.commits.length,1);
  assert.deepEqual(await run(db),{ok:true,erased:false,duplicate:true});
  assert.equal(db.commits.length,1);
});
test("view key erasure does not alter other's diary or viewCount",async()=>{
  const db=new Db();
  assert.equal((await run(db,"views")).erased,true);
  assert.equal(db.docs.has(view),false);
  assert.equal(db.docs.has(like),true);
  assert.equal(db.docs.get(diary).viewCount,970);
  assert.equal(db.commits.length,1);
});
test("old, cancelled, held and uncertified request fails closed",async()=>{
  const changes=[
    d=>d.docs.get(req).status="cancelled",
    d=>d.docs.get(req).requestId="stale_request_12345",
    d=>d.docs.get(req).legalHold=true,
    d=>d.docs.get(req).appealPending=true,
    d=>d.docs.get(cp).appealStatus="Under_Review",
    d=>d.docs.get(user).appealStatus="open",
    d=>d.docs.get(cp).requestId="stale_request_12345",
    d=>d.docs.get(cp).uid="different_user_123",
    d=>d.docs.get(cp).phase="notifications",
    d=>d.docs.get(cp).destructiveAllowed=false,
    d=>d.docs.get(cp).diaryInteractionRetentionCleared=false,
    d=>d.docs.get(cp).legalEvidenceReviewComplete=false,
    d=>d.docs.get(cp).historicalDiaryCountersReviewed=false,
    d=>d.docs.get(cp).investigationHold=true,
    d=>d.docs.get(user).role="owner",
    d=>d.docs.get(user).accountStatus="active",
    d=>d.docs.get(user).authDeleted=true,
    d=>d.docs.get(user).evidenceHold=true,
  ];
  for(const change of changes){const db=new Db();change(db);
    await assert.rejects(run(db),e=>
      e.code==="diary_interaction_erasure_not_authorized");
    assert.equal(db.commits.length,0);
    assert.equal(db.docs.has(like),true);
  }
});
test("held source diary or interaction blocks even after other stage approval",async()=>{
  for(const path of [like,view,diary]){
    for(const flag of ["legalHold","retentionHold","evidenceHold",
      "investigationHold","reported","appealPending"]){
      const db=new Db();db.docs.get(path)[flag]=true;
      const kind=path===view?"views":"likes";
      await assert.rejects(run(db,kind),
        e=>e.code==="diary_interaction_source_requires_review");
      assert.equal(db.commits.length,0);
      assert.equal(db.docs.has(path),true);
    }
  }
});
test("open appeal on diary interaction or original diary blocks destructive write",async()=>{
  for(const path of [like,view,diary]){
    const db=new Db();
    db.docs.get(path).appealStatus=" OPEN ";
    await assert.rejects(run(db,path===view?"views":"likes"),
      e=>e.code==="diary_interaction_source_requires_review");
    assert.equal(db.commits.length,0);
    assert.equal(db.docs.has(path),true);
  }
});
test("incorrect owner and unexpected extra fields fail before deletion",async()=>{
  for(const edit of [
    d=>d.docs.get(like).userUid=other,
    d=>d.docs.get(like).diaryId="diary_changed_123",
  ]){const db=new Db();edit(db);
    await assert.rejects(run(db),
      e=>e.code==="diary_interaction_owner_conflict");
    assert.equal(db.commits.length,0);
  }
  const db=new Db();db.docs.get(like).legacyEvidence="private";
  await assert.rejects(run(db),
    e=>e.code==="diary_interaction_legacy_schema_requires_review");
  assert.equal(db.docs.has(like),true);
});
test("missing source diary blocks, while absent target remains retry-safe",async()=>{
  const db=new Db();db.docs.delete(diary);
  await assert.rejects(run(db),
    e=>e.code==="diary_interaction_source_requires_review");
  assert.equal(db.docs.has(like),true);
  db.docs.delete(like);
  assert.deepEqual(await run(db),{ok:true,erased:false,duplicate:true});
});
test("invalid params require no Firestore transactions or IO",async()=>{
  for(const patch of [
    {uid:"../../unsafe"},{requestId:"short"},{diaryId:"../invalid"},
    {kind:"other"},{kind:""},{kind:null},
  ]){const db=new Db();db.beginTransaction=async()=>{throw Error("should not read");};
    await assert.rejects(run(db,"likes",patch),e=>e.status===400);
    assert.equal(db.reads,0);
  }
});
test("transient commit failure leaves no receipt and is safe to retry",async()=>{
  const db=new Db();const actual=db.commit.bind(db);
  db.commit=async()=>{throw Error("network_failure");};
  await assert.rejects(run(db),/network_failure/);
  assert.equal(db.docs.has(like),true);
  db.commit=actual;
  assert.equal((await run(db)).erased,true);
});
test("source only deletes exact account-owned interaction; no Auth or broad scans",()=>{
  const s=readFileSync(
    "cloudflare-worker/src/account-deletion-diary-interaction-stage.js","utf8");
  assert.doesNotMatch(s,/runQuery\(|deleteAuthUser\(|setInterval\(|bucket\.delete\(/);
  assert.match(s,/destructiveAllowed !== true/);
  assert.match(s,/diaryInteractionRetentionCleared !== true/);
});

test("diary interaction cannot be erased after any approval is revoked",async()=>{
  const db=new Db();
  db.docs.get("account_deletion_erasure_approvals/"+requestId+
    "__moderation_legal").decision="revoked";
  await assert.rejects(run(db),
    e=>e.code==="erasure_transactional_certification_blocked");
  assert.equal(db.commits.length,0);
  assert.equal(db.docs.has(like),true);
});
