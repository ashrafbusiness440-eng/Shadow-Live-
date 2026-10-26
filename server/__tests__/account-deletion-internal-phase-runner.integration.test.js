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

import { recheckErasureCertificatesInTransaction as recheckTransactional }
  from "../../cloudflare-worker/src/account-deletion-erasure-transactional-cert-gate.js";

test("emulator: withdrawn financial approval is rejected inside an actual Firestore transaction",async()=>{
  const suffix=sid();
  const uid="erase_conflict_"+suffix, requestId="conflict_request_"+suffix;
  const ownerUid="owner_erasure_test_123";
  const requestedAtMs=Date.parse("2026-08-01T00:00:00Z");
  const nowMs=Date.parse("2026-10-25T12:00:00Z");
  const note=store.doc("notifications/conflict_notice_"+suffix);
  const signoffs=domains.flatMap(domain=>[
    store.doc("account_deletion_erasure_approvals/"+requestId+"__"+domain),
    store.doc("admin_audit_logs/erasure_domain_cert_"+requestId+"__"+domain),
  ]);
  try {
    await Promise.all([
      note.set({userId:uid,body:"private notice must survive"}),
      ...domains.flatMap((domain,i)=>[
        signoffs[i*2].set({uid,requestId,domain,decision:"approved",
          signedByUid:ownerUid,signedAt:new Date(nowMs-20000),
          expiresAt:new Date(nowMs+86400_000)}),
        signoffs[i*2+1].set({action:"accountErasureDomainCertified",
          actorUid:ownerUid,targetId:uid,requestId,domain,
          createdAt:new Date(nowMs-20000)}),
      ]),
    ]);
    // Revocation is a separately committed change, visible before the
    // transaction. Do not claim this is a real simultaneous race test.
    await signoffs[0].update({decision:"revoked"});
    const txDb={async get(path,tx){
      const snapshot=await tx.get(store.doc(path));
      return {exists:snapshot.exists,data:snapshot.exists?snapshot.data():null};
    }};
    await assert.rejects(store.runTransaction(async tx=>{
      await recheckTransactional(txDb,tx,{
        uid,requestId,requestedAtMs,nowMs,
      });
      tx.delete(note);
    },{maxAttempts:3}),e=>
      e.code==="erasure_transactional_certification_blocked");
    assert.equal((await note.get()).exists,true);
  } finally {
    await Promise.all([note,...signoffs].map(ref=>ref.delete()));
  }
});

test("emulator: competing revoke and erasure writes have a safe server-ordered outcome",
  {timeout:25000},async()=>{
  const suffix=sid();
  const uid="race_erasure_"+suffix,requestId="race_request_"+suffix;
  const ownerUid="owner_erasure_test_123";
  const nowMs=Date.parse("2026-10-25T12:00:00Z");
  const requestedAtMs=nowMs-50*86400_000;
  const notice=store.doc("notifications/race_owned_"+suffix);
  const marker=store.doc("admin_audit_logs/race_test_commit_"+suffix);
  const signoffs=domains.flatMap(domain=>[
    store.doc("account_deletion_erasure_approvals/"+requestId+"__"+domain),
    store.doc("admin_audit_logs/erasure_domain_cert_"+requestId+"__"+domain),
  ]);
  let resumeFirst;
  let reachedFirstRead;
  const firstRead=new Promise(resolve=>{reachedFirstRead=resolve;});
  const proceed=new Promise(resolve=>{resumeFirst=resolve;});
  let attempts=0;
  try {
    await Promise.all([
      notice.set({userId:uid,body:"must survive if revocation commits first"}),
      ...domains.flatMap((domain,i)=>[
        signoffs[i*2].set({uid,requestId,domain,decision:"approved",
          signedByUid:ownerUid,signedAt:new Date(nowMs-10000),
          expiresAt:new Date(nowMs+86400_000)}),
        signoffs[i*2+1].set({action:"accountErasureDomainCertified",
          actorUid:ownerUid,targetId:uid,requestId,domain,
          createdAt:new Date(nowMs-10000)}),
      ]),
    ]);
    const txDb={async get(path,tx){
      const snapshot=await tx.get(store.doc(path));
      return {exists:snapshot.exists,data:snapshot.exists?snapshot.data():null};
    }};
    const transaction=store.runTransaction(async tx=>{
      attempts++;
      await recheckTransactional(txDb,tx,{
        uid,requestId,requestedAtMs,nowMs,
      });
      if(attempts===1){
        reachedFirstRead();
        await proceed;
      }
      // Test-only marker provides an authoritative server commit updateTime.
      tx.create(marker,{kind:"isolated_erasure_race",uid});
      tx.delete(notice);
    },{maxAttempts:4});
    await firstRead;
    // Firestore server transactions can LOCK read documents. The revoker
    // therefore MUST start competing before release, but MUST NOT be awaited
    // while we hold the transaction open (that would deadlock).
    const revoke=signoffs[0].update({decision:"revoked"});
    resumeFirst();
    const [outcome,revocation]=await Promise.all([
      transaction.then(()=>({committed:true}),
        error=>({committed:false,error})),
      revoke,
    ]);
    assert.ok(attempts>=1);
    assert.equal((await signoffs[0].get()).data().decision,"revoked");
    if(outcome.committed){
      // Erasure may legitimately commit BEFORE the revocation: transaction
      // locks serialize the writes. It must not commit AFTER revocation.
      assert.equal((await notice.get()).exists,false);
      const receipt=await marker.get();
      assert.equal(receipt.exists,true);
      assert.ok(receipt.updateTime.toMillis()<=revocation.writeTime.toMillis());
    }else{
      // If revoke won, the conflicting transaction must abort or retry into
      // the now-revoked signoff. No erase or marker may have committed.
      assert.ok(["erasure_transactional_certification_blocked",10,"aborted"]
        .includes(outcome.error?.code),String(outcome.error));
      assert.equal((await notice.get()).exists,true);
      assert.equal((await marker.get()).exists,false);
    }
  } finally {
    resumeFirst?.();
    await Promise.all([notice,marker,...signoffs].map(ref=>ref.delete()));
  }
});
