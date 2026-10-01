import assert from "node:assert/strict";
import {after, test} from "node:test";
import {deleteApp, initializeApp} from "firebase-admin/app";
import {getFirestore} from "firebase-admin/firestore";

import {sendGift as sendChatGift} from "../../cloudflare-worker/src/chat-safety-actions.js";
import {sendRoomGift} from "../../cloudflare-worker/src/room-gift.js";
import {cloudflareFirestoreAdapter} from "./helpers/cloudflare-firestore-adapter.js";

const app=initializeApp(
  {projectId:"shadow-live-economy-test"},
  "agency-stage06c-"+Date.now(),
);
const db=getFirestore(app);
const cloudflareDb=cloudflareFirestoreAdapter(db);

after(async()=>{await deleteApp(app);});

// Agency business periods close at Asia/Riyadh midnight (UTC+3).
const septemberEnd=new Date("2026-09-30T20:59:59.900Z");
const octoberStart=new Date("2026-09-30T21:00:00.100Z");

function agencyAccrualShard(value){
  const text=String(value??"").trim();
  let hash=2166136261;
  for(let index=0;index<text.length;index+=1){
    hash^=text.charCodeAt(index);
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

function abortFirstCommit(base){
  let commits=0;
  return {
    ...base,
    async commit(transaction,writes){
      commits+=1;
      if(commits===1){
        await base.rollback(transaction);
        throw new Error("ABORTED");
      }
      return base.commit(transaction,writes);
    },
  };
}

const approvedPolicy={
  enabled:true,
  policyMode:"tiered_host_agency",
  coinsPerUsd:10000,
  coinsPerDiamond:10000,
  hostPerformanceBonusBps:0,
  agencyPerformanceBonusBps:100,
  agencyPerformanceBonusMode:"per_host_target_month_end",
  hostBonusQualifiedDays:14,
  hostBonusMinutesPerQualifiedDay:120,
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
        id:"stage06c_monthly",
        nameAr:"هدية دورة الشهر",
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

test("06-C room target lifecycle resets at Riyadh month boundary and preserves both Agency monthly histories",async()=>{
  await seedSharedConfig();
  const suffix=Date.now().toString()+"_room";
  const senderId="stage06c_sender_"+suffix;
  const hostId="stage06c_host_"+suffix;
  const agencyId="stage06c_agency_"+suffix;
  const roomId="stage06c_room_"+suffix;
  const septemberKey="stage06c_sep_"+suffix;
  const octoberKey="stage06c_oct_"+suffix;

  await Promise.all([
    db.collection("users").doc(senderId).set({
      coins:500000,diamonds:0,role:"user",
    }),
    db.collection("users").doc(hostId).set({
      coins:0,diamonds:0,role:"user",agencyId,agencyRole:"host",
      pendingGiftEarningCoins:0,pendingAgencyGiftEarningCoins:0,
    }),
    db.collection("rooms").doc(roomId).set({
      isActive:true,agencyId,totalSupport:0,
    }),
  ]);

  const presence=realtimeNamespaceWithPresentUids([senderId,hostId]);
  const september=await sendRoomGift(cloudflareDb,senderId,{
    roomId,
    receiverId:hostId,
    giftId:"stage06c_monthly",
    quantity:1,
    idempotencyKey:septemberKey,
  },{
    realtimeNamespace:presence,
    now:septemberEnd,
  });

  assert.equal(september.agencyTargetMonth,"2026-09");
  assert.equal(september.agencyTargetProgressCoins,50000);
  assert.equal(september.salaryDeltaDiamonds,5);
  assert.equal(september.agencySalaryPaidDiamonds,5);

  const october=await sendRoomGift(cloudflareDb,senderId,{
    roomId,
    receiverId:hostId,
    giftId:"stage06c_monthly",
    quantity:1,
    idempotencyKey:octoberKey,
  },{
    realtimeNamespace:presence,
    now:octoberStart,
  });

  assert.equal(october.agencyTargetMonth,"2026-10");
  assert.equal(october.agencyTargetProgressCoins,50000);
  assert.equal(october.salaryDeltaDiamonds,5);
  assert.equal(october.agencySalaryPaidDiamonds,5);

  const septemberShard=agencyAccrualShard(septemberKey);
  const octoberShard=agencyAccrualShard(octoberKey);
  const [
    host,
    septemberHost,
    octoberHost,
    septemberShardDoc,
    octoberShardDoc,
    septemberRoomSupport,
    septemberTx,
    octoberTx,
    septemberLedger,
    octoberLedger,
    room,
  ]=await Promise.all([
    db.collection("users").doc(hostId).get(),
    db.collection("agency_host_monthly")
      .doc(agencyId+"__2026-09__"+hostId).get(),
    db.collection("agency_host_monthly")
      .doc(agencyId+"__2026-10__"+hostId).get(),
    db.collection("agency_monthly_accrual_shards")
      .doc(agencyId+"__2026-09__"+String(septemberShard).padStart(2,"0")).get(),
    db.collection("agency_monthly_accrual_shards")
      .doc(agencyId+"__2026-10__"+String(octoberShard).padStart(2,"0")).get(),
    db.collection("rooms").doc(roomId)
      .collection("support_monthly").doc("2026-09").get(),
    db.collection("gift_transactions").doc(septemberKey).get(),
    db.collection("gift_transactions").doc(octoberKey).get(),
    db.collection("financial_ledger").doc("gift_earnings_"+septemberKey).get(),
    db.collection("financial_ledger").doc("gift_earnings_"+octoberKey).get(),
    db.collection("rooms").doc(roomId).get(),
  ]);

  assert.equal(host.data().agencyTargetMonth,"2026-10");
  assert.equal(host.data().agencyTargetProgressCoins,50000);
  assert.equal(host.data().agencySalaryPaidDiamonds,5);
  assert.equal(host.data().giftRevenueMonth,"2026-10");
  assert.equal(host.data().giftRevenueMonthCoins,100000);
  assert.equal(host.data().diamonds,10);

  assert.equal(septemberHost.data().month,"2026-09");
  assert.equal(septemberHost.data().hostShareCoins,50000);
  assert.equal(septemberHost.data().salaryPaidDiamonds,5);
  assert.equal(octoberHost.data().month,"2026-10");
  assert.equal(octoberHost.data().hostShareCoins,50000);
  assert.equal(octoberHost.data().salaryPaidDiamonds,5);

  assert.equal(septemberShardDoc.data().supportCoins,100000);
  assert.equal(septemberShardDoc.data().hostShareCoins,50000);
  assert.equal(octoberShardDoc.data().supportCoins,100000);
  assert.equal(octoberShardDoc.data().hostShareCoins,50000);
  // Generic room-support analytics remain UTC by design, so both writes are
  // still in September UTC while Agency accounting has already rolled over.
  assert.equal(septemberRoomSupport.data().supportCoins,200000);

  assert.equal(septemberTx.data().periods.month,"2026-09");
  assert.equal(octoberTx.data().periods.month,"2026-09");
  assert.equal(septemberTx.data().agencyTargetMonth,"2026-09");
  assert.equal(octoberTx.data().agencyTargetMonth,"2026-10");
  assert.equal(septemberLedger.data().month,"2026-09");
  assert.equal(octoberLedger.data().month,"2026-10");
  assert.equal(septemberLedger.data().delta,5);
  assert.equal(octoberLedger.data().delta,5);
  assert.equal(
    room.data().totalSupport,
    0,
    "06-C must keep high-frequency support off the room root",
  );
});

test("06-C a transaction retry that crosses Riyadh midnight recomputes the Agency month instead of committing stale keys",async()=>{
  await seedSharedConfig();
  const suffix=Date.now().toString()+"_retry";
  const senderId="stage06c_retry_sender_"+suffix;
  const hostId="stage06c_retry_host_"+suffix;
  const agencyId="stage06c_retry_agency_"+suffix;
  const roomId="stage06c_retry_room_"+suffix;
  const key="stage06c_retry_key_"+suffix;
  const presence=realtimeNamespaceWithPresentUids([senderId,hostId]);

  await Promise.all([
    db.collection("users").doc(senderId).set({
      coins:300000,diamonds:0,role:"user",
    }),
    db.collection("users").doc(hostId).set({
      coins:0,diamonds:0,role:"user",agencyId,agencyRole:"host",
      agencyTargetMonth:"2026-09",
      agencyTargetProgressCoins:50000,
      agencySalaryPaidDiamonds:5,
      agencyCurrentTargetId:"starter_g",
      agencyNextTargetCoins:50000,
      giftRevenueMonth:"2026-09",
      giftRevenueMonthCoins:100000,
      pendingGiftEarningCoins:0,
      pendingAgencyGiftEarningCoins:0,
    }),
    db.collection("rooms").doc(roomId).set({
      isActive:true,agencyId,totalSupport:0,
    }),
  ]);

  const dates=[septemberEnd,octoberStart];
  let clockCalls=0;
  const retryDb=abortFirstCommit(cloudflareDb);
  const result=await sendRoomGift(retryDb,senderId,{
    roomId,
    receiverId:hostId,
    giftId:"stage06c_monthly",
    quantity:1,
    idempotencyKey:key,
  },{
    realtimeNamespace:presence,
    now:()=>{
      const value=dates[Math.min(clockCalls,dates.length-1)];
      clockCalls+=1;
      return value;
    },
  });

  assert.equal(result._transactionAttempts,2);
  assert.equal(clockCalls,2);
  assert.equal(result.agencyTargetMonth,"2026-10");
  assert.equal(result.agencyTargetProgressCoins,50000);
  assert.equal(result.salaryDeltaDiamonds,5);

  const shard=agencyAccrualShard(key);
  const [
    host,
    transaction,
    septemberHost,
    octoberHost,
    septemberShard,
    octoberShard,
  ]=await Promise.all([
    db.collection("users").doc(hostId).get(),
    db.collection("gift_transactions").doc(key).get(),
    db.collection("agency_host_monthly")
      .doc(agencyId+"__2026-09__"+hostId).get(),
    db.collection("agency_host_monthly")
      .doc(agencyId+"__2026-10__"+hostId).get(),
    db.collection("agency_monthly_accrual_shards")
      .doc(agencyId+"__2026-09__"+String(shard).padStart(2,"0")).get(),
    db.collection("agency_monthly_accrual_shards")
      .doc(agencyId+"__2026-10__"+String(shard).padStart(2,"0")).get(),
  ]);

  assert.equal(host.data().agencyTargetMonth,"2026-10");
  assert.equal(host.data().agencySalaryPaidDiamonds,5);
  assert.equal(host.data().diamonds,5);
  assert.equal(transaction.data().periods.month,"2026-09");
  assert.equal(transaction.data().agencyTargetMonth,"2026-10");
  assert.equal(septemberHost.exists,false);
  assert.equal(septemberShard.exists,false);
  assert.equal(octoberHost.data().salaryPaidDiamonds,5);
  assert.equal(octoberShard.data().hostShareCoins,50000);
});

test("06-C chat gifts use the same Riyadh Agency rollover and keep prior-month host history",async()=>{
  await seedSharedConfig();
  const suffix=Date.now().toString()+"_chat";
  const senderId="stage06c_chat_sender_"+suffix;
  const hostId="stage06c_chat_host_"+suffix;
  const agencyId="stage06c_chat_agency_"+suffix;
  const conversationId="stage06c_chat_conversation_"+suffix;
  const septemberKey="stage06c_chat_sep_"+suffix;
  const octoberKey="stage06c_chat_oct_"+suffix;

  await Promise.all([
    db.collection("users").doc(senderId).set({
      coins:500000,diamonds:0,role:"user",
    }),
    db.collection("users").doc(hostId).set({
      coins:0,diamonds:0,role:"user",agencyId,agencyRole:"host",
      pendingGiftEarningCoins:0,pendingAgencyGiftEarningCoins:0,
    }),
    db.collection("conversations").doc(conversationId).set({
      participants:[senderId,hostId],
      unreadCounts:{[senderId]:0,[hostId]:0},
    }),
  ]);

  const september=await sendChatGift(cloudflareDb,senderId,{
    receiverId:hostId,
    giftId:"stage06c_monthly",
    quantity:1,
    conversationId,
    idempotencyKey:septemberKey,
  },{now:septemberEnd});
  const october=await sendChatGift(cloudflareDb,senderId,{
    receiverId:hostId,
    giftId:"stage06c_monthly",
    quantity:1,
    conversationId,
    idempotencyKey:octoberKey,
  },{now:octoberStart});

  assert.equal(september.agencyTargetMonth,"2026-09");
  assert.equal(october.agencyTargetMonth,"2026-10");
  assert.equal(september.salaryDeltaDiamonds,5);
  assert.equal(october.salaryDeltaDiamonds,5);

  const [host,septemberHost,octoberHost,septemberTx,octoberTx]=await Promise.all([
    db.collection("users").doc(hostId).get(),
    db.collection("agency_host_monthly")
      .doc(agencyId+"__2026-09__"+hostId).get(),
    db.collection("agency_host_monthly")
      .doc(agencyId+"__2026-10__"+hostId).get(),
    db.collection("gift_transactions").doc(septemberKey).get(),
    db.collection("gift_transactions").doc(octoberKey).get(),
  ]);

  assert.equal(host.data().agencyTargetMonth,"2026-10");
  assert.equal(host.data().agencyTargetProgressCoins,50000);
  assert.equal(host.data().agencySalaryPaidDiamonds,5);
  assert.equal(host.data().diamonds,10);
  assert.equal(septemberHost.data().salaryPaidDiamonds,5);
  assert.equal(octoberHost.data().salaryPaidDiamonds,5);
  assert.equal(septemberTx.data().contextType,"chat");
  assert.equal(septemberTx.data().periods.month,"2026-09");
  assert.equal(septemberTx.data().agencyTargetMonth,"2026-09");
  assert.equal(octoberTx.data().contextType,"chat");
  assert.equal(octoberTx.data().periods.month,"2026-09");
  assert.equal(octoberTx.data().agencyTargetMonth,"2026-10");
});
