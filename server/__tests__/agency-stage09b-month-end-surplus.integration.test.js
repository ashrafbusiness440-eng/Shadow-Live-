import assert from "node:assert/strict";
import {after, test} from "node:test";
import {deleteApp, initializeApp} from "firebase-admin/app";
import {getFirestore} from "firebase-admin/firestore";

import {settleAgencyHostSurplusPage} from "../economy/economy-control.js";

const app=initializeApp(
  {projectId:"shadow-live-economy-test"},
  "agency-stage09b-"+Date.now(),
);
const db=getFirestore(app);

after(async()=>{await deleteApp(app);});

function hostMonthId(agencyId,month,hostUid){
  return agencyId+"__"+month+"__"+hostUid;
}

async function seedHostMonth({
  agencyId,
  month,
  hostUid,
  hostShareCoins,
  targetThresholdCoins,
  salaryPaidDiamonds=0,
}){
  const id=hostMonthId(agencyId,month,hostUid);
  await db.collection("agency_host_monthly").doc(id).set({
    agencyId,
    month,
    hostUid,
    surplusPageKey:id,
    hostShareCoins,
    targetThresholdCoins,
    salaryPaidDiamonds,
    giftCount:1,
  });
  return id;
}

test("09-B unset per-agency surplus policy fails closed before any settlement",async()=>{
  const agencyId="stage09b_unconfigured_"+Date.now();
  const month="2026-09";
  const hostUid="host_unconfigured";
  const id=await seedHostMonth({
    agencyId,month,hostUid,
    hostShareCoins:70000,
    targetThresholdCoins:50000,
    salaryPaidDiamonds:5,
  });

  await assert.rejects(
    settleAgencyHostSurplusPage(
      db,
      "owner",
      agencyId,
      month,
      {now:new Date("2026-10-15T00:00:00.000Z")},
    ),
    /agency_surplus_policy_unconfigured/,
  );

  const [snapshot,settlement]=await Promise.all([
    db.collection("agency_surplus_policy_snapshots")
      .doc(agencyId+"__"+month).get(),
    db.collection("agency_surplus_settlements").doc(id).get(),
  ]);
  assert.equal(snapshot.exists,false);
  assert.equal(settlement.exists,false);
});

