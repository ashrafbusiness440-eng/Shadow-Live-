// Disposable LOCAL Firestore Emulator acceptance for the *actual Cloudflare
// Firestore REST adapter*. A generated test-only RSA key and a local fetch
// bridge prevent any Google network call or real service-account access.
// This test never targets production or invokes any external R2 operation.
import assert from "node:assert/strict";
import {test,after} from "node:test";
import {randomUUID,generateKeyPairSync} from "node:crypto";
import {getApps,initializeApp,deleteApp} from "firebase-admin/app";
import {getFirestore} from "firebase-admin/firestore";
import {firestoreClient} from "../../cloudflare-worker/src/firestore.js";
import {redactDeletedPrivateTextMessage}
  from "../../cloudflare-worker/src/account-deletion-private-text-stage.js";
import {verifyAccountStorageCleanupJob}
  from "../../cloudflare-worker/src/user-storage.js";
import {reserveAccountErasureExternalIo as reserve,
  requestAccountErasureExternalIoRevocationIntent as requestStop,
  recordAccountErasureExternalIoCoordinationHold as recordHold,
  recordAccountErasureExternalIoUncertainAttempt as recordUncertainAttempt,
  recordAccountErasureExternalIoReadOnlyProbe as recordProbe}
  from "../../cloudflare-worker/src/account-deletion-external-io-reservation.js";
import {openAccountErasureExternalIoReconciliationCase as openReconciliation}
  from "../../cloudflare-worker/src/account-deletion-external-io-reconciliation.js";
import {rehearseAccountErasureR2Dispatch as dispatchFixture}
  from "../../cloudflare-worker/src/account-deletion-r2-external-interlock.js";
import {withdrawAccountErasureDomainWithExternalIoStop as withdrawDomain}
  from "../../cloudflare-worker/src/account-deletion-domain-withdrawal-interlock.js";
import {REQUIRED_ERASURE_ADMISSION_DOMAINS as domains}
  from "../../cloudflare-worker/src/account-deletion-processing-admission.js";
import {seedEmulatorErasureCertificates}
  from "./helpers/account-erasure-synthetic-certificates.js";

if (!process.env.FIRESTORE_EMULATOR_HOST ||
    !/^(localhost|127\.0\.0\.1|\[::1\]):\d+$/.test(
      process.env.FIRESTORE_EMULATOR_HOST)) {
  throw Error("LOCAL_FIRESTORE_EMULATOR_REQUIRED_FOR_REST_TEST");
}
const app=getApps()[0]||initializeApp({projectId:"shadow-live-economy-test"});
const store=getFirestore(app);
const upstreamFetch=globalThis.fetch;
const {privateKey}=generateKeyPairSync("rsa",{
  modulusLength:2048,
  privateKeyEncoding:{type:"pkcs8",format:"pem"},
  publicKeyEncoding:{type:"spki",format:"pem"},
});
const env={FIREBASE_SERVICE_ACCOUNT:JSON.stringify({
  project_id:"shadow-live-economy-test",
  client_email:"disposable-account-erasure-"+randomUUID()+"@example.invalid",
  private_key:privateKey,
})};
const FIRESTORE_ORIGIN="https://firestore.googleapis.com";
globalThis.fetch=async (url,options)=>{
  const target=String(url);
  if(target==="https://oauth2.googleapis.com/token"){
    return new Response(JSON.stringify({
      access_token:"local-emulator-test-token",expires_in:3600,
    }),{status:200,headers:{"content-type":"application/json"}});
  }
  if(target.startsWith(FIRESTORE_ORIGIN+"/v1/")){
    // Never allow this fetch wrapper to talk to Google Firestore.
    const local="http://"+process.env.FIRESTORE_EMULATOR_HOST+
      target.slice(FIRESTORE_ORIGIN.length);
    // The Emulator expects its documented local administrator identity,
    // not a mocked Google OAuth access token (which yields "invalid jwt").
    // This header rewrite NEVER leaves the loopback-only local test bridge.
    const headers=new Headers(options?.headers||{});
    headers.set("Authorization","Bearer owner");
    // Firestore Emulator can hold pessimistic locks for up to 30 seconds.
    // Bound test-only REST requests so a broken lock cannot hang CI forever.
    // Production Cloudflare fetch/authorization remains untouched.
    return upstreamFetch(local,{
      ...options,headers,signal:AbortSignal.timeout(35_000),
    });
  }
  throw Error("REST_EMULATOR_TEST_BLOCKS_EXTERNAL_FETCH");
};
after(async()=>{
  globalThis.fetch=upstreamFetch;
  await deleteApp(app);
});
const sid=()=>randomUUID().replaceAll("-","").slice(0,18);
const days=n=>n*86400_000;

