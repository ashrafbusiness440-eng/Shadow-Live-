import assert from "node:assert/strict";
import { after, test } from "node:test";
import { deleteApp, getApps, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

import {
  listInventory,
  setActiveReward,
} from "../economy/reward-inventory.js";

const app=getApps()[0]||initializeApp({projectId:"shadow-live-economy-test"});
const db=getFirestore(app);

after(async()=>{await deleteApp(app);});

test("My Items activates room background and applies it to owned rooms",async()=>{
  const suffix=Date.now().toString()+"_bg";
  const uid="inventory_user_"+suffix;
  const rewardId="bg_neon_"+suffix;
  const roomId="inventory_room_"+suffix;
  const expiresAtMs=Date.now()+24*60*60*1000;

  await Promise.all([
    db.collection("users").doc(uid).set({role:"user",coins:0}),
    db.collection("user_rewards").doc(uid).collection("items")
      .doc("room_background__"+rewardId).set({
        type:"room_background",
        rewardId,
        nameAr:"خلفية نيون",
        assetKey:"room.background.neon",
        imageUrl:"https://example.com/neon.webp",
        expiresAtMs,
        active:false,
        source:"room_rocket",
      }),
    db.collection("rooms").doc(roomId).set({
      isActive:true,
      ownerUid:uid,
      name:"Owned Room",
    }),
  ]);

  const activated=await setActiveReward(db,uid,{
    type:"room_background",
    rewardId,
    active:true,
  });
  assert.equal(activated.active,true);

  const [item,root,room,list]=await Promise.all([
    db.collection("user_rewards").doc(uid).collection("items")
      .doc("room_background__"+rewardId).get(),
    db.collection("user_rewards").doc(uid).get(),
    db.collection("rooms").doc(roomId).get(),
    listInventory(db,uid),
  ]);
  assert.equal(item.data().active,true);
  assert.equal(root.data().activeByType.room_background,rewardId);
  assert.equal(room.data().activeRoomBackgroundRewardId,rewardId);
  assert.equal(room.data().activeRoomBackgroundImageUrl,"https://example.com/neon.webp");
  assert.equal(room.data().activeRoomBackgroundExpiresAtMs,expiresAtMs);
  assert.equal(list.items.length,1);
  assert.equal(list.items[0].active,true);

  const deactivated=await setActiveReward(db,uid,{
    type:"room_background",
    rewardId,
    active:false,
  });
  assert.equal(deactivated.active,false);

  const roomAfter=await db.collection("rooms").doc(roomId).get();
  assert.equal(roomAfter.data().activeRoomBackgroundRewardId,undefined);
  const itemAfter=await db.collection("user_rewards").doc(uid)
    .collection("items").doc("room_background__"+rewardId).get();
  assert.equal(itemAfter.data().active,false);
});

test("activating a second item of the same type deactivates the previous item",async()=>{
  const suffix=Date.now().toString()+"_switch";
  const uid="inventory_user_"+suffix;
  const expiresAtMs=Date.now()+3*24*60*60*1000;
  const root=db.collection("user_rewards").doc(uid);

  await Promise.all([
    db.collection("users").doc(uid).set({role:"user",coins:0}),
    root.collection("items").doc("frame__first").set({
      type:"frame",rewardId:"first",expiresAtMs,active:true,
    }),
    root.collection("items").doc("frame__second").set({
      type:"frame",rewardId:"second",expiresAtMs,active:false,
    }),
    root.set({activeByType:{frame:"first"}}),
  ]);

  await setActiveReward(db,uid,{
    type:"frame",
    rewardId:"second",
    active:true,
  });

  const [first,second,rootAfter]=await Promise.all([
    root.collection("items").doc("frame__first").get(),
    root.collection("items").doc("frame__second").get(),
    root.get(),
  ]);
  assert.equal(first.data().active,false);
  assert.equal(second.data().active,true);
  assert.equal(rootAfter.data().activeByType.frame,"second");
});

test("expired reward cannot be activated",async()=>{
  const suffix=Date.now().toString()+"_expired";
  const uid="inventory_user_"+suffix;
  await Promise.all([
    db.collection("users").doc(uid).set({role:"user",coins:0}),
    db.collection("user_rewards").doc(uid).collection("items")
      .doc("entrance__expired").set({
        type:"entrance",
        rewardId:"expired",
        expiresAtMs:Date.now()-1000,
        active:false,
      }),
  ]);

  await assert.rejects(
    ()=>setActiveReward(db,uid,{
      type:"entrance",
      rewardId:"expired",
      active:true,
    }),
    /reward_expired/,
  );
});
