import assert from "node:assert/strict";
import {after, test} from "node:test";
import {deleteApp, initializeApp} from "firebase-admin/app";
import {getFirestore} from "firebase-admin/firestore";

import {sendGift as sendChatGift} from "../../cloudflare-worker/src/chat-safety-actions.js";
import {sendRoomGift} from "../../cloudflare-worker/src/room-gift.js";
import {cloudflareFirestoreAdapter} from "./helpers/cloudflare-firestore-adapter.js";

const app=initializeApp(
  {projectId:"shadow-live-economy-test"},
  "agency-stage09a-"+Date.now(),
);
const db=getFirestore(app);
const cloudflareDb=cloudflareFirestoreAdapter(db);

after(async()=>{await deleteApp(app);});

async function seedConfig(){
  await Promise.all([
    db.collection("system_config").doc("gift_catalog").set({
      gifts:[
        {
          id:"stage09a_small",
          nameAr:"هدية 09-A",
          priceCoins:100000,
          enabled:true,
          assetKey:"gifts.placeholder.default",
        },
        {
          id:"stage09a_jump",
          nameAr:"قفزة 09-A",
          priceCoins:400000,
          enabled:true,
          assetKey:"gifts.placeholder.default",
        },
      ],
    }),
    db.collection("system_config").doc("gift_economy").set({
      enabled:true,
      policyMode:"tiered_host_agency",
      coinsPerUsd:10000,
      coinsPerDiamond:10000,
      agencyPerformanceBonusBps:200,
      agencyBonusActiveHosts:10,
      tiers:[
        {id:"starter",nameAr:"Starter",minGiftCoins:0,hostShareBps:5000,agencyShareBps:500},
        {id:"bronze",nameAr:"Bronze",minGiftCoins:1000000,hostShareBps:5700,agencyShareBps:600},
        {id:"silver",nameAr:"Silver",minGiftCoins:5000000,hostShareBps:6000,agencyShareBps:800},
        {id:"gold",nameAr:"Gold",minGiftCoins:20000000,hostShareBps:6200,agencyShareBps:900},
        {id:"diamond",nameAr:"Diamond",minGiftCoins:50000000,hostShareBps:6300,agencyShareBps:1000},
      ],
    }),
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

test("09-A room gift snapshots reached Target threshold in existing host-month document",async()=>{
  await seedConfig();
  const suffix=Date.now().toString()+"_room";
  const senderId="stage09a_sender_"+suffix;
  const hostId="stage09a_host_"+suffix;
  const agencyId="stage09a_agency_"+suffix;
  const roomId="stage09a_room_"+suffix;
  const key="stage09a_room_key_"+suffix;
  const month="2026-09";

  await Promise.all([
    db.collection("users").doc(senderId).set({coins:1000000,diamonds:0,role:"user"}),
    db.collection("users").doc(hostId).set({
      coins:0,diamonds:0,role:"user",agencyId,agencyRole:"host",
      giftHostActivityMonth:month,giftHostQualifiedDays:0,
      pendingGiftEarningCoins:0,pendingAgencyGiftEarningCoins:0,
    }),
    db.collection("rooms").doc(roomId).set({isActive:true,agencyId,totalSupport:0}),
  ]);

  await sendRoomGift(
    cloudflareDb,
    senderId,
    {
      roomId,
      receiverId:hostId,
      giftId:"stage09a_small",
      quantity:1,
      idempotencyKey:key,
    },
    {
      now:new Date("2026-09-20T12:00:00.000Z"),
      realtimeNamespace:realtimeNamespaceWithPresentUids([senderId,hostId]),
    },
  );

  const monthly=await db.collection("agency_host_monthly")
    .doc(agencyId+"__"+month+"__"+hostId).get();
  assert.equal(monthly.data().hostShareCoins,50000);
  assert.equal(monthly.data().targetId,"starter_g");
  assert.equal(monthly.data().targetThresholdCoins,50000);
  assert.equal(monthly.data().salaryPaidDiamonds,5);
});

test("09-A chat gift snapshots the same Target threshold contract",async()=>{
  await seedConfig();
  const suffix=Date.now().toString()+"_chat";
  const senderId="stage09a_sender_"+suffix;
  const hostId="stage09a_host_"+suffix;
  const agencyId="stage09a_agency_"+suffix;
  const conversationId="stage09a_conversation_"+suffix;
  const key="stage09a_chat_key_"+suffix;
  const month="2026-09";

  await Promise.all([
    db.collection("users").doc(senderId).set({coins:1000000,diamonds:0,role:"user"}),
    db.collection("users").doc(hostId).set({
      coins:0,diamonds:0,role:"user",agencyId,agencyRole:"host",
      giftHostActivityMonth:month,giftHostQualifiedDays:0,
      pendingGiftEarningCoins:0,pendingAgencyGiftEarningCoins:0,
    }),
    db.collection("conversations").doc(conversationId).set({
      participants:[senderId,hostId],
      unreadCounts:{[senderId]:0,[hostId]:0},
    }),
  ]);

  await sendChatGift(
    cloudflareDb,
    senderId,
    {
      receiverId:hostId,
      giftId:"stage09a_jump",
      quantity:1,
      conversationId,
      idempotencyKey:key,
    },
    {now:new Date("2026-09-20T12:00:00.000Z")},
  );

  const monthly=await db.collection("agency_host_monthly")
    .doc(agencyId+"__"+month+"__"+hostId).get();
  assert.equal(monthly.data().hostShareCoins,200000);
  assert.equal(monthly.data().targetId,"starter_e");
  assert.equal(monthly.data().targetThresholdCoins,200000);
  assert.equal(monthly.data().salaryPaidDiamonds,20);
});