test("emulator: actual Cloudflare REST transactions admit at most one I/O reservation",{
  timeout:85000,
},async()=>{
  const suffix=sid(),uid="rest_io_user_"+suffix,
    requestId="rest_io_request_"+suffix,
    objectId="rest_io_object_"+suffix;
  const nowMs=Date.now(),requestedAt=new Date(nowMs-days(40));
  const owner="test_owner_rest_123456";
  const doc=path=>store.doc(path);
  const request=doc("account_deletion_requests/"+uid);
  const checkpoint=doc("account_deletion_erasure_checkpoints/"+uid);
  const user=doc("users/"+uid);
  const admission=doc("admin_audit_logs/erasure_processing_start_"+requestId);
  const asset=doc("storage_objects/"+objectId);
  const reservation=doc("account_erasure_external_io_reservations/"+uid+"__"+objectId);
  const certificates=await seedEmulatorErasureCertificates(store,{
    uid,requestId,nowMs,
  });
  const refs=[request,checkpoint,user,admission,asset,reservation,...certificates];
  try{
    await Promise.all([
      request.set({uid,requestId,status:"processing",requestedAt,
        eligibleAt:new Date(requestedAt.getTime()+days(30))}),
      checkpoint.set({uid,requestId,phase:"storage_media",destructiveAllowed:true,
        storageRetentionApproved:true,sharedMediaOwnershipReviewed:true,
        legalEvidenceReviewComplete:true,financialSettlementApproved:true,
        playBillingReviewComplete:true}),
      user.set({accountStatus:"deletion_processing",role:"user",coins:330}),
      admission.set({action:"accountErasureProcessingAdmitted",
        targetId:uid,requestId,certifiedDomains:[...domains]}),
      asset.set({objectId,ownerUid:uid,scope:"chat_image",
        storageKey:"account-erasure/emulator/"+suffix+".webp"}),
    ]);
    const args=token=>({uid,requestId,objectId,actor:{
      uid:owner,owner:true,
    },token,nowMs});
    // Two completely separate copies of the actual REST adapter, not an
    // in-memory serial queue. Firestore must resolve the create-only conflict.
    const outcomes=await Promise.allSettled([
      reserve(firestoreClient(env),args("rest_worker_one_token_123456")),
      reserve(firestoreClient(env),args("rest_worker_two_token_123456")),
    ]);
    const approved=outcomes.filter(x=>x.status==="fulfilled");
    assert.equal(approved.length,1,
      JSON.stringify(outcomes.map(x=>x.status==="rejected"?{
        message:x.reason?.message,status:x.reason?.status,
        code:x.reason?.code,details:x.reason?.details,
      }:x.value)));
    assert.equal(outcomes.filter(x=>x.status==="rejected").length,1);
    assert.equal(approved[0].value.externalIoAllowed,false);
    const stored=await reservation.get();
    assert.equal(stored.exists,true);
    assert.equal(stored.data().externalIoAllowed,false);
    assert.equal(stored.data().completionVerified,false);
    assert.equal(stored.data().state,"reserved_requires_external_interlock");
    assert.equal((await user.get()).data().coins,330);
    // Claim a non-permissive request-wide coordination hold using the
    // actual Cloudflare REST adapter and the winning reservation token.
    // This is a durable marker, NOT an R2 delete or permission.
    const hold=doc("account_erasure_external_io_coordination_holds/"+
      uid+"__"+requestId);
    refs.push(hold);
    const holdResult=await recordHold(firestoreClient(env),{
      ...args(stored.data().operationToken),
      objectId,
    });
    assert.equal(holdResult.externalIoAllowed,false);
    assert.equal((await hold.get()).data().state,
      "claimed_requires_external_interlock");
    await assert.rejects(recordHold(firestoreClient(env),{
      ...args(stored.data().operationToken),objectId,
    }),e=>e.code==="external_io_coordination_requires_reconciliation");
    // The irreversible unknown-outcome journal is an independent request-
    // wide record. It is NOT proof of an R2 write, does not permit deletion,
    // and cannot be automatically retried after a simulated crash.
    const journal=doc("account_erasure_external_io_uncertain_attempts/"+
      uid+"__"+requestId);
    refs.push(journal);
    const attempt=await recordUncertainAttempt(firestoreClient(env),{
      ...args(stored.data().operationToken),objectId,
    });
    assert.equal(attempt.outcomeUnknown,true);
    assert.equal(attempt.externalIoAllowed,false);
    assert.equal(attempt.retryAllowed,false);
    assert.equal((await journal.get()).data().state,
      "outcome_unknown_requires_reconciliation");
    assert.equal((await journal.get()).data().storageKey,
      "account-erasure/emulator/"+suffix+".webp");
    // Actual Cloudflare REST adapter writes the read-only probe observation;
    // bucket is fake and its delete method MUST NEVER run.
    const probeOne=doc("account_erasure_external_io_probe_observations/"+
      uid+"__"+requestId+"__rest_probe_one_123456");
    const probeTwo=doc("account_erasure_external_io_probe_observations/"+
      uid+"__"+requestId+"__rest_probe_two_123456");
    refs.push(probeOne,probeTwo);
    let probeHeads=0;
    const mockBucket={
      async head(key){
        probeHeads++;
        assert.equal(key,"account-erasure/emulator/"+suffix+".webp");
        return probeHeads===1?{etag:"fake-erasure-test",size:101}:null;
      },
      async delete(){throw Error("bucket_delete_must_not_be_called");},
    };
    const evidence=await recordProbe(firestoreClient(env),mockBucket,{
      ...args(stored.data().operationToken),objectId,
      probeId:"rest_probe_one_123456",
    });
    assert.equal(evidence.presenceAtProbe,"present_at_probe");
    assert.equal(evidence.completionVerified,false);
    assert.equal((await probeOne.get()).data().retryAllowed,false);
    await assert.rejects(recordProbe(firestoreClient(env),mockBucket,{
      ...args(stored.data().operationToken),objectId,
      probeId:"rest_probe_one_123456",
    }),e=>e.code==="external_io_probe_already_recorded");
    assert.equal(probeHeads,1);
    await assert.rejects(recordUncertainAttempt(firestoreClient(env),{
      ...args(stored.data().operationToken),objectId,
    }),e=>e.code==="external_io_uncertain_attempt_requires_reconciliation");
    // A held request must block a SECOND object even before the Owner
    // requests revocation. This is the actual REST Firestore transaction path.
    const heldObjectId="rest_io_held_"+suffix;
    const heldAsset=doc("storage_objects/"+heldObjectId);
    const heldReservation=doc("account_erasure_external_io_reservations/"+
      uid+"__"+heldObjectId);
    refs.push(heldAsset,heldReservation);
    await heldAsset.set({objectId:heldObjectId,ownerUid:uid,
      scope:"chat_image"});
    await assert.rejects(reserve(firestoreClient(env),{
      ...args("rest_worker_held_other_token_123456"),
      objectId:heldObjectId,
    }),e=>e.code==="external_io_coordination_requires_reconciliation");
    assert.equal((await heldReservation.get()).exists,false);
    // Revocation after a reservation must never permit a fresh reservation.
    await certificates[0].update({decision:"revoked"});
    await assert.rejects(reserve(firestoreClient(env),args(
      "rest_worker_three_token_123456")),
      e=>e.code==="external_io_coordination_requires_reconciliation"||
        e.code==="erasure_transactional_certification_blocked");
    assert.equal((await reservation.get()).data().externalIoAllowed,false);
    // A stop requested AFTER a prior immutable reservation must prevent
    // reservations for DIFFERENT objects too. This is a transaction-scoped
    // boundary, not a claim that prior external I/O was cancelled.
    const secondId="rest_io_second_"+suffix;
    const secondAsset=doc("storage_objects/"+secondId);
    const secondReservation=doc(
      "account_erasure_external_io_reservations/"+uid+"__"+secondId);
    const intent=doc(
      "account_erasure_external_io_revocation_intents/"+uid+"__"+requestId);
    const intentAudit=doc(
      "admin_audit_logs/erasure_external_io_revocation_intent_"+requestId);
    refs.push(secondAsset,secondReservation,intent,intentAudit);
    await secondAsset.set({objectId:secondId,ownerUid:uid,
      scope:"chat_image"});
    const intentResult=await requestStop(firestoreClient(env),{
      uid,requestId,actor:{uid:owner,owner:true},nowMs,
    });
    assert.equal(intentResult.revocationEffective,false);
    assert.equal(intentResult.coordinationHoldObserved,true);
    assert.equal(intentResult.uncertainAttemptObserved,true);
    assert.equal((await intent.get()).data().uncertainAttemptObserved,true);
    assert.equal((await journal.get()).data().retryAllowed,false);
    assert.equal((await hold.get()).data().externalIoAllowed,false);
    const evidenceAfterStop=await recordProbe(
      firestoreClient(env),mockBucket,{
        ...args(stored.data().operationToken),objectId,
        probeId:"rest_probe_two_123456",
      });
    assert.equal(evidenceAfterStop.presenceAtProbe,"absent_at_probe");
    assert.equal(evidenceAfterStop.stopObservedAtCommit,true);
    assert.equal(evidenceAfterStop.completionVerified,false);
    assert.equal((await probeTwo.get()).data().revocationEffective,false);
    // A separate post-stop HEAD at a later instant is required for an
    // immutable reconciliation CASE; neither probe can certify a delete.
    const probeThree=doc("account_erasure_external_io_probe_observations/"+
      uid+"__"+requestId+"__rest_probe_three_123456");
    const caseDoc=doc("account_erasure_external_io_reconciliation_cases/"+
      uid+"__"+requestId);
    const caseAudit=doc("admin_audit_logs/erasure_external_io_reconciliation_case_"+
      requestId);
    refs.push(probeThree,caseDoc,caseAudit);
    const later=await recordProbe(firestoreClient(env),mockBucket,{
      ...args(stored.data().operationToken),objectId,
      probeId:"rest_probe_three_123456",nowMs:nowMs+1000,
    });
    assert.equal(later.presenceAtProbe,"absent_at_probe");
    const caseResult=await openReconciliation(firestoreClient(env),{
      ...args(stored.data().operationToken),objectId,
      firstProbeId:"rest_probe_two_123456",
      secondProbeId:"rest_probe_three_123456",
      nowMs:nowMs+2000,
    });
    assert.equal(caseResult.classification,
      "absence_does_not_prove_historical_deletion");
    assert.equal(caseResult.pendingIndependentReview,true);
    assert.equal(caseResult.completionVerified,false);
    assert.equal((await caseDoc.get()).data().retryAllowed,false);
    assert.equal((await caseDoc.get()).data().ownerStopObserved,true);
    assert.equal((await caseAudit.get()).data().completionVerified,false);
    await assert.rejects(openReconciliation(firestoreClient(env),{
      ...args(stored.data().operationToken),objectId,
      firstProbeId:"rest_probe_two_123456",
      secondProbeId:"rest_probe_three_123456",
      nowMs:nowMs+2000,
    }),e=>e.code==="external_io_reconciliation_case_already_open");
    assert.equal(probeHeads,3);
    assert.equal((await intent.get()).data().revocationEffective,false);
    await assert.rejects(recordUncertainAttempt(firestoreClient(env),{
      ...args(stored.data().operationToken),objectId,
    }),e=>e.code==="external_io_revocation_intent_pending");
    await certificates[0].update({decision:"approved"});
    await assert.rejects(reserve(firestoreClient(env),{
      ...args("rest_worker_new_object_token_123456"),objectId:secondId,
    }),e=>e.code==="external_io_revocation_intent_pending");
    assert.equal((await secondReservation.get()).exists,false);
    assert.equal((await reservation.get()).data().externalIoAllowed,false);
  }finally{
    await Promise.all(refs.map(ref=>ref.delete()));
  }
});

