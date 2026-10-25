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
import {verifyAccountStorageCleanupJob}
  from "../../cloudflare-worker/src/user-storage.js";
import {reserveAccountErasureExternalIo as reserve,
  requestAccountErasureExternalIoRevocationIntent as requestStop,
  recordAccountErasureExternalIoCoordinationHold as recordHold}
  from "../../cloudflare-worker/src/account-deletion-external-io-reservation.js";
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
      asset.set({objectId,ownerUid:uid,scope:"chat_image"}),
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
    assert.equal((await hold.get()).data().externalIoAllowed,false);
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
