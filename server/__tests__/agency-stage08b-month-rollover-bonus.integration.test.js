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

async function seedAgency({agencyId,ownerUid,ownerDiamonds=0}){
  await Promise.all([
    db.collection("agencies").doc(agencyId).set({
      agencyId,
      publicId:"812345",
      name:"Stage 08-B Agency",
      ownerUid,
      status:"active",
    }),
    db.collection("users").doc(ownerUid).set({
      accountStatus:"active",
      agencyId,
      agencyRole:"owner",
      diamonds:ownerDiamonds,
      coins:0,
    }),
  ]);
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

async function seedTargetShare({
  agencyId,
  month,
  shareCoins=5000,
  diamondsPaid=0,
  payoutCount=1,
}){
  await db.collection("agency_target_share_monthly")
    .doc(agencyId+"__"+month)
    .set({
      agencyId,
      month,
      shareCoins,
      diamondsPaid,
      payoutCount,
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
    agencyTargetSharePaidCoins:targetThresholdCoins===50000?5000:10000,
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

test("08-B month close never repays Agency Share; only Target Share already earned plus aggregate Bonus are reported",async()=>{
  await seedEconomy();
  const suffix=Date.now().toString()+"_eligible";
  const agencyId="stage08b_agency_"+suffix;
  const ownerUid="stage08b_owner_"+suffix;
  const hostUid="stage08b_host_"+suffix;
  const month="2026-09";
  const now=new Date("2026-10-15T00:00:00.000Z");

  await Promise.all([
    seedAgencyPolicy(agencyId),
    seedAgency({agencyId,ownerUid,ownerDiamonds:2}),
    seedShard({agencyId,month}),
    seedTargetShare({agencyId,month,shareCoins:5000,diamondsPaid:0}),
    seedHostMonth({agencyId,month,hostUid}),
    db.collection("agency_financial_state").doc(agencyId).set({
      agencyId,
      carryoverCoins:5000,
      lifetimeAgencyDiamonds:0,
      legacyWalletMigrated:true,
    }),
    db.collection("users").doc(hostUid).set({
      agencyId,
      agencyRole:"host",
      coins:1000,
      diamonds:77,
    }),
  ]);

  const base=await settleAgencyMonth(db,ownerUid,agencyId,month,{now});
  assert.equal(base.alreadySettled,false);
  assert.equal(base.settlement.agencySharePayoutMode,"target_close");
  assert.equal(base.settlement.agencyTargetShareCoins,5000);
  assert.equal(base.settlement.agencyBaseShareCoins,5000);
  assert.equal(base.settlement.agencyMonthEndSharePayableCoins,0);
  assert.equal(base.settlement.agencyMonthEndShareDiamonds,0);
  assert.equal(base.settlement.agencyPayableCoins,0);

  const ownerAfterMonthClose=await db.collection("users").doc(ownerUid).get();
  assert.equal(ownerAfterMonthClose.data().diamonds,2);

  const page=await settleAgencyHostSurplusPage(
    db,
    ownerUid,
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
  assert.equal(
    settlement.agencyPerformanceBonusPayoutMode,
    "aggregate_month_end",
  );

  const statementId=agencyId+"__"+month;
  const hostMonthId=statementId+"__"+hostUid;
  const [
    owner,
    host,
    financialState,
    statement,
    bonusAccrual,
    hostBonusLedger,
    bonusLedger,
    monthCloseLedger,
    shareNotification,
    monthNotification,
    completion,
  ]=await Promise.all([
    db.collection("users").doc(ownerUid).get(),
    db.collection("users").doc(hostUid).get(),
    db.collection("agency_financial_state").doc(agencyId).get(),
    db.collection("agency_monthly_statements").doc(statementId).get(),
    db.collection("agency_bonus_accruals").doc(statementId).get(),
    db.collection("financial_ledger")
      .doc("agency_host_activity_bonus_"+hostMonthId).get(),
    db.collection("financial_ledger")
      .doc("agency_performance_bonus_"+statementId).get(),
    db.collection("financial_ledger")
      .doc("agency_month_close_"+statementId).get(),
    db.collection("notifications")
      .doc("agency_share_settlement_"+statementId).get(),
    db.collection("notifications")
      .doc("agency_monthly_settlement_"+statementId).get(),
    db.collection("agency_host_settlement_completions")
      .doc(statementId).get(),
  ]);

  assert.equal(owner.data().diamonds,2);
  assert.equal(financialState.data().carryoverCoins,5500);
  assert.equal(host.data().coins,6000);
  assert.equal(host.data().diamonds,77);
  assert.equal(hostBonusLedger.data().asset,"coins");
  assert.equal(hostBonusLedger.data().delta,5000);
  assert.equal(bonusLedger.data().payableCoins,500);
  assert.equal(bonusLedger.data().delta,0);
  assert.equal(bonusLedger.data().reason,"agency_performance_bonus");
  assert.equal(monthCloseLedger.data().delta,0);
  assert.equal(monthCloseLedger.data().payableCoins,0);
  assert.equal(
    monthCloseLedger.data().reason,
    "agency_month_close_no_share_payout",
  );
  assert.equal(bonusAccrual.data().status,"settled");
  assert.equal(bonusAccrual.data().perHostEligibleHostCount,1);
  assert.equal(bonusAccrual.data().perHostBonusCoins,500);
  assert.equal(statement.data().agencyTargetShareCoins,5000);
  assert.equal(statement.data().agencyBonusCoins,500);
  assert.equal(statement.data().agencyRemainderCoins,5500);
  assert.equal(completion.data().status,"complete");
  assert.equal(shareNotification.exists,false);
  assert.equal(monthNotification.data().userId,ownerUid);
  assert.equal(
    monthNotification.data().type,
    "agency_monthly_settlement_summary",
  );
  assert.equal(monthNotification.data().mandatory,true);
  assert.equal(monthNotification.data().financial,true);
  assert.equal(monthNotification.data().agencyTargetShareCoins,5000);
  assert.equal(monthNotification.data().agencyPerformanceBonusCoins,500);
  assert.equal(monthNotification.data().agencyCarryoverCoins,5500);

  const replay=await settleAgencyHostSurplusPage(
    db,
    ownerUid,
    agencyId,
    month,
    {now,limit:25},
  );
  assert.equal(replay.settledCount,0);
  assert.equal(replay.duplicateCount,1);
  const ownerAfterReplay=await db.collection("users").doc(ownerUid).get();
  const stateAfterReplay=await db.collection("agency_financial_state")
    .doc(agencyId).get();
  assert.equal(ownerAfterReplay.data().diamonds,2);
  assert.equal(stateAfterReplay.data().carryoverCoins,5500);
});

test("08-B 13 qualified days pays neither Host Activity Bonus nor Agency Performance Bonus",async()=>{
  await seedEconomy();
  const suffix=Date.now().toString()+"_unqualified";
  const agencyId="stage08b_unqualified_"+suffix;
  const ownerUid="stage08b_owner_"+suffix;
  const hostUid="stage08b_host_"+suffix;
  const month="2026-09";
  const now=new Date("2026-10-15T00:00:00.000Z");

  await Promise.all([
    seedAgencyPolicy(agencyId),
    seedAgency({agencyId,ownerUid,ownerDiamonds:4}),
    seedShard({agencyId,month}),
    seedTargetShare({agencyId,month,shareCoins:5000,diamondsPaid:0}),
    seedHostMonth({
      agencyId,
      month,
      hostUid,
      activityQualifiedDays:13,
    }),
    db.collection("agency_financial_state").doc(agencyId).set({
      agencyId,
      carryoverCoins:5000,
      lifetimeAgencyDiamonds:0,
      legacyWalletMigrated:true,
    }),
    db.collection("users").doc(hostUid).set({
      agencyId,
      coins:900,
      diamonds:10,
    }),
  ]);

  await settleAgencyMonth(db,ownerUid,agencyId,month,{now});
  const page=await settleAgencyHostSurplusPage(
    db,
    ownerUid,
    agencyId,
    month,
    {now,limit:25},
  );
  const settlement=page.results[0].settlement;
  assert.equal(settlement.hostActivityBonusEligible,false);
  assert.equal(settlement.hostActivityBonusAmount,0);
  assert.equal(settlement.agencyPerformanceBonusEligible,false);
  assert.equal(settlement.agencyPerformanceBonusCoins,0);

  const statementId=agencyId+"__"+month;
  const hostMonthId=statementId+"__"+hostUid;
  const [owner,host,state,hostLedger,bonusLedger,bonusAccrual]=await Promise.all([
    db.collection("users").doc(ownerUid).get(),
    db.collection("users").doc(hostUid).get(),
    db.collection("agency_financial_state").doc(agencyId).get(),
    db.collection("financial_ledger")
      .doc("agency_host_activity_bonus_"+hostMonthId).get(),
    db.collection("financial_ledger")
      .doc("agency_performance_bonus_"+statementId).get(),
    db.collection("agency_bonus_accruals").doc(statementId).get(),
  ]);
  assert.equal(owner.data().diamonds,4);
  assert.equal(host.data().coins,900);
  assert.equal(host.data().diamonds,10);
  assert.equal(state.data().carryoverCoins,5000);
  assert.equal(hostLedger.exists,false);
  assert.equal(bonusLedger.data().payableCoins,0);
  assert.equal(bonusLedger.data().delta,0);
  assert.equal(bonusAccrual.data().perHostBonusCoins,0);
  assert.equal(bonusAccrual.data().status,"settled");
});

test("08-B per-agency Bonus override uses the same Owner wallet and migrates legacy Agency wallet once",async()=>{
  await seedEconomy();
  const suffix=Date.now().toString()+"_override";
  const agencyId="stage08b_override_"+suffix;
  const ownerUid="stage08b_owner_"+suffix;
  const hostUid="stage08b_host_"+suffix;
  const month="2026-09";
  const now=new Date("2026-10-15T00:00:00.000Z");

  await Promise.all([
    seedAgencyPolicy(agencyId,{agencyPerformanceBonusBps:250}),
    seedAgency({agencyId,ownerUid,ownerDiamonds:10}),
    seedShard({
      agencyId,
      month,
      supportCoins:200000,
      hostShareCoins:100000,
      agencyShareCoins:10000,
      platformShareCoins:90000,
    }),
    seedTargetShare({
      agencyId,
      month,
      shareCoins:10000,
      diamondsPaid:1,
    }),
    seedHostMonth({
      agencyId,
      month,
      hostUid,
      targetId:"starter_f",
      targetRank:"F",
      targetThresholdCoins:100000,
    }),
    db.collection("agency_wallets").doc(agencyId).set({
      agencyId,
      diamonds:2,
      remainderCoins:7000,
      lifetimeDiamonds:2,
    }),
    db.collection("users").doc(hostUid).set({
      agencyId,
      coins:0,
      diamonds:0,
    }),
  ]);

  await settleAgencyMonth(db,ownerUid,agencyId,month,{now});
  const page=await settleAgencyHostSurplusPage(
    db,
    ownerUid,
    agencyId,
    month,
    {now,limit:25},
  );
  const settlement=page.results[0].settlement;
  assert.equal(settlement.hostActivityBonusAsset,"coins");
  assert.equal(settlement.hostActivityBonusAmount,10000);
  assert.equal(settlement.agencyPerformanceBonusBps,250);
  assert.equal(settlement.agencyPerformanceBonusCoins,2500);

  const statementId=agencyId+"__"+month;
  const [
    owner,
    state,
    legacyWallet,
    migrationLedger,
    bonusLedger,
    bonusAccrual,
  ]=await Promise.all([
    db.collection("users").doc(ownerUid).get(),
    db.collection("agency_financial_state").doc(agencyId).get(),
    db.collection("agency_wallets").doc(agencyId).get(),
    db.collection("financial_ledger")
      .doc("agency_wallet_migration_"+statementId).get(),
    db.collection("financial_ledger")
      .doc("agency_performance_bonus_"+statementId).get(),
    db.collection("agency_bonus_accruals").doc(statementId).get(),
  ]);

  // Legacy 2D migrates into the Owner's existing 10D. 7000 carryover +
  // 2500 Bonus = 9500, so no additional Bonus Diamond yet.
  assert.equal(owner.data().diamonds,12);
  assert.equal(state.data().carryoverCoins,9500);
  assert.equal(state.data().legacyWalletMigrated,true);
  assert.equal(legacyWallet.data().diamonds,0);
  assert.equal(legacyWallet.data().remainderCoins,0);
  assert.equal(legacyWallet.data().migratedToUnifiedWallet,true);
  assert.equal(migrationLedger.data().delta,2);
  assert.equal(bonusLedger.data().payableCoins,2500);
  assert.equal(bonusLedger.data().delta,0);
  assert.equal(bonusAccrual.data().perHostBonusCoins,2500);
  assert.equal(bonusAccrual.data().status,"settled");

  const replay=await settleAgencyHostSurplusPage(
    db,
    ownerUid,
    agencyId,
    month,
    {now,limit:25},
  );
  assert.equal(replay.duplicateCount,1);
  const ownerReplay=await db.collection("users").doc(ownerUid).get();
  assert.equal(ownerReplay.data().diamonds,12);
});
