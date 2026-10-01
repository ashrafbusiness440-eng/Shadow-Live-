import assert from "node:assert/strict";
import {after, test} from "node:test";
import {deleteApp, initializeApp} from "firebase-admin/app";
import {getFirestore} from "firebase-admin/firestore";

import {sendGift as sendChatGift} from "../../cloudflare-worker/src/chat-safety-actions.js";
import {sendRoomGift} from "../../cloudflare-worker/src/room-gift.js";
import {cloudflareFirestoreAdapter} from "./helpers/cloudflare-firestore-adapter.js";

const app=initializeApp(
  {projectId:"shadow-live-economy-test"},
  "agency-stage06b-"+Date.now(),
);
const db=getFirestore(app);
const cloudflareDb=cloudflareFirestoreAdapter(db);

after(async()=>{await deleteApp(app);});

function monthKey(date=new Date()){
  return date.toISOString().slice(0,7);
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
      gifts:[
        {
          id:"stage06b_small",
          nameAr:"هدية صغيرة",
          priceCoins:100000,
          enabled:true,
          assetKey:"gifts.placeholder.default",
        },
        {
          id:"stage06b_jump",
          nameAr:"هدية قفزة",
          priceCoins:400000,
          enabled:true,
          assetKey:"gifts.placeholder.default",
        },
      ],
    }),
    db.collection("system_config").doc("gift_economy").set(approvedPolicy),
    db.collection("system_config").doc("emergency_lock").set({
      enabled:false,
      economyLocked:false,
      giftsLocked:false,
    }),
  ]);
}

async function seedAgencyMonth(agencyId,month){
  const ownerUid="owner_"+agencyId;
  await Promise.all([
    db.collection("agency_support_stats").doc(agencyId)
      .collection("monthly").doc(month).set({activeHostIds:[]}),
    db.collection("agencies").doc(agencyId).set({
      agencyId,
      publicId:agencyId.replace(/\D/g,"").slice(0,8) || "600001",
      name:"Stage 06-B Agency",
      ownerUid,
      status:"active",
    }),
    db.collection("users").doc(ownerUid).set({
      publicId:"7"+agencyId.replace(/\D/g,"").slice(-7),
      accountStatus:"active",
      agencyId,
      agencyRole:"owner",
      diamonds:0,
      coins:0,
    }),
  ]);
  return ownerUid;
}

