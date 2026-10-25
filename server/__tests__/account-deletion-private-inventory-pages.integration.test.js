import assert from "node:assert/strict";
import {test,after} from "node:test";
import {randomUUID} from "node:crypto";
import {getApps,initializeApp,deleteApp} from "firebase-admin/app";
import {getFirestore} from "firebase-admin/firestore";
import {cloudflareFirestoreAdapter} from "./helpers/cloudflare-firestore-adapter.js";
import {inspectAccountPrivateErasurePage as inspect}
  from "../../cloudflare-worker/src/account-deletion-private-inventory-pages.js";

const app=getApps()[0]||initializeApp({projectId:"shadow-live-economy-test"});
const store=getFirestore(app),db=cloudflareFirestoreAdapter(store);
after(async()=>{await deleteApp(app);});
const sid=()=>randomUUID().replaceAll("-","").slice(0,18);

test("emulator: private conversations and authored message cursor pages keep counterpart text",async()=>{
  const suffix=sid(),uid="private_erase_"+suffix,other="counterpart_"+suffix;
  const requestId="request_private_"+suffix;
  const conversationId="conversation_"+suffix;
  const actor={uid:"verified_owner",owner:true};
  const request=store.doc("account_deletion_requests/"+uid);
  const checkpoint=store.doc("account_deletion_erasure_checkpoints/"+uid);
  const user=store.doc("users/"+uid);
  const conversation=store.doc("conversations/"+conversationId);
  const unrelated=store.doc("conversations/other_private_"+suffix);
  const messages=Array.from({length:7},(_,i)=>
    conversation.collection("messages").doc("message_"+suffix+"_"+i));
  const theirMessage=conversation.collection("messages").doc(
    "theirs_"+suffix);
  const flag=store.doc("content_filter_flags/"+messages[0].id);
  const refs=[request,checkpoint,user,conversation,unrelated,
    ...messages,theirMessage,flag];
  await Promise.all([
    request.set({uid,requestId,status:"review_ready"}),
    checkpoint.set({uid,requestId,phase:"preflight_blocked",
      destructiveAllowed:false}),
    user.set({role:"user",coins:750}),
    conversation.set({participants:[uid,other],lastMessage:"Sensitive preview"}),
    unrelated.set({participants:[other,"another_user_999"],
      lastMessage:"Unrelated"}),
    ...messages.map((ref,i)=>ref.set({
      senderId:uid,receiverId:other,
      type:i===1?"voice_note":"text",
      text:"sender private contents "+i,
    })),
    theirMessage.set({senderId:other,receiverId:uid,type:"text",
      text:"counterparty private text"}),
    flag.set({evidenceHold:true}),
  ]);
  try {
    const conversations=await inspect(db,{uid,requestId,actor});
    assert.deepEqual(conversations.items.map(x=>x.id),[conversationId]);
    assert.equal(conversations.exhaustive,false);
    let cursor=null;const items=[];
    for(let i=0;i<3;i++){
      const page=await inspect(db,{uid,requestId,actor,
        kind:"authored_messages",conversationId,cursor,limit:3});
      cursor=page.nextCursor;items.push(...page.items);
      assert.equal(page.completionVerified,false);
      assert.equal(page.erasureAllowed,false);
      assert.equal(JSON.stringify(page).includes("private contents"),false);
    }
    assert.equal(items.length,7);
    assert.equal(cursor,null);
    assert.equal(items[0].evidenceFlagPresent,true);
    assert.equal(items[1].class,"media_or_legacy_review");
    assert.equal((await theirMessage.get()).data().text,"counterparty private text");
    assert.equal((await conversation.get()).data().lastMessage,"Sensitive preview");
    assert.equal((await user.get()).data().coins,750);
    await messages[2].update({appealPending:true});
    const appealed=await inspect(db,{uid,requestId,actor,
      kind:"authored_messages",conversationId,limit:3});
    assert.equal(appealed.items[2].needsReview,true);
    assert.equal(appealed.erasureAllowed,false);
    await request.update({appealStatus:"Under_Review"});
    await assert.rejects(inspect(db,{uid,requestId,actor}),
      e=>e.code==="private_inventory_review_blocked");
    assert.equal((await theirMessage.get()).data().text,"counterparty private text");
    await request.update({appealStatus:"closed",status:"cancelled"});
    await assert.rejects(inspect(db,{uid,requestId,actor}),
      e=>e.code==="private_inventory_review_blocked");
  } finally {
    await Promise.all(refs.map(ref=>ref.delete()));
  }
});
