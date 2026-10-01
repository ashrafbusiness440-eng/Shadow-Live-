import assert from "node:assert/strict";
import {after, test} from "node:test";
import {deleteApp, initializeApp} from "firebase-admin/app";
import {getFirestore} from "firebase-admin/firestore";

import {
  settleAgencyHostSurplusPage,
  settleAgencyMonth,
} from "../economy/economy-control.js";

const app=initializeApp(
  {projectId:"shadow-live-economy-test"},
  "agency-stage08b-"+Date.now(),
);
const db=getFirestore(app);

after(async()=>{await deleteApp(app);});

async function seedEconomy(overrides={}){
  await db.collection("system_config").doc("gift_economy").set({
    enabled:true,
    policyMode:"tiered_host_agency",
    coinsPerDiamond:10000,
    agencyPerformanceBonusMode:"per_host_target_month_end",
    agencyPerformanceBonusBps:100,
    hostPerformanceBonusBps:0,
    ...overrides,
  });
}

async function seedAgencyPolicy(agencyId,overrides={}){
  await db.collection("agency_policy_overrides").doc(agencyId).set({
    agencyId,
    surplusToShadow:false,
    agencyPerformanceBonusMode:"per_host_target_month_end",
    agencyPerformanceBonusBps:100,
    ...overrides,
  });
}

async function seedShard({
  agencyId,
  month,
  supportCoins=100000,
  hostShareCoins=50000,
  agencyShareCoins=5000,
  platformShareCoins=45000,
}){
  await db.collection("agency_monthly_accrual_shards")
    .doc(agencyId+"__"+month+"__00")
    .set({
      agencyId,
      month,
      shard:0,
      supportCoins,
      hostShareCoins,
      agencyShareCoins,
      platformShareCoins,
      giftCount:1,
    });
}

async function seedHostMonth({
  agencyId,
  month,
  hostUid,
  targetId="starter_g",
  targetTierId="starter",
  targetRank="G",
  targetThresholdCoins=50000,
  activityQualifiedDays=14,
}){
  const id=agencyId+"__"+month+"__"+hostUid;
  await db.collection("agency_host_monthly").doc(id).set({
    agencyId,
    month,
    hostUid,
    surplusPageKey:id,
    supportCoins:100000,
    hostShareCoins:targetThresholdCoins,
    agencyShareCoins:5000,
    giftCount:1,
    targetId,
    targetTierId,
    targetRank,
    targetThresholdCoins,
    salaryPaidDiamonds:5,
    activityQualifiedDays,
    activityRequiredQualifiedDays:14,
    activityRequiredMinutesPerDay:120,
  });
}

test("08-B month-end pays Base Agency Share then approved Host and per-host Agency bonuses exactly once",async()=>{
  await seedEconomy();
  const suffix=Date.now().toString()+"_eligible";
  const agencyId="stage08b_agency_"+suffix;
  const actorUid="stage08b_owner_"+suffix;
  const hostUid="stage08b_host_"+suffix;
  const month="2026-09";
  const now=new Date("2026-10-15T00:00:00.000Z");

  await Promise.all([
    seedAgencyPolicy(agencyId),
    seedShard({agencyId,month}),
    db.collection("agencies").doc(agencyId).set({
      agencyId,
      ownerUid:actorUid,
      status:"active",
    }),
    seedHostMonth({agencyId,month,hostUid}),
    db.collection("agency_wallets").doc(agencyId).set({
      agencyId,
      diamonds:2,
      remainderCoins:5000,
      lifetimeDiamonds:2,
    }),
    db.collection("users").doc(hostUid).set({
      agencyId,
      agencyRole:"host",
      coins:1000,
      diamonds:77,
    }),
  ]);

  const base=await settleAgencyMonth(db,actorUid,agencyId,month,{now});
  assert.equal(base.alreadySettled,false);
  assert.equal(base.settlement.agencyBaseShareCoins,5000);
  assert.equal(base.settlement.agencyBonusCoins,0);
  assert.equal(base.settlement.agencyPayableCoins,5000);
  assert.equal(base.settlement.agencyDiamonds,1);

  const page=await settleAgencyHostSurplusPage(
    db,
    actorUid,
    agencyId,
    month,
    {now,limit:25},
  );
  assert.equal(page.done,true);
  assert.equal(page.settledCount,1);
  const settlement=page.results[0].settlement;
  assert.equal(settlement.hostActivityBonusEligible,true);
  assert.equal(settlement.hostActivityBonusAsset,"coins");
  assert.equal(settlement.hostActivityBonusAmount,5000);
  assert.equal(settlement.agencyPerformanceBonusEligible,true);
  assert.equal(settlement.agencyPerformanceBonusBps,100);
  assert.equal(settlement.agencyPerformanceBonusCoins,500);
  assert.equal(settlement.agencyPerformanceBonusDiamonds,0);

  const statementId=agencyId+"__"+month;
  const hostMonthId=statementId+"__"+hostUid;
  const [
    wallet,
    host,
    bonusAccrual,
    hostBonusLedger,
    agencyBonusLedger,
    shareNotification,
    monthNotification,
    completion,
  ]=await Promise.all([
    db.collection("agency_wallets").doc(agencyId).get(),
    db.collection("users").doc(hostUid).get(),
    db.collection("agency_bonus_accruals").doc(statementId).get(),
    db.collection("financial_ledger")
      .doc("agency_host_activity_bonus_"+hostMonthId).get(),
    db.collection("financial_ledger")
      .doc("agency_performance_bonus_"+hostMonthId).get(),
    db.collection("notifications")
      .doc("agency_share_settlement_"+statementId).get(),
    db.collection("notifications")
      .doc("agency_monthly_settlement_"+statementId).get(),
    db.collection("agency_host_settlement_completions")
      .doc(statementId).get(),
  ]);

  assert.equal(wallet.data().diamonds,3);
  assert.equal(wallet.data().remainderCoins,500);
  assert.equal(host.data().coins,6000);
  assert.equal(host.data().diamonds,77);
  assert.equal(hostBonusLedger.data().asset,"coins");
  assert.equal(hostBonusLedger.data().delta,5000);
  assert.equal(agencyBonusLedger.data().payableCoins,500);
  assert.equal(agencyBonusLedger.data().delta,0);
  assert.equal(bonusAccrual.data().perHostEligibleHostCount,1);
  assert.equal(bonusAccrual.data().perHostBonusCoins,500);
  assert.equal(completion.data().status,"complete");
  assert.equal(shareNotification.data().userId,actorUid);
  assert.equal(
    shareNotification.data().type,
    "agency_share_settlement_paid",
  );
  assert.equal(shareNotification.data().mandatory,true);
  assert.equal(shareNotification.data().financial,true);
  assert.equal(shareNotification.data().agencyBaseShareCoins,5000);
  assert.equal(shareNotification.data().agencyDiamondsAdded,1);
  assert.equal(shareNotification.data().agencyCarryoverCoins,0);
  assert.equal(monthNotification.data().userId,actorUid);
  assert.equal(
    monthNotification.data().type,
    "agency_monthly_settlement_summary",
  );
  assert.equal(monthNotification.data().mandatory,true);
  assert.equal(monthNotification.data().financial,true);
  assert.equal(monthNotification.data().agencyBaseShareCoins,5000);
  assert.equal(monthNotification.data().agencyPerformanceBonusCoins,500);
  assert.equal(monthNotification.data().agencyCarryoverCoins,500);

  const replay=await settleAgencyHostSurplusPage(
    db,
    actorUid,
    agencyId,
    month,
    {now,limit:25},
  );
  assert.equal(replay.settledCount,0);
  assert.equal(replay.duplicateCount,1);
  const walletAfter=await db.collection("agency_wallets").doc(agencyId).get();
  const hostAfter=await db.collection("users").doc(hostUid).get();
  assert.equal(walletAfter.data().diamonds,3);
  assert.equal(walletAfter.data().remainderCoins,500);
  assert.equal(hostAfter.data().coins,6000);
});

