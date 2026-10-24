import assert from "node:assert/strict";
import {test,after} from "node:test";
import {randomUUID} from "node:crypto";
import {getApps,initializeApp,deleteApp} from "firebase-admin/app";
import {getFirestore} from "firebase-admin/firestore";
import {cloudflareFirestoreAdapter} from "./helpers/cloudflare-firestore-adapter.js";
import {inspectAccountReportEvidencePage as inspect}
  from "../../cloudflare-worker/src/account-deletion-report-evidence-review-pages.js";
const app=getApps()[0]||initializeApp({projectId:"shadow-live-economy-test"});
const store=getFirestore(app),db=cloudflareFirestoreAdapter(store);
after(async()=>{await deleteApp(app);});
test("emulator: page reports with legal mirror holds, preserve counterparty and 90-day evidence",async()=>{
  const suffix=randomUUID().replaceAll("-","").slice(0,18);
  const uid="report_deletion_"+suffix,other="report_other_"+suffix;
  const requestId="report_request_"+suffix;
  const req=store.doc("account_deletion_requests/"+uid);
  const cp=store.doc("account_deletion_erasure_checkpoints/"+uid);
  const user=store.doc("users/"+uid);
  const reports=Array.from({length:6},(_,i)=>
    store.doc("reports/report_"+suffix+"_"+i));
  const mirror=store.doc("diary_reports/"+reports[0].id);
  const foreign=store.doc("reports/other_"+suffix);
  const refs=[req,cp,user,...reports,mirror,foreign];
  const nowMs=Date.parse("2026-12-01T12:00:00Z");
  await Promise.all([
    req.set({uid,requestId,status:"review_ready"}),
    cp.set({uid,requestId,phase:"preflight_blocked",destructiveAllowed:false}),
    user.set({role:"user",coins:200}),
    ...reports.map((ref,i)=>ref.set({
      reporterUid:uid,targetUid:other,
      targetType:i===0?"diary":"user",
      status:i===0?"under_review":"closed",
      evidencePurgeAt:new Date(nowMs+(i===0?-2:90)*86400_000),
      evidence:{description:"protected report "+i},
    })),
    mirror.set({legalHold:true,evidence:{text:"retained diary evidence"}}),
    foreign.set({reporterUid:other,targetUid:uid,
      evidence:{privateText:"other person's complaint"}}),
  ]);
  const opts={uid,requestId,
    actor:{owner:true,uid:"platform_owner_123"},
    scope:"reporter",nowMs};
  try{
    const items=[];let cursor=null;
    for(let i=0;i<3;i++){
      const page=await inspect(db,{...opts,cursor,limit:2});
      items.push(...page.items);cursor=page.nextCursor;
      assert.equal(page.evidenceErased,false);
      assert.equal(page.retentionCertified,false);
      assert.equal(page.erasureAllowed,false);
      assert.equal(JSON.stringify(page).includes("protected report"),false);
    }
    assert.equal(items.length,6);
    assert.equal(cursor,null);
    assert.equal(items[0].linkedDiaryReportPresent,true);
    assert.equal(items[0].holdOrAppealPresent,true);
    assert.equal(items[0].purgeDeadlinePassed,true);
    assert.equal((await foreign.get()).data().evidence.privateText,
      "other person's complaint");
    assert.equal((await mirror.get()).data().evidence.text,
      "retained diary evidence");
    assert.equal((await reports[0].get()).data().status,"under_review");
    assert.equal((await user.get()).data().coins,200);
    await req.update({investigationHold:true});
    await assert.rejects(inspect(db,opts),
      e=>e.code==="report_evidence_review_blocked");
  }finally{
    await Promise.all(refs.map(ref=>ref.delete()));
  }
});