test("emulator: REST transactional batchGet blocks revoked approval before any reservation",{
  timeout:45000,
},async()=>{
  const suffix=sid(),uid="rest_revoke_user_"+suffix,
    requestId="rest_revoke_request_"+suffix,
    objectId="rest_revoke_object_"+suffix;
  const nowMs=Date.now(),requestedAt=new Date(nowMs-days(40));
  const paths=[
    "account_deletion_requests/"+uid,
    "account_deletion_erasure_checkpoints/"+uid,
    "users/"+uid,
    "admin_audit_logs/erasure_processing_start_"+requestId,
    "storage_objects/"+objectId,
    "account_erasure_external_io_reservations/"+uid+"__"+objectId,
    "account_erasure_external_io_revocation_intents/"+uid+"__"+requestId,
    "admin_audit_logs/erasure_external_io_revocation_intent_"+requestId,
  ];
  const docs=paths.map(path=>store.doc(path));
  const certificates=await seedEmulatorErasureCertificates(store,{
    uid,requestId,nowMs,
  });
  try{
    await Promise.all([
      docs[0].set({uid,requestId,status:"processing",requestedAt,
        eligibleAt:new Date(requestedAt.getTime()+days(30))}),
      docs[1].set({uid,requestId,phase:"storage_media",
        destructiveAllowed:true,storageRetentionApproved:true,
        sharedMediaOwnershipReviewed:true,legalEvidenceReviewComplete:true,
        financialSettlementApproved:true,playBillingReviewComplete:true}),
      docs[2].set({accountStatus:"deletion_processing",role:"user"}),
      docs[3].set({action:"accountErasureProcessingAdmitted",
        targetId:uid,requestId,certifiedDomains:[...domains]}),
      docs[4].set({objectId,ownerUid:uid,scope:"chat_image"}),
    ]);
    await certificates[0].update({decision:"revoked"});
    await assert.rejects(reserve(firestoreClient(env),{
      uid,requestId,objectId,nowMs,actor:{
        owner:true,uid:"test_owner_rest_123456",
      },token:"rest_revoke_token_123456",
    }),e=>{
      assert.equal(e.code,"erasure_transactional_certification_blocked",
        JSON.stringify({message:e.message,status:e.status,
          details:e.details}));
      return true;
    });
    assert.equal((await docs[5].get()).exists,false);
    // Genuine Cloudflare REST Firestore transaction creates a durable
    // revocation INTENT, not an effective approval revocation. Subsequent
    // attempts remain blocked even if the synthetic signoff is restored.
    const stop=await requestStop(firestoreClient(env),{
      uid,requestId,nowMs,actor:{
        owner:true,uid:"test_owner_rest_123456",
      },
    });
    assert.equal(stop.revocationIntentCreated,true);
    assert.equal(stop.revocationEffective,false);
    assert.equal((await docs[6].get()).data().revocationEffective,false);
    assert.equal((await docs[7].get()).data().action,
      "accountErasureExternalIoRevocationIntent");
    await certificates[0].update({decision:"approved"});
    await assert.rejects(reserve(firestoreClient(env),{
      uid,requestId,objectId,nowMs,actor:{
        owner:true,uid:"test_owner_rest_123456",
      },token:"rest_revoke_after_stop_token_123456",
    }),e=>e.code==="external_io_revocation_intent_pending");
    assert.equal((await docs[5].get()).exists,false);
  }finally{
    await Promise.all([...docs,...certificates].map(ref=>ref.delete()));
  }
});

