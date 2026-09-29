import assert from "node:assert/strict";
import {after, test} from "node:test";
import {deleteApp, initializeApp} from "firebase-admin/app";
import {getFirestore} from "firebase-admin/firestore";

import {settleAgencyMonth} from "../economy/economy-control.js";

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
    agencyPerformanceBonusBps:200,
    agencyBonusActiveHosts:10,
    ...overrides,
  });
}

async function seedEligibleMonth(agencyId,month){
  await Promise.all([
    db.collection("agency_support_stats").doc(agencyId)
      .collection("monthly").doc(month).set({
        activeHostCount:10,
        activeHostIds:Array.from({length:10},(_,i)=>"h"+i),
      }),
    db.collection("agency_monthly_accrual_shards")
      .doc(agencyId+"__"+month+"__00").set({
        agencyId,
        month,
        shard:0,
        supportCoins:1000000,
        hostShareCoins:500000,
        agencyShareCoins:50000,
        platformShareCoins:450000,
        giftCount:10,
      }),
  ]);
}

test("08-C concurrent eligible Bonus settlements credit exactly once",async()=>{
  await seedEconomy();
  const suffix=Date.now().toString()+"_race";
  const agencyId="stage08c_agency_"+suffix;
  const month="2026-09";
  const now=new Date("2026-11-15T00:00:00.000Z");

  await Promise.all([
    db.collection("agency_wallets").doc(agencyId).set({
      agencyId,diamonds:1,remainderCoins:0,lifetimeDiamonds:1,
    }),
    seedEligibleMonth(agencyId,month),
  ]);

  const results=await Promise.all([
    settleAgencyMonth(db,"owner_a",agencyId,month,{now}),
    settleAgencyMonth(db,"owner_b",agencyId,month,{now}),
  ]);

  assert.equal(results.filter(x=>x.alreadySettled===false).length,1);
  assert.equal(results.filter(x=>x.alreadySettled===true).length,1);

  const statementId=agencyId+"__"+month;
  const [wallet,statement,ledger,bonus,audits]=await Promise.all([
    db.collection("agency_wallets").doc(agencyId).get(),
    db.collection("agency_monthly_statements").doc(statementId).get(),
    db.collection("financial_ledger").doc("agency_monthly_share_"+statementId).get(),
    db.collection("agency_bonus_accruals").doc(statementId).get(),
    db.collection("admin_audit_logs")
      .where("action","==","settleAgencyMonth")
      .where("targetId","==",statementId)
      .get(),
  ]);

  assert.equal(wallet.data().diamonds,8);
  assert.equal(statement.data().agencyBonusCoins,20000);
  assert.equal(statement.data().agencyPayableCoins,70000);
  assert.equal(ledger.data().delta,7);
  assert.equal(bonus.data().bonusCoins,20000);
  assert.equal(audits.size,1);
});

test("08-C settled replay remains valid after later policy and conversion changes",async()=>{
  await seedEconomy();
  const suffix=Date.now().toString()+"_historical";
  const agencyId="stage08c_historical_"+suffix;
  const month="2026-09";
  const now=new Date("2026-11-15T00:00:00.000Z");

  await seedEligibleMonth(agencyId,month);
  const first=await settleAgencyMonth(db,"owner",agencyId,month,{now});
  assert.equal(first.settlement.coinsPerDiamond,10000);
  assert.equal(first.settlement.agencyBonusBps,200);

  await Promise.all([
    db.collection("system_config").doc("gift_economy").set({
      enabled:true,
      policyMode:"tiered_host_agency",
      coinsPerDiamond:20000,
      agencyPerformanceBonusBps:500,
      agencyBonusActiveHosts:1,
    }),
    db.collection("agency_policy_overrides").doc(agencyId).set({
      agencyPerformanceBonusBps:1000,
      agencyBonusActiveHosts:1,
    }),
  ]);

  const replay=await settleAgencyMonth(db,"owner",agencyId,month,{now});
  assert.equal(replay.alreadySettled,true);
  assert.equal(replay.settlement.coinsPerDiamond,10000);
  assert.equal(replay.settlement.agencyBonusBps,200);
  assert.equal(replay.settlement.agencyBonusCoins,20000);
});

test("08-C replay fails closed when Bonus Accrual is missing or corrupted",async()=>{
  await seedEconomy();
  const now=new Date("2026-11-15T00:00:00.000Z");

  for(const mode of ["missing","corrupt"]){
    const suffix=Date.now().toString()+"_"+mode;
    const agencyId="stage08c_bonus_"+suffix;
    const month="2026-09";
    const statementId=agencyId+"__"+month;

    await seedEligibleMonth(agencyId,month);
    await settleAgencyMonth(db,"owner",agencyId,month,{now});

    const ref=db.collection("agency_bonus_accruals").doc(statementId);
    if(mode==="missing"){
      await ref.delete();
      await assert.rejects(
        settleAgencyMonth(db,"owner",agencyId,month,{now}),
        /settlement_bonus_accrual_missing/,
      );
    }else{
      await ref.update({bonusCoins:999999});
      await assert.rejects(
        settleAgencyMonth(db,"owner",agencyId,month,{now}),
        /settlement_bonus_accrual_conflict/,
      );
    }
  }
});

test("08-C orphan Bonus Accrual blocks a fresh settlement",async()=>{
  await seedEconomy();
  const agencyId="stage08c_orphan_"+Date.now();
  const month="2026-09";
  const statementId=agencyId+"__"+month;
  const now=new Date("2026-11-15T00:00:00.000Z");

  await Promise.all([
    seedEligibleMonth(agencyId,month),
    db.collection("agency_bonus_accruals").doc(statementId).set({
      agencyId,month,status:"settled",
    }),
  ]);

  await assert.rejects(
    settleAgencyMonth(db,"owner",agencyId,month,{now}),
    /settlement_bonus_accrual_conflict/,
  );

  const wallet=await db.collection("agency_wallets").doc(agencyId).get();
  assert.equal(wallet.exists,false);
});
