import assert from "node:assert/strict";
import { after, test } from "node:test";
import { deleteApp, getApps, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

import {
  claimRocketReward,
  registerRocketEntry,
} from "../economy/room-rocket-runtime.js";

const app=getApps()[0]||initializeApp({projectId:"shadow-live-economy-test"});
const db=getFirestore(app);

after(async()=>{await deleteApp(app);});

function explosionData({
  roomId,
  startsAtMs,
  endsAtMs,
  contributors=[],
  top3=[],
  winProbabilityBps=10000,
}){
  return {
    roomId,
    cycleNumber:1,
    level:1,
    thresholdCoins:100000,
    startsAtMs,
    endsAtMs,
    durationSeconds:10,
    winProbabilityBps,
    triggerUid:"trigger",
    triggerDisplayName:"Trigger",
    triggerProfileImageUrl:"",
    contributors,
    contributorIds:contributors.map((item)=>item.uid),
    top3,
    rewardTypes:["coins","frame","entrance","voice_wave"],
    rewardPool:{
      coinPrizes:[{coins:100,weight:1}],
      frameRewards:[],
      entranceRewards:[],
      voiceWaveRewards:[],
    },
    cosmeticStackCapHours:720,
    noWinMessageAr:"حظ أوفر في المرة القادمة",
    status:"queued",
  };
}

test("present room user registers during 10s window then claims one private reward idempotently",async()=>{
  const suffix=Date.now().toString()+"_present";
  const uid="rocket_user_"+suffix;
  const roomId="rocket_room_"+suffix;
  const explosionId="rocket_explosion_"+suffix;
  const start=100000;
  const end=110000;

  await Promise.all([
    db.collection("users").doc(uid).set({coins:1000,role:"user"}),
    db.collection("room_presence").doc(roomId).collection("users").doc(uid).set({
      uid,
      displayName:"Present User",
      lastSeenAtMs:start+5000,
    }),
    db.collection("room_rocket_explosions").doc(explosionId).set(
      explosionData({roomId,startsAtMs:start,endsAtMs:end}),
    ),
  ]);

  const entry=await registerRocketEntry(db,uid,explosionId,start+5000);
  assert.equal(entry.ok,true);
  assert.equal(entry.attempts,1);

  const first=await claimRocketReward(db,uid,explosionId,end+1);
  assert.equal(first.ok,true);
  assert.equal(first.duplicate,false);
  assert.equal(first.result.attempts,1);
  assert.equal(first.result.coinAward,100);
  assert.equal(first.result.private,true);
  assert.equal(first.result.awardedAtMs,end);

  const [user,result,notification,ledger]=await Promise.all([
    db.collection("users").doc(uid).get(),
    db.collection("room_rocket_explosions").doc(explosionId)
      .collection("results").doc(uid).get(),
    db.collection("notifications")
      .where("userId","==",uid)
      .where("data.explosionId","==",explosionId)
      .get(),
    db.collection("financial_ledger").doc("rocket_"+explosionId+"_"+uid).get(),
  ]);
  assert.equal(user.data().coins,1100);
  assert.equal(result.exists,true);
  assert.equal(result.data().coinAward,100);
  assert.equal(notification.size,1);
  assert.equal(ledger.data().delta,100);

  const duplicate=await claimRocketReward(db,uid,explosionId,end+5000);
  assert.equal(duplicate.ok,true);
  assert.equal(duplicate.duplicate,true);
  const userAfter=await db.collection("users").doc(uid).get();
  assert.equal(userAfter.data().coins,1100);
});

test("contributor outside room remains eligible and top3 receives two attempts",async()=>{
  const suffix=Date.now().toString()+"_outside";
  const uid="rocket_contributor_"+suffix;
  const roomId="rocket_room_"+suffix;
  const explosionId="rocket_explosion_"+suffix;
  const start=200000;
  const end=210000;
  const contribution={uid,coins:70000,displayName:"Contributor",profileImageUrl:""};

  await Promise.all([
    db.collection("users").doc(uid).set({coins:0,role:"user"}),
    db.collection("room_rocket_explosions").doc(explosionId).set(
      explosionData({
        roomId,
        startsAtMs:start,
        endsAtMs:end,
        contributors:[contribution],
        top3:[contribution],
      }),
    ),
  ]);

  const result=await claimRocketReward(db,uid,explosionId,end+25000);
  assert.equal(result.ok,true);
  assert.equal(result.result.attempts,2);
  assert.equal(result.result.outcomes.length,2);
  assert.equal(result.result.coinAward,200);
  assert.equal(result.result.awardedAtMs,end);

  const user=await db.collection("users").doc(uid).get();
  assert.equal(user.data().coins,200);
});


test("timed voice-wave reward starts at explosion end and is not auto-activated",async()=>{
  const suffix=Date.now().toString()+"_wave";
  const uid="rocket_wave_"+suffix;
  const roomId="rocket_room_"+suffix;
  const explosionId="rocket_explosion_"+suffix;
  const start=300000;
  const end=310000;
  const contribution={uid,coins:100000,displayName:"Wave Winner",profileImageUrl:""};
  const explosion=explosionData({
    roomId,
    startsAtMs:start,
    endsAtMs:end,
    contributors:[contribution],
    top3:[],
  });
  explosion.rewardPool={
    coinPrizes:[],
    frameRewards:[],
    entranceRewards:[],
    voiceWaveRewards:[{
      id:"wave_test",
      durationHours:24,
      weight:1,
      overflowCoins:500,
      enabled:true,
    }],
  };

  await Promise.all([
    db.collection("users").doc(uid).set({coins:0,role:"user"}),
    db.collection("room_rocket_explosions").doc(explosionId).set(explosion),
  ]);

  const result=await claimRocketReward(db,uid,explosionId,end+3600000);
  assert.equal(result.ok,true);
  assert.equal(result.result.awardedAtMs,end);
  assert.equal(result.result.outcomes[0].type,"voice_wave");

  const reward=await db.collection("user_rewards").doc(uid)
    .collection("items").doc("voice_wave__wave_test").get();
  assert.equal(reward.exists,true);
  assert.equal(reward.data().active,false);
  assert.equal(reward.data().expiresAtMs,end+24*60*60*1000);
});
