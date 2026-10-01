import assert from "node:assert/strict";
import {after, test} from "node:test";
import {deleteApp, initializeApp} from "firebase-admin/app";
import {getFirestore} from "firebase-admin/firestore";

import {sendGift as sendChatGift} from "../../cloudflare-worker/src/chat-safety-actions.js";
import {sendRoomGift} from "../../cloudflare-worker/src/room-gift.js";
import {calculateAgencyMonthlyBonus} from "../economy/economy-policy.js";
import {recordMicActivity} from "../economy/mic-activity-admin.js";
import {cloudflareFirestoreAdapter} from "./helpers/cloudflare-firestore-adapter.js";

const app=initializeApp(
  {projectId:"shadow-live-economy-test"},
  "agency-stage08a-"+Date.now(),
);
const db=getFirestore(app);
const cloudflareDb=cloudflareFirestoreAdapter(db);

after(async()=>{await deleteApp(app);});

const policy={
  enabled:true,
  policyMode:"tiered_host_agency",
  coinsPerUsd:10000,
  coinsPerDiamond:10000,
  hostPerformanceBonusBps:0,
  agencyPerformanceBonusBps:100,
  agencyPerformanceBonusMode:"per_host_target_month_end",
  hostBonusQualifiedDays:14,
  hostBonusMinutesPerQualifiedDay:120,
  agencyBonusActiveHosts:10,
  tiers:[
    {id:"starter",nameAr:"Starter",minGiftCoins:0,hostShareBps:5000,agencyShareBps:500},
    {id:"bronze",nameAr:"Bronze",minGiftCoins:1000000,hostShareBps:5700,agencyShareBps:600},
    {id:"silver",nameAr:"Silver",minGiftCoins:5000000,hostShareBps:6000,agencyShareBps:800},
    {id:"gold",nameAr:"Gold",minGiftCoins:20000000,hostShareBps:6200,agencyShareBps:900},
    {id:"diamond",nameAr:"Diamond",minGiftCoins:50000000,hostShareBps:6300,agencyShareBps:1000},
  ],
};

async function seedConfig(){
  await Promise.all([
    db.collection("system_config").doc("gift_catalog").set({
      gifts:[{
        id:"stage08a_gift",
        nameAr:"هدية 08-A",
        priceCoins:100000,
        enabled:true,
        assetKey:"gifts.placeholder.default",
      }],
    }),
    db.collection("system_config").doc("gift_economy").set(policy),
    db.collection("system_config").doc("emergency_lock").set({
      enabled:false,
      economyLocked:false,
      giftsLocked:false,
    }),
  ]);
}

function realtimeNamespaceWithPresentUids(uids=[]){
  const present=new Set(uids);
  return {
    idFromName(roomId){return "room:"+roomId;},
    get(){
      return {
        async fetch(url){
          const uid=new URL(url).searchParams.get("uid");
          return Response.json({ok:true,present:present.has(uid)});
        },
      };
    },
  };
}

test("08-A aggregate Agency Bonus is retired in favor of per-host Target settlement",()=>{
  const result=calculateAgencyMonthlyBonus(policy,{
    supportCoins:1000000,
    activeHostCount:100,
    hasAgency:true,
  });
  assert.equal(result.eligible,false);
  assert.equal(result.agencyBonusBps,0);
  assert.equal(result.agencyBonusCoins,0);
  assert.equal(result.requiredActiveHosts,0);
  assert.equal(result.configuredBonusBps,100);
  assert.equal(result.mode,"per_host_target_month_end");

  assert.throws(
    ()=>calculateAgencyMonthlyBonus(policy,{
      supportCoins:Number.MAX_SAFE_INTEGER+1,
      activeHostCount:10,
      hasAgency:true,
    }),
    /invalid_agency_bonus_support_coins/,
  );
});


test("08-A room gift keeps Agency Bonus deferred even when activity threshold is already met",async()=>{
  await seedConfig();
  const suffix=Date.now().toString()+"_room";
  const senderId="stage08a_sender_"+suffix;
  const receiverId="stage08a_receiver_"+suffix;
  const roomId="stage08a_room_"+suffix;
  const agencyId="stage08a_agency_"+suffix;
  const key="stage08a_room_gift_"+suffix;
  const activeHostIds=Array.from({length:10},(_,index)=>"host_"+index);

  await Promise.all([
    db.collection("users").doc(senderId).set({
      coins:1000000,diamonds:0,role:"user",
    }),
    db.collection("users").doc(receiverId).set({
      coins:0,diamonds:0,role:"user",agencyId,
      giftHostActivityMonth:"2026-09",
      giftHostQualifiedDays:0,
      pendingGiftEarningCoins:0,
    }),
    db.collection("rooms").doc(roomId).set({isActive:true,totalSupport:0}),
    db.collection("users").doc("owner_"+agencyId).set({
      coins:0,diamonds:0,role:"user",accountStatus:"active",
    }),
    db.collection("agencies").doc(agencyId).set({
      agencyId,ownerUid:"owner_"+agencyId,status:"active",
    }),
    db.collection("agency_support_stats").doc(agencyId)
      .collection("monthly").doc("2026-09").set({
        activeHostIds,
        activeHostCount:10,
      }),
  ]);

  const result=await sendRoomGift(
    cloudflareDb,
    senderId,
    {
      roomId,
      receiverId,
      giftId:"stage08a_gift",
      quantity:1,
      idempotencyKey:key,
    },
    {
      now:new Date("2026-09-20T12:00:00.000Z"),
      realtimeNamespace:realtimeNamespaceWithPresentUids([
        senderId,
        receiverId,
      ]),
    },
  );

  assert.equal(result.ok,true);
  assert.equal(result.recipientShareCoins,50000);
  assert.equal(result.agencyShareCoins,5000);
  assert.equal(result.platformShareCoins,45000);

  const transaction=await db.collection("gift_transactions").doc(key).get();
  assert.equal(transaction.data().agencyBaseShareBps,500);
  assert.equal(transaction.data().agencyBonusBps,0);
  assert.equal(transaction.data().agencyBonusDeferredToMonthEnd,true);
  assert.equal(transaction.data().agencyShareBps,500);
  assert.equal(transaction.data().agencyActiveHostCount,0);
  assert.equal(transaction.data().agencyRequiredActiveHosts,0);
});

