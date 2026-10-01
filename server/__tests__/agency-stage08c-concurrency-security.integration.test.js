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
  "agency-stage08c-"+Date.now(),
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

async function seedBaseMonth(agencyId,month){
  await db.collection("agency_monthly_accrual_shards")
    .doc(agencyId+"__"+month+"__00").set({
      agencyId,
      month,
      shard:0,
      supportCoins:100000,
      hostShareCoins:50000,
      agencyShareCoins:5000,
      platformShareCoins:45000,
      giftCount:1,
    });
}

async function seedHost(agencyId,month,hostUid){
  const id=agencyId+"__"+month+"__"+hostUid;
  await Promise.all([
    db.collection("agency_policy_overrides").doc(agencyId).set({
      agencyId,
      surplusToShadow:false,
      agencyPerformanceBonusMode:"per_host_target_month_end",
      agencyPerformanceBonusBps:100,
    }),
    db.collection("agency_host_monthly").doc(id).set({
      agencyId,
      month,
      hostUid,
      surplusPageKey:id,
      supportCoins:100000,
      hostShareCoins:50000,
      agencyShareCoins:5000,
      giftCount:1,
      targetId:"starter_g",
      targetTierId:"starter",
      targetRank:"G",
      targetThresholdCoins:50000,
      salaryPaidDiamonds:5,
      activityQualifiedDays:14,
    }),
    db.collection("users").doc(hostUid).set({
      agencyId,
      coins:0,
      diamonds:0,
    }),
  ]);
}

test("08-C concurrent Base Agency Share settlement credits exactly once without legacy percentage Bonus",async()=>{
  await seedEconomy();
  const suffix=Date.now().toString()+"_base";
  const agencyId="stage08c_agency_"+suffix;
  const month="2026-09";
  const now=new Date("2026-11-15T00:00:00.000Z");

  await Promise.all([
    db.collection("agency_wallets").doc(agencyId).set({
      agencyId,diamonds:1,remainderCoins:0,lifetimeDiamonds:1,
    }),
    seedBaseMonth(agencyId,month),
  ]);

  const results=await Promise.all([
    settleAgencyMonth(db,"owner_a",agencyId,month,{now}),
    settleAgencyMonth(db,"owner_b",agencyId,month,{now}),
  ]);

  assert.equal(results.filter(x=>x.alreadySettled===false).length,1);
  assert.equal(results.filter(x=>x.alreadySettled===true).length,1);

  const statementId=agencyId+"__"+month;
  const [wallet,statement,ledger,audits]=await Promise.all([
    db.collection("agency_wallets").doc(agencyId).get(),
    db.collection("agency_monthly_statements").doc(statementId).get(),
    db.collection("financial_ledger").doc("agency_monthly_share_"+statementId).get(),
    db.collection("admin_audit_logs")
      .where("action","==","settleAgencyMonth")
      .where("targetId","==",statementId)
      .get(),
  ]);

  assert.equal(wallet.data().diamonds,1);
  assert.equal(wallet.data().remainderCoins,5000);
  assert.equal(statement.data().agencyBonusCoins,0);
  assert.equal(statement.data().agencyPayableCoins,5000);
  assert.equal(ledger.data().delta,0);
  assert.equal(ledger.data().payableCoins,5000);
  assert.equal(audits.size,1);
});

test("08-C concurrent per-host month-end settlement pays Host and Agency bonuses exactly once",async()=>{
  await seedEconomy();
  const suffix=Date.now().toString()+"_host_race";
  const agencyId="stage08c_host_"+suffix;
  const hostUid="host_"+suffix;
  const month="2026-09";
  const now=new Date("2026-11-15T00:00:00.000Z");

  await seedHost(agencyId,month,hostUid);

  const results=await Promise.all([
    settleAgencyHostSurplusPage(db,"owner_a",agencyId,month,{now,limit:25}),
    settleAgencyHostSurplusPage(db,"owner_b",agencyId,month,{now,limit:25}),
  ]);

  assert.equal(
    results.reduce((sum,item)=>sum+item.settledCount,0),
    1,
  );
  assert.equal(
    results.reduce((sum,item)=>sum+item.duplicateCount,0),
    1,
  );

  const hostMonthId=agencyId+"__"+month+"__"+hostUid;
  const [host,wallet,hostLedger,agencyLedger,bonus]=await Promise.all([
    db.collection("users").doc(hostUid).get(),
    db.collection("agency_wallets").doc(agencyId).get(),
    db.collection("financial_ledger")
      .doc("agency_host_activity_bonus_"+hostMonthId).get(),
    db.collection("financial_ledger")
      .doc("agency_performance_bonus_"+hostMonthId).get(),
    db.collection("agency_bonus_accruals").doc(agencyId+"__"+month).get(),
  ]);

  assert.equal(host.data().coins,5000);
  assert.equal(hostLedger.data().delta,5000);
  assert.equal(agencyLedger.data().payableCoins,500);
  assert.equal(wallet.data().remainderCoins,500);
  assert.equal(bonus.data().perHostEligibleHostCount,1);
  assert.equal(bonus.data().perHostBonusCoins,500);
});

