import assert from "node:assert/strict";
import {after, test} from "node:test";
import {deleteApp, getApps, initializeApp} from "firebase-admin/app";
import {getFirestore} from "firebase-admin/firestore";

import {sendGift as sendChatGift} from "../../cloudflare-worker/src/chat-safety-actions.js";
import {settleAgencyCycle} from "../economy/economy-control.js";
import {saveGiftEconomyPolicy} from "../economy/gift-economy-config.js";
import {calculateAgencyCycleSettlement} from "../economy/economy-policy.js";
import {sendRoomGift} from "../../cloudflare-worker/src/room-gift.js";
import {recordMicActivity} from "../economy/mic-activity-admin.js";
import {cloudflareFirestoreAdapter} from "./helpers/cloudflare-firestore-adapter.js";

const app=getApps()[0]||initializeApp({projectId:"shadow-live-economy-test"});
const db=getFirestore(app);
const cloudflareDb=cloudflareFirestoreAdapter(db);

after(async()=>{await deleteApp(app);});

function periodKeys(date=new Date()){
  const day=date.toISOString().slice(0,10);
  const month=day.slice(0,7);
  return {
    day,
    month,
    cycle:month+"-"+(date.getUTCDate()<=15?"C1":"C2"),
  };
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
    {id:"starter",nameAr:"Starter",minGiftCoins:0,hostShareBps:5500,agencyShareBps:500},
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
        id:"integration_gift",
        nameAr:"هدية اختبار",
        priceCoins:100000,
        enabled:true,
        assetKey:"gifts.placeholder.default",
      }],
    }),
    db.collection("system_config").doc("gift_economy").set(approvedPolicy),
    db.collection("system_config").doc("emergency_lock").set({
      enabled:false,economyLocked:false,giftsLocked:false,
    }),
  ]);
}

test("room gift debits once and records transaction ledger agency link and accrual",async()=>{
  await seedSharedConfig();
  const periods=periodKeys();
  const suffix=Date.now().toString()+"_room";
  const senderId="sender_"+suffix;
  const receiverId="receiver_"+suffix;
  const roomId="room_"+suffix;
  const agencyId="agency_"+suffix;
  const roomAgencyId="other_room_agency_"+suffix;
  const key="roomgift_integration_"+suffix;

  await Promise.all([
    db.collection("users").doc(senderId).set({
      coins:1000000,diamonds:0,role:"user",
    }),
    db.collection("users").doc(receiverId).set({
      coins:0,diamonds:0,role:"user",agencyId,
      giftHostActivityMonth:periods.month,
      giftHostQualifiedDays:0,
      pendingAgencyGiftEarningCoins:0,
      pendingGiftEarningCoins:0,
    }),
    db.collection("rooms").doc(roomId).set({
      isActive:true,agencyId:roomAgencyId,totalSupport:0,
    }),
    db.collection("agency_support_stats").doc(agencyId).collection("monthly").doc(periods.month).set({
      activeHostIds:[],
    }),
  ]);

  const body={
    roomId,receiverId,giftId:"integration_gift",quantity:1,idempotencyKey:key,
  };
  const first=await sendRoomGift(
    cloudflareDb,
    senderId,
    body,
    {
      realtimeNamespace:realtimeNamespaceWithPresentUids([
        senderId,
        receiverId,
      ]),
    },
  );
  assert.equal(first.ok,true);
  assert.equal(first.code,"ok");
  assert.equal(first.totalCost,100000);
  assert.equal(first.recipientShareCoins,55000);
  assert.equal(first.agencyShareCoins,5000);
  assert.equal(first.platformShareCoins,40000);
  assert.equal(first.earningsStatus,"accrued_for_cycle");

  const [sender,receiver,transaction,ledger,operation,accrual,rocketState,rocketExplosion]=await Promise.all([
    db.collection("users").doc(senderId).get(),
    db.collection("users").doc(receiverId).get(),
    db.collection("gift_transactions").doc(key).get(),
    db.collection("financial_ledger").doc("gift_"+key).get(),
    db.collection("gift_operations").doc(key).get(),
    db.collection("agency_settlement_accruals").doc(
      agencyId+"__"+periods.cycle+"__"+receiverId,
    ).get(),
    db.collection("room_rocket_state").doc(roomId).get(),
    db.collection("room_rocket_explosions").doc(key+"_rocket_1").get(),
  ]);
  assert.equal(sender.data().coins,900000);
  assert.equal(receiver.data().pendingAgencyGiftEarningCoins,55000);
  assert.equal(transaction.data().contextType,"room");
  assert.equal(transaction.data().agencyId,agencyId);
  assert.notEqual(transaction.data().agencyId,roomAgencyId);
  assert.equal(transaction.data().recipientShareCoins,55000);
  assert.equal(transaction.data().agencyShareCoins,5000);
  assert.equal(transaction.data().platformShareCoins,40000);
  assert.equal(ledger.data().delta,-100000);
  assert.equal(operation.data().status,"completed");
  assert.equal(rocketState.exists,true);
  assert.equal(rocketState.data().currentLevel,2);
  assert.equal(rocketState.data().progressCoins,0);
  assert.equal(rocketExplosion.exists,true);
  assert.equal(rocketExplosion.data().level,1);
  assert.equal(rocketExplosion.data().triggerUid,senderId);
  assert.equal(accrual.data().supportCoins,100000);
  assert.equal(accrual.data().hostGrossEarningCoins,55000);
  assert.equal(accrual.data().agencyGrossEarningCoins,5000);
  assert.equal(accrual.data().platformShareCoins,40000);

  const duplicate=await sendRoomGift(
    cloudflareDb,
    senderId,
    body,
    {realtimeNamespace:realtimeNamespaceWithPresentUids([])},
  );
  assert.equal(
    duplicate.code,
    "duplicate",
    "duplicate remains idempotent after realtime presence changes",
  );
  const [senderAfter,accrualAfter]=await Promise.all([
    db.collection("users").doc(senderId).get(),
    db.collection("agency_settlement_accruals").doc(
      agencyId+"__"+periods.cycle+"__"+receiverId,
    ).get(),
  ]);
  assert.equal(senderAfter.data().coins,900000);
  assert.equal(accrualAfter.data().supportCoins,100000);
  const explosionsAfter=await db.collection("room_rocket_explosions")
    .where("operationId","==",key).get();
  assert.equal(explosionsAfter.size,1);
});

