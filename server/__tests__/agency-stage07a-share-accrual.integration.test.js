import assert from "node:assert/strict";
import {after, test} from "node:test";
import {deleteApp, initializeApp} from "firebase-admin/app";
import {getFirestore} from "firebase-admin/firestore";

import {sendGift as sendChatGift} from "../../cloudflare-worker/src/chat-safety-actions.js";
import {agencyPublicRankingKey} from "../../cloudflare-worker/src/agency-policy.js";
import {sendRoomGift} from "../../cloudflare-worker/src/room-gift.js";
import {cloudflareFirestoreAdapter} from "./helpers/cloudflare-firestore-adapter.js";

const app=initializeApp(
  {projectId:"shadow-live-economy-test"},
  "agency-stage07a-"+Date.now(),
);
const db=getFirestore(app);
const cloudflareDb=cloudflareFirestoreAdapter(db);
const fixedNow=new Date("2026-09-29T04:00:00.000Z");
const month="2026-09";

after(async()=>{await deleteApp(app);});

function agencyAccrualShard(value){
  const text=String(value??"").trim();
  let hash=2166136261;
  for(let index=0;index<text.length;index+=1){
    hash^=text.charCodeAt(index);
    hash=Math.imul(hash,16777619);
  }
  return (hash>>>0)%32;
}