test("emulator: R2 queue verification honors pending external-I/O stop",{
  timeout:65000,
},async()=>{
  const suffix=sid(),uid="rest_queue_user_"+suffix,
    requestId="rest_queue_request_"+suffix;
  const nowMs=Date.now(),requestedAt=new Date(nowMs-days(40));
  const owner="test_owner_rest_123456";
  const paths=[
    "account_deletion_requests/"+uid,
    "account_deletion_erasure_checkpoints/"+uid,
    "users/"+uid,
    "admin_audit_logs/r2_deletion_queue_"+requestId,
    "account_erasure_external_io_revocation_intents/"+uid+"__"+requestId,
    "admin_audit_logs/erasure_external_io_revocation_intent_"+requestId,
  ];
  const refs=paths.map(path=>store.doc(path));
  const certificates=await seedEmulatorErasureCertificates(store,{
    uid,requestId,nowMs,
  });
  const job={id:"disposable_pending_erasure_job_"+suffix,data:{
    ownerUid:uid,requestId,reason:"account_deleted_verified",
    status:"queued",
  }};
  try{
    await Promise.all([
      refs[0].set({uid,requestId,status:"processing",requestedAt,
        eligibleAt:new Date(requestedAt.getTime()+days(30))}),
      refs[1].set({uid,requestId,phase:"storage_media",
        destructiveAllowed:true,storageRetentionApproved:true,
        sharedMediaOwnershipReviewed:true,legalEvidenceReviewComplete:true,
        financialSettlementApproved:true,playBillingReviewComplete:true}),
      refs[2].set({accountStatus:"deletion_processing",role:"user"}),
      refs[3].set({targetId:uid,requestId,
        action:"accountErasureR2QueueCertified"}),
    ]);
    // The actual Cloudflare REST adapter and disposable Emulator transaction
    // accept a valid read-only queue validation BEFORE the stop.
    assert.equal(await verifyAccountStorageCleanupJob(
      firestoreClient(env),job),true);
    const result=await requestStop(firestoreClient(env),{
      uid,requestId,actor:{uid:owner,owner:true},nowMs,
    });
    assert.equal(result.revocationEffective,false);
    assert.equal((await refs[4].get()).data().status,
      "pending_reconciliation");
    // The same still-approved independent certificates cannot override a
    // durable stop request; no bucket or actual storage data is involved.
    assert.equal(await verifyAccountStorageCleanupJob(
      firestoreClient(env),job),false);
    assert.equal((await refs[3].get()).data().action,
      "accountErasureR2QueueCertified");
  }finally{
    await Promise.all([...refs,...certificates].map(ref=>ref.delete()));
  }
});

