import assert from "node:assert/strict";
import { test, after } from "node:test";
import { randomUUID } from "node:crypto";
import { getApps, initializeApp, deleteApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { cloudflareFirestoreAdapter }
  from "./helpers/cloudflare-firestore-adapter.js";
import { runCertifiedInternalAccountErasurePage as run }
  from "../../cloudflare-worker/src/account-deletion-internal-phase-runner.js";
import { REQUIRED_ERASURE_ADMISSION_DOMAINS as domains }
  from "../../cloudflare-worker/src/account-deletion-processing-admission.js";

const app=getApps()[0]||initializeApp({projectId:"shadow-live-economy-test"});
const store=getFirestore(app),db=cloudflareFirestoreAdapter(store);
after(async()=>{await deleteApp(app);});
const sid=()=>randomUUID().replaceAll("-","").slice(0,18);

test("emulator: bounded, certified notification pages preserve unrelated recipients and resume after late appeal",async()=>{
  const suffix=sid();
  const uid="erase_runner_"+suffix,other="other_runner_"+suffix;
  const owner="owner_erasure_test_123";
  const requestId="runner_request_"+suffix;
  const nowMs=Date.parse("2026-12-25T12:00:00Z");
  const requestedAt=new Date(nowMs-50*86400_000);
  const req=store.doc("account_deletion_requests/"+uid);
  const cp=store.doc("account_deletion_erasure_checkpoints/"+uid);
  const user=store.doc("users/"+uid);
  const audit=store.doc(
    "admin_audit_logs/erasure_processing_start_"+requestId);
  const approvals=domains.flatMap(domain=>[
    store.doc("account_deletion_erasure_approvals/"+requestId+"__"+domain),
    store.doc("admin_audit_logs/erasure_domain_cert_"+requestId+"__"+domain),
  ]);
  const notices=Array.from({length:7},(_,i)=>store.doc(
    "notifications/owned_runner_"+suffix+"_"+i));
  const third=store.doc("notifications/unrelated_runner_"+suffix);
  const refs=[req,cp,user,audit,...approvals,...notices,third];
  await Promise.all([
    req.set({uid,requestId,status:"processing",requestedAt,
      eligibleAt:new Date(requestedAt.getTime()+30*86400_000)}),
    cp.set({uid,requestId,phase:"notifications",
      destructiveAllowed:true, notificationRetentionCleared:true,
      legalEvidenceReviewComplete:true,financialSettlementApproved:true}),
    user.set({role:"user",accountStatus:"deletion_processing",
      coins:320,diamonds:4}),
    audit.set({action:"accountErasureProcessingAdmitted",targetId:uid,
      requestId,certifiedDomains:[...domains]}),
    ...domains.flatMap((domain,i)=>[
      approvals[i*2].set({uid,requestId,domain,decision:"approved",
        signedByUid:owner,signedAt:new Date(nowMs-10_000),
        expiresAt:new Date(nowMs+86400_000)}),
      approvals[i*2+1].set({action:"accountErasureDomainCertified",
        actorUid:owner,targetId:uid,requestId,domain,
        createdAt:new Date(nowMs-10_000)}),
    ]),
    ...notices.map((ref,i)=>ref.set({userId:uid,body:"private-"+i})),
    third.set({userId:other,body:"keep other user's data"}),
  ]);
  const args={uid,requestId,actor:{uid:owner,owner:true},
    step:"notifications",limit:3,nowMs};
  try {
    const first=await run(db,args);
    assert.equal(first.checked,3);
    assert.equal(first.erased,3);
    assert.equal(first.hasMore,true);
    assert.equal(first.stageCompleted,false);
    assert.equal(first.completionVerified,false);
    assert.equal((await third.get()).data().body,"keep other user's data");
    assert.equal((await user.get()).data().coins,320);

    // A newly opened appeal revokes the right to process the next page.
    await approvals[3].update({appealStatus:"open"});
    await assert.rejects(run(db,args),
      e=>e.code==="internal_erasure_certification_invalid");
    assert.equal((await notices[3].get()).exists,true);
    assert.equal((await user.get()).data().diamonds,4);
    await approvals[3].update({appealStatus:"closed"});

    const second=await run(db,args);
    const thirdPage=await run(db,args);
    assert.equal(second.erased,3);
    assert.equal(thirdPage.erased,1);
    assert.equal(thirdPage.hasMore,false);
    for(const ref of notices)assert.equal((await ref.get()).exists,false);
    assert.equal((await third.get()).exists,true);
    assert.equal((await cp.get()).data().destructiveAllowed,true);
    assert.equal((await user.get()).data().coins,320);
    assert.equal((await user.get()).data().diamonds,4);
    assert.equal((await audit.get()).exists,true);
    // Exhaustion of one indexed collection never finalizes user deletion.
    assert.equal(thirdPage.accountErased,false);
    assert.equal(thirdPage.firebaseAuthDeleted,false);
    assert.equal((await req.get()).data().status,"processing");
  } finally {
    await Promise.all(refs.map(ref=>ref.delete()));
  }
});

test("emulator: production-style blocked checkpoint cannot remove disposable messages",async()=>{
  const suffix=sid(),uid="runner_block_"+suffix;
  const requestId="runner_block_request_"+suffix;
  const req=store.doc("account_deletion_requests/"+uid);
  const cp=store.doc("account_deletion_erasure_checkpoints/"+uid);
  const user=store.doc("users/"+uid);
  const note=store.doc("notifications/blocked_runner_notice_"+suffix);
  const refs=[req,cp,user,note];
  await Promise.all([
    req.set({uid,requestId,status:"processing",requestedAt:
      new Date("2026-10-10T00:00:00Z"),eligibleAt:
      new Date("2026-11-10T00:00:00Z")}),
    cp.set({uid,requestId,phase:"notifications",
      destructiveAllowed:false}),
    user.set({role:"user",accountStatus:"deletion_processing"}),
    note.set({userId:uid,body:"retain"}),
  ]);
  try {
    await assert.rejects(run(db,{
      uid,requestId,step:"notifications",
      actor:{uid:"owner_erasure_test_123",owner:true},
      nowMs:Date.parse("2026-12-25T12:00:00Z"),
    }),e=>e.code==="internal_erasure_stage_blocked");
    assert.equal((await note.get()).exists,true);
    assert.equal((await cp.get()).data().destructiveAllowed,false);
  } finally {
    await Promise.all(refs.map(ref=>ref.delete()));
  }
});
