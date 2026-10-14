import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import {
  filterRepeatGroupWrites, recordRoomFilterRepeat,
  filterRulePriority, higherFilterPriority,
} from "../../cloudflare-worker/src/moderation-flag-groups.js";
import { applyContentFilter } from "../../cloudflare-worker/src/content-filter.js";
import { generalReportsTestHooks } from "../../cloudflare-worker/src/general-reports.js";

class Db {
  constructor(seed={}){this.docs=new Map(Object.entries(seed));this.writes=[];}
  async beginTransaction(){return "tx";}
  async rollback(){}
  async get(path){return {exists:this.docs.has(path),
    data:structuredClone(this.docs.get(path)||null)};}
  writeUpdate(path,fields){return {kind:"update",path,fields};}
  writeCreate(path,fields){return {kind:"create",path,fields};}
  async commit(_tx,writes) {
    for(const w of writes){
      if(w.kind==="create"&&this.docs.has(w.path))throw Error("exists");
      this.docs.set(w.path, {...(w.kind==="update" ? this.docs.get(w.path):{}),
        ...structuredClone(w.fields)});
      this.writes.push(w);
    }
  }
}
const at=(hours)=>new Date(Date.UTC(2026,9,14,6)+hours*3600_000);
const event=(ref,hours=0,priority="normal",uid="u_001")=>({
  actorUid:uid,referenceId:ref,surface:"private_chat",priority,now:at(hours),
});
const accept=async(db,evt)=>{
  const tx=await db.beginTransaction();
  const result=await filterRepeatGroupWrites(db,tx,evt);
  await db.commit(tx,result.writes);
  return result;
};
const inbox=(db)=>[...db.docs.entries()]
  .filter(([key])=>key.startsWith("admin_inbox_items/system_repeat_flag__"));

test("U6-K an account gets one grouped alert on second incident, not per word or message",async()=>{
  const db=new Db();
  const first=await accept(db,event("msg1"));
  assert.equal(first.count,1);
  assert.equal(first.notified,false);
  assert.equal(inbox(db).length,0);
  const second=await accept(db,event("msg2",1));
  assert.equal(second.count,2);
  assert.equal(second.notified,true);
  const third=await accept(db,event("msg3",2));
  assert.equal(third.count,3);
  assert.equal(third.notified,false);
  assert.equal(inbox(db).length,1);
  assert.equal(inbox(db)[0][1].meta.count,2);
  assert.equal(inbox(db)[0][1].type,"system_repeat_flag");
  assert.equal(inbox(db)[0][1].route,"general_reports");
  assert.equal(JSON.stringify(inbox(db)).includes("originalText"),false);
  const group=db.docs.get("moderation_flag_group_cases/"+first.groupId);
  assert.equal(group.count,3);
  assert.deepEqual(group.recentReferences.map(x=>x.referenceId),
    ["msg1","msg2","msg3"]);
  assert.equal(group.evidenceCopied,false);
});

test("U6-K only a higher severity creates another alert for same 24h group",async()=>{
  const db=new Db();
  await accept(db,event("m1",0,"normal"));
  await accept(db,event("m2",1,"normal"));
  const escalated=await accept(db,event("m3",2,"high"));
  assert.equal(escalated.notified,true);
  assert.equal(escalated.priority,"high");
  assert.equal((await accept(db,event("m4",3,"normal"))).notified,false);
  assert.equal((await accept(db,event("m5",4,"high"))).notified,false);
  assert.equal((await accept(db,event("m6",5,"urgent"))).notified,true);
  assert.equal((await accept(db,event("m7",6,"urgent"))).notified,false);
  const alerts=inbox(db);
  assert.equal(alerts.length,3);
  assert.deepEqual(alerts.map(x=>x[1].priority).sort(),
    ["high","normal","urgent"]);
});

test("U6-K one finite new case each day, previous group remains reachable",async()=>{
  const db=new Db();
  const a=await accept(db,event("m1",0));
  await accept(db,event("m2",1));
  const next=await accept(db,event("m3",25));
  assert.notEqual(a.groupId,next.groupId);
  assert.equal(next.count,1);
  assert.equal(next.notified,false);
  assert.equal(db.docs.get("moderation_flag_group_cases/"+a.groupId).count,2);
  assert.equal(db.docs.get("moderation_flag_group_cases/"+next.groupId).count,1);
});