test("chat gift uses the same economy shares and duplicate protection as room gifts",async()=>{
  await seedSharedConfig();
  const periods=periodKeys();
  const suffix=Date.now().toString()+"_chat";
  const senderId="sender_"+suffix;
  const receiverId="receiver_"+suffix;
  const conversationId="conversation_"+suffix;
  const agencyId="agency_"+suffix;
  const key="chatgift_integration_"+suffix;

  await Promise.all([
    db.collection("users").doc(senderId).set({
      coins:1000000,diamonds:0,role:"user",
    }),
    db.collection("users").doc(receiverId).set({
      coins:0,diamonds:0,role:"user",agencyId,
      giftHostActivityMonth:periods.month,
      giftHostQualifiedDays:0,
      pendingAgencyGiftEarningCoins:0,
      pendingGiftEarningCoins:0,
    }),
    db.collection("conversations").doc(conversationId).set({
      participants:[senderId,receiverId],
      unreadCounts:{[senderId]:0,[receiverId]:0},
    }),
    db.collection("agency_support_stats").doc(agencyId).collection("monthly").doc(periods.month).set({
      activeHostIds:[],
    }),
  ]);

  const body={
    receiverId,giftId:"integration_gift",quantity:1,
    conversationId,idempotencyKey:key,
  };
  const first=await sendChatGift(cloudflareDb,senderId,body);
  assert.equal(first.ok,true);
  assert.equal(first.code,"ok");
  assert.equal(first.totalCost,100000);
  assert.equal(first.recipientShareCoins,55000);
  assert.equal(first.agencyShareCoins,5000);
  assert.equal(first.platformShareCoins,40000);

  const [sender,transaction,ledger,accrual]=await Promise.all([
    db.collection("users").doc(senderId).get(),
    db.collection("gift_transactions").doc(key).get(),
    db.collection("financial_ledger").doc("gift_"+key).get(),
    db.collection("agency_settlement_accruals").doc(
      agencyId+"__"+periods.cycle+"__"+receiverId,
    ).get(),
  ]);
  assert.equal(sender.data().coins,900000);
  assert.equal(transaction.data().contextType,"chat");
  assert.equal(transaction.data().agencyId,agencyId);
  assert.equal(transaction.data().recipientShareCoins,55000);
  assert.equal(transaction.data().agencyShareCoins,5000);
  assert.equal(transaction.data().platformShareCoins,40000);
  assert.equal(ledger.data().delta,-100000);
  assert.equal(accrual.data().hostGrossEarningCoins,55000);
  const chatRocketState=await db.collection("room_rocket_state").doc(conversationId).get();
  assert.equal(chatRocketState.exists,false);

  const duplicate=await sendChatGift(cloudflareDb,senderId,body);
  assert.equal(duplicate.code,"duplicate");
  const senderAfter=await db.collection("users").doc(senderId).get();
  assert.equal(senderAfter.data().coins,900000);
});

