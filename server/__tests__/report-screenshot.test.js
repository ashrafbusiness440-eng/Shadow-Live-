import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import {
  attachReportScreenshot, openReportScreenshot,
  parseReportScreenshot, validateReportScreenshotTarget,
} from "../../cloudflare-worker/src/report-screenshot.js";
import { purgeReportEvidenceDocument, evidenceDeadline } from "../../cloudflare-worker/src/report-evidence-retention.js";

const now = new Date("2026-10-14T12:00:00.000Z");
const jpg = Buffer.from([0xff,0xd8,0xff,0xe0,0x00,0x04,0x00,0x01,0xff,0xd9]);
const b64 = jpg.toString("base64");
const report = (extra={}) => ({
  reporterUid:"reporter", targetType:"room_message",
  targetUid:"accused", roomId:"room1", messageId:"msg1",
  status:"new", createdAt:new Date(now.getTime()-20_000),
  evidence:{source:"room_realtime_session",
    message:{id:"msg1",text:"TRUSTED_SERVER_EVIDENCE"},
    context:[{id:"msg1",text:"TRUSTED_SERVER_EVIDENCE"}]},
  ...extra,
});

class Db {
  constructor(docs={}) {
    this.docs = new Map(Object.entries(docs));
    this.writes = [];
    this.failCommit = false;
  }
  async beginTransaction(){return "tx";}
  async rollback(){}
  async get(path){return {exists:this.docs.has(path),
    data:structuredClone(this.docs.get(path)||null)};}
  writeUpdate(path,fields){return {type:"update",path,fields};}
  writeCreate(path,fields){return {type:"create",path,fields};}
  async commit(_tx,writes){
    if(this.failCommit) throw Error("commit_failed");
    for(const w of writes){
      if(w.type==="create" && this.docs.has(w.path))throw Error("already_exists");
      if(w.type==="create")this.docs.set(w.path,structuredClone(w.fields));
      else this.docs.set(w.path,{...this.docs.get(w.path),
        ...structuredClone(w.fields)});
      this.writes.push(w);
    }
  }
}

class Bucket {
  constructor(){this.values=new Map();this.ops=[];}
  async put(key,bytes,opts){this.ops.push("put");this.values.set(key,{
    bytes:Buffer.from(bytes), mime:opts.httpMetadata.contentType,
  });}
  async get(key){this.ops.push("get");const item=this.values.get(key);
    return item?{size:item.bytes.length,arrayBuffer:async()=>item.bytes}:null;}
  async delete(key){this.ops.push("delete");this.values.delete(key);}
}

test("U6-J validates bounded JPEG with canonical base64 and rejects manipulated input",()=>{
  assert.deepEqual(parseReportScreenshot(b64),jpg);
  for(const input of ["", "data:image/jpeg;base64,"+b64,b64.slice(0,-4),
    Buffer.alloc(150001,0x11).toString("base64"),
    Buffer.from("this is not an image").toString("base64")]){
    assert.throws(()=>parseReportScreenshot(input),/invalid_report_screenshot/);
  }
});

test("U6-J cannot attach another user's, closed, stale or foreign report",()=>{
  assert.throws(()=>validateReportScreenshotTarget(report(),"attacker",now.getTime()),
    /forbidden/);
  assert.throws(()=>validateReportScreenshotTarget(report({status:"closed"}),
    "reporter",now.getTime()),/report_already_closed/);
  assert.throws(()=>validateReportScreenshotTarget(report({createdAt:
    new Date(now.getTime()-600_000)}),"reporter",now.getTime()),
    /report_attachment_expired/);
  assert.throws(()=>validateReportScreenshotTarget(report({evidence:{
    clientScreenshot:{objectId:"existing"}}}),"reporter",now.getTime()),
    /report_screenshot_exists/);
  assert.throws(()=>validateReportScreenshotTarget(report({
    targetType:"unknown",roomId:"",source:"unknown"}),
    "reporter",now.getTime()),/invalid_report_source/);
  assert.doesNotThrow(()=>validateReportScreenshotTarget({
    source:"private_chat",conversationId:"conv1",
    reporterId:"reporter",status:"open",
    createdAt:new Date(now.getTime()-30_000),
  },"reporter",now.getTime()));
});

