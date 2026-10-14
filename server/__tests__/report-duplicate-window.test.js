import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import {
  checkReportDuplicateWindow,
  reportDuplicateSignature,
  REPORT_DUPLICATE_WINDOW_MS,
} from "../../cloudflare-worker/src/report-duplicate-window.js";
import { reportDeduplicationTestHooks } from "../../cloudflare-worker/src/chat-safety-actions.js";

class MockDb {
  constructor(seed={}) {
    this.docs = new Map(Object.entries(seed).map(([k,v])=>[k,structuredClone(v)]));
    this.reads=[];
  }
  async beginTransaction(){return "tx";}
  async rollback(){}
  async get(path){
    this.reads.push(path);
    return {exists:this.docs.has(path),data:structuredClone(this.docs.get(path)||{})};
  }
  writeCreate(path,fields){return {kind:"create",path,fields};}
  writeUpdate(path,fields){return {kind:"update",path,fields};}
  async commit(_tx,writes){
    for(const w of writes){
      if(w.kind==="create"){
        if(this.docs.has(w.path))throw Error("exists");
        this.docs.set(w.path,structuredClone(w.fields));
      }else{
        this.docs.set(w.path,{...(this.docs.get(w.path)||{}),...structuredClone(w.fields)});
      }
    }
  }
}

test("duplicate keys expire lazily and the rate window remains bounded",()=>{
  const now=Date.parse("2026-10-14T12:00:00Z");
  const key=reportDuplicateSignature("room","room_1","room","harassment");
  const first=checkReportDuplicateWindow({},key,now);
  assert.equal(first.duplicate,false);
  assert.equal(first.recent.length,1);
  assert.equal(checkReportDuplicateWindow({recentReportKeys:first.recent},key,now+6000).duplicate,true);
  assert.equal(checkReportDuplicateWindow({recentReportKeys:first.recent},key,now+REPORT_DUPLICATE_WINDOW_MS).duplicate,false);
  const many=Array.from({length:50},(_,i)=>({key:"report_"+i,atMs:now-1000}));
  const distinct=checkReportDuplicateWindow({recentReportKeys:many},"new_report",now);
  assert.equal(distinct.recent.length,12);
  assert.equal(distinct.recent.at(-1).key,"new_report");
  assert.equal(checkReportDuplicateWindow({recentReportKeys:"malformed"},key,now).duplicate,false);
  assert.notEqual(reportDuplicateSignature("room","ab","c","spam"),
    reportDuplicateSignature("room","a","bc","spam"));
});

test("U6-B direct-chat reports reject repeat with different key, but allow different incident reason",async()=>{
  const db=new MockDb({
    "users/target":{role:"user"},
    "conversations/chat001":{participants:["reporter","target"]},
  });
  const request=(key,reason="harassment")=>({
    targetUserId:"target",conversationId:"chat001",reason,
    idempotencyKey:key,details:"محتوى المخالفة",
  });
  const first=await reportDeduplicationTestHooks.reportUser(
    db,"reporter",request("repeat_chat_unique_01"));
  assert.equal(first.ok,true);
  assert.equal(db.docs.get("report_rate_limits/reporter").count,1);
  await assert.rejects(
    reportDeduplicationTestHooks.reportUser(
      db,"reporter",request("repeat_chat_unique_02")),
    /report_recent_duplicate/,
  );
  assert.equal(db.docs.get("report_rate_limits/reporter").count,1);
  assert.equal(db.docs.has("reports/report_repeat_chat_unique_02"),false);
  const retry=await reportDeduplicationTestHooks.reportUser(
    db,"reporter",request("repeat_chat_unique_01"));
  assert.equal(retry.code,"duplicate");
  await reportDeduplicationTestHooks.reportUser(
    db,"reporter",request("repeat_chat_unique_03","spam"));
  assert.equal(db.docs.get("report_rate_limits/reporter").count,2);
  assert.equal(db.reads.filter(p=>p==="report_rate_limits/reporter").length,4);
});

test("U6-B room duplicate uses the existing rate document and no extra query",async()=>{
  const db=new MockDb({
    "rooms/room001":{ownerUid:"owner",roomName:"الغرفة",seats:[]},
  });
  const namespace={
    idFromName:x=>x,
    get:_=>({fetch:async()=>Response.json({present:true})}),
  };
  const request=(key,reason="harassment")=>({
    roomId:"room001",reason,details:"ملاحظة",
    idempotencyKey:key,
  });
  await reportDeduplicationTestHooks.reportRoom(
    db,"reporter",request("repeat_room_unique_01"),namespace);
  assert.equal(db.docs.get("report_rate_limits/reporter").count,1);
  await assert.rejects(
    reportDeduplicationTestHooks.reportRoom(
      db,"reporter",request("repeat_room_unique_02"),namespace),
    /report_recent_duplicate/,
  );
  assert.equal(db.docs.get("report_rate_limits/reporter").count,1);
  assert.equal(db.docs.has("reports/room_report_repeat_room_unique_02"),false);
  const retry=await reportDeduplicationTestHooks.reportRoom(
    db,"reporter",request("repeat_room_unique_01"),namespace);
  assert.equal(retry.code,"duplicate");
  await reportDeduplicationTestHooks.reportRoom(
    db,"reporter",request("repeat_room_unique_03","spam"),namespace);
  assert.equal(db.docs.get("report_rate_limits/reporter").count,2);
  assert.equal(db.reads.filter(p=>p==="report_rate_limits/reporter").length,4);
});

test("U6-B preserves clear Arabic duplicate errors without adding listeners or background scans",()=>{
  const main=readFileSync("lib/main.dart","utf8");
  const dm=readFileSync("lib/features/chat/screens/private_chat_screen.dart","utf8");
  const src=readFileSync("cloudflare-worker/src/report-duplicate-window.js","utf8");
  assert.match(main,/'report_recent_duplicate'/);
  assert.match(dm,/'report_recent_duplicate'/);
  assert.doesNotMatch(src,/\.snapshots\(|Timer\.periodic|setInterval|runQuery\(/);
});
