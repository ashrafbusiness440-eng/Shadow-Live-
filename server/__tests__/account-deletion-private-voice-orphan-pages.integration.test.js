import assert from "node:assert/strict";
import {test,after} from "node:test";
import {randomUUID} from "node:crypto";
import {getApps,initializeApp,deleteApp} from "firebase-admin/app";
import {getFirestore} from "firebase-admin/firestore";
import {cloudflareFirestoreAdapter} from "./helpers/cloudflare-firestore-adapter.js";
import {inspectPrivateVoiceOrphanPage as inspect}
  from "../../cloudflare-worker/src/account-deletion-private-voice-orphan-pages.js";

const app=getApps()[0]||initializeApp({projectId:"shadow-live-economy-test"});
const store=getFirestore(app),db=cloudflareFirestoreAdapter(store);
after(async()=>{await deleteApp(app);});
test("emulator: scoped R2 listing reports missing metadata, leaves other user/audio intact",async()=>{
  const suffix=randomUUID().replaceAll("-","").slice(0,18);
  const uid="voice_orphan_"+suffix,other="peer_orphan_"+suffix;
  const requestId="orphan_request_"+suffix,chatId="voice_chat_"+suffix;
  const ids=Array.from({length:4},()=>randomUUID().replaceAll("-",""));
  const key=x=>`private-voice/${chatId}/${uid}/${x}.wav`;
  const request=store.doc("account_deletion_requests/"+uid);
  const checkpoint=store.doc("account_deletion_erasure_checkpoints/"+uid);
  const user=store.doc("users/"+uid);
  const conversation=store.doc("conversations/"+chatId);
  const metadata=ids.slice(0,3).map(id=>store.doc("private_voice_objects/"+id));
  const foreign=store.doc("private_voice_objects/"+
    randomUUID().replaceAll("-",""));
  const evidence=store.doc("reports/voice_report_"+suffix);
  const refs=[request,checkpoint,user,conversation,...metadata,foreign,evidence];
  await Promise.all([
    request.set({uid,requestId,status:"review_ready"}),
    checkpoint.set({uid,requestId,phase:"preflight_blocked",
      destructiveAllowed:false}),
    user.set({role:"user",coins:400}),
    conversation.set({participants:[uid,other],lastMessage:"🎤 voice"}),
    ...metadata.map((ref,i)=>ref.set({
      objectId:ids[i],ownerUid:uid,otherUid:other,conversationId:chatId,
      storageKey:key(ids[i]),state:"sent",
    })),
    foreign.set({ownerUid:other,state:"sent"}),
    evidence.set({reporterUid:other,evidence:"protected original"}),
  ]);
  const calls=[];
  const r2={
    list:async arg=>{
      calls.push(arg);
      const start=arg.cursor?Number(arg.cursor.slice(1)):0;
      const slice=ids.slice(start,start+arg.limit);
      return {objects:slice.map(id=>({key:key(id)})),
        truncated:start+slice.length<ids.length,
        ...(start+slice.length<ids.length
          ?{cursor:"c"+(start+slice.length)}:{}),
      };
    },
    delete:async()=>{throw Error("unexpected delete");},
    get:async()=>{throw Error("unexpected get");},
  };
  const opts={uid,requestId,conversationId:chatId,
    actor:{owner:true,uid:"owner_control_123"},limit:2};
  try {
    const first=await inspect(db,r2,opts);
    const second=await inspect(db,r2,{...opts,cursor:first.nextCursor});
    assert.deepEqual([first.checked,second.checked],[2,2]);
    assert.equal(second.items[1].metadataPresent,false);
    assert.equal(second.items[1].needsReview,true);
    assert.equal(first.items.every(x=>x.needsReview===false),true);
    assert.equal(calls.length,2);
    assert.equal(calls.every(c=>c.prefix===`private-voice/${chatId}/${uid}/`),true);
    assert.equal(JSON.stringify(second).includes("private-voice/"),false);
    assert.equal(second.completionVerified,false);
    assert.equal(second.erasureAllowed,false);
    assert.equal((await foreign.get()).data().ownerUid,other);
    assert.equal((await evidence.get()).data().evidence,"protected original");
    assert.equal((await conversation.get()).data().lastMessage,"🎤 voice");
    assert.equal((await user.get()).data().coins,400);
    await metadata[0].update({appealStatus:"open"});
    const appealed=await inspect(db,r2,opts);
    assert.equal(appealed.items[0].needsReview,true);
    assert.equal(appealed.erasureAllowed,false);
    assert.equal(calls.length,3);
    await request.update({appealPending:true});
    await assert.rejects(inspect(db,r2,opts),
      e=>e.code==="private_voice_orphan_review_blocked");
    assert.equal(calls.length,3);
    await request.update({appealPending:false,legalHold:true});
    await assert.rejects(inspect(db,r2,opts),
      e=>e.code==="private_voice_orphan_review_blocked");
    assert.equal(calls.length,3);
  } finally {
    await Promise.all(refs.map(ref=>ref.delete()));
  }
});