test("06-B one room gift can jump multiple targets and pays only the reached salary delta",async()=>{
  await seedSharedConfig();
  const suffix=Date.now().toString()+"_jump";
  const senderId="stage06b_sender_"+suffix;
  const hostId="stage06b_host_"+suffix;
  const agencyId="stage06b_agency_"+suffix;
  const roomId="stage06b_room_"+suffix;
  const key1="stage06b_jump_one_"+suffix;
  const key2="stage06b_jump_two_"+suffix;
  const month=monthKey();

  await Promise.all([
    db.collection("users").doc(senderId).set({
      coins:2000000,diamonds:0,role:"user",
    }),
    db.collection("users").doc(hostId).set({
      coins:0,diamonds:0,role:"user",agencyId,agencyRole:"host",
      giftHostActivityMonth:month,giftHostQualifiedDays:0,
      pendingGiftEarningCoins:0,pendingAgencyGiftEarningCoins:0,
    }),
    db.collection("rooms").doc(roomId).set({
      isActive:true,agencyId,totalSupport:0,
    }),
    seedAgencyMonth(agencyId,month),
  ]);

  const presence=realtimeNamespaceWithPresentUids([senderId,hostId]);
  const first=await sendRoomGift(cloudflareDb,senderId,{
    roomId,receiverId:hostId,giftId:"stage06b_jump",quantity:1,idempotencyKey:key1,
  },{realtimeNamespace:presence});

  assert.equal(first.recipientShareCoins,200000);
  assert.equal(first.agencyTargetId,"starter_e");
  assert.equal(first.salaryDeltaDiamonds,20);
  assert.equal(first.diamondsEarned,20);
  assert.equal(first.agencySalaryPaidDiamonds,20);

  const ownerUid="owner_"+agencyId;
  const [
    hostAfterFirst,
    ownerAfterFirst,
    financialStateAfterFirst,
    shareLedger1,
    ledger1,
    audit1,
    op1,
    notification1,
  ]=await Promise.all([
    db.collection("users").doc(hostId).get(),
    db.collection("users").doc(ownerUid).get(),
    db.collection("agency_financial_state").doc(agencyId).get(),
    db.collection("financial_ledger")
      .doc("agency_target_share_"+key1).get(),
    db.collection("financial_ledger").doc("gift_earnings_"+key1).get(),
    db.collection("admin_audit_logs").doc("agency_target_salary_"+key1).get(),
    db.collection("gift_operations").doc(key1).get(),
    db.collection("notifications")
      .doc("agency_target_salary_"+key1+"_"+hostId).get(),
  ]);
  assert.equal(hostAfterFirst.data().diamonds,20);
  assert.equal(ownerAfterFirst.data().diamonds,2);
  assert.equal(financialStateAfterFirst.data().carryoverCoins,0);
  assert.equal(shareLedger1.data().payableCoins,20000);
  assert.equal(shareLedger1.data().delta,2);
  assert.equal(shareLedger1.data().reason,"agency_target_share");
  assert.equal(hostAfterFirst.data().agencyTargetProgressCoins,200000);
  assert.equal(ledger1.data().delta,20);
  assert.equal(ledger1.data().reason,"agency_target_salary");
  assert.equal(audit1.data().action,"agencyTargetSalaryPaid");
  assert.equal(audit1.data().contextType,"room");
  assert.equal(audit1.data().salaryDeltaDiamonds,20);
  assert.equal(op1.data().giftId,"stage06b_jump");
  assert.equal(op1.data().quantity,1);
  assert.equal(notification1.data().userId,hostId);
  assert.equal(notification1.data().type,"agency_target_salary_paid");
  assert.equal(notification1.data().mandatory,true);
  assert.equal(notification1.data().financial,true);
  assert.equal(notification1.data().salaryDeltaDiamonds,20);
  assert.equal(notification1.data().targetId,"starter_e");

  const second=await sendRoomGift(cloudflareDb,senderId,{
    roomId,receiverId:hostId,giftId:"stage06b_jump",quantity:1,idempotencyKey:key2,
  },{realtimeNamespace:presence});

  assert.equal(second.recipientShareCoins,200000);
  assert.equal(second.agencyTargetId,"starter_d");
  assert.equal(second.salaryDeltaDiamonds,10);
  assert.equal(second.diamondsEarned,10);
  assert.equal(second.agencySalaryPaidDiamonds,30);

  const [
    hostAfterSecond,
    ownerAfterSecond,
    shareLedger2,
    ledger2,
    audit2,
    notification2,
  ]=await Promise.all([
    db.collection("users").doc(hostId).get(),
    db.collection("users").doc(ownerUid).get(),
    db.collection("financial_ledger")
      .doc("agency_target_share_"+key2).get(),
    db.collection("financial_ledger").doc("gift_earnings_"+key2).get(),
    db.collection("admin_audit_logs").doc("agency_target_salary_"+key2).get(),
    db.collection("notifications")
      .doc("agency_target_salary_"+key2+"_"+hostId).get(),
  ]);
  assert.equal(hostAfterSecond.data().diamonds,30);
  assert.equal(ownerAfterSecond.data().diamonds,4);
  assert.equal(shareLedger2.data().payableCoins,20000);
  assert.equal(shareLedger2.data().delta,2);
  assert.equal(hostAfterSecond.data().agencyTargetProgressCoins,400000);
  assert.equal(hostAfterSecond.data().agencySalaryPaidDiamonds,30);
  assert.equal(ledger2.data().delta,10);
  assert.equal(audit2.data().salaryDeltaDiamonds,10);
  assert.equal(notification2.data().salaryDeltaDiamonds,10);
  assert.equal(notification2.data().targetId,"starter_d");
});