test("emulator: REST private text redaction rechecks revoked audited approval",{
  timeout:80000,
},async()=>{
  // Disposable local Firestore rows, actual Cloudflare REST transactions.
  // No account-auth removal, R2, scheduler or real-world data access.
  const suffix=sid(),uid="rest_text_user_"+suffix,
    other="rest_text_other_"+suffix,
    requestId="rest_text_request_"+suffix,
    conversationId="rest_text_conversation_"+suffix;
  const nowMs=Date.now(),requestedAt=new Date(nowMs-days(40));
  const conversation=store.doc("conversations/"+conversationId);
  const messageOne=conversation.collection("messages").doc("owned_one_"+suffix);
  const messageTwo=conversation.collection("messages").doc("owned_two_"+suffix);
  const counterpart=conversation.collection("messages").doc("counterpart_"+suffix);
  const request=store.doc("account_deletion_requests/"+uid);
  const checkpoint=store.doc("account_deletion_erasure_checkpoints/"+uid);
  const user=store.doc("users/"+uid);
  const admission=store.doc("admin_audit_logs/erasure_processing_start_"+requestId);
  const certificates=await seedEmulatorErasureCertificates(store,{
    uid,requestId,nowMs,
  });
  const refs=[conversation,messageOne,messageTwo,counterpart,
    request,checkpoint,user,admission,...certificates];
  const args=messageId=>({uid,requestId,conversationId,messageId,
    now:new Date(nowMs)});
  try{
    await Promise.all([
      request.set({uid,requestId,status:"processing",requestedAt,
        eligibleAt:new Date(requestedAt.getTime()+days(30))}),
      checkpoint.set({uid,requestId,phase:"private_text",destructiveAllowed:true,
        privateMessageRetentionCleared:true,legalEvidenceReviewComplete:true}),
      user.set({role:"user",accountStatus:"deletion_processing",coins:470}),
      admission.set({action:"accountErasureProcessingAdmitted",
        targetId:uid,requestId,certifiedDomains:[...domains]}),
      conversation.set({participants:[uid,other],lastSenderId:uid,
        lastMessage:"Confidential old preview"}),
      messageOne.set({senderId:uid,receiverId:other,type:"text",
        text:"private one",createdAt:new Date(nowMs-days(39))}),
      messageTwo.set({senderId:uid,receiverId:other,type:"text",
        text:"private two",createdAt:new Date(nowMs-days(38))}),
      counterpart.set({senderId:other,receiverId:uid,type:"text",
        text:"other user message",createdAt:new Date(nowMs-days(39))}),
    ]);
    // Missing original admission cannot be hidden by a forged checkpoint
    // or otherwise valid synthetic signoffs.
    await admission.delete();
    await assert.rejects(redactDeletedPrivateTextMessage(
      firestoreClient(env),args(messageOne.id)),e=>
      e.code==="private_text_erasure_blocked");
    assert.equal((await messageOne.get()).data().text,"private one");
    await admission.set({action:"accountErasureProcessingAdmitted",
      targetId:uid,requestId,certifiedDomains:[...domains]});
    // The real Cloudflare REST transaction sees all six synthetic current
    // signoffs; only this first disposable text row may be tombstoned.
    const initial=await redactDeletedPrivateTextMessage(
      firestoreClient(env),args(messageOne.id));
    assert.equal(initial.redacted,true);
    assert.equal((await messageOne.get()).data().type,"deleted");
    assert.equal("text" in (await messageOne.get()).data(),false);

    // Approval revocation in Firestore MUST block another text mutation even
    // though checkpoint flags remain true and the original message is valid.
    const play=store.doc("account_deletion_erasure_approvals/"+
      requestId+"__play_billing");
    await play.update({decision:"revoked"});
    await assert.rejects(redactDeletedPrivateTextMessage(
      firestoreClient(env),args(messageTwo.id)),error=>
      error.code==="erasure_transactional_certification_blocked");
    assert.equal((await messageTwo.get()).data().text,"private two");
    assert.equal((await counterpart.get()).data().text,"other user message");
    assert.equal((await user.get()).data().coins,470);
    assert.equal((await conversation.get()).data().lastMessage,
      "رسالة من حساب محذوف");
  }finally{
    await Promise.all(refs.map(ref=>ref.delete()));
  }
});

