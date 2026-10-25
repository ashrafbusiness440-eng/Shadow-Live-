import assert from "node:assert/strict";
import {test,after} from "node:test";
import {randomUUID} from "node:crypto";
import {getApps,initializeApp,deleteApp} from "firebase-admin/app";
import {getFirestore} from "firebase-admin/firestore";
import {cloudflareFirestoreAdapter} from "./helpers/cloudflare-firestore-adapter.js";
import {recordErasurePreflightCheckpoint as preflight} from
 "../../cloudflare-worker/src/account-deletion-erasure-checkpoint.js";
import {REQUIRED_ERASURE_ADMISSION_DOMAINS as domains} from
 "../../cloudflare-worker/src/account-deletion-processing-admission.js";
const app=getApps()[0]||initializeApp({projectId:"shadow-live-economy-test"});
const firestore=getFirestore(app),db=cloudflareFirestoreAdapter(firestore);
after(async()=>deleteApp(app));
const makeIds=()=>{
  const suffix=randomUUID().replaceAll("-","").slice(0,14);
  return {uid:"erasure_preflight_"+suffix,requestId:"preflight_req_"+suffix};
};
const nowMs=Date.parse("2026-11-25T12:00:00Z");
test("emulator: preflight records canonical six-domain review list and refuses held replay",async()=>{
  const {uid,requestId}=makeIds();
  const req=firestore.doc("account_deletion_requests/"+uid);
  const checkpoint=firestore.doc("account_deletion_erasure_checkpoints/"+uid);
  const user=firestore.doc("users/"+uid);
  const audit=firestore.doc("admin_audit_logs/erasure_preflight_"+requestId);
  const refs=[req,checkpoint,user,audit];
  await Promise.all([
    req.set({uid,requestId,status:"review_ready",eligibleAt:new Date(nowMs-60000)}),
    user.set({role:"user",accountStatus:"active",coins:700,diamonds:5}),
  ]);
  const opts={uid,requestId,actor:{uid:"control_owner_123",owner:true},nowMs};
  try {
    const first=await preflight(db,opts);
    assert.equal(first.duplicate,false);
    assert.equal(first.destructiveAllowed,false);
    const data=(await checkpoint.get()).data();
    assert.equal(data.phase,"preflight_blocked");
    assert.equal(data.destructiveAllowed,false);
    assert.deepEqual(data.requiredReviews,domains);
    assert.equal((await audit.get()).data().action,"accountErasurePreflightBlocked");
    const duplicate=await preflight(db,opts);
    assert.equal(duplicate.duplicate,true);
    await checkpoint.update({appealStatus:"under_review"});
    await assert.rejects(preflight(db,opts),e=>e.code==="erasure_legal_hold");
    assert.equal((await checkpoint.get()).data().destructiveAllowed,false);
    assert.equal((await user.get()).data().coins,700);
    assert.equal((await user.get()).data().diamonds,5);
  }finally {
    await Promise.all(refs.map(ref=>ref.delete()));
  }
});
test("emulator: request appeal or user evidence hold blocks first checkpoint",async()=>{
  for(const {kind,field,value} of [
    {kind:"request",field:"appealPending",value:true},
    {kind:"request",field:"investigationHold",value:true},
    {kind:"user",field:"evidenceHold",value:true},
    {kind:"user",field:"appealStatus",value:"Open"},
  ]){
    const {uid,requestId}=makeIds();
    const req=firestore.doc("account_deletion_requests/"+uid);
    const user=firestore.doc("users/"+uid);
    const checkpoint=firestore.doc("account_deletion_erasure_checkpoints/"+uid);
    const audit=firestore.doc("admin_audit_logs/erasure_preflight_"+requestId);
    const refs=[req,user,checkpoint,audit];
    await Promise.all([
      req.set({uid,requestId,status:"review_ready",eligibleAt:new Date(nowMs-1000),
        ...(kind==="request"?{[field]:value}:{})}),
      user.set({role:"user",accountStatus:"active",coins:123,
        ...(kind==="user"?{[field]:value}:{})}),
    ]);
    try{
      await assert.rejects(preflight(db,{
        uid,requestId,actor:{uid:"control_owner_123",owner:true},nowMs,
      }),e=>e.code==="erasure_legal_hold");
      assert.equal((await checkpoint.get()).exists,false);
      assert.equal((await audit.get()).exists,false);
      assert.equal((await user.get()).data().coins,123);
    }finally {
      await Promise.all(refs.map(ref=>ref.delete()));
    }
  }
});
