import assert from "node:assert/strict";
import {test,after} from "node:test";
import {randomUUID} from "node:crypto";
import {getApps,initializeApp,deleteApp} from "firebase-admin/app";
import {getFirestore} from "firebase-admin/firestore";
import {cloudflareFirestoreAdapter} from "./helpers/cloudflare-firestore-adapter.js";
import {inspectAccountDiaryInteractions as inspect}
  from "../../cloudflare-worker/src/account-deletion-diary-interaction-inventory.js";

const app=getApps()[0]||initializeApp({projectId:"shadow-live-economy-test"});
const store=getFirestore(app),db=cloudflareFirestoreAdapter(store);
after(async()=>{await deleteApp(app);});
const sid=()=>randomUUID().replaceAll("-","").slice(0,18);
const hex=uid=>Buffer.from(uid,"utf8").toString("hex");

test("emulator: indexed likes and views pages keep other user's diary intact",async()=>{
  const suffix=sid(),uid="deleted_like_"+suffix,other="other_diary_"+suffix;
  const requestId="erase_likes_"+suffix,actor={uid:"control_owner",owner:true};
  const request=store.doc("account_deletion_requests/"+uid);
  const checkpoint=store.doc("account_deletion_erasure_checkpoints/"+uid);
  const user=store.doc("users/"+uid);
  const diaries=Array.from({length:7},(_,i)=>
    store.doc("diaries/diary_interact_"+suffix+"_"+i));
  const likes=diaries.map(d=>
    store.doc("diary_likes/"+d.id+"__"+hex(uid)));
  const views=diaries.slice(0,3).map(d=>
    store.doc("diary_view_keys/"+d.id+"__"+hex(uid)));
  const foreign=store.doc("diary_likes/"+diaries[0].id+"__"+hex(other));
  const all=[request,checkpoint,user,foreign,...diaries,...likes,...views];
  await Promise.all([
    request.set({uid,requestId,status:"review_ready"}),
    checkpoint.set({uid,requestId,phase:"preflight_blocked",
      destructiveAllowed:false}),
    user.set({role:"user",coins:345}),
    ...diaries.map(d=>d.set({ownerUid:other,
      text:"other person content",likeCount:99,viewCount:501})),
    ...likes.map((d,i)=>d.set({diaryId:diaries[i].id,userUid:uid})),
    ...views.map((d,i)=>d.set({diaryId:diaries[i].id,userUid:uid})),
    foreign.set({diaryId:diaries[0].id,userUid:other}),
  ]);
  try {
    const ids=[];let cursor=null;
    for(let i=0;i<3;i++){
      const page=await inspect(db,{uid,requestId,actor,limit:3,cursor});
      ids.push(...page.items.map(x=>x.id));
      assert.ok(page.items.every(x=>x.onOtherUserDiary===true));
      assert.equal(page.erasureAllowed,false);
      cursor=page.nextCursor;
    }
    assert.equal(ids.length,7);
    assert.equal(new Set(ids).size,7);
    assert.equal(cursor,null);
    const viewPage=await inspect(db,{uid,requestId,actor,kind:"views"});
    assert.equal(viewPage.items.length,3);
    assert.equal(viewPage.hasMore,false);
    assert.equal(viewPage.completionVerified,false);
    assert.equal((await foreign.get()).exists,true);
    assert.equal((await diaries[0].get()).data().likeCount,99);
    assert.equal((await diaries[0].get()).data().viewCount,501);
    assert.equal((await user.get()).data().coins,345);
    await request.update({status:"cancelled"});
    await assert.rejects(inspect(db,{uid,requestId,actor}),
      e=>e.code==="diary_interaction_inventory_blocked");
  } finally {
    await Promise.all(all.map(ref=>ref.delete()));
  }
});