test("09-B OFF credits Host coins in bounded pages and freezes policy across pages",async()=>{
  const suffix=Date.now().toString()+"_off";
  const agencyId="stage09b_agency_"+suffix;
  const month="2026-09";
  const now=new Date("2026-10-15T00:00:00.000Z");
  const host1="h1_"+suffix;
  const host2="h2_"+suffix;
  const host3="h3_"+suffix;
  const id1=hostMonthId(agencyId,month,host1);
  const id2=hostMonthId(agencyId,month,host2);
  const id3=hostMonthId(agencyId,month,host3);

  await Promise.all([
    db.collection("agency_policy_overrides").doc(agencyId).set({
      agencyId,
      surplusToShadow:false,
    }),
    db.collection("users").doc(host1).set({coins:1000,diamonds:5}),
    db.collection("users").doc(host2).set({coins:2000,diamonds:5}),
    db.collection("users").doc(host3).set({coins:3000,diamonds:0}),
    seedHostMonth({
      agencyId,month,hostUid:host1,
      hostShareCoins:70000,
      targetThresholdCoins:50000,
      salaryPaidDiamonds:5,
    }),
    seedHostMonth({
      agencyId,month,hostUid:host2,
      hostShareCoins:50000,
      targetThresholdCoins:50000,
      salaryPaidDiamonds:5,
    }),
    seedHostMonth({
      agencyId,month,hostUid:host3,
      hostShareCoins:40000,
      targetThresholdCoins:0,
      salaryPaidDiamonds:0,
    }),
  ]);

  const first=await settleAgencyHostSurplusPage(
    db,
    "owner_a",
    agencyId,
    month,
    {now,limit:2},
  );
  assert.equal(first.pageSize,2);
  assert.equal(first.processedCount,2);
  assert.equal(first.settledCount,2);
  assert.equal(first.duplicateCount,0);
  assert.equal(first.done,false);
  assert.equal(first.nextCursor,id2);
  assert.equal(first.policySnapshot.surplusToShadow,false);
  assert.equal(first.policySnapshot.mode,"host_wallet_coins");

  await db.collection("agency_policy_overrides").doc(agencyId).update({
    surplusToShadow:true,
  });

  const second=await settleAgencyHostSurplusPage(
    db,
    "owner_b",
    agencyId,
    month,
    {now,limit:2,cursor:first.nextCursor},
  );
  assert.equal(second.processedCount,1);
  assert.equal(second.done,true);
  assert.equal(second.nextCursor,null);
  assert.equal(second.policySnapshot.surplusToShadow,false);
  assert.equal(second.results[0].hostUid,host3);
  assert.equal(second.results[0].settlement.destination,"host_wallet_coins");

  const replay=await settleAgencyHostSurplusPage(
    db,
    "owner_c",
    agencyId,
    month,
    {now,limit:2},
  );
  assert.equal(replay.settledCount,0);
  assert.equal(replay.duplicateCount,2);

  const [
    snapshot,
    user1,
    user2,
    user3,
    settlement1,
    settlement2,
    settlement3,
    ledger1,
    ledger2,
    ledger3,
    month1,
    month3,
    audit1,
  ]=await Promise.all([
    db.collection("agency_surplus_policy_snapshots")
      .doc(agencyId+"__"+month).get(),
    db.collection("users").doc(host1).get(),
    db.collection("users").doc(host2).get(),
    db.collection("users").doc(host3).get(),
    db.collection("agency_surplus_settlements").doc(id1).get(),
    db.collection("agency_surplus_settlements").doc(id2).get(),
    db.collection("agency_surplus_settlements").doc(id3).get(),
    db.collection("financial_ledger").doc("agency_host_surplus_"+id1).get(),
    db.collection("financial_ledger").doc("agency_host_surplus_"+id2).get(),
    db.collection("financial_ledger").doc("agency_host_surplus_"+id3).get(),
    db.collection("agency_host_monthly").doc(id1).get(),
    db.collection("agency_host_monthly").doc(id3).get(),
    db.collection("admin_audit_logs").doc("agency_host_surplus_"+id1).get(),
  ]);

  assert.equal(snapshot.data().surplusToShadow,false);
  assert.equal(snapshot.data().mode,"host_wallet_coins");

  assert.equal(user1.data().coins,21000);
  assert.equal(user1.data().diamonds,5);
  assert.equal(user2.data().coins,2000);
  assert.equal(user2.data().diamonds,5);
  assert.equal(user3.data().coins,43000);
  assert.equal(user3.data().diamonds,0);

  assert.equal(settlement1.data().surplusCoins,20000);
  assert.equal(settlement1.data().hostWalletCoins,20000);
  assert.equal(settlement1.data().shadowProfitCoins,0);
  assert.equal(settlement1.data().salaryPaidDiamondsSnapshot,5);
  assert.equal(settlement1.data().hostSalaryRepaidAtMonthEnd,false);

  assert.equal(settlement2.data().surplusCoins,0);
  assert.equal(settlement2.data().destination,"none");

  assert.equal(settlement3.data().surplusCoins,40000);
  assert.equal(settlement3.data().targetThresholdCoins,0);
  assert.equal(settlement3.data().destination,"host_wallet_coins");

  assert.equal(ledger1.data().reason,"agency_host_surplus_host_wallet");
  assert.equal(ledger1.data().delta,20000);
  assert.equal(ledger1.data().openingBalance,1000);
  assert.equal(ledger1.data().closingBalance,21000);
  assert.equal(ledger2.data().reason,"agency_host_surplus_none");
  assert.equal(ledger2.data().delta,0);
  assert.equal(ledger3.data().delta,40000);

  assert.equal(month1.data().surplusCoins,20000);
  assert.equal(month1.data().surplusHostWalletCoins,20000);
  assert.equal(month1.data().surplusShadowProfitCoins,0);
  assert.equal(month3.data().surplusCoins,40000);
  assert.equal(audit1.data().action,"settleAgencyHostSurplus");
});

