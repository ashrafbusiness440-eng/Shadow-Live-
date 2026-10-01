import assert from "node:assert/strict";
import {after, test} from "node:test";
import {deleteApp, getApps, initializeApp} from "firebase-admin/app";
import {getFirestore} from "firebase-admin/firestore";

import {sendGift as sendChatGift} from "../../cloudflare-worker/src/chat-safety-actions.js";
import {settleAgencyMonth} from "../economy/economy-control.js";
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
  return {day,month};
}

function previousMonthKey(date=new Date()){
  return new Date(Date.UTC(
    date.getUTCFullYear(),
    date.getUTCMonth()-1,
    1,
  )).toISOString().slice(0,7);
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

function agencyAccrualDocId(agencyId,month,key){
  const shard=agencyAccrualShard(key);
  return agencyId+"__"+month+"__"+String(shard).padStart(2,"0");
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

test("room gift pays agency target salary immediately and records sharded monthly accrual",async()=>{
  await seedSharedConfig();
  const periods=periodKeys();
  const suffix=Date.now().toString()+"_room";
  const senderId="sender_"+suffix;
  const receiverId="receiver_"+suffix;
  const roomId="room_"+suffix;
  const agencyId="agency_"+suffix;
  const roomAgencyId="other_room_agency_"+suffix;
  const key="roomgift_integration_"+suffix;
  const accrualId=agencyAccrualDocId(agencyId,periods.month,key);

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
  assert.equal(first.recipientShareCoins,50000);
  assert.equal(first.agencyShareCoins,5000);
  assert.equal(first.platformShareCoins,45000);
  assert.equal(first.earningsStatus,"target_paid");
  assert.equal(first.diamondsEarned,5);
  assert.equal(first.agencyTargetId,"starter_g");

  const [sender,receiver,transaction,ledger,earningsLedger,operation,accrual,hostMonth,rocketState,rocketExplosion]=await Promise.all([
    db.collection("users").doc(senderId).get(),
    db.collection("users").doc(receiverId).get(),
    db.collection("gift_transactions").doc(key).get(),
    db.collection("financial_ledger").doc("gift_"+key).get(),
    db.collection("financial_ledger").doc("gift_earnings_"+key).get(),
    db.collection("gift_operations").doc(key).get(),
    db.collection("agency_monthly_accrual_shards").doc(accrualId).get(),
    db.collection("agency_host_monthly").doc(
      agencyId+"__"+periods.month+"__"+receiverId,
    ).get(),
    db.collection("room_rocket_state").doc(roomId).get(),
    db.collection("room_rocket_explosions").doc(key+"_rocket_1").get(),
  ]);
  assert.equal(sender.data().coins,900000);
  assert.equal(receiver.data().diamonds,5);
  assert.equal(receiver.data().agencyTargetProgressCoins,50000);
  assert.equal(receiver.data().agencySalaryPaidDiamonds,5);
  assert.equal(receiver.data().agencyCurrentTargetId,"starter_g");
  assert.equal(transaction.data().contextType,"room");
  assert.equal(transaction.data().agencyId,agencyId);
  assert.notEqual(transaction.data().agencyId,roomAgencyId);
  assert.equal(transaction.data().recipientShareCoins,50000);
  assert.equal(transaction.data().agencyShareCoins,5000);
  assert.equal(transaction.data().platformShareCoins,45000);
  assert.equal(transaction.data().settlementMode,"target_immediate");
  assert.equal(transaction.data().settlementCycleKey,null);
  assert.equal(ledger.data().delta,-100000);
  assert.equal(earningsLedger.data().reason,"agency_target_salary");
  assert.equal(earningsLedger.data().delta,5);
  assert.equal(operation.data().status,"completed");
  assert.equal(rocketState.exists,true);
  assert.equal(rocketState.data().currentLevel,2);
  assert.equal(rocketState.data().progressCoins,0);
  assert.equal(rocketExplosion.exists,true);
  assert.equal(rocketExplosion.data().level,1);
  assert.equal(rocketExplosion.data().triggerUid,senderId);
  assert.equal(accrual.data().supportCoins,100000);
  assert.equal(accrual.data().hostShareCoins,50000);
  assert.equal(accrual.data().agencyShareCoins,5000);
  assert.equal(accrual.data().platformShareCoins,45000);
  assert.equal(hostMonth.data().supportCoins,100000);
  assert.equal(hostMonth.data().salaryPaidDiamonds,5);

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
    db.collection("agency_monthly_accrual_shards").doc(accrualId).get(),
  ]);
  assert.equal(senderAfter.data().coins,900000);
  assert.equal(accrualAfter.data().supportCoins,100000);
  const explosionsAfter=await db.collection("room_rocket_explosions")
    .where("operationId","==",key).get();
  assert.equal(explosionsAfter.size,1);
});