test("08-B 13 qualified days pays neither Host Activity Bonus nor Agency Performance Bonus",async()=>{
  await seedEconomy();
  const suffix=Date.now().toString()+"_unqualified";
  const agencyId="stage08b_unqualified_"+suffix;
  const actorUid="stage08b_owner_"+suffix;
  const hostUid="stage08b_host_"+suffix;
  const month="2026-09";
  const now=new Date("2026-10-15T00:00:00.000Z");

  await Promise.all([
    seedAgencyPolicy(agencyId),
    seedHostMonth({
      agencyId,
      month,
      hostUid,
      activityQualifiedDays:13,
    }),
    db.collection("users").doc(hostUid).set({
      agencyId,
      coins:900,
      diamonds:10,
    }),
  ]);

  const page=await settleAgencyHostSurplusPage(
    db,
    actorUid,
    agencyId,
    month,
    {now,limit:25},
  );
  const settlement=page.results[0].settlement;
  assert.equal(settlement.hostActivityBonusEligible,false);
  assert.equal(settlement.hostActivityBonusAmount,0);
  assert.equal(settlement.agencyPerformanceBonusEligible,false);
  assert.equal(settlement.agencyPerformanceBonusCoins,0);

  const hostMonthId=agencyId+"__"+month+"__"+hostUid;
  const [host,hostLedger,agencyLedger]=await Promise.all([
    db.collection("users").doc(hostUid).get(),
    db.collection("financial_ledger")
      .doc("agency_host_activity_bonus_"+hostMonthId).get(),
    db.collection("financial_ledger")
      .doc("agency_performance_bonus_"+hostMonthId).get(),
  ]);
  assert.equal(host.data().coins,900);
  assert.equal(host.data().diamonds,10);
  assert.equal(hostLedger.exists,false);
  assert.equal(agencyLedger.exists,false);
});

test("08-B new per-agency override changes only Agency Performance Bonus percentage",async()=>{
  await seedEconomy();
  const suffix=Date.now().toString()+"_override";
  const agencyId="stage08b_override_"+suffix;
  const actorUid="stage08b_owner_"+suffix;
  const hostUid="stage08b_host_"+suffix;
  const month="2026-09";
  const now=new Date("2026-10-15T00:00:00.000Z");

  await Promise.all([
    seedAgencyPolicy(agencyId,{agencyPerformanceBonusBps:250}),
    seedHostMonth({
      agencyId,
      month,
      hostUid,
      targetId:"starter_f",
      targetRank:"F",
      targetThresholdCoins:100000,
    }),
    db.collection("users").doc(hostUid).set({
      agencyId,
      coins:0,
      diamonds:0,
    }),
  ]);

  const page=await settleAgencyHostSurplusPage(
    db,
    actorUid,
    agencyId,
    month,
    {now,limit:25},
  );
  const settlement=page.results[0].settlement;
  assert.equal(settlement.hostActivityBonusAsset,"coins");
  assert.equal(settlement.hostActivityBonusAmount,10000);
  assert.equal(settlement.agencyPerformanceBonusBps,250);
  assert.equal(settlement.agencyPerformanceBonusCoins,2500);
});
