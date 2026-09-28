import assert from "node:assert/strict";
import {after, test} from "node:test";
import {deleteApp, initializeApp} from "firebase-admin/app";
import {getFirestore} from "firebase-admin/firestore";

import {sendRoomGift} from "../../cloudflare-worker/src/room-gift.js";
import {cloudflareFirestoreAdapter} from "./helpers/cloudflare-firestore-adapter.js";

const app=initializeApp(
  {projectId:"shadow-live-economy-test"},
  "agency-stage06a-"+Date.now(),
);
const db=getFirestore(app);
const cloudflareDb=cloudflareFirestoreAdapter(db);

after(async()=>{await deleteApp(app);});

function monthKey(date=new Date()){
  return date.toISOString().slice(0,7);
}

function agencyAccrualShard(value){
  const text=String(value??"").trim();
  let hash=2166136261;
  for(let i=0;i<text.length;i++){
    hash^=text.charCodeAt(i);
    hash=Math.imul(hash,16777619);
  }
  return (hash>>>0)%32;
}

function realtimeNamespaceWithPresentUids(uids=[]){
  const present=new Set(uids);
  return {
    idFromName(roomId){return `room:${roomId}`;},
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

const approvedPolicy={
  enabled:true,
  policyMode:"tiered_host_agency",
  coinsPerUsd:10000,
  coinsPerDiamond:10000,
  hostPerformanceBonusBps:200,
  agencyPerformanceBonusBps:200,
  hostBonusQualifiedDays:9,
  hostBonusMinutesPerQualifiedDay:120,
  agencyBonusActiveHosts:10,
  activityPayoutBpsByQualifiedDays:{
    "0":0,"1":0,"2":0,"3":2500,"4":4000,
    "5":5500,"6":7000,"7":8000,"8":9000,"9":10000,
  },
  tiers:[
    {id:"starter",nameAr:"Starter",minGiftCoins:0,hostShareBps:5000,agencyShareBps:500},
    {id:"bronze",nameAr:"Bronze",minGiftCoins:1000000,hostShareBps:5700,agencyShareBps:600},
    {id:"silver",nameAr:"Silver",minGiftCoins:5000000,hostShareBps:6000,agencyShareBps:800},
    {id:"gold",nameAr:"Gold",minGiftCoins:20000000,hostShareBps:6200,agencyShareBps:900},
    {id:"diamond",nameAr:"Diamond",minGiftCoins:50000000,hostShareBps:6300,agencyShareBps:1000},
  ],
};

async function seedSharedConfig(){
  await Promise.all([
    db.collection("system_config").doc("gift_catalog").set({
      gifts:[{
        id:"stage06a_gift",
        nameAr:"هدية 06-A",
        priceCoins:100000,
        enabled:true,
        assetKey:"gifts.placeholder.default",
      }],
    }),
    db.collection("system_config").doc("gift_economy").set(approvedPolicy),
    db.collection("system_config").doc("emergency_lock").set({
      enabled:false,
      economyLocked:false,
      giftsLocked:false,
    }),
  ]);
}

test("06-A Agency Owner as Host uses Host Share target progress with sharded idempotent accrual",async()=>{
  await seedSharedConfig();
  const suffix=Date.now().toString();
  const senderId="stage06a_sender_"+suffix;
  const ownerId="stage06a_owner_"+suffix;
  const agencyId="stage06a_agency_"+suffix;
  const roomId="stage06a_room_"+suffix;
  const key="stage06a_roomgift_"+suffix;
  const month=monthKey();
  const shard=agencyAccrualShard(key);
  const shardId=
    agencyId+"__"+month+"__"+String(shard).padStart(2,"0");

  await Promise.all([
    db.collection("users").doc(senderId).set({
      coins:1000000,
      diamonds:0,
      role:"user",
    }),
    db.collection("users").doc(ownerId).set({
      coins:0,
      diamonds:0,
      role:"user",
      agencyId,
      agencyRole:"owner",
      giftHostActivityMonth:month,
      giftHostQualifiedDays:0,
      pendingAgencyGiftEarningCoins:0,
      pendingGiftEarningCoins:0,
    }),
    db.collection("rooms").doc(roomId).set({
      isActive:true,
      agencyId,
      totalSupport:0,
    }),
    db.collection("agency_support_stats").doc(agencyId)
      .collection("monthly").doc(month).set({activeHostIds:[]}),
  ]);

  const body={
    roomId,
    receiverId:ownerId,
    giftId:"stage06a_gift",
    quantity:1,
    idempotencyKey:key,
  };
  const first=await sendRoomGift(
    cloudflareDb,
    senderId,
    body,
    {realtimeNamespace:realtimeNamespaceWithPresentUids([senderId,ownerId])},
  );

  assert.equal(first.ok,true);
  assert.equal(first.totalCost,100000);
  assert.equal(first.recipientShareCoins,50000);
  assert.equal(first.agencyTargetId,"starter_g");
  assert.equal(first.diamondsEarned,5);

  const [owner,hostMonth,accrual,room]=await Promise.all([
    db.collection("users").doc(ownerId).get(),
    db.collection("agency_host_monthly")
      .doc(agencyId+"__"+month+"__"+ownerId).get(),
    db.collection("agency_monthly_accrual_shards").doc(shardId).get(),
    db.collection("rooms").doc(roomId).get(),
  ]);

  assert.equal(owner.data().agencyRole,"owner");
  assert.equal(owner.data().agencyTargetMonth,month);
  assert.equal(owner.data().agencyTargetProgressCoins,50000);
  assert.equal(owner.data().agencyCurrentTargetId,"starter_g");
  assert.equal(owner.data().agencyNextTargetCoins,50000);
  assert.equal(owner.data().agencySalaryPaidDiamonds,5);
  assert.equal(hostMonth.data().hostShareCoins,50000);
  assert.equal(accrual.data().hostShareCoins,50000);
  assert.equal(accrual.data().supportCoins,100000);
  assert.equal(
    room.data().totalSupport,
    0,
    "high-frequency gift support must not write back to rooms/{roomId}",
  );

  const duplicate=await sendRoomGift(
    cloudflareDb,
    senderId,
    body,
    {realtimeNamespace:realtimeNamespaceWithPresentUids([])},
  );
  assert.equal(duplicate.code,"duplicate");

  const [ownerAfter,accrualAfter]=await Promise.all([
    db.collection("users").doc(ownerId).get(),
    db.collection("agency_monthly_accrual_shards").doc(shardId).get(),
  ]);
  assert.equal(ownerAfter.data().agencyTargetProgressCoins,50000);
  assert.equal(ownerAfter.data().agencySalaryPaidDiamonds,5);
  assert.equal(accrualAfter.data().hostShareCoins,50000);
  assert.equal(accrualAfter.data().supportCoins,100000);
});