test("room gift is rejected when either user has blocked the other",async()=>{
  await seedSharedConfig();
  const suffix=Date.now().toString()+"_blocked";
  const senderId="sender_"+suffix;
  const receiverId="receiver_"+suffix;
  const roomId="room_"+suffix;
  const key="roomgift_blocked_"+suffix;

  await Promise.all([
    db.collection("users").doc(senderId).set({
      coins:1000000,diamonds:0,role:"user",
    }),
    db.collection("users").doc(receiverId).set({
      coins:0,diamonds:0,role:"user",
    }),
    db.collection("rooms").doc(roomId).set({isActive:true,totalSupport:0}),
    db.collection("room_presence").doc(roomId).collection("users").doc(senderId).set({
      lastSeenAtMs:Date.now(),displayName:"Sender",
    }),
    db.collection("room_presence").doc(roomId).collection("users").doc(receiverId).set({
      lastSeenAtMs:Date.now(),displayName:"Receiver",
    }),
    db.collection("user_blocks").doc(receiverId).collection("items").doc(senderId).set({
      blockedAt:Date.now(),
    }),
  ]);

  await assert.rejects(
    sendRoomGift(cloudflareDb,senderId,{
      roomId,
      receiverId,
      giftId:"integration_gift",
      quantity:1,
      idempotencyKey:key,
    }),
    /blocked/,
  );

  const [sender,tx,ledger,op]=await Promise.all([
    db.collection("users").doc(senderId).get(),
    db.collection("gift_transactions").doc(key).get(),
    db.collection("financial_ledger").doc("gift_"+key).get(),
    db.collection("gift_operations").doc(key).get(),
  ]);
  assert.equal(sender.data().coins,1000000);
  assert.equal(tx.exists,false);
  assert.equal(ledger.exists,false);
  assert.equal(op.exists,false);
});

