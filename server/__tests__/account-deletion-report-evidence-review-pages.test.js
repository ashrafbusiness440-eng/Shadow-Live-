import assert from "node:assert/strict";
import test from "node:test";
import {readFileSync} from "node:fs";
import {inspectAccountReportEvidencePage as inspect,
  MAX_REPORT_EVIDENCE_REVIEW_PAGE,REPORT_EVIDENCE_REVIEW_SCOPES}
  from "../../cloudflare-worker/src/account-deletion-report-evidence-review-pages.js";

const uid="deleted_report_user",other="counterparty_user_456";
const requestId="report_delete_request_1234";
const actor={owner:true,uid:"platform_owner_789"};
const req="account_deletion_requests/"+uid;
const cp="account_deletion_erasure_checkpoints/"+uid;
const user="users/"+uid;
const nowMs=Date.parse("2026-12-01T12:00:00Z");
const id=i=>"moderation_report_"+String(i).padStart(3,"0");
class Db {
  constructor(){
    this.docs=new Map([
      [req,{uid,requestId,status:"review_ready"}],
      [cp,{uid,requestId,phase:"preflight_blocked",destructiveAllowed:false}],
      [user,{role:"user",coins:250}],
    ]);
    this.queries=[];this.writes=0;
  }
  async get(path){return {exists:this.docs.has(path),
    data:this.docs.get(path)??null};}
  async runQuery(collection,opts){
    this.queries.push({collection,opts});
    const prefix=collection+"/";
    let rows=[...this.docs].filter(([path,data])=>
      path.startsWith(prefix)&&!path.slice(prefix.length).includes("/")&&
      data[opts.filters[0].field]===opts.filters[0].value)
      .map(([path,data])=>({id:path.slice(prefix.length),data}))
      .sort((a,b)=>a.id.localeCompare(b.id));
    if(opts.startAfter.length){
      const cursor=opts.startAfter[0].referencePath.slice(prefix.length);
      rows=rows.filter(r=>r.id>cursor);
    }
    return rows.slice(0,opts.limit);
  }
}
const run=(db,patch={})=>inspect(db,{
  uid,requestId,actor,scope:"reporter",nowMs,...patch,
});
test("four current and legacy report indexes are explicit",()=>{
  assert.deepEqual(Object.keys(REPORT_EVIDENCE_REVIEW_SCOPES),[
    "reporter","target","legacy_reporter","legacy_target",
  ]);
});
test("12 reporter records paginate 5/5/2, never disclose evidence/reasons",async()=>{
  const db=new Db();
  for(let i=0;i<12;i++)db.docs.set("reports/"+id(i),{
    reporterUid:uid,targetUid:other,
    status:"closed",evidencePurgeAt:new Date(nowMs+86400_000),
    evidence:{clientScreenshot:{storageKey:"secret/evidence.jpg"}},
    details:"sensitive report",reason:"private complaint",
  });
  db.docs.set("reports/foreign_report_123",{
    reporterUid:other,targetUid:uid,
  });
  let cursor=null;const counts=[];
  for(let i=0;i<3;i++){
    const page=await run(db,{cursor});
    counts.push(page.checked);cursor=page.nextCursor;
    assert.equal(page.retentionCertified,false);
    assert.equal(page.evidenceErased,false);
    assert.equal(page.completionVerified,false);
    assert.equal(page.items.every(x=>x.retentionReviewRequired),true);
    assert.equal(page.items.every(x=>x.evidencePresent),true);
    assert.equal(JSON.stringify(page).includes("secret/"),false);
    assert.equal(JSON.stringify(page).includes("sensitive"),false);
    assert.equal(JSON.stringify(page).includes(other),false);
  }
  assert.deepEqual(counts,[5,5,2]);assert.equal(cursor,null);
  assert.deepEqual(db.queries.map(q=>q.opts.limit),[6,6,6]);
  assert.equal(db.docs.get(user).coins,250);
  assert.equal(db.writes,0);
});
test("finalization time alone cannot authorize deletion; active appeals hold",async()=>{
  const db=new Db();
  db.docs.set("reports/"+id(1),{
    reporterUid:uid,status:"closed",
    evidencePurgeAt:new Date(nowMs-86400_000),
    evidence:{clientScreenshot:"protected"},appealPending:true,
    targetType:"diary",
  });
  db.docs.set("diary_reports/"+id(1),{legalHold:true});
  const page=await run(db);
  assert.equal(page.checked,1);
  assert.equal(page.items[0].purgeDeadlinePassed,true);
  assert.equal(page.items[0].holdOrAppealPresent,true);
  assert.equal(page.items[0].linkedDiaryReportPresent,true);
  assert.equal(page.items[0].deletionAuthorized,false);
  assert.equal(page.evidenceErased,false);
});
test("pending, reopened and legacy uncertain reports never receive retention certification",async()=>{
  const db=new Db();
  for(let i=0;i<3;i++)db.docs.set("reports/"+id(i),{
    targetUid:uid,status:i===0?"under_review":i===1?"reopened":"closed",
    evidence:{note:"confidential"},
  });
  const page=await run(db,{scope:"target"});
  assert.deepEqual(page.items.map(x=>x.explicitPurgeDeadlinePresent),
    [false,false,false]);
  assert.deepEqual(page.items.map(x=>x.finalReportStatus),[false,false,true]);
  assert.equal(page.retentionCertified,false);
});
test("four scopes contain no other user data and honor legacy aliases",async()=>{
  for(const [scope,field] of [
    ["reporter","reporterUid"],["target","targetUid"],
    ["legacy_reporter","reporterId"],["legacy_target","targetUserId"],
  ]){
    const db=new Db();
    db.docs.set("reports/"+id(5),{[field]:uid,details:"secret"});
    const page=await run(db,{scope});
    assert.equal(page.checked,1);
    assert.equal(db.queries[0].opts.filters[0].field,field);
    assert.equal(JSON.stringify(page).includes("secret"),false);
  }
});
test("account holds, request rotation, forged query ownership fail closed",async()=>{
  for(const edit of [
    d=>d.docs.get(req).status="cancelled",
    d=>d.docs.get(req).requestId="changed_request_123456",
    d=>d.docs.get(cp).requestId="old_request_12345678",
    d=>d.docs.get(cp).investigationHold=true,
    d=>d.docs.get(user).role="owner",
    d=>d.docs.get(user).authDeleted=true,
    d=>d.docs.get(user).legalHold=true,
  ]){
    const db=new Db();edit(db);
    await assert.rejects(run(db),e=>e.code==="report_evidence_review_blocked");
    assert.equal(db.queries.length,0);
  }
  const db=new Db();
  db.runQuery=async()=>[{id:id(5),data:{reporterUid:other}}];
  await assert.rejects(run(db),e=>e.code==="report_evidence_index_mismatch");
});
test("invalid identifiers and limit rejected before reads",async()=>{
  for(const patch of [
    {uid:"../invalid"},{requestId:"bad"}, {actor:{owner:false,uid:"user_987"}},
    {scope:"all"},{cursor:"../bad"},{limit:0},
    {limit:MAX_REPORT_EVIDENCE_REVIEW_PAGE+1},{nowMs:NaN},
  ]){
    const db=new Db();db.get=async()=>{throw Error("unexpectedIO");};
    await assert.rejects(run(db,patch),e=>e.status===400||e.status===403);
    assert.equal(db.queries.length,0);
  }
});
test("module cannot purge evidence, mutate reports or certify erasure",()=>{
  const s=readFileSync(
    "cloudflare-worker/src/account-deletion-report-evidence-review-pages.js",
    "utf8");
  assert.doesNotMatch(s,/db\.commit\(|writeDelete\(|writeUpdate\(|bucket\.delete\(|deleteAuthUser\(|setInterval\(/);
  assert.match(s,/retentionCertified:false/);
  assert.match(s,/completionVerified:false/);
});
