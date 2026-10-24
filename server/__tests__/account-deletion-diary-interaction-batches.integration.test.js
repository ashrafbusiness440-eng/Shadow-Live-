import assert from "node:assert/strict";
import {test,after} from "node:test";
import {randomUUID} from "node:crypto";
import {getApps,initializeApp,deleteApp} from "firebase-admin/app";
import {getFirestore} from "firebase-admin/firestore";
import {cloudflareFirestoreAdapter} from "./helpers/cloudflare-firestore-adapter.js";
import {drainAccountDiaryInteractions as drain}
  from "../../cloudflare-worker/src/account-deletion-diary-interaction-batches.js";

const app=getApps()[0]||initializeApp({projectId:"shadow-live-economy-test"});
const store=getFirestore(app),db=cloudflareFirestoreAdapter(store);
after(async()=>{await deleteApp(app);});
const sid=()=>randomUUID().replaceAll("-","").slice(0,18);
const hex=u=>Buffer.from(u,"utf8").toString("hex");

test("emulator: two bounded indexed cleanup passes retain other's diary and funds",async()=>{
  const suffix=sid(),uid="deleted_page_"+suffix,other="other_page_"+suffix;
  const requestId="page_request_"+suffix;
  const req=store.doc("account_deletion_requests/"+uid);
  const cp=store.doc("account_deletion_erasure_checkpoints/"+uid);
  const user=store.doc("users/"+uid);
  const diaries=Array.from({length:7},(_,i)=>
    store.doc("diaries/page_diary_"+suffix+"_"+i));
  const likes=diaries.map(d=>store.doc("diary_likes/"+d.id+"__"+hex(uid)));
  const view=store.doc("diary_view_keys/"+diaries[0].id+"__"+hex(uid));
  const otherLike=store.doc("diary_likes/"+diaries[0].id+"__"+hex(other));
  const all=[req,cp,user,...diaries,...likes,view,otherLike];
  await Promise.all([
    req.set({uid,requestId,status:"processing"}),
    cp.set({uid,requestId,phase:"diary_interactions",destructiveAllowed:true,
      diaryInteractionRetentionCleared:true,legalEvidenceReviewComplete:true,
      historicalDiaryCountersReviewed:true}),
    user.set({role:"user",accountStatus:"deletion_processing",coins:70}),
    ...diaries.map(d=>d.set({ownerUid:other,likeCount:12,viewCount:31,
      giftCoins:220,text:"retained user text"})),
    ...likes.map((d,i)=>d.set({userUid:uid,diaryId:diaries[i].id,
      createdAt:new Date()})),
    view.set({userUid:uid,diaryId:diaries[0].id,
      lastCountedAt:new Date(),lastCountedAtMs:1,nextEligibleAtMs:90}),
    otherLike.set({userUid:other,diaryId:diaries[0].id,
      createdAt:new Date()}),
  ]);
  try{
    let page=await drain(db,{uid,requestId,kind:"likes",limit:3});
    assert.equal(page.erased,3);
    assert.equal(page.moreInPage,true);
    page=await drain(db,{uid,requestId,kind:"likes",limit:3});
    assert.equal(page.erased,3);
    page=await drain(db,{uid,requestId,kind:"likes",limit:3});
    assert.equal(page.erased,1);
    assert.equal(page.completionVerified,false);
    for(const ref of likes)assert.equal((await ref.get()).exists,false);
    assert.equal((await otherLike.get()).exists,true);
    assert.equal((await view.get()).exists,true);
    assert.equal((await drain(db,{uid,requestId,kind:"views"})).erased,1);
    const retained=(await diaries[0].get()).data();
    assert.equal(retained.likeCount,12);
    assert.equal(retained.viewCount,31);
    assert.equal(retained.giftCoins,220);
    assert.equal(retained.text,"retained user text");
    assert.equal((await user.get()).data().coins,70);
    await req.update({legalHold:true});
    await assert.rejects(drain(db,{uid,requestId,kind:"likes"}),
      e=>e.code==="diary_erasure_batch_not_authorized");
  } finally {
    await Promise.all(all.map(ref=>ref.delete()));
  }
});