test("emulator: real Cloudflare REST withdrawal fences fixture R2 dispatch while in flight",{
  timeout:125000,
},async()=>{
  const suffix=sid(),uid="rest_fixture_user_"+suffix,
    requestId="rest_fixture_request_"+suffix,
    objectId="rest_fixture_object_"+suffix;
  const token="fixture_external_operation_token_123456";
  const nowMs=Date.now(),requestedAt=new Date(nowMs-days(40));
  const owner="test_owner_rest_123456";
  const args={uid,requestId,objectId,token,
    actor:{uid:owner,owner:true},nowMs};
  const stopArgs={uid,requestId,domain:"play_billing",
    actor:{uid:owner,owner:true},nowMs};
  const key="erasure-fixture/"+suffix+".webp";
  const doc=path=>store.doc(path);
  const request=doc("account_deletion_requests/"+uid);
  const checkpoint=doc("account_deletion_erasure_checkpoints/"+uid);
  const user=doc("users/"+uid);
  const admission=doc("admin_audit_logs/erasure_processing_start_"+requestId);
  const asset=doc("storage_objects/"+objectId);
  const reservation=doc("account_erasure_external_io_reservations/"+
    uid+"__"+objectId);
  const holdDoc=doc("account_erasure_external_io_coordination_holds/"+
    uid+"__"+requestId);
  const attempt=doc("account_erasure_external_io_uncertain_attempts/"+
    uid+"__"+requestId);
  const dispatchDoc=doc("account_erasure_external_io_fixture_dispatches/"+
    uid+"__"+requestId);
  const stopDoc=doc("account_erasure_external_io_revocation_intents/"+
    uid+"__"+requestId);
  const stopAudit=doc("admin_audit_logs/erasure_external_io_revocation_intent_"+
    requestId);
  const withdrawalAudit=doc("admin_audit_logs/erasure_domain_withdrawal_"+
    requestId+"__play_billing");
  const certs=await seedEmulatorErasureCertificates(store,{uid,requestId,nowMs});
  const refs=[request,checkpoint,user,admission,asset,reservation,holdDoc,
    attempt,dispatchDoc,stopDoc,stopAudit,withdrawalAudit,...certs];
  try{
    await Promise.all([
      request.set({uid,requestId,status:"processing",requestedAt,
        eligibleAt:new Date(requestedAt.getTime()+days(30))}),
      checkpoint.set({uid,requestId,phase:"storage_media",
        destructiveAllowed:true,storageRetentionApproved:true,
        sharedMediaOwnershipReviewed:true,legalEvidenceReviewComplete:true,
        financialSettlementApproved:true,playBillingReviewComplete:true}),
      user.set({accountStatus:"deletion_processing",role:"user"}),
      admission.set({action:"accountErasureProcessingAdmitted",
        targetId:uid,requestId,certifiedDomains:[...domains]}),
      asset.set({ownerUid:uid,objectId,scope:"chat_image",storageKey:key}),
    ]);
    await reserve(firestoreClient(env),args);
    await recordHold(firestoreClient(env),args);
    await recordUncertainAttempt(firestoreClient(env),args);
    let deletes=0;
    const result=await dispatchFixture(firestoreClient(env),{
      async delete(seenKey){
        deletes++;
        assert.equal(seenKey,key);
        // Deliberately withdraw AFTER external dispatch is committed but
        // BEFORE the mock bucket call acknowledges completion.
        const withdrawal=await withdrawDomain(firestoreClient(env),stopArgs);
        assert.equal(withdrawal.domainApprovalRevoked,true);
        assert.equal(withdrawal.existingExternalIoObserved,true);
        assert.equal(withdrawal.revocationEffective,false);
      },
    },args);
    assert.equal(deletes,1);
    assert.equal(result.completionVerified,false);
    assert.equal((await dispatchDoc.get()).data().completionVerified,false);
    assert.equal((await stopDoc.get()).data().status,"pending_reconciliation");
    assert.equal((await stopDoc.get()).data().revocationEffective,false);
    assert.equal((await withdrawalAudit.get()).data().externalIoOutcome,
      "requires_reconciliation");
    assert.equal((await certs[2].get()).data().decision,"revoked");
    await assert.rejects(dispatchFixture(firestoreClient(env),{
      async delete(){deletes++;},
    },args),/r2_interlock_stopped_or_already_dispatched/);
    assert.equal(deletes,1);
    assert.equal((await attempt.get()).data().retryAllowed,false);
  }finally{
    await Promise.all(refs.map(ref=>ref.delete()));
  }
});