test("chat gift uses the same monthly target salary and sharded accrual as room gifts",async()=>{
  await seedSharedConfig();
  const periods=periodKeys();
  const suffix=Date.now().toString()+"_chat";
  const senderId="sender_"+suffix;
  const receiverId="receiver_"+suffix;
  const conversationId="conversation_"+suffix;
  const agencyId="agency_"+suffix;
  const key="chatgift_integration_"+suffix;
  const accrualId=agencyAccrualDocId(agencyId,periods.month,key);

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
  assert.equal(first.recipientShareCoins,50000);
  assert.equal(first.agencyShareCoins,5000);
  assert.equal(first.platformShareCoins,45000);
  assert.equal(first.earningsStatus,"target_paid");
  assert.equal(first.diamondsEarned,5);

  const [sender,receiver,transaction,ledger,earningsLedger,accrual,hostMonth]=await Promise.all([
    db.collection("users").doc(senderId).get(),
    db.collection("users").doc(receiverId).get(),
    db.collection("gift_transactions").doc(key).get(),
    db.collection("financial_ledger").doc("gift_"+key).get(),
    db.collection("financial_ledger").doc("gift_earnings_"+key).get(),
    db.collection("agency_monthly_accrual_shards").doc(accrualId).get(),
    db.collection("agency_host_monthly").doc(
      agencyId+"__"+periods.month+"__"+receiverId,
    ).get(),
  ]);
  assert.equal(sender.data().coins,900000);
  assert.equal(receiver.data().diamonds,5);
  assert.equal(receiver.data().agencyTargetProgressCoins,50000);
  assert.equal(transaction.data().contextType,"chat");
  assert.equal(transaction.data().agencyId,agencyId);
  assert.equal(transaction.data().recipientShareCoins,50000);
  assert.equal(transaction.data().agencyShareCoins,5000);
  assert.equal(transaction.data().platformShareCoins,45000);
  assert.equal(transaction.data().settlementMode,"target_immediate");
  assert.equal(ledger.data().delta,-100000);
  assert.equal(earningsLedger.data().reason,"agency_target_salary");
  assert.equal(earningsLedger.data().delta,5);
  assert.equal(accrual.data().hostShareCoins,50000);
  assert.equal(accrual.data().agencyShareCoins,5000);
  assert.equal(hostMonth.data().salaryPaidDiamonds,5);
  const chatRocketState=await db.collection("room_rocket_state").doc(conversationId).get();
  assert.equal(chatRocketState.exists,false);

  const duplicate=await sendChatGift(cloudflareDb,senderId,body);
  assert.equal(duplicate.code,"duplicate");
  const [senderAfter,accrualAfter]=await Promise.all([
    db.collection("users").doc(senderId).get(),
    db.collection("agency_monthly_accrual_shards").doc(accrualId).get(),
  ]);
  assert.equal(senderAfter.data().coins,900000);
  assert.equal(accrualAfter.data().supportCoins,100000);
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

test("Shadow Control policy save keeps activity fixed while custom economics remain dynamic",async()=>{
  const custom={
    policyMode:"tiered_host_agency",
    enabled:true,
    hostPerformanceBonusBps:300,
    agencyPerformanceBonusBps:150,
    agencyPerformanceBonusMode:"per_host_target_month_end",
    hostBonusQualifiedDays:5,
    hostBonusMinutesPerQualifiedDay:90,
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
  assert.equal(saved.hostBonusQualifiedDays,14);
  assert.equal(saved.hostBonusMinutesPerQualifiedDay,120);
  assert.equal(stored.data().hostBonusQualifiedDays,14);
  assert.equal(stored.data().hostBonusMinutesPerQualifiedDay,120);
  assert.equal(stored.data().hostPerformanceBonusBps,0);
  assert.equal(stored.data().agencyPerformanceBonusBps,150);
  assert.equal(
    stored.data().agencyPerformanceBonusMode,
    "per_host_target_month_end",
  );
  assert.equal(stored.data().tiers[1].minGiftCoins,200000);

  const result=calculateAgencyCycleSettlement(stored.data(),{
    monthlyGrossCoins:250000,
    supportCoins:250000,
    qualifiedDays:14,
    activeHostCount:3,
    hasAgency:true,
  });
  assert.equal(result.tierId,"custom");
  assert.equal(result.hostBonusBps,0);
  assert.equal(result.agencyBonusBps,0);
  assert.equal(result.hostShareBps,6100);
  assert.equal(result.agencyShareBps,700);
  assert.equal(result.hostPayableCoins,152500);
  assert.equal(result.agencyPayableCoins,17500);
  assert.equal(result.platformCoins,80000);

  const audit=await db.collection("admin_audit_logs")
    .where("actorUid","==","shadow_control_test")
    .where("action","==","updateGiftEconomyPolicy")
    .get();
  assert.equal(audit.empty,false);
});

test("closed-month agency settlement aggregates bounded shards and stays idempotent",async()=>{
  await seedSharedConfig();
  const month=previousMonthKey();
  const suffix=Date.now().toString()+"_settlement";
  const agencyId="agency_"+suffix;
  const actorUid="owner_"+suffix;
  const statementId=agencyId+"__"+month;

  await Promise.all([
    db.collection("agency_wallets").doc(agencyId).set({
      agencyId,
      diamonds:7,
      remainderCoins:2500,
      lifetimeDiamonds:7,
    }),
    db.collection("agency_monthly_accrual_shards")
      .doc(agencyId+"__"+month+"__00").set({
        agencyId,month,shard:0,
        supportCoins:600000,
        hostShareCoins:300000,
        agencyShareCoins:30000,
        platformShareCoins:270000,
        giftCount:6,
      }),
    db.collection("agency_monthly_accrual_shards")
      .doc(agencyId+"__"+month+"__17").set({
        agencyId,month,shard:17,
        supportCoins:400000,
        hostShareCoins:200000,
        agencyShareCoins:20000,
        platformShareCoins:180000,
        giftCount:4,
      }),
  ]);

  const first=await settleAgencyMonth(db,actorUid,agencyId,month);
  assert.equal(first.alreadySettled,false);
  const settlement=first.settlement;
  assert.equal(settlement.supportCoins,1000000);
  assert.equal(settlement.hostShareCoins,500000);
  assert.equal(settlement.agencyShareCoins,50000);
  assert.equal(settlement.platformShareCoins,450000);
  assert.equal(settlement.giftCount,10);
  assert.equal(settlement.shardCount,32);
  assert.equal(settlement.agencyDiamonds,5);
  assert.equal(settlement.agencyRemainderCoins,2500);
  assert.equal(settlement.hostSalaryMode,"target_immediate");
  assert.equal(settlement.hostSalaryRepaidAtMonthEnd,false);

  const [wallet,stored,ledger]=await Promise.all([
    db.collection("agency_wallets").doc(agencyId).get(),
    db.collection("agency_monthly_statements").doc(statementId).get(),
    db.collection("financial_ledger").doc("agency_monthly_share_"+statementId).get(),
  ]);
  assert.equal(wallet.data().diamonds,12);
  assert.equal(wallet.data().remainderCoins,2500);
  assert.equal(stored.data().agencyShareCoins,50000);
  assert.equal(stored.data().agencyDiamonds,5);
  assert.equal(ledger.data().delta,5);
  assert.equal(ledger.data().payableCoins,50000);

  const second=await settleAgencyMonth(db,actorUid,agencyId,month);
  assert.equal(second.alreadySettled,true);
  const walletAfter=await db.collection("agency_wallets").doc(agencyId).get();
  assert.equal(walletAfter.data().diamonds,12);
  assert.equal(walletAfter.data().remainderCoins,2500);
});


test("agency settlement rejects the current month before any payout",async()=>{
  await seedSharedConfig();
  const month=periodKeys().month;
  const suffix=Date.now().toString()+"_open_month";
  const agencyId="agency_"+suffix;
  const actorUid="owner_"+suffix;
  await db.collection("agency_monthly_accrual_shards")
    .doc(agencyId+"__"+month+"__00").set({
      agencyId,month,shard:0,
      supportCoins:100000,
      hostShareCoins:50000,
      agencyShareCoins:5000,
      platformShareCoins:45000,
      giftCount:1,
    });

  await assert.rejects(
    settleAgencyMonth(db,actorUid,agencyId,month),
    /agency_month_not_closed/,
  );
  const [wallet,statement,ledger]=await Promise.all([
    db.collection("agency_wallets").doc(agencyId).get(),
    db.collection("agency_monthly_statements").doc(agencyId+"__"+month).get(),
    db.collection("financial_ledger").doc(
      "agency_monthly_share_"+agencyId+"__"+month,
    ).get(),
  ]);
  assert.equal(wallet.exists,false);
  assert.equal(statement.exists,false);
  assert.equal(ledger.exists,false);
});

test("agency settlement records carryover in ledger even when payout is zero diamonds",async()=>{
  await seedSharedConfig();
  const month=previousMonthKey();
  const suffix=Date.now().toString()+"_carryover";
  const agencyId="agency_"+suffix;
  const actorUid="owner_"+suffix;
  const statementId=agencyId+"__"+month;

  await Promise.all([
    db.collection("agency_wallets").doc(agencyId).set({
      agencyId,diamonds:3,remainderCoins:1000,lifetimeDiamonds:3,
    }),
    db.collection("agency_monthly_accrual_shards")
      .doc(agencyId+"__"+month+"__00").set({
        agencyId,month,shard:0,
        supportCoins:100000,
        hostShareCoins:91000,
        agencyShareCoins:4000,
        platformShareCoins:5000,
        giftCount:1,
      }),
  ]);

  const result=await settleAgencyMonth(db,actorUid,agencyId,month);
  assert.equal(result.settlement.agencyDiamonds,0);
  assert.equal(result.settlement.openingRemainderCoins,1000);
  assert.equal(result.settlement.agencyRemainderCoins,5000);

  const [wallet,ledger]=await Promise.all([
    db.collection("agency_wallets").doc(agencyId).get(),
    db.collection("financial_ledger").doc("agency_monthly_share_"+statementId).get(),
  ]);
  assert.equal(wallet.data().diamonds,3);
  assert.equal(wallet.data().remainderCoins,5000);
  assert.equal(ledger.exists,true);
  assert.equal(ledger.data().delta,0);
  assert.equal(ledger.data().openingRemainderCoins,1000);
  assert.equal(ledger.data().remainderCoins,5000);
});

test("agency settlement rejects corrupted financial shard totals",async()=>{
  await seedSharedConfig();
  const month=previousMonthKey();
  const suffix=Date.now().toString()+"_corrupt";
  const agencyId="agency_"+suffix;
  const actorUid="owner_"+suffix;
  await db.collection("agency_monthly_accrual_shards")
    .doc(agencyId+"__"+month+"__00").set({
      agencyId,month,shard:0,
      supportCoins:100000,
      hostShareCoins:50000,
      agencyShareCoins:5000,
      platformShareCoins:44000,
      giftCount:1,
    });
  await assert.rejects(
    settleAgencyMonth(db,actorUid,agencyId,month),
    /agency_settlement_invariant_failed/,
  );
  const statement=await db.collection("agency_monthly_statements")
    .doc(agencyId+"__"+month).get();
  assert.equal(statement.exists,false);
});