test("real unmuted mic time qualifies 120-minute days and accumulates 9 cycle days",async()=>{
  await seedSharedConfig();
  const periods=periodKeys();
  const suffix=Date.now().toString()+"_activity";
  const hostUid="host_"+suffix;
  const agencyId="agency_"+suffix;
  const [year,monthNumber]=periods.month.split("-").map(Number);
  const cycleStart=new Date().getUTCDate()<=15?1:16;

  await db.collection("users").doc(hostUid).set({
    role:"user",
    agencyId,
    giftHostActivityMonth:periods.month,
    giftHostMicSecondsMonth:0,
    giftHostQualifiedDays:0,
  });

  const mutedEnd=Date.UTC(year,monthNumber-1,cycleStart,9,0,0);
  await db.runTransaction(async tx=>{
    await recordMicActivity(
      tx,
      db,
      hostUid,
      {muted:true,micStartedAtMs:mutedEnd-2*60*60*1000},
      mutedEnd,
    );
  });
  let host=await db.collection("users").doc(hostUid).get();
  assert.equal(host.data().giftHostMicSecondsMonth,0);
  assert.equal(host.data().giftHostQualifiedDays,0);

  for(let i=0;i<9;i++){
    const end=Date.UTC(year,monthNumber-1,cycleStart+i,12,0,0);
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

  host=await db.collection("users").doc(hostUid).get();
  assert.equal(host.data().giftHostMicSecondsMonth,9*7200);
  assert.equal(host.data().giftHostQualifiedDays,9);

  const firstDay=periods.month+"-"+String(cycleStart).padStart(2,"0");
  const firstActivity=await db.collection("host_mic_activity")
    .doc(hostUid).collection("days").doc(firstDay).get();
  assert.equal(firstActivity.data().micSeconds,7200);
  assert.equal(firstActivity.data().qualified,true);
  assert.equal(firstActivity.data().requiredMinutes,120);

  const agencyMonth=await db.collection("agency_support_stats")
    .doc(agencyId).collection("monthly").doc(periods.month).get();
  assert.deepEqual(agencyMonth.data().activeHostIds,[hostUid]);
});

test("Shadow Control policy save persists custom values and runtime calculations use them",async()=>{
  const custom={
    policyMode:"tiered_host_agency",
    enabled:true,
    hostPerformanceBonusBps:300,
    agencyPerformanceBonusBps:100,
    hostBonusQualifiedDays:5,
    hostBonusMinutesPerQualifiedDay:90,
    agencyBonusActiveHosts:3,
    activityPayoutBpsByQualifiedDays:{
      "0":0,"1":0,"2":0,"3":2500,"4":4000,
      "5":5500,"6":7000,"7":8000,"8":9000,"9":10000,
    },
    tiers:[
      {id:"starter",nameAr:"Starter",minGiftCoins:0,hostShareBps:5000,agencyShareBps:400},
      {id:"custom",nameAr:"Custom",minGiftCoins:200000,hostShareBps:6100,agencyShareBps:700},
    ],
  };
  const saved=await saveGiftEconomyPolicy(db,"shadow_control_test",custom);
  const stored=await db.collection("system_config").doc("gift_economy").get();
  assert.equal(saved.hostBonusMinutesPerQualifiedDay,90);
  assert.equal(stored.data().hostPerformanceBonusBps,300);
  assert.equal(stored.data().agencyBonusActiveHosts,3);
  assert.equal(stored.data().tiers[1].minGiftCoins,200000);

  const result=calculateAgencyCycleSettlement(stored.data(),{
    monthlyGrossCoins:250000,
    supportCoins:250000,
    qualifiedDays:9,
    activeHostCount:3,
    hasAgency:true,
  });
  assert.equal(result.tierId,"custom");
  assert.equal(result.hostShareBps,6400);
  assert.equal(result.agencyShareBps,800);
  assert.equal(result.hostPayableCoins,160000);
  assert.equal(result.agencyPayableCoins,20000);
  assert.equal(result.platformCoins,70000);

  const audit=await db.collection("admin_audit_logs")
    .where("actorUid","==","shadow_control_test")
    .where("action","==","updateGiftEconomyPolicy")
    .get();
  assert.equal(audit.empty,false);
});

test("cycle settlement pays final monthly tier and bonuses even above provisional accrual, then stays idempotent",async()=>{
  await seedSharedConfig();
  const periods=periodKeys();
  const suffix=Date.now().toString()+"_settlement";
  const hostUid="host_"+suffix;
  const agencyId="agency_"+suffix;
  const actorUid="owner_"+suffix;
  const accrualId=agencyId+"__"+periods.cycle+"__"+hostUid;
  const cycleStart=new Date().getUTCDate()<=15?1:16;

  const activityWrites=[];
  for(let i=0;i<9;i++){
    const day=periods.month+"-"+String(cycleStart+i).padStart(2,"0");
    activityWrites.push(
      db.collection("host_mic_activity").doc(hostUid).collection("days").doc(day).set({
        day,micSeconds:7200,qualified:true,requiredMinutes:120,
      }),
    );
  }

  await Promise.all([
    ...activityWrites,
    db.collection("users").doc(hostUid).set({
      coins:0,
      diamonds:0,
      role:"user",
      agencyId,
      giftRevenueMonth:periods.month,
      giftRevenueMonthCoins:1000000,
      pendingAgencyGiftEarningCoins:550000,
      pendingGiftEarningCoins:1500,
      giftDiamondsLifetime:0,
    }),
    db.collection("agency_support_stats").doc(agencyId).collection("monthly").doc(periods.month).set({
      activeHostIds:Array.from({length:10},(_,i)=>"active_"+i),
    }),
    db.collection("agency_settlement_accruals").doc(accrualId).set({
      agencyId,
      hostUid,
      cycleKey:periods.cycle,
      month:periods.month,
      supportCoins:1000000,
      hostGrossEarningCoins:550000,
      agencyGrossEarningCoins:50000,
      platformShareCoins:400000,
      giftCount:10,
      status:"open",
    }),
  ]);

  const first=await settleAgencyCycle(db,actorUid,accrualId);
  assert.equal(first.alreadySettled,false);
  const settlement=first.settlement;
  assert.equal(settlement.tierId,"bronze");
  assert.equal(settlement.qualifiedDays,9);
  assert.equal(settlement.activityPayoutBps,10000);
  assert.equal(settlement.hostShareBps,5900);
  assert.equal(settlement.agencyShareBps,800);
  assert.equal(settlement.hostPayableCoins,590000);
  assert.equal(settlement.agencyPayableCoins,80000);
  assert.equal(settlement.platformCoins,330000);
  assert.equal(settlement.provisionalHostAccruedCoins,550000);
  assert.equal(settlement.hostAccrualAdjustmentCoins,40000);
  assert.equal(settlement.hostDiamonds,59);
  assert.equal(settlement.hostRemainderCoins,1500);

  const [host,stored,accrual,ledger]=await Promise.all([
    db.collection("users").doc(hostUid).get(),
    db.collection("agency_settlements").doc(accrualId).get(),
    db.collection("agency_settlement_accruals").doc(accrualId).get(),
    db.collection("financial_ledger").doc("agency_settlement_"+accrualId).get(),
  ]);
  assert.equal(host.data().pendingAgencyGiftEarningCoins,0);
  assert.equal(host.data().pendingGiftEarningCoins,1500);
  assert.equal(host.data().diamonds,59);
  assert.equal(stored.data().hostPayableCoins,590000);
  assert.equal(accrual.data().status,"settled");
  assert.equal(ledger.data().delta,59);
  assert.equal(ledger.data().payableCoins,590000);

  const second=await settleAgencyCycle(db,actorUid,accrualId);
  assert.equal(second.alreadySettled,true);
  const hostAfter=await db.collection("users").doc(hostUid).get();
  assert.equal(hostAfter.data().diamonds,59);
  assert.equal(hostAfter.data().pendingGiftEarningCoins,1500);
});