test("09-B ON books surplus to Shadow Profit without mutating Host wallet",async()=>{
  const suffix=Date.now().toString()+"_shadow";
  const agencyId="stage09b_shadow_"+suffix;
  const month="2026-09";
  const hostUid="host_"+suffix;
  const id=hostMonthId(agencyId,month,hostUid);

  await Promise.all([
    db.collection("agency_policy_overrides").doc(agencyId).set({
      agencyId,
      surplusToShadow:true,
    }),
    db.collection("users").doc(hostUid).set({coins:777,diamonds:9}),
    seedHostMonth({
      agencyId,month,hostUid,
      hostShareCoins:70000,
      targetThresholdCoins:50000,
      salaryPaidDiamonds:5,
    }),
  ]);

  const result=await settleAgencyHostSurplusPage(
    db,
    "owner",
    agencyId,
    month,
    {now:new Date("2026-10-15T00:00:00.000Z"),limit:25},
  );

  assert.equal(result.done,true);
  assert.equal(result.results[0].settlement.destination,"shadow_profit");

  const [user,settlement,ledger]=await Promise.all([
    db.collection("users").doc(hostUid).get(),
    db.collection("agency_surplus_settlements").doc(id).get(),
    db.collection("financial_ledger").doc("agency_host_surplus_"+id).get(),
  ]);

  assert.equal(user.data().coins,777);
  assert.equal(user.data().diamonds,9);
  assert.equal(settlement.data().surplusCoins,20000);
  assert.equal(settlement.data().hostWalletCoins,0);
  assert.equal(settlement.data().shadowProfitCoins,20000);
  assert.equal(settlement.data().hostSalaryRepaidAtMonthEnd,false);
  assert.equal(ledger.data().accountType,"shadow_profit");
  assert.equal(ledger.data().reason,"agency_host_surplus_shadow_profit");
  assert.equal(ledger.data().delta,20000);
});

test("09-B corrupted Target threshold fails closed and does not credit Host",async()=>{
  const suffix=Date.now().toString()+"_corrupt";
  const agencyId="stage09b_corrupt_"+suffix;
  const month="2026-09";
  const hostUid="host_"+suffix;
  const id=hostMonthId(agencyId,month,hostUid);

  await Promise.all([
    db.collection("agency_policy_overrides").doc(agencyId).set({
      agencyId,
      surplusToShadow:false,
    }),
    db.collection("users").doc(hostUid).set({coins:500,diamonds:3}),
    seedHostMonth({
      agencyId,month,hostUid,
      hostShareCoins:50000,
      targetThresholdCoins:100000,
      salaryPaidDiamonds:3,
    }),
  ]);

  await assert.rejects(
    settleAgencyHostSurplusPage(
      db,
      "owner",
      agencyId,
      month,
      {now:new Date("2026-10-15T00:00:00.000Z")},
    ),
    /agency_surplus_target_threshold_conflict/,
  );

  const [user,settlement,ledger]=await Promise.all([
    db.collection("users").doc(hostUid).get(),
    db.collection("agency_surplus_settlements").doc(id).get(),
    db.collection("financial_ledger").doc("agency_host_surplus_"+id).get(),
  ]);
  assert.equal(user.data().coins,500);
  assert.equal(user.data().diamonds,3);
  assert.equal(settlement.exists,false);
  assert.equal(ledger.exists,false);
});

test("09-B surplus settlement accepts only a closed UTC month",async()=>{
  const agencyId="stage09b_closed_"+Date.now();
  await db.collection("agency_policy_overrides").doc(agencyId).set({
    agencyId,
    surplusToShadow:false,
  });
  await assert.rejects(
    settleAgencyHostSurplusPage(
      db,
      "owner",
      agencyId,
      "2026-10",
      {now:new Date("2026-10-15T00:00:00.000Z")},
    ),
    /agency_month_not_closed/,
  );
});