test("U6-K capped references, no lifetime claim and server-only urgency",async()=>{
  const db=new Db();
  for(let i=0;i<20;i++) await accept(db,event("m_"+i,i/5));
  const state=db.docs.get("moderation_flag_groups/u_001");
  assert.equal(state.count,20);
  assert.equal(state.recentReferences.length,12);
  assert.equal(state.recentReferences[0].referenceId,"m_8");
  assert.equal(inbox(db).length,1);
  assert.equal(filterRulePriority("threats"),"urgent");
  assert.equal(filterRulePriority("bullying"),"high");
  assert.equal(filterRulePriority("spam"),"normal");
  assert.equal(higherFilterPriority("high","normal"),"high");
  const config={enabled:true,surfaces:{private_chat:true},rules:[{
    id:"threat_001",pattern:"تهديد واضح",action:"mask",
    group:"threats",surfaces:["private_chat"],enabled:true,exceptions:[],
  }]};
  const result=applyContentFilter("تهديد واضح",config,"private_chat");
  assert.equal(result.text,"***");
  assert.equal(result.flagged,true);
  assert.equal(result.priority,"urgent");
});

test("U6-K a room flag's receipt prevents re-alert during persisted retry",async()=>{
  const db=new Db();
  const one=await recordRoomFilterRepeat(db,{...event("room_101"),surface:"room_chat"});
  const countBefore=db.writes.length;
  const duplicate=await recordRoomFilterRepeat(db,
    {...event("room_101"),surface:"room_chat"});
  assert.equal(duplicate.duplicate,true);
  assert.equal(db.writes.length,countBefore);
  assert.equal(db.docs.get("moderation_flag_groups/u_001").count,1);
  await recordRoomFilterRepeat(db,{...event("room_102",1),surface:"room_chat"});
  assert.equal(inbox(db).length,1);
  assert.equal(one.notified,false);
});

test("U6-K grouped admin reads return limited references and no raw evidence",async()=>{
  const db=new Db();
  const a=await accept(db,event("m1",0,"high"));
  await accept(db,event("m2",1,"high"));
  const out=await generalReportsTestHooks.getSystemFlagGroup(db,{
    groupAlertId:a.groupId+"_high",
  });
  assert.equal(out.group.groupId,a.groupId);
  assert.equal(out.group.recentReferences.length,2);
  assert.equal(JSON.stringify(out).includes("evidence"),false);
  await assert.rejects(()=>generalReportsTestHooks.getSystemFlagGroup(db,{
    groupAlertId:"../../users_owner_normal",
  }),/invalid_report_id/);
});

test("U6-K no polling, role exception, or new navigation section",()=>{
  const room=fs.readFileSync("cloudflare-worker/src/room-realtime-object.js","utf8");
  const inbox=fs.readFileSync("cloudflare-worker/src/admin-inbox.js","utf8");
  const section=fs.readFileSync("lib/admin/reports_hub_inbox_route.dart","utf8");
  const hub=fs.readFileSync("lib/admin/reports_hub_page.dart","utf8");
  const ui=fs.readFileSync("lib/admin/system_reports_control_page.dart","utf8");
  const chat=fs.readFileSync("cloudflare-worker/src/chat-safety-actions.js","utf8");
  const diaries=fs.readFileSync("cloudflare-worker/src/diaries.js","utf8");
  assert.match(inbox,/case "system_repeat_flag":/);
  assert.match(section,/'system_repeat_flag' => ReportsHubSection.system/);
  assert.match(hub,/initialGroupAlertId: focused/);
  assert.match(ui,/ملف التنبيهات المتكررة/);
  assert.match(ui,/لا يترتب عليه إجراء تلقائي/);
  assert.match(room,/filter_pending_aggregate/);
  assert.match(room,/persistRoomFilterAggregate/);
  assert.match(room,/aggregationPending/);
  assert.match(chat,/filterRepeatGroupWrites\(db, transaction/);
  assert.match(diaries,/filterRepeatGroupWrites\(db, transaction/);
  assert.equal(room.includes("setInterval("),false);
});
