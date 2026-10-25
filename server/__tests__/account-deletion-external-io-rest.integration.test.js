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
import {reserveAccountErasureExternalIo as reserve}
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
    return upstreamFetch(local,options);
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
  timeout:45000,
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
    // Revocation after a reservation must never permit a fresh reservation.
    await certificates[0].update({decision:"revoked"});
    await assert.rejects(reserve(firestoreClient(env),args(
      "rest_worker_three_token_123456")),
      e=>e.code==="external_io_reservation_requires_reconciliation"||
        e.code==="erasure_transactional_certification_blocked");
    assert.equal((await reservation.get()).data().externalIoAllowed,false);
  }finally{
    await Promise.all(refs.map(ref=>ref.delete()));
  }
});

test("emulator: REST transactional batchGet blocks revoked approval before any reservation",{
  timeout:25000,
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
    }),e=>assert.equal(e.code,"erasure_transactional_certification_blocked",
      JSON.stringify({message:e.message,status:e.status,
        details:e.details})));
    assert.equal((await docs[5].get()).exists,false);
  }finally{
    await Promise.all([...docs,...certificates].map(ref=>ref.delete()));
  }
});
