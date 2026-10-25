import assert from "node:assert/strict";
import { inspectAccountDeletionClosureReadiness } from "../../cloudflare-worker/src/account-deletion-closure-readiness.js";
import {test,after} from "node:test";
import {randomUUID} from "node:crypto";
import {getApps,initializeApp,deleteApp} from "firebase-admin/app";
import {getFirestore} from "firebase-admin/firestore";
import {cloudflareFirestoreAdapter} from "./helpers/cloudflare-firestore-adapter.js";
import {admitCertifiedAccountErasure, REQUIRED_ERASURE_ADMISSION_DOMAINS}
  from "../../cloudflare-worker/src/account-deletion-processing-admission.js";

const app=getApps()[0]||initializeApp({projectId:"shadow-live-economy-test"});
const firestore=getFirestore(app),db=cloudflareFirestoreAdapter(firestore);
after(async()=>{await deleteApp(app);});

test("emulator: concurrent certified admission of suspended account preserves moderation status",async()=>{
  const suffix=randomUUID().replaceAll("-","").slice(0,18);
  const uid="erase_admit_"+suffix,requestId="admit_req_"+suffix;
  const ownerUid="verified_owner_123";
  const nowMs=Date.parse("2026-12-15T00:00:00Z");
  const requestedAtMs=nowMs-35*86400_000;
  const request=firestore.doc("account_deletion_requests/"+uid);
  const checkpoint=firestore.doc("account_deletion_erasure_checkpoints/"+uid);
  const user=firestore.doc("users/"+uid);
  const startAudit=firestore.doc("admin_audit_logs/erasure_processing_start_"+requestId);
  const certs=REQUIRED_ERASURE_ADMISSION_DOMAINS.flatMap(domain=>[
    firestore.doc("account_deletion_erasure_approvals/"+requestId+"__"+domain),
    firestore.doc("admin_audit_logs/erasure_domain_cert_"+requestId+"__"+domain),
  ]);
  const refs=[request,checkpoint,user,startAudit,...certs];
  await Promise.all([
    request.set({uid,requestId,status:"review_ready",
      requestedAt:new Date(requestedAtMs),
      eligibleAt:new Date(requestedAtMs+30*86400_000)}),
    checkpoint.set({uid,requestId,phase:"preflight_blocked",
      destructiveAllowed:false}),
    user.set({role:"user",accountStatus:"suspended",
      name:"kept",coins:900,diamonds:10}),
    ...REQUIRED_ERASURE_ADMISSION_DOMAINS.flatMap((domain,index)=>[
      certs[index*2].set({uid,requestId,domain,decision:"approved",
        signedByUid:ownerUid,signedAt:new Date(nowMs-10000),
        expiresAt:new Date(nowMs+86400_000)}),
      certs[index*2+1].set({action:"accountErasureDomainCertified",
        actorUid:ownerUid,targetId:uid,requestId,domain,
        createdAt:new Date(nowMs-10000)}),
    ]),
  ]);
  const opts={uid,requestId,actor:{uid:ownerUid,owner:true},nowMs};
  try{
    const results=await Promise.all([
      admitCertifiedAccountErasure(db,opts),
      admitCertifiedAccountErasure(db,opts),
    ]);
    assert.deepEqual(results.map(x=>x.admitted).sort(),[false,true]);
    assert.equal((await request.get()).data().status,"processing");
    const userRow=(await user.get()).data();
    assert.equal(userRow.accountStatus,"deletion_processing");
    assert.equal(userRow.name,"kept");
    assert.equal(userRow.coins,900);
    assert.equal(userRow.diamonds,10);
    assert.equal((await checkpoint.get()).data().destructiveAllowed,false);
    assert.equal((await checkpoint.get()).data().priorAccountStatus,"suspended");
    assert.equal((await startAudit.get()).data().action,
      "accountErasureProcessingAdmitted");
    await request.update({reviewHold:true});
    await assert.rejects(admitCertifiedAccountErasure(db,opts),
      error=>error.code==="erasure_admission_blocked");
    await request.update({reviewHold:false,investigationHold:true});
    await assert.rejects(admitCertifiedAccountErasure(db,opts),
      error=>error.code==="erasure_admission_blocked");
    await request.update({investigationHold:false});
    await checkpoint.update({reported:true});
    await assert.rejects(admitCertifiedAccountErasure(db,opts),
      error=>error.code==="erasure_admission_blocked");
    await checkpoint.update({reported:false,appealStatus:"under_review"});
    await assert.rejects(admitCertifiedAccountErasure(db,opts),
      error=>error.code==="erasure_admission_blocked");
    await checkpoint.update({appealStatus:"closed"});
    await user.update({appealPending:true});
    await assert.rejects(admitCertifiedAccountErasure(db,opts),
      error=>error.code==="erasure_admission_blocked");
    await user.update({appealPending:false});
    await certs[0].update({decision:"revoked"});
    await assert.rejects(admitCertifiedAccountErasure(db,opts),
      error=>error.code==="erasure_domain_certification_missing_or_invalid");
    await certs[0].update({decision:"approved",expiresAt:new Date(nowMs-1)});
    await assert.rejects(admitCertifiedAccountErasure(db,opts),
      error=>error.code==="erasure_domain_certification_missing_or_invalid");
    await certs[0].update({expiresAt:new Date(nowMs+86400_000)});
    await certs[1].update({appealStatus:"open"});
    await assert.rejects(admitCertifiedAccountErasure(db,opts),
      error=>error.code==="erasure_domain_certification_missing_or_invalid");
    await certs[1].update({appealStatus:"closed"});
    const retry=await admitCertifiedAccountErasure(db,opts);
    assert.equal(retry.duplicate,true);
    assert.equal(retry.destructiveAllowed,false);
    assert.equal((await user.get()).data().coins,900);
    assert.equal((await checkpoint.get()).data().destructiveAllowed,false);
  }finally{
    await Promise.all(refs.map(ref=>ref.delete()));
  }
});

