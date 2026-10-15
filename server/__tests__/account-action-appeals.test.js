import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import {
  submitAccountActionAppeal, getOwnAccountActionAppeal,
  listAccountActionAppeals, reviewAccountActionAppeal,
} from "../../cloudflare-worker/src/account-action-appeals.js";

const opId = "gr_action_account_sanction_123_account";
const reportId = "report_offense_123456";
const reviewKey = "appeal_rejected_admin_12345";
class Db {
  constructor(seed={}) {
    this.docs = new Map(Object.entries(seed));
    this.calls=[];
  }
  async beginTransaction(){return "tx";}
  async rollback(){}
  async get(path){this.calls.push(["get",path]);
    return {exists:this.docs.has(path),data:this.docs.get(path)||{}};}
  async runQuery(collection,opts){this.calls.push(["query",collection,opts.limit]);
    return [...this.docs.entries()].filter(([p,d])=>
      p.startsWith(collection+"/") && d.status===opts.filters[0].value)
      .slice(0,opts.limit).map(([p,data])=>({id:p.split("/")[1],data}));}
  writeCreate(path,data){return {path,data,method:"create"};}
  writeUpdate(path,data){return {path,data,method:"update"};}
  writeDelete(path){return {path,method:"delete"};}
  async commit(_tx,writes){for(const w of writes){
    this.calls.push(["write",w.path]);
    if(w.method==="delete"){this.docs.delete(w.path);continue;}
    if(w.method==="create"&&this.docs.has(w.path))throw Error("exists");
    this.docs.set(w.path,w.method==="update"?
      {...(this.docs.get(w.path)||{}),...w.data}:w.data);
  }}
}
const make=()=>new Db({
  "users/target":{role:"user",accountStatus:"active"},
  ["control_operations/"+opId]:{
    action:"restrictRoomChat",actorUid:"admin",targetType:"user",
    targetId:"target",status:"completed",
    result:{targetUid:"target",action:"restrictRoomChat",linkedReportId:reportId},
  },
  ["reports/"+reportId]:{
    type:"user",source:"private_chat",targetUserId:"target",
    status:"actioned",moderationAction:"room_chat_restricted",
  },
});
const submit=(db,user="target",extra={})=>submitAccountActionAppeal(db,user,{
  operationId:opId,explanation:"الرجاء التحقق من القرار",...extra,
});

test("U6-M1 one appeal for a verified sanctioned user, no case or sanction mutation",async()=>{
  const db=make();
  const first=await submit(db);
  assert.equal(first.status,"under_review");
  assert.equal(db.docs.get("account_action_appeals/"+opId).userUid,"target");
  assert.equal(db.docs.get("notifications/account_appeal_received_"+opId).userId,"target");
  assert.equal(db.docs.get("admin_inbox_items/account_action_appeal__"+opId).route,
    "account_action_appeals");
  assert.equal(db.docs.get("users/target").accountStatus,"active");
  assert.equal(db.docs.get("reports/"+reportId).status,"actioned");
  const writes=db.calls.filter(x=>x[0]==="write").length;
  assert.equal((await submit(db)).duplicate,true);
  assert.equal(db.calls.filter(x=>x[0]==="write").length,writes);
  assert.deepEqual(await getOwnAccountActionAppeal(db,"target",{operationId:opId}),{
    ok:true,operationId:opId,status:"under_review",decisionReason:"",
  });
  await assert.rejects(()=>getOwnAccountActionAppeal(db,"other",{operationId:opId}),
    /appeal_not_found/);
  const q=await listAccountActionAppeals(db);
  assert.equal(q.appeals.length,1);
  assert.equal(q.appeals[0].userUid,"target");
  assert.equal(q.appeals[0].explanation,"الرجاء التحقق من القرار");
});

test("U6-M1 other users, forged/unreviewed receipts and malformed submissions fail closed",async()=>{
  const db=make();
  // Existing valid stranger: prove the server does not leak the target's case.
  db.docs.set("users/stranger",{role:"user",accountStatus:"active"});
  await assert.rejects(()=>submit(db,"stranger"),/sanction_not_found/);
  await assert.rejects(()=>submit(db,"target",{operationId:"../target"}),/invalid_appeal_request/);
  await assert.rejects(()=>submit(db,"target",{explanation:"x".repeat(801)}),
    /invalid_appeal_request/);
  db.docs.get("reports/"+reportId).status="under_review";
  await assert.rejects(()=>submit(db),/sanction_not_found/);
  db.docs.get("reports/"+reportId).status="actioned";
  db.docs.get("control_operations/"+opId).result.targetUid="other";
  await assert.rejects(()=>submit(db),/sanction_not_found/);
  assert.equal(db.docs.has("account_action_appeals/"+opId),false);
});

