import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  REPORT_EVIDENCE_RETENTION_DAYS,
  evidenceDeadline, evidenceHoldActive, evidenceRetentionExpired,
  purgeReportEvidenceDocument, setReportEvidenceHold,
} from "../../cloudflare-worker/src/report-evidence-retention.js";
import { readProtectedReportEvidence } from "../../cloudflare-worker/src/report-evidence-access.js";

class Db {
  constructor(seed={}) {
    this.docs = new Map(Object.entries(seed)
      .map(([key,value])=>[key,structuredClone(value)]));
    this.writes=[];
  }
  async beginTransaction(){return "tx";}
  async rollback(){}
  async get(path){return {exists:this.docs.has(path),
    data:structuredClone(this.docs.get(path)||null)};}
  writeCreate(path,fields){return {kind:"create",path,fields};}
  writeUpdate(path,fields){return {kind:"update",path,fields};}
  async commit(_tx,writes){
    for(const w of writes){
      if(w.kind==="create"&&this.docs.has(w.path))
        throw Error("exists");
      if(w.kind==="create")this.docs.set(w.path,structuredClone(w.fields));
      else this.docs.set(w.path,{...this.docs.get(w.path),
        ...structuredClone(w.fields)});
      this.writes.push(w);
    }
  }
}

const base=new Date("2026-10-14T09:00:00Z");
const after=new Date("2027-01-13T10:00:00Z");
const seed=(overrides={})=>({
  status:"closed",evidence:{message:{text:"PRIVATE_EVIDENCE"}},
  evidencePurgeAt:evidenceDeadline(base),
  evidenceRetentionDueAt:evidenceDeadline(base),...overrides,
});

test("U6-G retention lasts 90 days and never guesses unknown old decisions",()=>{
  assert.equal(REPORT_EVIDENCE_RETENTION_DAYS,90);
  assert.equal(evidenceDeadline(base).toISOString(),"2027-01-12T09:00:00.000Z");
  assert.equal(evidenceRetentionExpired(seed(),base.getTime()),false);
  assert.equal(evidenceRetentionExpired(seed(),after.getTime()),true);
  assert.equal(evidenceRetentionExpired({status:"closed",evidence:{}},
    after.getTime()),false);
  for(const flag of [
    {evidenceHold:true},{legalHold:true},{investigationHold:true},
    {appealPending:true},{appealStatus:"pending"},
    {appealStatus:"under_review"},
  ]) {
    assert.equal(evidenceHoldActive(flag),true);
    assert.equal(evidenceRetentionExpired(seed(flag),after.getTime()),false);
  }
  assert.equal(evidenceHoldActive({appealStatus:"rejected"}),false);
});

test("U6-G expired general report evidence is purged transactionally; decision remains",async()=>{
  const db=new Db({"reports/r1":seed({reviewReason:"مدقق",targetUid:"target"})});
  const out=await purgeReportEvidenceDocument(db,"reports","r1",after);
  assert.equal(out,"purged");
  const row=db.docs.get("reports/r1");
  assert.equal(row.evidence,null);
  assert.equal(row.evidencePurgeAt,null);
  assert.equal(row.reviewReason,"مدقق");
  assert.equal(row.targetUid,"target");
  assert.equal(row.status,"closed");
  assert.equal(db.writes.length,2);
  const audit=[...db.docs.values()].find(x=>
    x.action==="purgeReportEvidenceAfterRetention");
  assert.equal(audit.reportId,"r1");
  assert.equal(JSON.stringify(audit).includes("PRIVATE_EVIDENCE"),false);
  assert.equal(await purgeReportEvidenceDocument(db,"reports","r1",after),
    "skipped");
});

test("U6-G pending appeal and investigation hold defer deletion and are audit logged",async()=>{
  for(const collection of ["reports","diary_reports"]){
    const db=new Db({[collection+"/r2"]:seed({
      appealStatus:"under_review",evidenceHold:true,
    })});
    const result=await purgeReportEvidenceDocument(db,collection,"r2",after);
    assert.equal(result,"held");
    assert.equal(db.docs.get(collection+"/r2").evidence.message.text,
      "PRIVATE_EVIDENCE");
    assert.ok(db.docs.get(collection+"/r2").evidencePurgeAt>after);
    assert.equal([...db.docs.values()].filter(x=>
      x.action==="deferReportEvidenceDeletion").length,1);
  }
});

test("U6-G never purges open, future, missing or invalid reports",async()=>{
  const db=new Db({
    "reports/open":seed({status:"under_review"}),
    "reports/future":seed({evidencePurgeAt:evidenceDeadline(after)}),
    "reports/legacy":{status:"closed",evidence:{text:"legacy"}},
  });
  for(const id of ["open","future","legacy","missing"]){
    assert.equal(await purgeReportEvidenceDocument(db,"reports",id,after),
      "skipped");
  }
  assert.equal(db.writes.length,0);
  assert.equal(db.docs.get("reports/open").evidence.message.text,
    "PRIVATE_EVIDENCE");
  await assert.rejects(()=>purgeReportEvidenceDocument(db,"reports","../x",after),
    /invalid_report_id/);
});