function shardId(agencyId,key){
  return agencyId+"__"+month+"__"+String(agencyAccrualShard(key)).padStart(2,"0");
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

async function seedConfig(){
  await Promise.all([
    db.collection("system_config").doc("gift_catalog").set({
      gifts:[{
        id:"stage07a_gift",
        nameAr:"هدية حصة الوكالة",
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

const tiers=[
  {id:"starter",previousGross:0,hostBps:5000,agencyBps:500,agencyCoins:5000,platformCoins:45000},
  {id:"bronze",previousGross:900000,hostBps:5700,agencyBps:600,agencyCoins:6000,platformCoins:37000},
  {id:"silver",previousGross:4900000,hostBps:6000,agencyBps:800,agencyCoins:8000,platformCoins:32000},
  {id:"gold",previousGross:19900000,hostBps:6200,agencyBps:900,agencyCoins:9000,platformCoins:29000},
  {id:"diamond",previousGross:49900000,hostBps:6300,agencyBps:1000,agencyCoins:10000,platformCoins:27000},
];

test("07-A room gifts accrue the approved base Agency Share by tier without mutating Agency Wallet",async()=>{
  await seedConfig();
  const suffix=Date.now().toString()+"_tiers";

  for(const tier of tiers){
    const senderId=`stage07a_sender_${tier.id}_${suffix}`;
    const hostId=`stage07a_host_${tier.id}_${suffix}`;
    const agencyId=`stage07a_agency_${tier.id}_${suffix}`;
    const roomId=`stage07a_room_${tier.id}_${suffix}`;
    const key=`stage07a_room_${tier.id}_${suffix}`;

    await Promise.all([
      db.collection("users").doc(senderId).set({
        coins:500000,diamonds:0,role:"user",
      }),
      db.collection("users").doc(hostId).set({
        coins:0,
        diamonds:0,
        role:"user",
        agencyId,
        agencyRole:"host",
        giftRevenueMonth:month,
        giftRevenueMonthCoins:tier.previousGross,
        giftHostActivityMonth:month,
        giftHostQualifiedDays:0,
        pendingGiftEarningCoins:0,
        pendingAgencyGiftEarningCoins:0,
      }),
      db.collection("rooms").doc(roomId).set({
        isActive:true,
        agencyId,
        totalSupport:0,
      }),
      db.collection("agency_support_stats").doc(agencyId)
        .collection("monthly").doc(month).set({activeHostIds:[]}),
      db.collection("agency_wallets").doc(agencyId).set({
        agencyId,
        diamonds:7,
        remainderCoins:4321,
        lifetimeDiamonds:7,
      }),
    ]);

    const result=await sendRoomGift(
      cloudflareDb,
      senderId,
      {
        roomId,
        receiverId:hostId,
        giftId:"stage07a_gift",
        quantity:1,
        idempotencyKey:key,
      },
      {
        realtimeNamespace:realtimeNamespaceWithPresentUids([senderId,hostId]),
        now:fixedNow,
      },
    );

    const [transaction,accrual,wallet,statement,hostMonth,hostUser]=await Promise.all([
      db.collection("gift_transactions").doc(key).get(),
      db.collection("agency_monthly_accrual_shards").doc(shardId(agencyId,key)).get(),
      db.collection("agency_wallets").doc(agencyId).get(),
      db.collection("agency_monthly_statements").doc(agencyId+"__"+month).get(),
      db.collection("agency_host_monthly").doc(agencyId+"__"+month+"__"+hostId).get(),
      db.collection("users").doc(hostId).get(),
    ]);

    assert.equal(result.revenueTierId,tier.id);
    assert.equal(result.agencyShareCoins,tier.agencyCoins);
    assert.equal(result.platformShareCoins,tier.platformCoins);

    assert.equal(transaction.data().agencyBaseShareBps,tier.agencyBps);
    assert.equal(transaction.data().agencyBonusBps,0);
    assert.equal(transaction.data().agencyShareBps,tier.agencyBps);
    assert.equal(transaction.data().agencyShareCoins,tier.agencyCoins);
    assert.equal(transaction.data().recipientShareBps,tier.hostBps);
    assert.equal(
      transaction.data().recipientShareCoins+
        transaction.data().agencyShareCoins+
        transaction.data().platformShareCoins,
      100000,
    );

    assert.equal(accrual.data().agencyId,agencyId);
    assert.equal(accrual.data().month,month);
    assert.equal(accrual.data().agencyShareCoins,tier.agencyCoins);
    assert.equal(accrual.data().supportCoins,100000);
    assert.equal(hostMonth.data().supportCoins,100000);
    assert.equal(hostMonth.data().publicSupportCoins,100000);
    assert.equal(
      hostMonth.data().publicRankingKey,
      agencyPublicRankingKey({
        agencyId,
        month,
        hostUid:hostId,
        supportCoins:100000,
      }),
    );
    assert.equal(hostUser.data().agencyPublicSupportAgencyId,agencyId);
    assert.equal(hostUser.data().agencyPublicSupportMonth,month);
    assert.equal(hostUser.data().agencyPublicSupportCoins,100000);
    assert.equal(
      hostUser.data().giftRevenueMonthCoins,
      tier.previousGross+100000,
      "public Agency support must stay separate from global monthly gift revenue",
    );

    assert.equal(wallet.data().diamonds,7);
    assert.equal(wallet.data().remainderCoins,4321);
    assert.equal(wallet.data().lifetimeDiamonds,7);
    assert.equal(statement.exists,false);
  }
});

test("07-A Room and Chat use the same separated Agency Share accrual contract",async()=>{
  await seedConfig();
  const suffix=Date.now().toString()+"_parity";
  const agencyId="stage07a_parity_agency_"+suffix;
  const roomSender="stage07a_room_sender_"+suffix;
  const chatSender="stage07a_chat_sender_"+suffix;
  const roomHost="stage07a_room_host_"+suffix;
  const chatHost="stage07a_chat_host_"+suffix;
  const roomId="stage07a_parity_room_"+suffix;
  const conversationId="stage07a_parity_chat_"+suffix;
  const roomKey="stage07a_parity_room_key_"+suffix;
  const chatKey="stage07a_parity_chat_key_"+suffix;

  await Promise.all([
    db.collection("users").doc(roomSender).set({coins:300000,diamonds:0,role:"user"}),
    db.collection("users").doc(chatSender).set({coins:300000,diamonds:0,role:"user"}),
    db.collection("users").doc(roomHost).set({
      coins:0,diamonds:0,role:"user",agencyId,agencyRole:"host",
      giftRevenueMonth:month,giftRevenueMonthCoins:900000,
      giftHostActivityMonth:month,giftHostQualifiedDays:0,
      pendingGiftEarningCoins:0,pendingAgencyGiftEarningCoins:0,
    }),
    db.collection("users").doc(chatHost).set({
      coins:0,diamonds:0,role:"user",agencyId,agencyRole:"host",
      giftRevenueMonth:month,giftRevenueMonthCoins:900000,
      giftHostActivityMonth:month,giftHostQualifiedDays:0,
      pendingGiftEarningCoins:0,pendingAgencyGiftEarningCoins:0,
    }),
    db.collection("rooms").doc(roomId).set({isActive:true,agencyId,totalSupport:0}),
    db.collection("conversations").doc(conversationId).set({
      participants:[chatSender,chatHost],
      unreadCounts:{[chatSender]:0,[chatHost]:0},
    }),
    db.collection("agency_support_stats").doc(agencyId)
      .collection("monthly").doc(month).set({activeHostIds:[]}),
    db.collection("agency_wallets").doc(agencyId).set({
      agencyId,diamonds:11,remainderCoins:2222,lifetimeDiamonds:11,
    }),
  ]);

  const roomResult=await sendRoomGift(
    cloudflareDb,
    roomSender,
    {
      roomId,
      receiverId:roomHost,
      giftId:"stage07a_gift",
      quantity:1,
      idempotencyKey:roomKey,
    },
    {
      realtimeNamespace:realtimeNamespaceWithPresentUids([roomSender,roomHost]),
      now:fixedNow,
    },
  );
  const chatResult=await sendChatGift(
    cloudflareDb,
    chatSender,
    {
      receiverId:chatHost,
      giftId:"stage07a_gift",
      quantity:1,
      conversationId,
      idempotencyKey:chatKey,
    },
    {now:fixedNow},
  );

  assert.equal(roomResult.revenueTierId,"bronze");
  assert.equal(chatResult.revenueTierId,"bronze");
  assert.equal(roomResult.agencyShareCoins,6000);
  assert.equal(chatResult.agencyShareCoins,6000);

  const roomShardId=shardId(agencyId,roomKey);
  const chatShardId=shardId(agencyId,chatKey);
  const [
    roomTx,
    chatTx,
    roomShard,
    chatShard,
    wallet,
    roomHostMonth,
    chatHostMonth,
  ]=await Promise.all([
    db.collection("gift_transactions").doc(roomKey).get(),
    db.collection("gift_transactions").doc(chatKey).get(),
    db.collection("agency_monthly_accrual_shards").doc(roomShardId).get(),
    db.collection("agency_monthly_accrual_shards").doc(chatShardId).get(),
    db.collection("agency_wallets").doc(agencyId).get(),
    db.collection("agency_host_monthly").doc(agencyId+"__"+month+"__"+roomHost).get(),
    db.collection("agency_host_monthly").doc(agencyId+"__"+month+"__"+chatHost).get(),
  ]);

  assert.equal(roomTx.data().agencyShareBps,600);
  assert.equal(chatTx.data().agencyShareBps,600);
  assert.equal(roomTx.data().agencyShareCoins,6000);
  assert.equal(chatTx.data().agencyShareCoins,6000);
  assert.equal(roomHostMonth.data().supportCoins,100000);
  assert.equal(chatHostMonth.data().supportCoins,100000);
  assert.equal(roomHostMonth.data().publicSupportCoins,100000);
  assert.equal(chatHostMonth.data().publicSupportCoins,100000);
  assert.equal(
    roomHostMonth.data().publicRankingKey,
    agencyPublicRankingKey({
      agencyId,
      month,
      hostUid:roomHost,
      supportCoins:100000,
    }),
  );
  assert.equal(
    chatHostMonth.data().publicRankingKey,
    agencyPublicRankingKey({
      agencyId,
      month,
      hostUid:chatHost,
      supportCoins:100000,
    }),
  );

  const expectedShardTotals=new Map();
  for(const id of [roomShardId,chatShardId]){
    expectedShardTotals.set(id,(expectedShardTotals.get(id)||0)+6000);
  }
  for(const [id,expected] of expectedShardTotals){
    const snap=id===roomShardId?roomShard:chatShard;
    assert.equal(snap.data().agencyShareCoins,expected);
  }

  assert.equal(wallet.data().diamonds,11);
  assert.equal(wallet.data().remainderCoins,2222);
});

test("07-A Agency Share is distributed across deterministic monthly shards and duplicate gifts do not accrue twice",async()=>{
  await seedConfig();
  const suffix=Date.now().toString()+"_shards";
  const agencyId="stage07a_shard_agency_"+suffix;
  const senderId="stage07a_shard_sender_"+suffix;
  const hostId="stage07a_shard_host_"+suffix;
  const roomId="stage07a_shard_room_"+suffix;

  const keys=[];
  const seen=new Set();
  for(let index=0;index<200&&keys.length<3;index+=1){
    const key=`stage07a_shard_key_${index}_${suffix}`;
    const shard=agencyAccrualShard(key);
    if(seen.has(shard))continue;
    seen.add(shard);
    keys.push(key);
  }
  assert.equal(keys.length,3);

  await Promise.all([
    db.collection("users").doc(senderId).set({coins:1000000,diamonds:0,role:"user"}),
    db.collection("users").doc(hostId).set({
      coins:0,diamonds:0,role:"user",agencyId,agencyRole:"host",
      giftRevenueMonth:month,giftRevenueMonthCoins:0,
      giftHostActivityMonth:month,giftHostQualifiedDays:0,
      pendingGiftEarningCoins:0,pendingAgencyGiftEarningCoins:0,
    }),
    db.collection("rooms").doc(roomId).set({isActive:true,agencyId,totalSupport:0}),
    db.collection("agency_support_stats").doc(agencyId)
      .collection("monthly").doc(month).set({activeHostIds:[]}),
  ]);

  const presence=realtimeNamespaceWithPresentUids([senderId,hostId]);
  for(const key of keys){
    const result=await sendRoomGift(
      cloudflareDb,
      senderId,
      {
        roomId,
        receiverId:hostId,
        giftId:"stage07a_gift",
        quantity:1,
        idempotencyKey:key,
      },
      {realtimeNamespace:presence,now:fixedNow},
    );
    assert.equal(result.agencyShareCoins,5000);
  }

  const duplicate=await sendRoomGift(
    cloudflareDb,
    senderId,
    {
      roomId,
      receiverId:hostId,
      giftId:"stage07a_gift",
      quantity:1,
      idempotencyKey:keys[0],
    },
    {realtimeNamespace:realtimeNamespaceWithPresentUids([]),now:fixedNow},
  );
  assert.equal(duplicate.code,"duplicate");

  let agencyShareTotal=0;
  let supportTotal=0;
  for(const key of keys){
    const shard=await db.collection("agency_monthly_accrual_shards")
      .doc(shardId(agencyId,key)).get();
    assert.equal(shard.exists,true);
    agencyShareTotal+=Number(shard.data().agencyShareCoins||0);
    supportTotal+=Number(shard.data().supportCoins||0);
  }

  assert.equal(agencyShareTotal,15000);
  assert.equal(supportTotal,300000);
  const wallet=await db.collection("agency_wallets").doc(agencyId).get();
  assert.equal(wallet.exists,false);
});
