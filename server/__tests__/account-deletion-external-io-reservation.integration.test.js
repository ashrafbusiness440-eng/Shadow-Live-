// Disposable Firestore Emulator acceptance for the actual INTERNAL reservation
// API. A test-only bridge adapts its transaction interface to Admin SDK native
// runTransaction, so these tests check real Firestore conflicts rather than the
// serialized unit fake. NOT an implementation for the Cloudflare runtime.
import assert from "node:assert/strict";
import {test,after} from "node:test";
import {randomUUID} from "node:crypto";
import {getApps,initializeApp,deleteApp} from "firebase-admin/app";
import {getFirestore} from "firebase-admin/firestore";
import {reserveAccountErasureExternalIo as reserve}
  from "../../cloudflare-worker/src/account-deletion-external-io-reservation.js";
import {REQUIRED_ERASURE_ADMISSION_DOMAINS as domains}
  from "../../cloudflare-worker/src/account-deletion-processing-admission.js";
import {seedEmulatorErasureCertificates}
  from "./helpers/account-erasure-synthetic-certificates.js";

const app=getApps()[0]||initializeApp({projectId:"shadow-live-economy-test"});
const store=getFirestore(app);
after(async()=>{await deleteApp(app);});
const sid=()=>randomUUID().replaceAll("-","").slice(0,18);
const days=n=>n*86400_000;

// This adapter is TEST-ONLY. The transaction body waits for reserve() to
// validate all reads and supply one create; the real Admin SDK then performs
// the commit atomically with Firestore's actual read locks/preconditions.
function nativeTransactionBridge(){
  return {
    async beginTransaction(){
      let readyResolve,readyReject,complete;
      const ready=new Promise((ok,no)=>{readyResolve=ok;readyReject=no;});
      const operation=new Promise(ok=>{complete=ok;});
      const context={done:false};
      context.finished=store.runTransaction(async sdkTx=>{
        context.sdkTx=sdkTx;
        readyResolve();
        const writes=await operation;
        if(writes){
          for(const write of writes){
            if(write.kind!=="create")throw Error("unexpected_test_bridge_write");
            sdkTx.create(store.doc(write.path),write.data);
          }
        }
      },{maxAttempts:1});
      context.finished.catch(readyReject);
      await ready;
      context.complete=complete;
      return context;
    },
    async get(path,ctx){
      const s=await ctx.sdkTx.get(store.doc(path));
      return {exists:s.exists,data:s.exists?s.data():null};
    },
    async getMany(paths,ctx){
      const snapshots=await Promise.all(paths.map(path=>
        ctx.sdkTx.get(store.doc(path))));
      return snapshots.map(s=>({
        exists:s.exists,data:s.exists?s.data():null,
      }));
    },
    writeCreate(path,data){return {kind:"create",path,data};},
    async commit(ctx,writes){
      if(ctx.done)throw Error("transaction_already_finished");
      ctx.done=true;ctx.complete(writes);await ctx.finished;
    },
    async rollback(ctx){
      if(ctx.done)return;
      ctx.done=true;ctx.complete(null);
      await ctx.finished.catch(()=>{});
    },
  };
}

