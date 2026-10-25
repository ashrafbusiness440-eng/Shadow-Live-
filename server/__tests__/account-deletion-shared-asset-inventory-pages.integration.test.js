import assert from "node:assert/strict";
import {test,after} from "node:test";
import {randomUUID} from "node:crypto";
import {getApps,initializeApp,deleteApp} from "firebase-admin/app";
import {getFirestore} from "firebase-admin/firestore";
import {cloudflareFirestoreAdapter} from "./helpers/cloudflare-firestore-adapter.js";
import {inspectAccountSharedAssetsPage as inspect}
  from "../../cloudflare-worker/src/account-deletion-shared-asset-inventory-pages.js";

const app=getApps()[0]||initializeApp({projectId:"shadow-live-economy-test"});
const store=getFirestore(app),db=cloudflareFirestoreAdapter(store);
after(async()=>{await deleteApp(app);});
test("emulator: paginated shared rooms and owner agency require independent transfer; counterpart unaffected",async()=>{
  const suffix=randomUUID().replaceAll("-","").slice(0,18);
  const uid="owner_erasure_"+suffix,other="other_member_"+suffix;
  const requestId="shared_asset_delete_req_"+suffix;
  const agencyId="agency_assets_"+suffix;
  const req=store.doc("account_deletion_requests/"+uid);
  const cp=store.doc("account_deletion_erasure_checkpoints/"+uid);
  const user=store.doc("users/"+uid);
  const rooms=Array.from({length:7},(_,i)=>
    store.doc("rooms/shared_room_"+suffix+"_"+i));
  const otherRoom=store.doc("rooms/other_room_"+suffix);
  const agency=store.doc("agencies/"+agencyId);
  const pair=store.doc("agency_memberships/"+agencyId+"__"+uid);
  const membership=store.doc("agency_user_memberships/"+uid);
  const refs=[req,cp,user,...rooms,otherRoom,agency,pair,membership];
  await Promise.all([
    req.set({uid,requestId,status:"review_ready"}),
    cp.set({uid,requestId,phase:"preflight_blocked",destructiveAllowed:false}),
    user.set({role:"user",accountStatus:"active",coins:100}),
    ...rooms.map((ref,i)=>ref.set({
      ownerUid:uid,ownerId:uid,roomName:"Sensitive room",
      agencyId:i===0?agencyId:"",participantCount:8,
    })),
    otherRoom.set({ownerUid:other,roomName:"Other room",participantCount:9}),
    agency.set({agencyId,ownerUid:uid,name:"Private owned agency",
      memberCount:9,hostCount:7,status:"active"}),
    pair.set({agencyId,uid,role:"owner",status:"active"}),
    membership.set({agencyId,uid,role:"owner",status:"active"}),
  ]);
  const opts={uid,requestId,actor:{owner:true,uid:"control_owner_987"}};
  try{
    const first=await inspect(db,{...opts,kind:"rooms_owner_uid",limit:3});
    const second=await inspect(db,{...opts,kind:"rooms_owner_uid",
      cursor:first.nextCursor,limit:3});
    const third=await inspect(db,{...opts,kind:"rooms_owner_uid",
      cursor:second.nextCursor,limit:3});
    assert.deepEqual([first.items.length,second.items.length,third.items.length],
      [3,3,1]);
    assert.equal(first.items.some(item=>item.linkedAgencyRequiresReview),true);
    assert.equal(third.nextCursor,null);
    assert.equal(first.exhaustive,false);
    assert.equal(first.ownershipTransferred,false);
    const owned=await inspect(db,{...opts,kind:"agencies_owned"});
    assert.equal(owned.items.length,1);
    assert.equal(owned.items[0].membershipConsistent,true);
    assert.equal(owned.items[0].requiresFinancialReview,true);
    assert.equal(owned.erasureAllowed,false);
    assert.equal((await otherRoom.get()).data().roomName,"Other room");
    assert.equal((await rooms[0].get()).data().roomName,"Sensitive room");
    assert.equal((await agency.get()).data().memberCount,9);
    assert.equal((await user.get()).data().coins,100);
    await pair.update({legalHold:true});
    const held=await inspect(db,{...opts,kind:"agencies_owned"});
    assert.equal(held.items[0].held,true);
    assert.equal(held.items[0].membershipConsistent,false);
    await pair.update({legalHold:false,appealStatus:"open"});
    const appealed=await inspect(db,{...opts,kind:"agencies_owned"});
    assert.equal(appealed.items[0].held,true);
    assert.equal(appealed.items[0].membershipConsistent,false);
    await rooms[0].update({appealPending:true});
    const roomAppeal=await inspect(db,{...opts,kind:"rooms_owner_uid",limit:1});
    assert.equal(roomAppeal.items[0].held,true);
    assert.equal(roomAppeal.erasureAllowed,false);
    await req.update({appealPending:true});
    await assert.rejects(inspect(db,{...opts,kind:"agencies_owned"}),
      error=>error.code==="shared_asset_inventory_review_blocked");
    await req.update({appealPending:false,status:"cancelled"});
    await assert.rejects(inspect(db,{...opts,kind:"rooms_owner_uid"}),
      error=>error.code==="shared_asset_inventory_review_blocked");
  }finally{
    await Promise.all(refs.map(ref=>ref.delete()));
  }
});
