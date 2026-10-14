import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import {
  FILTER_CASE_WINDOW_MS, FILTER_CASE_RECENT_MAX,
  filterCaseTier, filterCasePriority, nextFilterCase,
  filterCaseWrites, commitRoomFilterCase,
} from "../../cloudflare-worker/src/content-filter-case.js";

class Db {
  constructor(seed={}) {
    this.docs=new Map(Object.entries(seed));
    this.commits=[];
    this.rollbacks=0;
  }
  async beginTransaction(){return "tx";}
  async rollback(){this.rollbacks++;}
  async get(path){return {exists:this.docs.has(path),
    data:this.docs.get(path)||null};}
  writeCreate(path,fields){return {path,fields,type:"create"};}
  writeUpdate(path,fields){return {path,fields,type:"update"};}
  async commit(_tx,writes){
    // Transaction preconditions are enforced for immutable room markers.
    for(const w of writes){
      if(w.type==="create"&&this.docs.has(w.path)){
        throw Error("exists");
      }
    }
    for(const w of writes){
      this.docs.set(w.path,{...(this.docs.get(w.path)||{}),...w.fields});
    }
    this.commits.push(writes);
  }
}

const start=Date.UTC(2026,9,14,0,0,0);
function event(i,actorUid="u1",surface="private_chat",time=start+i*1000){
  return {actorUid,sourceId:"m"+i,surface,createdAtMs:time};
}

test("U6-K review tiers are frequency hints, not proven offences",()=>{
  assert.equal(FILTER_CASE_WINDOW_MS,24*60*60*1000);
  assert.equal(FILTER_CASE_RECENT_MAX,12);
  for(const [n,tier] of [[1,0],[2,0],[3,1],[5,1],[6,2],[9,2],[10,3]]){
    assert.equal(filterCaseTier(n),tier);
  }
  assert.deepEqual([1,2,3].map(filterCasePriority),["normal","high","urgent"]);
  const step=nextFilterCase({},event(1));
  assert.equal(step.escalated,false);
  assert.equal(step.caseData.verifiedOffences,0);
  assert.equal(step.caseData.evidenceIsAllegation,true);
  assert.equal(step.caseData.recentFlagIds[0],"saved_m1");
  assert.equal("evidence" in step.caseData,false);
  assert.equal("message" in step.caseData,false);
  assert.throws(()=>nextFilterCase({},event(1,"a/b")),/invalid_filter_case_event/);
});

test("U6-K 3,6,10 flags produce only three indexed admin escalation notices",async()=>{
  const db=new Db();
  const levels=[];
  for(let i=1;i<=10;i++){
    const e=event(i);
    // Sender/diary write transactions reuse this exact point read.
    const {writes,escalated,caseData}=await filterCaseWrites(db,"tx",e);
    assert.equal(writes.length,escalated?2:1);
    await db.commit("tx",writes);
    if(escalated)levels.push([i,caseData.tier]);
  }
  assert.deepEqual(levels,[[3,1],[6,2],[10,3]]);
  const record=db.docs.get("content_filter_cases/u1");
  assert.equal(record.count,10);
  assert.equal(record.recentFlagIds.length,10);
  assert.equal(record.notifiedTier,3);
  assert.equal(record.verifiedOffences,0);
  const notice=db.docs.get("admin_inbox_items/system_filter_case__u1");
  assert.equal(notice.type,"system_filter_case");
  assert.equal(notice.meta.actorUid,"u1");
  assert.equal(notice.meta.count,10);
  assert.equal(notice.priority,"urgent");
  assert.equal(notice.meta.alleged,true);
  assert.equal(JSON.stringify(db.docs.get("content_filter_cases/u1"))
    .includes("originalText"),false);
  assert.equal(JSON.stringify(notice).includes("private original"),false);
  const notices=db.commits.flat().filter(w=>
    w.path==="admin_inbox_items/system_filter_case__u1");
  assert.equal(notices.length,3);
});

test("U6-K 24-hour windows reset, flags stay independent and recent list bounded",async()=>{
  const db=new Db();
  for(let i=1;i<=18;i++){
    const surf=i%3===0?"diary_comment":"diary_post";
    const x=await filterCaseWrites(db,"tx",event(i,"u2",surf));
    await db.commit("tx",x.writes);
  }
  const prev=db.docs.get("content_filter_cases/u2");
  assert.equal(prev.count,18);
  assert.equal(prev.recentFlagIds.length,12);
  assert.equal(prev.recentFlagIds[0],"saved_m7");
  const reset=await filterCaseWrites(db,"tx",
    event(20,"u2","private_chat",start+FILTER_CASE_WINDOW_MS+20_000));
  assert.equal(reset.escalated,false);
  await db.commit("tx",reset.writes);
  const current=db.docs.get("content_filter_cases/u2");
  assert.equal(current.count,1);
  assert.deepEqual(current.recentFlagIds,["saved_m20"]);
  assert.equal(current.notifiedTier,0);
  assert.equal(db.docs.has("content_filter_cases/u1"),false);
});

test("U6-K room coordinator idempotency survives retries after case linked",async()=>{
  const db=new Db();
  const room={actorUid:"roomSpeaker",sourceId:"55",surface:"room_chat",
    createdAtMs:start};
  let x=await commitRoomFilterCase(db,room);
  assert.equal(x.ok,true);
  assert.equal(x.escalated,false);
  x=await commitRoomFilterCase(db,room);
  assert.equal(x.duplicate,true);
  assert.equal(db.docs.get("content_filter_cases/roomSpeaker").count,1);
  assert.equal(db.docs.get("content_filter_cases/roomSpeaker")
    .recentFlagIds[0],"room_55");
  assert.equal(db.docs.get("content_filter_case_events/55").sourceId,"55");
});

test("U6-K every persisted surface uses the same transaction and admin route",()=>{
  const chat=fs.readFileSync("cloudflare-worker/src/chat-safety-actions.js","utf8");
  const diary=fs.readFileSync("cloudflare-worker/src/diaries.js","utf8");
  const room=fs.readFileSync("cloudflare-worker/src/room-realtime-object.js","utf8");
  const admin=fs.readFileSync("cloudflare-worker/src/general-reports.js","utf8");
  const inbox=fs.readFileSync("cloudflare-worker/src/admin-inbox.js","utf8");
  const router=fs.readFileSync("lib/admin/reports_hub_inbox_route.dart","utf8");
  const panel=fs.readFileSync("lib/admin/system_reports_control_page.dart","utf8");
  assert.match(chat,/filterCaseWrites\(db,transaction/);
  assert.equal((diary.match(/filterCaseWrites\(db,transaction/g)||[]).length,2);
  assert.match(room,/persistRoomFilterCaseEvent\(this.env/);
  assert.doesNotMatch(room,/firestore/i);
  assert.match(room,/casePending\.slice\(0,5\)/);
  assert.match(admin,/action === "getSystemFilterCase"/);
  assert.match(inbox,/case "system_filter_case"/);
  assert.match(router,/'system_filter_case' => ReportsHubSection\.system/);
  assert.match(panel,/ملف التنبيهات المتكررة/);
  assert.match(panel,/فتح الدليل/);
});