test("U6-M1 rejection logs decision, notifies once, closes inbox, no auto unban",async()=>{
  const db=make();
  await submit(db);
  const rejected=await reviewAccountActionAppeal(db,"reviewer",{
    operationId:opId,decision:"rejected",reason:"راجعنا الأدلة والإجراء صحيح",
    idempotencyKey:reviewKey,
  });
  assert.equal(rejected.decision,"rejected");
  assert.equal(db.docs.has("admin_inbox_items/account_action_appeal__"+opId),false);
  assert.equal(db.docs.get("notifications/account_appeal_decision_"+opId).userId,
    "target");
  assert.equal(db.docs.get("account_action_appeals/"+opId).reviewedBy,"reviewer");
  assert.equal(db.docs.get("admin_audit_logs/account_appeal_review_"+reviewKey)
    .decision,"rejected");
  assert.equal(db.docs.get("users/target").accountStatus,"active");
  const again=await reviewAccountActionAppeal(db,"reviewer",{
    operationId:opId,decision:"rejected",reason:"راجعنا الأدلة والإجراء صحيح",
    idempotencyKey:reviewKey,
  });
  assert.equal(again.duplicate,true);
  await assert.rejects(()=>reviewAccountActionAppeal(db,"reviewer",{
    operationId:opId,decision:"accepted",reason:"قرار معكوس",
    reversalOperationId:"lift_restriction_1234567890",
    idempotencyKey:reviewKey,
  }),/appeal_conflict/);
});

test("U6-M1 acceptance requires proven reversal of this precise original sanction",async()=>{
  const db=make();
  await submit(db);
  const reversalId="lift_account_restriction_123456";
  const payload={operationId:opId,decision:"accepted",reason:"تم رفع الجزاء بعد مراجعة الأدلة",
    reversalOperationId:reversalId,idempotencyKey:"accept_appeal_review_12345"};
  await assert.rejects(()=>reviewAccountActionAppeal(db,"reviewer",payload),
    /reversal_not_verified/);
  db.docs.set("control_operations/"+reversalId,{
    action:"liftRoomChatRestriction",targetId:"target",status:"completed",
    result:{targetUid:"target",action:"liftRoomChatRestriction",
      originalOperationId:"different_source_123456"},
  });
  db.docs.get("control_operations/"+opId).lifecycle={
    type:"lifted",operationId:reversalId,
  };
  await assert.rejects(()=>reviewAccountActionAppeal(db,"reviewer",payload),
    /reversal_not_verified/);
  db.docs.get("control_operations/"+reversalId).result.originalOperationId=opId;
  const accepted=await reviewAccountActionAppeal(db,"reviewer",payload);
  assert.equal(accepted.decision,"accepted");
  assert.equal(db.docs.get("account_action_appeals/"+opId).status,"accepted");
  assert.match(db.docs.get("notifications/account_appeal_decision_"+opId).body,
    /رفع العقوبة/);
  assert.equal(db.docs.has("admin_inbox_items/account_action_appeal__"+opId),false);
});

test("U6-M1 production route is self-only and admin review stays capability and recent-auth gated",()=>{
  const src=fs.readFileSync("cloudflare-worker/src/general-reports.js","utf8");
  const inbox=fs.readFileSync("cloudflare-worker/src/admin-inbox.js","utf8");
  assert.match(src,/action === "submitAccountActionAppeal"/);
  assert.match(src,/action === "getOwnAccountActionAppeal"/);
  assert.ok(src.indexOf('action === "submitAccountActionAppeal"')<
    src.indexOf("const actor = await requireAdmin"));
  assert.match(src,/action === "reviewAccountActionAppeal"/);
  assert.match(src,/actor\.canReview/);
  assert.match(inbox,/case "account_action_appeal":/);
  assert.doesNotMatch(src,/setInterval\(/);
});