test("06-B concurrent room gifts serialize salary progress and never double-pay a target",async()=>{
  await seedSharedConfig();
  const suffix=Date.now().toString()+"_race";
  const senderA="stage06b_sender_a_"+suffix;
  const senderB="stage06b_sender_b_"+suffix;
  const hostId="stage06b_race_host_"+suffix;
  const agencyId="stage06b_race_agency_"+suffix;
  const roomId="stage06b_race_room_"+suffix;
  const keyA="stage06b_race_a_"+suffix;
  const keyB="stage06b_race_b_"+suffix;
  const month=monthKey();

  await Promise.all([
    db.collection("users").doc(senderA).set({coins:1000000,diamonds:0,role:"user"}),
    db.collection("users").doc(senderB).set({coins:1000000,diamonds:0,role:"user"}),
    db.collection("users").doc(hostId).set({
      coins:0,diamonds:0,role:"user",agencyId,agencyRole:"host",
      giftHostActivityMonth:month,giftHostQualifiedDays:0,
      pendingGiftEarningCoins:0,pendingAgencyGiftEarningCoins:0,
    }),
    db.collection("rooms").doc(roomId).set({isActive:true,agencyId,totalSupport:0}),
    seedAgencyMonth(agencyId,month),
  ]);

  const presence=realtimeNamespaceWithPresentUids([senderA,senderB,hostId]);
  const [first,second]=await Promise.all([
    sendRoomGift(cloudflareDb,senderA,{
      roomId,receiverId:hostId,giftId:"stage06b_small",quantity:1,idempotencyKey:keyA,
    },{realtimeNamespace:presence}),
    sendRoomGift(cloudflareDb,senderB,{
      roomId,receiverId:hostId,giftId:"stage06b_small",quantity:1,idempotencyKey:keyB,
    },{realtimeNamespace:presence}),
  ]);

  assert.equal(first.diamondsEarned+second.diamondsEarned,10);
  assert.deepEqual(
    [first.diamondsEarned,second.diamondsEarned].sort((a,b)=>a-b),
    [5,5],
  );

  const concurrentOwnerUid="owner_"+agencyId;
  const [
    host,
    concurrentOwner,
    financialState,
    targetShareMonth,
    ledgerA,
    ledgerB,
    auditA,
    auditB,
    room,
  ]=await Promise.all([
    db.collection("users").doc(hostId).get(),
    db.collection("users").doc(concurrentOwnerUid).get(),
    db.collection("agency_financial_state").doc(agencyId).get(),
    db.collection("agency_target_share_monthly")
      .doc(agencyId+"__"+month).get(),
    db.collection("financial_ledger").doc("gift_earnings_"+keyA).get(),
    db.collection("financial_ledger").doc("gift_earnings_"+keyB).get(),
    db.collection("admin_audit_logs").doc("agency_target_salary_"+keyA).get(),
    db.collection("admin_audit_logs").doc("agency_target_salary_"+keyB).get(),
    db.collection("rooms").doc(roomId).get(),
  ]);

  assert.equal(host.data().agencyTargetProgressCoins,100000);
  assert.equal(host.data().agencyCurrentTargetId,"starter_f");
  assert.equal(host.data().agencySalaryPaidDiamonds,10);
  assert.equal(host.data().diamonds,10);
  assert.equal(concurrentOwner.data().diamonds,1);
  assert.equal(financialState.data().carryoverCoins,0);
  assert.equal(targetShareMonth.data().shareCoins,10000);
  assert.equal(targetShareMonth.data().diamondsPaid,1);
  assert.equal(targetShareMonth.data().payoutCount,2);
  assert.equal(ledgerA.data().delta+ledgerB.data().delta,10);
  assert.equal(auditA.data().salaryDeltaDiamonds+auditB.data().salaryDeltaDiamonds,10);
  assert.equal(
    room.data().totalSupport,
    0,
    "06-B must not reintroduce per-gift room-root support writes",
  );
});

