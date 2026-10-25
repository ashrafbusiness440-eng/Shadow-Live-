import assert from "node:assert/strict";
import {test,after} from "node:test";
import {randomUUID} from "node:crypto";
import {getApps,initializeApp,deleteApp} from "firebase-admin/app";
import {getFirestore} from "firebase-admin/firestore";
import {cloudflareFirestoreAdapter} from "./helpers/cloudflare-firestore-adapter.js";
import {inspectPersonalImageR2OrphanPage as inspect}
 from "../../cloudflare-worker/src/account-deletion-personal-image-r2-orphan-pages.js";
const app=getApps()[0]||initializeApp({projectId:"shadow-live-economy-test"});
const store=getFirestore(app),db=cloudflareFirestoreAdapter(store);
after(async()=>deleteApp(app));
const hex=()=>randomUUID().replaceAll("-","");
test("emulator: personal R2 orphan preview preserves peer, metadata, upload tickets and evidence",async()=>{
 const suffix=hex().slice(0,14),uid="orphan_user_"+suffix;
 const peer="other_orphan_"+suffix,requestId="orphan_request_"+suffix;
 const ids=[hex(),hex(),hex()];
 const prefix="users/"+uid+"/profile/";
 const keys=ids.map(id=>prefix+id+".jpg");
 const paths=[
  "account_deletion_requests/"+uid,
  "account_deletion_erasure_checkpoints/"+uid,
  "users/"+uid,"users/"+peer,
  "storage_objects/"+ids[0],
  "storage_upload_tickets/"+ids[1],
  "reports/legal_image_"+suffix,
 ];
 const refs=paths.map(p=>store.doc(p));
 const [req,checkpoint,user,other,metadata,ticket,evidence]=refs;
 await Promise.all([
  req.set({uid,requestId,status:"review_ready"}),
  checkpoint.set({uid,requestId,phase:"preflight_blocked",destructiveAllowed:false}),
  user.set({role:"user",coins:700}),
  other.set({role:"user",coins:950}),
  metadata.set({
   objectId:ids[0],ownerUid:uid,targetId:uid,scope:"profile_image",
   storageKey:keys[0],mimeType:"image/jpeg",sizeBytes:1000,
   bucket:"shadow-live-storage",state:"active",
  }),
  ticket.set({objectId:ids[1],ownerUid:uid,storageKey:keys[1]}),
  evidence.set({targetUid:uid,protectedEvidence:"preserve"}),
 ]);
 const calls=[];
 const bucket={
  async list(x){calls.push(x);return {objects:keys.map(key=>({key})),
   truncated:false};},
  async get(){throw Error("unexpected_get");},
  async head(){throw Error("unexpected_head");},
  async delete(){throw Error("unexpected_delete");},
 };
 const opts={uid,requestId,folder:"profile",
  actor:{owner:true,uid:"control_owner_123"}};
 try{
  const result=await inspect(db,bucket,opts);
  assert.equal(result.checked,3);
  assert.equal(result.items[0].referenceConsistent,true);
  assert.equal(result.items[1].uploadTicketPresent,true);
  assert.equal(result.items[1].possibleOrphan,false);
  assert.equal(result.items[2].possibleOrphan,true);
  assert.equal(result.erasureAllowed,false);
  assert.equal(result.completionVerified,false);
  assert.equal(calls[0].prefix,prefix);
  assert.equal(calls[0].limit,5);
  assert.equal((await other.get()).data().coins,950);
  assert.equal((await user.get()).data().coins,700);
  assert.equal((await evidence.get()).data().protectedEvidence,"preserve");
  assert.equal((await metadata.get()).data().state,"active");
  assert.equal((await ticket.get()).data().ownerUid,uid);
  await req.update({evidenceHold:true});
  await assert.rejects(inspect(db,bucket,opts),
    e=>e.code==="personal_image_orphan_review_blocked");
  assert.equal(calls.length,1);
 }finally{
  await Promise.all(refs.map(ref=>ref.delete()));
 }
});
