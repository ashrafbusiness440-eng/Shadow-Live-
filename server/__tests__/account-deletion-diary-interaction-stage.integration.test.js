import assert from "node:assert/strict";
import {test,after} from "node:test";
import {randomUUID} from "node:crypto";
import {getApps,initializeApp,deleteApp} from "firebase-admin/app";
import {getFirestore} from "firebase-admin/firestore";
import {cloudflareFirestoreAdapter} from "./helpers/cloudflare-firestore-adapter.js";
import {eraseDeletedDiaryInteraction as erase}
  from "../../cloudflare-worker/src/account-deletion-diary-interaction-stage.js";
import { seedEmulatorErasureCertificates }
  from "./helpers/account-erasure-synthetic-certificates.js";

const app=getApps()[0]||initializeApp({projectId:"shadow-live-economy-test"});
const store=getFirestore(app),db=cloudflareFirestoreAdapter(store);
after(async()=>{await deleteApp(app);});
const suffix=()=>randomUUID().replaceAll("-","").slice(0,18);
const hex=uid=>Buffer.from(uid,"utf8").toString("hex");

test("emulator: retry-safe like/view deletion retains unrelated interactions and diary counts",async()=>{
  const id=suffix(),uid="deletion_like_"+id,other="other_liker_"+id;
  const requestId="erase_diary_interaction_"+id;
  const nowMs=Date.now();
  const diaryId="diary_source_"+id;
  const req=store.doc("account_deletion_requests/"+uid);
  const cp=store.doc("account_deletion_erasure_checkpoints/"+uid);
  const user=store.doc("users/"+uid);
  const diary=store.doc("diaries/"+diaryId);
  const like=store.doc("diary_likes/"+diaryId+"__"+hex(uid));
  const view=store.doc("diary_view_keys/"+diaryId+"__"+hex(uid));
  const unrelated=store.doc("diary_likes/"+diaryId+"__"+hex(other));
  const refs=[req,cp,user,diary,like,view,unrelated];
  refs.push(...await seedEmulatorErasureCertificates(store,{
    uid,requestId,nowMs,
  }));
  await Promise.all([
    req.set({uid,requestId,status:"processing",
      requestedAt:new Date(nowMs-40*86400_000)}),
    cp.set({uid,requestId,phase:"diary_interactions",
      destructiveAllowed:true,diaryInteractionRetentionCleared:true,
      legalEvidenceReviewComplete:true,historicalDiaryCountersReviewed:true}),
    user.set({role:"user",accountStatus:"deletion_processing",
      coins:31,diamonds:2}),
    diary.set({ownerUid:other,likeCount:17,viewCount:99,
      giftCoins:130,text:"other person's post"}),
    like.set({userUid:uid,diaryId,createdAt:new Date()}),
    view.set({userUid:uid,diaryId,
      lastCountedAt:new Date(),lastCountedAtMs:100,nextEligibleAtMs:900}),
    unrelated.set({userUid:other,diaryId,createdAt:new Date()}),
  ]);
  try{
    const opts={uid,requestId,diaryId};
    const twice=await Promise.all([
      erase(db,{...opts,kind:"likes"}),
      erase(db,{...opts,kind:"likes"}),
    ]);
    assert.deepEqual(twice.map(x=>x.erased).sort(),[false,true]);
    assert.equal((await like.get()).exists,false);
    assert.equal((await unrelated.get()).exists,true);
    assert.equal((await view.get()).exists,true);
    assert.equal((await erase(db,{...opts,kind:"views"})).erased,true);
    assert.equal((await view.get()).exists,false);
    const current=(await diary.get()).data();
    assert.equal(current.likeCount,17);
    assert.equal(current.viewCount,99);
    assert.equal(current.giftCoins,130);
    assert.equal(current.text,"other person's post");
    assert.equal((await user.get()).data().coins,31);
    await like.set({userUid:uid,diaryId,legalHold:true});
    await assert.rejects(erase(db,{...opts,kind:"likes"}),
      e=>e.code==="diary_interaction_source_requires_review");
    assert.equal((await like.get()).exists,true);
    await req.update({status:"cancelled"});
    await assert.rejects(erase(db,{...opts,kind:"views"}),
      e=>e.code==="diary_interaction_erasure_not_authorized");
  } finally {
    await Promise.all(refs.map(ref=>ref.delete()));
  }
});
