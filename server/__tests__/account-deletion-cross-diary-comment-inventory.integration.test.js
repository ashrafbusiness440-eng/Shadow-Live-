import assert from "node:assert/strict";
import {test,after} from "node:test";
import {randomUUID} from "node:crypto";
import {getApps,initializeApp,deleteApp} from "firebase-admin/app";
import {getFirestore} from "firebase-admin/firestore";
import {cloudflareFirestoreAdapter} from "./helpers/cloudflare-firestore-adapter.js";
import {inspectAccountCrossDiaryComments as inspect}
  from "../../cloudflare-worker/src/account-deletion-cross-diary-comment-inventory.js";

const app=getApps()[0]||initializeApp({projectId:"shadow-live-economy-test"});
const store=getFirestore(app),db=cloudflareFirestoreAdapter(store);
after(async()=>{await deleteApp(app);});
const sid=()=>randomUUID().replaceAll("-","").slice(0,18);

test("emulator: bounded discovery finds cross-owner comments and respects cancellation",async()=>{
  const suffix=sid(),uid="comment_author_"+suffix,other="owner_"+suffix;
  const requestId="comment_erasure_"+suffix,actor={uid:"control_owner",owner:true};
  const request=store.doc("account_deletion_requests/"+uid);
  const checkpoint=store.doc("account_deletion_erasure_checkpoints/"+uid);
  const user=store.doc("users/"+uid);
  const diary=store.doc("diaries/other_diary_"+suffix);
  const operations=Array.from({length:6},(_,i)=>({
    id:"comment_op_"+suffix+"_"+String(i).padStart(2,"0"),
    commentId:"comment_"+suffix+"_"+i,
  }));
  const opRefs=operations.map(x=>store.doc("diary_operations/"+x.id));
  const commentRefs=operations.map(x=>store.doc(
    "diaries/"+diary.id+"/comments/"+x.commentId));
  const filter=store.doc("content_filter_flags/"+operations[0].commentId);
  const all=[request,checkpoint,user,diary,...opRefs,...commentRefs,filter];
  await Promise.all([
    request.set({uid,requestId,status:"review_ready"}),
    checkpoint.set({uid,requestId,phase:"preflight_blocked",
      destructiveAllowed:false}),
    user.set({role:"user",coins:700}),
    diary.set({ownerUid:other,text:"original other author"}),
    ...operations.flatMap((x,i)=>[
      opRefs[i].set({actorUid:uid,
        action:i===5?"createDiary":"createComment",
        diaryId:diary.id,result:{commentId:x.commentId},
        text:"not for output"}),
      commentRefs[i].set({authorUid:uid,diaryId:diary.id,
        text:"private comment data"}),
    ]),
    filter.set({evidenceHold:true}),
  ]);
  try{
    let cursor=null;const results=[];
    for(let i=0;i<3;i++){
      const page=await inspect(db,{uid,requestId,actor,limit:2,cursor});
      cursor=page.nextCursor;
      results.push(...page.comments);
      assert.equal(page.erasureAllowed,false);
      assert.equal(page.completionVerified,false);
    }
    assert.equal(results.length,5);
    assert.equal(results.every(x=>x.onOtherDiary===true),true);
    assert.equal(results[0].needsReview,true);
    assert.equal(cursor,null);
    assert.equal((await diary.get()).data().text,"original other author");
    assert.equal((await commentRefs[0].get()).data().text,
      "private comment data");
    assert.equal((await user.get()).data().coins,700);
    await request.update({status:"cancelled"});
    await assert.rejects(inspect(db,{uid,requestId,actor}),
      e=>e.code==="cross_diary_inventory_review_blocked");
  }finally{
    await Promise.all(all.map(x=>x.delete()));
  }
});