test("06-B gift idempotency rejects a changed request using an existing operation key",async()=>{
  await seedSharedConfig();
  const suffix=Date.now().toString()+"_idem";
  const senderId="stage06b_idem_sender_"+suffix;
  const hostId="stage06b_idem_host_"+suffix;
  const agencyId="stage06b_idem_agency_"+suffix;
  const roomId="stage06b_idem_room_"+suffix;
  const key="stage06b_idem_key_"+suffix;
  const month=monthKey();

  await Promise.all([
    db.collection("users").doc(senderId).set({coins:2000000,diamonds:0,role:"user"}),
    db.collection("users").doc(hostId).set({
      coins:0,diamonds:0,role:"user",agencyId,agencyRole:"host",
      giftHostActivityMonth:month,giftHostQualifiedDays:0,
      pendingGiftEarningCoins:0,pendingAgencyGiftEarningCoins:0,
    }),
    db.collection("rooms").doc(roomId).set({isActive:true,agencyId,totalSupport:0}),
    seedAgencyMonth(agencyId,month),
  ]);

  const presence=realtimeNamespaceWithPresentUids([senderId,hostId]);
  await sendRoomGift(cloudflareDb,senderId,{
    roomId,receiverId:hostId,giftId:"stage06b_small",quantity:1,idempotencyKey:key,
  },{realtimeNamespace:presence});

  await assert.rejects(
    sendRoomGift(cloudflareDb,senderId,{
      roomId,receiverId:hostId,giftId:"stage06b_small",quantity:7,idempotencyKey:key,
    },{realtimeNamespace:realtimeNamespaceWithPresentUids([])}),
    /idempotency_conflict/,
  );

  const [sender,host,ledger,audit]=await Promise.all([
    db.collection("users").doc(senderId).get(),
    db.collection("financial_ledger").doc("gift_earnings_"+key).get(),
    db.collection("admin_audit_logs").doc("agency_target_salary_"+key).get(),
  ]);
  assert.equal(sender.data().coins,1900000);
  assert.equal(host.data().diamonds,5);
  assert.equal(host.data().agencyTargetProgressCoins,50000);
  assert.equal(ledger.data().delta,5);
  assert.equal(audit.data().salaryDeltaDiamonds,5);
});

test("06-B chat gifts use the same immediate target salary ledger audit and fingerprint contract",async()=>{
  await seedSharedConfig();
  const suffix=Date.now().toString()+"_chat";
  const senderId="stage06b_chat_sender_"+suffix;
  const hostId="stage06b_chat_host_"+suffix;
  const agencyId="stage06b_chat_agency_"+suffix;
  const conversationId="stage06b_chat_conversation_"+suffix;
  const key="stage06b_chat_key_"+suffix;
  const month=monthKey();

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
    seedAgencyMonth(agencyId,month),
  ]);

  const result=await sendChatGift(cloudflareDb,senderId,{
    receiverId:hostId,
    giftId:"stage06b_jump",
    quantity:1,
    conversationId,
    idempotencyKey:key,
  });

  assert.equal(result.agencyTargetId,"starter_e");
  assert.equal(result.salaryDeltaDiamonds,20);
  assert.equal(result.agencySalaryPaidDiamonds,20);

  const chatOwnerUid="owner_"+agencyId;
  const [host,chatOwner,shareLedger,ledger,audit,op,notification]=await Promise.all([
    db.collection("users").doc(hostId).get(),
    db.collection("users").doc(chatOwnerUid).get(),
    db.collection("financial_ledger")
      .doc("agency_target_share_"+key).get(),
    db.collection("users").doc(hostId).get(),
    db.collection("financial_ledger").doc("gift_earnings_"+key).get(),
    db.collection("admin_audit_logs").doc("agency_target_salary_"+key).get(),
    db.collection("gift_operations").doc(key).get(),
    db.collection("notifications")
      .doc("agency_target_salary_"+key+"_"+hostId).get(),
  ]);
  assert.equal(host.data().diamonds,20);
  assert.equal(chatOwner.data().diamonds,2);
  assert.equal(shareLedger.data().payableCoins,20000);
  assert.equal(shareLedger.data().delta,2);
  assert.equal(ledger.data().delta,20);
  assert.equal(audit.data().contextType,"chat");
  assert.equal(audit.data().salaryDeltaDiamonds,20);
  assert.equal(op.data().conversationId,conversationId);
  assert.equal(op.data().giftId,"stage06b_jump");
  assert.equal(op.data().quantity,1);
  assert.equal(notification.data().type,"agency_target_salary_paid");
  assert.equal(notification.data().salaryDeltaDiamonds,20);
  assert.equal(notification.data().targetId,"starter_e");

  const duplicate=await sendChatGift(cloudflareDb,senderId,{
    receiverId:hostId,
    giftId:"stage06b_jump",
    quantity:1,
    conversationId,
    idempotencyKey:key,
  });
  assert.equal(duplicate.code,"duplicate");
  assert.equal(duplicate.salaryDeltaDiamonds,20);
});