test("U6-G expired evidence cannot be opened before periodic cleanup",async()=>{
  const db=new Db({"reports/r1":seed()});
  const previous=Date.now;
  try {
    Date.now=()=>after.getTime();
    await assert.rejects(()=>readProtectedReportEvidence(db,{
      collection:"reports",reportId:"r1",actorUid:"owner",
    }),/evidence_retention_expired/);
    assert.equal(db.writes.length,0);
    db.docs.set("reports/r1",seed({legalHold:true}));
    const out=await readProtectedReportEvidence(db,{
      collection:"reports",reportId:"r1",actorUid:"owner",
    });
    assert.equal(out.evidence.message.text,"PRIVATE_EVIDENCE");
    assert.equal(db.writes.length,1);
  } finally {Date.now=previous;}
});

test("U6-G terminal reporting writes deadlines and cron is bounded hourly",()=>{
  const g=fs.readFileSync("cloudflare-worker/src/general-reports.js","utf8");
  const d=fs.readFileSync("cloudflare-worker/src/diary-moderation.js","utf8");
  const index=fs.readFileSync("cloudflare-worker/src/index.js","utf8");
  assert.match(g,/TERMINAL_STATUSES\.has\(status\)/);
  assert.match(g,/evidencePurgeAt: evidenceDeadline\(now\)/);
  assert.match(d,/evidencePurgeAt: evidenceDeadline\(now\)/);
  assert.match(index,/getUTCMinutes\(\) === 0/);
  assert.match(index,/runDueReportEvidenceCleanup/);
});

test("U6-G owner evidence hold mirrors diary and is audited and idempotent",async()=>{
  const db=new Db({
    "diary_reports/rhold":seed({targetType:"diary"}),
    "reports/rhold":seed({targetType:"diary"}),
  });
  const params={collection:"diary_reports",reportId:"rhold",actorUid:"owner",
    hold:true,reason:"اعتراض مستمر",operationKey:"hold_report_rhold_01"};
  const held=await setReportEvidenceHold(db,params);
  assert.equal(held.hold,true);
  assert.equal(db.docs.get("diary_reports/rhold").evidenceHold,true);
  assert.equal(db.docs.get("reports/rhold").evidenceHold,true);
  const audit=db.docs.get("admin_audit_logs/report_evidence_hold_hold_report_rhold_01");
  assert.equal(audit.after.hold,true);
  assert.equal(audit.actorUid,"owner");
  assert.equal(audit.before.hold,false);
  const duplicate=await setReportEvidenceHold(db,params);
  assert.equal(duplicate.code,"duplicate");
  await assert.rejects(()=>setReportEvidenceHold(db,
    {...params,hold:false}),/idempotency_key_conflict/);
  assert.equal(await purgeReportEvidenceDocument(db,"diary_reports","rhold",after),
    "held");
  assert.equal(await purgeReportEvidenceDocument(db,"reports","rhold",after),
    "held");
  const released=await setReportEvidenceHold(db,{
    ...params,hold:false,reason:"انتهى التحقيق",
    operationKey:"release_report_rhold_02",
  });
  assert.equal(released.hold,false);
  assert.equal(db.docs.get("diary_reports/rhold").evidenceHold,false);
  assert.equal(db.docs.get("reports/rhold").evidenceHold,false);
  assert.equal(db.docs.get("diary_reports/rhold").evidencePurgeAt.toISOString(),
    evidenceDeadline(base).toISOString());
});

test("U6-G hold requires valid report, original reason and safe token",async()=>{
  const db=new Db();
  await assert.rejects(()=>setReportEvidenceHold(db,{
    collection:"diary_reports",reportId:"missing",actorUid:"owner",
    hold:true,reason:"تحقيق",operationKey:"hold_missing_000001",
  }),/report_not_found/);
  await assert.rejects(()=>setReportEvidenceHold(db,{
    collection:"reports",reportId:"../../users",actorUid:"owner",
    hold:true,reason:"تحقيق",operationKey:"hold_invalid_000001",
  }),/invalid_request/);
  assert.equal(db.docs.size,0);
});

test("U6-G the owner hold controls are explicit in both Arabic screens",()=>{
  const general=fs.readFileSync("lib/admin/general_reports_control_page.dart","utf8");
  const diary=fs.readFileSync("lib/admin/diary_reports_control_page.dart","utf8");
  assert.match(general,/_canHoldEvidence/);
  assert.match(diary,/if \(_owner && item\.hasSensitiveEvidence\)/);
  for(const screen of [general,diary]){
    assert.match(screen,/حجز الدليل/);
    assert.match(screen,/رفع حجز الدليل/);
    assert.match(screen,/setEvidenceHold/);
    assert.match(screen,/evidence_retention_expired/);
  }
});
