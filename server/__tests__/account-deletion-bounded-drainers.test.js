import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import {
  drainAccountOwnedNotifications,
  drainAccountPrivateCallPushDevices,
  MAX_ACCOUNT_ERASURE_BATCH_ITEMS,
} from "../../cloudflare-worker/src/account-deletion-bounded-drainers.js";

const uid = "account_delete_123";
const otherUid = "other_user_456";
const requestId = "request_delete_1234567890";
const requestPath = "account_deletion_requests/" + uid;
const checkpointPath = "account_deletion_erasure_checkpoints/" + uid;
const userPath = "users/" + uid;
class Db {
  constructor(phase = "notifications") {
    this.docs = new Map([
      [requestPath,{uid,requestId,status:"processing"}],
      [checkpointPath,{requestId,phase,destructiveAllowed:true,
        legalEvidenceReviewComplete:true,notificationRetentionCleared:true,
        financialSettlementApproved:true}],
      [userPath,{role:"user",accountStatus:"deletion_processing",coins:42}],
    ]);
    this.queries=[];this.commits=[];this.failAt=0;
  }
  addNotices(count) {
    for(let i=0;i<count;i++)this.docs.set(
      "notifications/account_notice_"+String(i).padStart(3,"0"),
      {userId:uid,title:"test "+i});
    this.docs.set("notifications/unrelated_555",
      {userId:otherUid,title:"do not delete"});
  }
  addTokens(count) {
    for(let i=0;i<count;i++) {
      const token="token-device-"+i+"-012345678901234567890123456789";
      const hash=createHash("sha256").update(token).digest("hex");
      this.docs.set("private_call_push_devices/"+uid+"/tokens/"+hash,
        {token,platform:"android"});
      this.docs.set("private_call_push_token_owners/"+hash,{uid});
    }
    this.docs.set("private_call_push_devices/"+otherUid+"/tokens/unrelated",
      {token:"do not delete"});
  }
  async get(path) {return {exists:this.docs.has(path),data:this.docs.get(path)||null};}
  async beginTransaction() {return "tx";}
  async rollback() {}
  writeDelete(path) {return {path,type:"delete"};}
  async commit(_tx,writes) {
    if (this.failAt && ++this.failAt === 3)
      throw Error("temporary_network_failure");
    const next=new Map(this.docs);
    writes.forEach(w=>next.delete(w.path));
    this.docs=next;this.commits.push(writes);
  }
  async runQuery(collection, options) {
    this.queries.push({collection,options});
    const prefix=collection+"/";
    let rows=[...this.docs].filter(([path]) =>
      path.startsWith(prefix) && !path.slice(prefix.length).includes("/"))
      .map(([path,data])=>({id:path.slice(prefix.length),data}));
    for(const f of options.filters||[]) {
      assert.equal(f.op,"==");
      rows=rows.filter(row=>row.data?.[f.field]===f.value);
    }
    return rows.sort((a,b)=>a.id.localeCompare(b.id)).slice(0,options.limit);
  }
}
test("indexed batches drain 12 owned notifications, never delete other user's notice",async()=>{
  const db=new Db();db.addNotices(12);
  const outputs=[];
  for(let i=0;i<3;i++)outputs.push(
    await drainAccountOwnedNotifications(db,{uid,requestId,limit:5}));
  assert.deepEqual(outputs.map(x=>x.erased),[5,5,2]);
  assert.deepEqual(outputs.map(x=>x.moreInPage),[true,true,false]);
  assert.ok(outputs.every(x=>x.completionVerified===false));
  assert.equal(db.docs.has("notifications/unrelated_555"),true);
  assert.equal(db.docs.get(userPath).coins,42);
  assert.equal(db.queries.length,3);
  assert.deepEqual(db.queries[0],{
    collection:"notifications",
    options:{filters:[{field:"userId",op:"==",value:uid}],limit:6},
  });
  assert.equal((await drainAccountOwnedNotifications(db,{uid,requestId})).checked,0);
});
test("private call tokens drain bounded pages without touching other devices",async()=>{
  const db=new Db("push_devices");db.addTokens(7);
  const removed=[];
  for(let i=0;i<3;i++){
    const res=await drainAccountPrivateCallPushDevices(db,{uid,requestId,limit:3});
    removed.push(res.erased);
  }
  assert.deepEqual(removed,[3,3,1]);
  assert.equal(db.docs.has(
    "private_call_push_devices/"+otherUid+"/tokens/unrelated"),true);
  assert.equal(db.queries.every(q=>
    q.collection==="private_call_push_devices/"+uid+"/tokens" &&
    q.options.limit===4),true);
  assert.equal(db.queries.every(q=>q.options.filters.length===0),true);
  assert.equal(db.commits.length,7);
});
test("invalid target or batch size never reads Firestore",async()=>{
  for(const input of [
    {uid:"../unsafe"}, {requestId:"no"},
    {limit:0},{limit:MAX_ACCOUNT_ERASURE_BATCH_ITEMS+1},
    {limit:"5"},
  ]){
    const db=new Db();
    db.get=async()=>{throw Error("should_not_read");};
    await assert.rejects(
      drainAccountOwnedNotifications(db,{uid,requestId,...input}),
      e=>e.code==="invalid_erasure_batch");
    assert.equal(db.queries.length,0);
  }
});
test("stale request, missing approvals, holds and Owner block before index query",async()=>{
  const mods=[
    d=>d.docs.get(requestPath).requestId="old_request_987654321",
    d=>d.docs.get(requestPath).status="cancelled",
    d=>d.docs.get(checkpointPath).phase="preflight_blocked",
    d=>d.docs.get(checkpointPath).destructiveAllowed=false,
    d=>d.docs.get(checkpointPath).notificationRetentionCleared=false,
    d=>d.docs.get(checkpointPath).financialSettlementApproved=false,
    d=>d.docs.get(checkpointPath).legalEvidenceReviewComplete=false,
    d=>d.docs.get(userPath).role="owner",
    d=>d.docs.get(userPath).accountStatus="active",
    d=>d.docs.get(userPath).legalHold=true,
    d=>d.docs.get(requestPath).appealPending=true,
    d=>d.docs.get(checkpointPath).appealStatus="Under_Review",
    d=>d.docs.get(userPath).appealPending=true,
    d=>d.docs.delete(requestPath),
  ];
  for(const mod of mods){const db=new Db();db.addNotices(2);mod(db);
    await assert.rejects(
      drainAccountOwnedNotifications(db,{uid,requestId}),
      e=>e.code==="erasure_batch_not_authorized");
    assert.equal(db.queries.length,0);
    assert.equal(db.commits.length,0);
  }
});
test("malformed indexed rows block entire page, not partially delete",async()=>{
  const db=new Db();db.addNotices(2);
  db.runQuery=async()=>[{id:"../../bad",data:{userId:uid}}];
  await assert.rejects(
    drainAccountOwnedNotifications(db,{uid,requestId}),
    e=>e.code==="erasure_batch_legacy_schema_review");
  assert.equal(db.commits.length,0);
});
test("mid-batch network failure can be retried with no duplicate deletion",async()=>{
  const db=new Db();db.addNotices(4);
  db.failAt=1;
  await assert.rejects(
    drainAccountOwnedNotifications(db,{uid,requestId,limit:4}),
    /temporary_network_failure/);
  assert.equal(db.commits.length,1);
  db.failAt=0;
  const result=await drainAccountOwnedNotifications(db,{uid,requestId,limit:4});
  assert.equal(result.erased,3);
  assert.equal(db.commits.length,4);
  assert.equal(db.docs.has("notifications/unrelated_555"),true);
});
test("bounded read-only queries, no completion or external service calls",()=>{
  const s=readFileSync(
    "cloudflare-worker/src/account-deletion-bounded-drainers.js","utf8");
  assert.doesNotMatch(s,/setInterval\(|deleteAuthUser\(|bucket\.delete\(|fetch\(/);
  assert.match(s,/limit: limit \+ 1/);
  assert.match(s,/completionVerified: false/);
});