test("U6-J attachments use one private R2 key, retain trusted facts and audit",async()=>{
  const db=new Db({"reports/room_report_one":report()});
  const bucket=new Bucket();
  const result=await attachReportScreenshot(db,bucket,"reporter",{
    reportId:"room_report_one",imageBase64:b64,
  },now);
  assert.deepEqual(result,{ok:true,reportId:"room_report_one",
    screenshotAttached:true});
  const evidence=db.docs.get("reports/room_report_one").evidence;
  assert.equal(evidence.message.text,"TRUSTED_SERVER_EVIDENCE");
  assert.equal(evidence.clientScreenshot.source,"client_capture_unverified");
  assert.equal(evidence.clientScreenshot.capturedBy,"reporter");
  assert.ok(evidence.clientScreenshot.storageKey.startsWith(
    "report-evidence/room_report_one/"));
  assert.equal(bucket.values.size,1);
  assert.equal(bucket.ops[0],"put");
  assert.equal(db.writes.filter(w=>w.path.startsWith("admin_audit_logs/")).length,1);
  assert.equal(JSON.stringify(db.writes.filter(w=>
    w.path.startsWith("admin_audit_logs/"))).includes(b64),false);
  await assert.rejects(()=>attachReportScreenshot(db,bucket,"reporter",{
    reportId:"room_report_one",imageBase64:b64,
  },now),/report_screenshot_exists/);
  assert.equal(bucket.values.size,1);
  const opened=await openReportScreenshot(db,{USER_STORAGE:bucket},
    "authorized_reviewer","room_report_one");
  assert.equal(opened.imageBase64,b64);
  assert.equal(opened.source,"client_capture_unverified");
  const order=bucket.ops;
  assert.equal(order[order.length-1],"get");
  assert.equal(db.writes.filter(w=>w.path.startsWith("admin_audit_logs/")).length,2);
});

test("U6-J upload failure cannot leave R2 image linked to report",async()=>{
  const db=new Db({"reports/report_lost":report()});
  const bucket=new Bucket();
  db.failCommit=true;
  await assert.rejects(()=>attachReportScreenshot(db,bucket,"reporter",{
    reportId:"report_lost",imageBase64:b64,
  },now),/commit_failed/);
  assert.deepEqual(bucket.ops,["put","delete"]);
  assert.equal(bucket.values.size,0);
  assert.equal(db.docs.get("reports/report_lost").evidence.clientScreenshot,
    undefined);
});

test("U6-J 90-day cleanup queues private R2 image deletion with audit and respects holds",async()=>{
  const db=new Db({"reports/report_due":report({
    status:"closed",evidencePurgeAt:evidenceDeadline(now),
  })});
  const bucket=new Bucket();
  await attachReportScreenshot(db,bucket,"reporter",{
    reportId:"report_due",imageBase64:b64,
  },new Date(now.getTime()+50_000)).catch(()=>{});
  // Restore an ordinary closed case with an already-linked proof.
  const objectId="1c3c5555-aabb-4ccd-8eef-123456789abc";
  const screenshot={objectId,storageKey:"report-evidence/report_due/"+objectId+".jpg",
    byteLength:jpg.length,capturedBy:"reporter",mimeType:"image/jpeg",
    source:"client_capture_unverified"};
  const original=report({
    status:"closed",evidencePurgeAt:evidenceDeadline(now),
    evidence:{clientScreenshot:screenshot},
  });
  db.docs.set("reports/report_due",original);
  const after=new Date(evidenceDeadline(now).getTime()+60_000);
  assert.equal(await purgeReportEvidenceDocument(db,"reports","report_due",after),
    "purged");
  const row=db.docs.get("reports/report_due");
  assert.equal(row.evidence,null);
  const queued=db.docs.get("storage_delete_queue/report_screenshot_"+objectId);
  assert.equal(queued.storageKey,screenshot.storageKey);
  assert.equal(queued.scope,"report_evidence");
  assert.equal(queued.reason,"report_evidence_90_day_purge");
  assert.equal(db.docs.has("admin_audit_logs/report_evidence_purge_"+objectId),false);
  const held=new Db({"reports/report_hold":report({
    status:"closed",evidencePurgeAt:evidenceDeadline(now),
    evidenceHold:true,evidence:{clientScreenshot:{
      ...screenshot,storageKey:"report-evidence/report_hold/"+objectId+".jpg"}},
  })});
  assert.equal(await purgeReportEvidenceDocument(held,"reports","report_hold",after),
    "held");
  assert.equal([...held.docs.keys()].filter(k=>k.startsWith(
    "storage_delete_queue/")).length,0);
});

test("U6-J Flutter report capture and server R2 display are connected and optional",()=>{
  const screenshot=fs.readFileSync(
    "lib/shared/services/report_screenshot_service.dart","utf8");
  const chat=fs.readFileSync(
    "lib/features/chat/screens/private_chat_screen.dart","utf8");
  const room=fs.readFileSync(
    "lib/features/room/widgets/room_chat_panel.dart","utf8");
  const session=fs.readFileSync(
    "lib/features/room/services/room_presence_service.dart","utf8");
  const admin=fs.readFileSync(
    "lib/admin/general_reports_control_page.dart","utf8");
  const worker=fs.readFileSync("cloudflare-worker/src/index.js","utf8");
  assert.match(screenshot,/RepaintBoundary/);
  assert.match(screenshot,/captureReportSnapshot/);
  assert.match(screenshot,/Future<bool> attach/);
  assert.match(chat,/final reportId = await _safety\.reportUser/);
  assert.match(chat,/imageBase64: screenshot/);
  assert.match(room,/final reportId = await _service\.reportMessage/);
  assert.match(session,/Future<String> reportChatMessage/);
  assert.match(admin,/clientScreenshot/);
  assert.match(admin,/Image\.memory\(snapshotBytes/);
  assert.match(worker,/api\/report-screenshot/);
});