test("08-A chat gift matches room gift Base Agency Share with Bonus deferred",async()=>{
  await seedConfig();
  const suffix=Date.now().toString()+"_chat";
  const senderId="stage08a_sender_"+suffix;
  const receiverId="stage08a_receiver_"+suffix;
  const conversationId="stage08a_conversation_"+suffix;
  const agencyId="stage08a_agency_"+suffix;
  const key="stage08a_chat_gift_"+suffix;

  await Promise.all([
    db.collection("users").doc(senderId).set({
      coins:1000000,diamonds:0,role:"user",
    }),
    db.collection("users").doc(receiverId).set({
      coins:0,diamonds:0,role:"user",agencyId,
      giftHostActivityMonth:"2026-09",
      giftHostQualifiedDays:0,
      pendingGiftEarningCoins:0,
    }),
    db.collection("conversations").doc(conversationId).set({
      participants:[senderId,receiverId],
      unreadCounts:{[senderId]:0,[receiverId]:0},
    }),
    db.collection("users").doc("owner_"+agencyId).set({
      coins:0,diamonds:0,role:"user",accountStatus:"active",
    }),
    db.collection("agencies").doc(agencyId).set({
      agencyId,ownerUid:"owner_"+agencyId,status:"active",
    }),
    db.collection("agency_support_stats").doc(agencyId)
      .collection("monthly").doc("2026-09").set({
        activeHostIds:Array.from({length:10},(_,index)=>"host_"+index),
        activeHostCount:10,
      }),
  ]);

  const result=await sendChatGift(
    cloudflareDb,
    senderId,
    {
      receiverId,
      giftId:"stage08a_gift",
      quantity:1,
      conversationId,
      idempotencyKey:key,
    },
    {now:new Date("2026-09-20T12:00:00.000Z")},
  );

  assert.equal(result.ok,true);
  assert.equal(result.recipientShareCoins,50000);
  assert.equal(result.agencyShareCoins,5000);
  assert.equal(result.platformShareCoins,45000);

  const transaction=await db.collection("gift_transactions").doc(key).get();
  assert.equal(transaction.data().agencyBonusBps,0);
  assert.equal(transaction.data().agencyBonusDeferredToMonthEnd,true);
  assert.equal(transaction.data().agencyShareBps,500);
});

test("08-A agency active-host marker increments only on first qualified day of month",async()=>{
  await seedConfig();
  const suffix=Date.now().toString()+"_activity";
  const hostUid="stage08a_host_"+suffix;
  const agencyId="stage08a_agency_"+suffix;

  await db.collection("users").doc(hostUid).set({
    role:"user",
    agencyId,
    giftHostActivityMonth:"2026-09",
    giftHostMicSecondsMonth:0,
    giftHostQualifiedDays:0,
  });

  for(const day of [5,6]){
    const end=Date.UTC(2026,8,day,12,0,0);
    await db.runTransaction(async tx=>{
      await recordMicActivity(
        tx,
        db,
        hostUid,
        {muted:false,micStartedAtMs:end-120*60*1000},
        end,
      );
    });
  }

  const [host,agencyMonth,hostMonth]=await Promise.all([
    db.collection("users").doc(hostUid).get(),
    db.collection("agency_support_stats").doc(agencyId)
      .collection("monthly").doc("2026-09").get(),
    db.collection("agency_host_monthly")
      .doc(agencyId+"__2026-09__"+hostUid).get(),
  ]);

  assert.equal(host.data().giftHostQualifiedDays,2);
  assert.equal(host.data().giftHostMicSecondsMonth,2*7200);
  assert.equal(agencyMonth.data().activeHostCount,1);
  assert.deepEqual(agencyMonth.data().activeHostIds,[hostUid]);
  assert.equal(hostMonth.data().activityQualifiedDays,2);
  assert.equal(hostMonth.data().activityRequiredQualifiedDays,14);
  assert.equal(hostMonth.data().activityRequiredMinutesPerDay,120);
});