test("emulator: missing financial certification is fail-closed without locking account",async()=>{
  const suffix=randomUUID().replaceAll("-","").slice(0,18);
  const uid="erase_admit_"+suffix,requestId="admit_req_"+suffix;
  const request=firestore.doc("account_deletion_requests/"+uid);
  const checkpoint=firestore.doc("account_deletion_erasure_checkpoints/"+uid);
  const user=firestore.doc("users/"+uid);
  const nowMs=Date.parse("2026-12-15T00:00:00Z");
  const refs=[request,checkpoint,user];
  await Promise.all([
    request.set({uid,requestId,status:"review_ready",
      requestedAt:new Date(nowMs-40*86400_000),
      eligibleAt:new Date(nowMs-10*86400_000)}),
    checkpoint.set({uid,requestId,phase:"preflight_blocked",
      destructiveAllowed:false}),
    user.set({role:"user",accountStatus:"active"}),
  ]);
  try{
    await assert.rejects(admitCertifiedAccountErasure(db,{
      uid,requestId,actor:{uid:"verified_owner_123",owner:true},nowMs,
    }),e=>e.code==="erasure_domain_certification_missing_or_invalid");
    assert.equal((await request.get()).data().status,"review_ready");
    assert.equal((await user.get()).data().accountStatus,"active");
  }finally{
    await Promise.all(refs.map(ref=>ref.delete()));
  }
});

test("emulator: closure readiness shows six signoffs without admitting processing or mutating money",async()=>{
  const suffix=randomUUID().replaceAll("-","").slice(0,18);
  const uid="erase_closure_"+suffix,requestId="closure_req_"+suffix;
  const ownerUid="owner_for_closure_123",nowMs=Date.parse("2026-12-15T00:00:00Z");
  const requestedAt=new Date(nowMs-40*86400_000);
  const req=firestore.doc("account_deletion_requests/"+uid);
  const cp=firestore.doc("account_deletion_erasure_checkpoints/"+uid);
  const user=firestore.doc("users/"+uid);
  const approvals=REQUIRED_ERASURE_ADMISSION_DOMAINS.flatMap(domain=>[
    firestore.doc("account_deletion_erasure_approvals/"+requestId+"__"+domain),
    firestore.doc("admin_audit_logs/erasure_domain_cert_"+requestId+"__"+domain),
  ]);
  const refs=[req,cp,user,...approvals];
  await Promise.all([
    req.set({uid,requestId,status:"review_ready",requestedAt,
      eligibleAt:new Date(requestedAt.getTime()+30*86400_000)}),
    cp.set({uid,requestId,phase:"preflight_blocked",destructiveAllowed:false}),
    user.set({role:"user",accountStatus:"active",coins:750,diamonds:21,
      displayName:"private customer"}),
    ...REQUIRED_ERASURE_ADMISSION_DOMAINS.flatMap((domain,i)=>[
      approvals[i*2].set({uid,requestId,domain,decision:"approved",
        signedByUid:ownerUid,signedAt:new Date(nowMs-10000),
        expiresAt:new Date(nowMs+86400_000)}),
      approvals[i*2+1].set({action:"accountErasureDomainCertified",
        actorUid:ownerUid,targetId:uid,requestId,domain,
        createdAt:new Date(nowMs-10000)}),
    ]),
  ]);
  const opts={uid,requestId,actor:{uid:ownerUid,owner:true},nowMs};
  try {
    let page=await inspectAccountDeletionClosureReadiness(db,opts);
    assert.equal(page.structurallySignedDomains,6);
    assert.equal(page.erasureAllowed,false);
    assert.equal(page.processingAdmitted,false);
    assert.equal(JSON.stringify(page).includes("private customer"),false);
    assert.equal(JSON.stringify(page).includes(ownerUid),false);
    assert.equal((await req.get()).data().status,"review_ready");
    assert.equal((await cp.get()).data().destructiveAllowed,false);
    assert.equal((await user.get()).data().coins,750);
    await approvals[2].update({appealStatus:"under_review"});
    page=await inspectAccountDeletionClosureReadiness(db,opts);
    assert.equal(page.structurallySignedDomains,5);
    assert.equal(page.domains[1].certificateDocumentsValid,false);
    await req.update({appealPending:true});
    await assert.rejects(inspectAccountDeletionClosureReadiness(db,opts),
      e=>e.code==="closure_readiness_review_blocked");
    assert.equal((await user.get()).data().diamonds,21);
    assert.equal((await cp.get()).data().destructiveAllowed,false);
  } finally {
    await Promise.all(refs.map(ref=>ref.delete()));
  }
});
