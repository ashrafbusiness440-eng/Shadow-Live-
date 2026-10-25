import assert from "node:assert/strict";
import {test,after} from "node:test";
import {randomUUID} from "node:crypto";
import {getApps,initializeApp,deleteApp} from "firebase-admin/app";
import {getFirestore} from "firebase-admin/firestore";
import {cloudflareFirestoreAdapter} from "./helpers/cloudflare-firestore-adapter.js";
import {inspectAccountImageUploadTicketPage as inspect} from
 "../../cloudflare-worker/src/account-deletion-image-upload-ticket-review.js";
const app=getApps()[0]||initializeApp({projectId:"shadow-live-economy-test"});
const store=getFirestore(app),db=cloudflareFirestoreAdapter(store);
after(async()=>deleteApp(app));
const hex=()=>randomUUID().replaceAll("-","");
test("emulator: five-ticket cursor, linked chat, holds and other-account preservation",async()=>{
  const suffix=hex().slice(0,14),uid="image_ticket_user_"+suffix;
  const peer="image_ticket_peer_"+suffix,requestId="image_ticket_req_"+suffix;
  const conversation="image_ticket_chat_"+suffix,ids=Array.from({length:7},hex);
  const paths=[
    "account_deletion_requests/"+uid,
    "account_deletion_erasure_checkpoints/"+uid,
    "users/"+uid,"users/"+peer,"conversations/"+conversation,
    ...ids.map(x=>"storage_upload_tickets/"+x),
    "storage_objects/"+ids[0],"reports/image_ticket_legal_"+suffix,
  ];
  const refs=paths.map(path=>store.doc(path));
  const [request,checkpoint,user,other,chat]=refs;
  try{
    await Promise.all([
      request.set({uid,requestId,status:"review_ready"}),
      checkpoint.set({uid,requestId,phase:"preflight_blocked",destructiveAllowed:false}),
      user.set({role:"user",coins:10}),
      other.set({role:"user",coins:999}),
      chat.set({participants:[uid,peer]}),
      refs[12].set({ownerUid:uid,objectId:ids[0],targetId:uid,
        scope:"profile_image",mimeType:"image/jpeg",bucket:"shadow-live-storage"}),
      refs[13].set({targetUid:uid,protectedEvidence:true}),
      ...ids.map((id,i)=>{
        const shared=i===1;
        const key=shared?"chat/"+conversation+"/"+uid+"/"+id+".jpg":
          "users/"+uid+"/profile/"+id+".jpg";
        return refs[5+i].set({
          ownerUid:uid,objectId:id,
          scope:shared?"chat_image":"profile_image",
          targetId:shared?conversation:uid,
          storageKey:key,publicStorageKey:key,
          bucket:"shadow-live-storage",mimeType:"image/jpeg",
          expectedSizeBytes:1024,expiresAt:new Date("2025-01-01T00:00:00Z"),
        });
      }),
    ]);
    const opts={uid,requestId,actor:{owner:true,uid:"control_owner_123"},
      nowMs:1790000000000};
    const first=await inspect(db,opts);
    assert.equal(first.checked,5);
    assert.equal(first.hasMore,true);
    const second=await inspect(db,{...opts,cursor:first.nextCursor});
    assert.equal(second.checked,2);
    assert.equal(second.hasMore,false);
    assert.equal(first.items.every(x=>x.uploadFinalizationUnresolved),true);
    assert.equal(first.erasureAllowed,false);
    assert.equal(first.completionVerified,false);
    assert.equal((await other.get()).data().coins,999);
    assert.equal((await chat.get()).data().participants[1],peer);
    assert.equal((await refs[13].get()).data().protectedEvidence,true);
    assert.equal((await refs[5].get()).data().ownerUid,uid);
    await request.update({appealPending:true});
    await assert.rejects(inspect(db,opts),
      e=>e.code==="image_upload_ticket_review_blocked");
    assert.equal((await other.get()).data().coins,999);
  } finally {
    await Promise.all(refs.map(ref=>ref.delete()));
  }
});