test("emulator: two REAL Firestore transactions reserve exactly one object",{
  timeout:30000,
},async()=>{
  const suffix=sid(),uid="io_user_"+suffix;
  const requestId="io_request_"+suffix,objectId="io_object_"+suffix;
  const owner="owner_io_test_123456";
  const nowMs=Date.now(),requestedAt=new Date(nowMs-days(40));
  const doc=path=>store.doc(path);
  const request=doc("account_deletion_requests/"+uid),
    checkpoint=doc("account_deletion_erasure_checkpoints/"+uid),
    user=doc("users/"+uid),
    admission=doc("admin_audit_logs/erasure_processing_start_"+requestId),
    storage=doc("storage_objects/"+objectId),
    reserved=doc("account_erasure_external_io_reservations/"+uid+"__"+objectId);
  const certs=await seedEmulatorErasureCertificates(store,{
    uid,requestId,nowMs,
  });
  const refs=[request,checkpoint,user,admission,storage,reserved,...certs];
  await Promise.all([
    request.set({uid,requestId,status:"processing",requestedAt,
      eligibleAt:new Date(requestedAt.getTime()+days(30))}),
    checkpoint.set({uid,requestId,phase:"storage_media",
      destructiveAllowed:true,storageRetentionApproved:true,
      sharedMediaOwnershipReviewed:true,legalEvidenceReviewComplete:true,
      financialSettlementApproved:true,playBillingReviewComplete:true}),
    user.set({role:"user",accountStatus:"deletion_processing",
      coins:243,diamonds:7}),
    admission.set({action:"accountErasureProcessingAdmitted",
      targetId:uid,requestId,certifiedDomains:[...domains]}),
    storage.set({ownerUid:uid,objectId,scope:"chat_image"}),
  ]);
  const args=(token)=>({uid,requestId,objectId,token,
    nowMs,actor:{uid:owner,owner:true}});
  try{
    const contenders=[
      "worker_one_token_123456789",
      "worker_two_token_123456789",
    ];
    let outcomes=await Promise.allSettled(contenders.map(token=>
      reserve(nativeTransactionBridge(),args(token))));
    // Two simultaneous Firestore Emulator pessimistic transactions may
    // deadlock and BOTH return ABORTED before either commits. This is a
    // legitimate fail-closed outcome (zero external-I/O permits). Do not
    // disguise an unexpected failure or blindly retry a possible R2 call.
    // If AND ONLY IF both reported a definite lock-abort and the durable
    // reservation is absent, retry one *non-destructive bookkeeping*
    // reservation, then confirm the second worker is denied.
    if(outcomes.every(x=>x.status==="rejected"&&
        /ABORTED: Transaction lock timeout/.test(String(x.reason?.message)))){
      assert.equal((await reserved.get()).exists,false,
        "no replay if the first concurrent transaction possibly committed");
      outcomes=[
        await Promise.allSettled([
          reserve(nativeTransactionBridge(),args(contenders[0])),
        ]).then(results=>results[0]),
      ];
      assert.equal(outcomes[0].status,"fulfilled",
        String(outcomes[0].reason?.message));
      const loser=await Promise.allSettled([
        reserve(nativeTransactionBridge(),args(contenders[1])),
      ]);
      outcomes.push(loser[0]);
    }
    assert.equal(outcomes.filter(x=>x.status==="fulfilled").length,1,
      JSON.stringify(outcomes.map(x=>x.status==="rejected"?
        String(x.reason?.message):x.value)));
    assert.equal(outcomes.filter(x=>x.status==="rejected").length,1);
    const proof=await reserved.get();
    assert.equal(proof.exists,true);
    assert.equal(proof.data().externalIoAllowed,false);
    assert.equal(proof.data().completionVerified,false);
    assert.equal(proof.data().state,"reserved_requires_external_interlock");
    assert.equal((await user.get()).data().coins,243);
    assert.equal((await user.get()).data().diamonds,7);
    await certs[0].update({decision:"revoked"});
    await assert.rejects(
      reserve(nativeTransactionBridge(),args("worker_three_token_123456789")),
      e=>e.code==="external_io_reservation_requires_reconciliation" ||
         e.code==="erasure_transactional_certification_blocked");
    assert.equal((await reserved.get()).data().externalIoAllowed,false);
  }finally{
    await Promise.all(refs.map(ref=>ref.delete()));
  }
});

test("emulator: revoked approval cannot create any new I/O reservation",{
 timeout:25000,
},async()=>{
 const suffix=sid(),uid="io_block_"+suffix,requestId="io_req_block_"+suffix,
   objectId="io_obj_block_"+suffix,owner="owner_io_test_123456";
 const nowMs=Date.now(),requestedAt=new Date(nowMs-days(40));
 const paths=[
  "account_deletion_requests/"+uid,
  "account_deletion_erasure_checkpoints/"+uid,
  "users/"+uid,
  "admin_audit_logs/erasure_processing_start_"+requestId,
  "storage_objects/"+objectId,
  "account_erasure_external_io_reservations/"+uid+"__"+objectId,
 ];
 const docs=paths.map(x=>store.doc(x));
 const certs=await seedEmulatorErasureCertificates(store,{uid,requestId,nowMs});
 try{
  await Promise.all([
   docs[0].set({uid,requestId,status:"processing",requestedAt,
     eligibleAt:new Date(requestedAt.getTime()+days(30))}),
   docs[1].set({uid,requestId,phase:"storage_media",
     destructiveAllowed:true,storageRetentionApproved:true,
     sharedMediaOwnershipReviewed:true,legalEvidenceReviewComplete:true,
     financialSettlementApproved:true,playBillingReviewComplete:true}),
   docs[2].set({role:"user",accountStatus:"deletion_processing"}),
   docs[3].set({action:"accountErasureProcessingAdmitted",
     targetId:uid,requestId,certifiedDomains:[...domains]}),
   docs[4].set({ownerUid:uid,objectId,scope:"chat_image"}),
  ]);
  await certs[0].update({decision:"revoked"});
  await assert.rejects(reserve(nativeTransactionBridge(),{
   uid,requestId,objectId,nowMs,actor:{uid:owner,owner:true},
   token:"rejected_io_token_123456789",
  }),e=>e.code==="erasure_transactional_certification_blocked");
  assert.equal((await docs[5].get()).exists,false);
 }finally{
  await Promise.all([...docs,...certs].map(ref=>ref.delete()));
 }
});
