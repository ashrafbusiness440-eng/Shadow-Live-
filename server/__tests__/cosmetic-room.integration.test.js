import assert from "node:assert/strict";
import { after, test } from "node:test";
import { deleteApp, getApps, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

import { announceRoomEntrance } from "../../api/voice-session.js";

const app=getApps()[0]||initializeApp({projectId:"shadow-live-economy-test"});
const db=getFirestore(app);

after(async()=>{await deleteApp(app);});

test("active entrance reward is projected into the room with a stable fallback asset key",async()=>{
  const suffix=Date.now().toString()+"_entrance";
  const uid="cosmetic_user_"+suffix;
  const roomId="cosmetic_room_"+suffix;
  const rewardId="royal_entry";
  const expiresAtMs=Date.now()+24*60*60*1000;

  await Promise.all([
    db.collection("users").doc(uid).set({role:"user",coins:0}),
    db.collection("public_profiles").doc(uid).set({
      uid,
      displayName:"Entrance User",
      profileImageUrl:"https://example.com/avatar.webp",
    }),
    db.collection("user_rewards").doc(uid).set({
      activeByType:{entrance:rewardId},
    }),
    db.collection("user_rewards").doc(uid).collection("items")
      .doc("entrance__"+rewardId).set({
        type:"entrance",
        rewardId,
        expiresAtMs,
        active:true,
        imageUrl:"",
        assetKey:"",
      }),
    db.collection("rooms").doc(roomId).set({
      isActive:true,
      name:"Cosmetic Room",
    }),
  ]);

  const result=await announceRoomEntrance(db,uid,roomId);
  assert.equal(result.ok,true);
  assert.equal(result.announced,true);
  assert.equal(result.event.uid,uid);
  assert.equal(result.event.rewardId,rewardId);
  assert.equal(result.event.assetKey,"cosmetics.entrance.royal_entry");

  const room=await db.collection("rooms").doc(roomId).get();
  const event=room.data().recentEntrance;
  assert.equal(event.displayName,"Entrance User");
  assert.equal(event.assetKey,"cosmetics.entrance.royal_entry");
  assert.ok(Number(event.eventAtMs)>0);
});

test("expired entrance reward is not announced",async()=>{
  const suffix=Date.now().toString()+"_expired";
  const uid="cosmetic_user_"+suffix;
  const roomId="cosmetic_room_"+suffix;
  const rewardId="expired_entry";

  await Promise.all([
    db.collection("users").doc(uid).set({role:"user",coins:0}),
    db.collection("user_rewards").doc(uid).set({
      activeByType:{entrance:rewardId},
    }),
    db.collection("user_rewards").doc(uid).collection("items")
      .doc("entrance__"+rewardId).set({
        type:"entrance",
        rewardId,
        expiresAtMs:Date.now()-1000,
        active:true,
      }),
    db.collection("rooms").doc(roomId).set({
      isActive:true,
      name:"Cosmetic Room",
    }),
  ]);

  const result=await announceRoomEntrance(db,uid,roomId);
  assert.equal(result.ok,true);
  assert.equal(result.announced,false);

  const room=await db.collection("rooms").doc(roomId).get();
  assert.equal(room.data().recentEntrance,undefined);
});