test("08-C settled Host/Agency bonus replay remains historical after later policy changes",async()=>{
  await seedEconomy();
  const suffix=Date.now().toString()+"_historical";
  const agencyId="stage08c_historical_"+suffix;
  const hostUid="host_"+suffix;
  const month="2026-09";
  const now=new Date("2026-11-15T00:00:00.000Z");

  await seedHost(agencyId,month,hostUid);
  const first=await settleAgencyHostSurplusPage(
    db,"owner",agencyId,month,{now,limit:25},
  );
  assert.equal(first.results[0].settlement.agencyPerformanceBonusBps,100);

  await Promise.all([
    db.collection("system_config").doc("gift_economy").set({
      enabled:true,
      policyMode:"tiered_host_agency",
      coinsPerDiamond:20000,
      agencyPerformanceBonusMode:"per_host_target_month_end",
      agencyPerformanceBonusBps:500,
    }),
    db.collection("agency_policy_overrides").doc(agencyId).set({
      agencyId,
      surplusToShadow:true,
      agencyPerformanceBonusMode:"per_host_target_month_end",
      agencyPerformanceBonusBps:1000,
    }),
  ]);

  const replay=await settleAgencyHostSurplusPage(
    db,"owner",agencyId,month,{now,limit:25},
  );
  assert.equal(replay.results[0].alreadySettled,true);
  assert.equal(replay.results[0].settlement.agencyPerformanceBonusBps,100);
  assert.equal(replay.results[0].settlement.agencyPerformanceBonusCoins,500);
});

test("08-C replay fails closed when an approved Host bonus ledger is missing",async()=>{
  await seedEconomy();
  const suffix=Date.now().toString()+"_missing";
  const agencyId="stage08c_missing_"+suffix;
  const hostUid="host_"+suffix;
  const month="2026-09";
  const now=new Date("2026-11-15T00:00:00.000Z");

  await seedHost(agencyId,month,hostUid);
  await settleAgencyHostSurplusPage(
    db,"owner",agencyId,month,{now,limit:25},
  );

  const hostMonthId=agencyId+"__"+month+"__"+hostUid;
  await db.collection("financial_ledger")
    .doc("agency_host_activity_bonus_"+hostMonthId).delete();

  await assert.rejects(
    settleAgencyHostSurplusPage(db,"owner",agencyId,month,{now,limit:25}),
    /agency_host_bonus_ledger_missing/,
  );
});

test("08-C pre-existing per-host bonus accrual does not block later Base Agency Share settlement",async()=>{
  await seedEconomy();
  const agencyId="stage08c_prebonus_"+Date.now();
  const month="2026-09";
  const now=new Date("2026-11-15T00:00:00.000Z");

  await Promise.all([
    seedBaseMonth(agencyId,month),
    db.collection("agency_bonus_accruals").doc(agencyId+"__"+month).set({
      agencyId,
      month,
      mode:"per_host_target_month_end",
      perHostEligibleHostCount:1,
      perHostBonusCoins:500,
    }),
  ]);

  const result=await settleAgencyMonth(db,"owner",agencyId,month,{now});
  assert.equal(result.alreadySettled,false);
  assert.equal(result.settlement.agencyBonusCoins,0);
  const bonus=await db.collection("agency_bonus_accruals")
    .doc(agencyId+"__"+month).get();
  assert.equal(bonus.data().perHostBonusCoins,500);
  assert.equal(bonus.data().status,"settled");
});
