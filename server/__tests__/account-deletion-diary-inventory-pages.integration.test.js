import assert from "node:assert/strict";
import { test, after } from "node:test";
import { randomUUID } from "node:crypto";
import { getApps, initializeApp, deleteApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { cloudflareFirestoreAdapter } from "./helpers/cloudflare-firestore-adapter.js";
import { inspectAccountDiaryErasurePage as inspect }
  from "../../cloudflare-worker/src/account-deletion-diary-inventory-pages.js";

const app=getApps()[0]||initializeApp({projectId:"shadow-live-economy-test"});
const store=getFirestore(app),db=cloudflareFirestoreAdapter(store);
const sid=()=>randomUUID().replaceAll("-","").slice(0,18);
after(async()=>{await deleteApp(app);});

test("emulator: cursor pages cover owned diaries; nested comments retain authorship",async()=>{
  const suffix=sid(),uid="erase_diary_"+suffix,other="reader_"+suffix;
  const requestId="diary_req_"+suffix,owner={uid:"control_owner",owner:true};
  const request=store.doc("account_deletion_requests/"+uid);
  const checkpoint=store.doc("account_deletion_erasure_checkpoints/"+uid);
  const user=store.doc("users/"+uid);
  const diaries=Array.from({length:7},(_,i)=>{
    const id="diary_"+suffix+"_"+i;
    return {original:store.doc("diaries/"+id),
      mirror:store.doc("users/"+uid+"/diaries/"+id),id};
  });
  const comments=[
    store.doc("diaries/"+diaries[0].id+"/comments/comment_a_"+suffix),
    store.doc("diaries/"+diaries[0].id+"/comments/comment_b_"+suffix),
  ];
  const all=[request,checkpoint,user,...diaries.flatMap(x=>
    [x.original,x.mirror]),...comments];
  await Promise.all([
    request.set({uid,requestId,status:"review_ready"}),
    checkpoint.set({uid,requestId,phase:"preflight_blocked",
      destructiveAllowed:false}),
    user.set({role:"user",coins:543}),
    ...diaries.flatMap((x,i)=>{
      const data={diaryId:x.id,ownerUid:uid,createdAtMs:5000-i,
        text:"protected original content",commentCount:i===0?2:0};
      return [x.original.set(data),x.mirror.set(data)];
    }),
    comments[0].set({commentId:"comment_a_"+suffix,
      diaryId:diaries[0].id,authorUid:uid,createdAtMs:300,
      text:"deleted person's comment"}),
    comments[1].set({commentId:"comment_b_"+suffix,
      diaryId:diaries[0].id,authorUid:other,createdAtMs:200,
      text:"counterparty comment"}),
  ]);
  try{
    const visited=[];
    let cursor=null;
    for(let i=0;i<3;i++){
      const page=await inspect(db,{uid,requestId,actor:owner,
        limit:3,cursor});
      visited.push(...page.items.map(x=>x.id));
      assert.equal(page.exhaustive,false);
      assert.equal(page.erasureAllowed,false);
      cursor=page.nextCursor;
    }
    assert.equal(visited.length,7);
    assert.equal(new Set(visited).size,7);
    assert.equal(cursor,null);
    const page=await inspect(db,{uid,requestId,actor:owner,
      kind:"comments",diaryId:diaries[0].id,limit:2});
    assert.deepEqual(page.items.map(x=>x.authoredByDeleted),[true,false]);
    assert.equal(page.completionVerified,false);
    assert.equal((await diaries[0].original.get()).data().text,
      "protected original content");
    assert.equal((await comments[1].get()).data().text,"counterparty comment");
    assert.equal((await user.get()).data().coins,543);
    await request.update({status:"cancelled"});
    await assert.rejects(inspect(db,{uid,requestId,actor:owner}),
      e=>e.code==="diary_inventory_review_blocked");
  }finally{
    await Promise.all(all.map(x=>x.delete()));
  }
});
