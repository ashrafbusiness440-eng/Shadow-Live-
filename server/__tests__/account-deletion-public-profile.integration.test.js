import assert from "node:assert/strict";
import { after, test } from "node:test";
import { randomUUID } from "node:crypto";
import { deleteApp, getApps, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { cloudflareFirestoreAdapter } from "./helpers/cloudflare-firestore-adapter.js";
import { erasePublicProfileStage } from "../../cloudflare-worker/src/account-deletion-public-profile-stage.js";

const app=getApps()[0]||initializeApp({projectId:"shadow-live-economy-test"});
const db=getFirestore(app);
const workerDb=cloudflareFirestoreAdapter(db);
after(async()=>{await deleteApp(app);});

test("profile-only deletion is idempotent and keeps accounts and financial evidence",async()=>{
  const suffix=randomUUID().replaceAll("-","").slice(0,18);
  const uid="erasure_profile_"+suffix;
  const requestId="delete_request_"+suffix;
  const paths={
    request:db.doc("account_deletion_requests/"+uid),
    checkpoint:db.doc("account_deletion_erasure_checkpoints/"+uid),
    user:db.doc("users/"+uid),
    profile:db.doc("public_profiles/"+uid),
    ledger:db.doc("financial_ledger/test_"+suffix),
    evidence:db.doc("reports/test_"+suffix),
  };
  await Promise.all([
    paths.request.set({uid,requestId,status:"processing"}),
    paths.checkpoint.set({requestId,phase:"public_profile",destructiveAllowed:true}),
    paths.user.set({role:"user",accountStatus:"deletion_processing",coins:1500,diamonds:3}),
    paths.profile.set({uid,displayName:"Old Secret",profileImageUrl:"https://test.invalid/old.png"}),
    paths.ledger.set({userId:uid,delta:100,reason:"historic purchase"}),
    paths.evidence.set({targetUid:uid,reason:"retained evidence"}),
  ]);
  const args={uid,requestId};
  try {
    const outcome=await Promise.all([
      erasePublicProfileStage(workerDb,args),
      erasePublicProfileStage(workerDb,args),
    ]);
    assert.deepEqual(outcome.map(x=>x.removed).sort(),[false,true]);
    assert.equal((await paths.profile.get()).exists,false);
    assert.equal((await paths.user.get()).data().coins,1500);
    assert.equal((await paths.user.get()).data().diamonds,3);
    assert.equal((await paths.ledger.get()).data().delta,100);
    assert.equal((await paths.evidence.get()).data().reason,"retained evidence");
    // New appeals block even idempotent retries, not only fresh deletes.
    await paths.profile.set({uid,displayName:"Protected",appealPending:true});
    await assert.rejects(erasePublicProfileStage(workerDb,args),
      e=>e.code==="public_profile_erasure_blocked");
    assert.equal((await paths.profile.get()).data().displayName,"Protected");
    await paths.profile.update({appealPending:false,appealStatus:"open"});
    await assert.rejects(erasePublicProfileStage(workerDb,args),
      e=>e.code==="public_profile_erasure_blocked");
    assert.equal((await paths.ledger.get()).data().delta,100);
    // Even a retry of the old request must not succeed after cancellation.
    await paths.request.update({status:"cancelled"});
    await assert.rejects(erasePublicProfileStage(workerDb,args),
      e=>e.code==="public_profile_erasure_blocked");
  } finally {
    await Promise.all(Object.values(paths).map(ref=>ref.delete()));
  }
});
