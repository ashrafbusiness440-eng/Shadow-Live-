import assert from "node:assert/strict";
import {test,after} from "node:test";
import {randomUUID} from "node:crypto";
import {getApps,initializeApp,deleteApp} from "firebase-admin/app";
import {getFirestore} from "firebase-admin/firestore";
import {cloudflareFirestoreAdapter} from "./helpers/cloudflare-firestore-adapter.js";
import {removeDeletedAccountSocialPair} from "../../cloudflare-worker/src/account-deletion-social-pair-stage.js";
import { seedEmulatorErasureCertificates }
  from "./helpers/account-erasure-synthetic-certificates.js";
const app=getApps()[0]||initializeApp({projectId:"shadow-live-economy-test"});
const db=getFirestore(app),dbAdapter=cloudflareFirestoreAdapter(db);
after(async()=>{await deleteApp(app);});
test("emulator: delete only the four targeted follow/block records, retry idempotently",async()=>{
 const suffix=randomUUID().replaceAll("-","").slice(0,18);
 const uid="erasure_social_"+suffix,otherUid="counterpart_"+suffix,third="unrelated_"+suffix;
 const requestId="erasure_req_"+suffix;
 const nowMs=Date.now();
 const request=db.doc("account_deletion_requests/"+uid);
 const checkpoint=db.doc("account_deletion_erasure_checkpoints/"+uid);
 const user=db.doc("users/"+uid);
 const pair=[
  db.doc(`follows/${uid}__${otherUid}`),
  db.doc(`follows/${otherUid}__${uid}`),
  db.doc(`user_blocks/${uid}/items/${otherUid}`),
  db.doc(`user_blocks/${otherUid}/items/${uid}`),
 ];
 const unrelated=db.doc(`follows/${otherUid}__${third}`);
 const certificates=await seedEmulatorErasureCertificates(db,{uid,requestId,nowMs});
 await Promise.all([
  request.set({uid,requestId,status:"processing",
    requestedAt:new Date(nowMs-40*86400_000)}),
  checkpoint.set({requestId,phase:"social_links",destructiveAllowed:true}),
  user.set({role:"user",accountStatus:"deletion_processing"}),
  pair[0].set({followerUid:uid,followingUid:otherUid}),
  pair[1].set({followerUid:otherUid,followingUid:uid}),
  pair[2].set({blockerUid:uid,blockedUid:otherUid}),
  pair[3].set({blockerUid:otherUid,blockedUid:uid}),
  unrelated.set({followerUid:otherUid,followingUid:third}),
 ]);
 const opts={uid,otherUid,requestId};
 try{
   const result=await Promise.all([
    removeDeletedAccountSocialPair(dbAdapter,opts),
    removeDeletedAccountSocialPair(dbAdapter,opts),
   ]);
   assert.deepEqual(result.map(x=>x.removed).sort((a,b)=>a-b),[0,4]);
   for(const ref of pair)assert.equal((await ref.get()).exists,false);
   assert.equal((await unrelated.get()).exists,true);
   await user.update({appealStatus:" Under_Review "});
   await assert.rejects(removeDeletedAccountSocialPair(dbAdapter,opts),
     e=>e.code==="social_pair_erasure_blocked");
   assert.equal((await unrelated.get()).exists,true);
   await user.update({appealStatus:"closed"});
   await request.update({reviewHold:true});
   await assert.rejects(removeDeletedAccountSocialPair(dbAdapter,opts),
     e=>e.code==="social_pair_erasure_blocked");
 }finally{
   await Promise.all([request,checkpoint,user,unrelated,...pair,...certificates].map(ref=>ref.delete()));
 }
});
