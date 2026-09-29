import assert from "node:assert/strict";
import {after, test} from "node:test";
import {deleteApp, initializeApp} from "firebase-admin/app";
import {getFirestore} from "firebase-admin/firestore";

import {settleAgencyMonth} from "../economy/economy-control.js";

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
    agencyPerformanceBonusBps:200,
    agencyBonusActiveHosts:10,
    ...overrides,
  });
}

async function seedShard({
  agencyId,
  month,
  shard=0,
  supportCoins,
  hostShareCoins,
  agencyShareCoins,
  platformShareCoins,
  giftCount=1,
}){
  await db.collection("agency_monthly_accrual_shards")
    .doc(agencyId+"__"+month+"__"+String(shard).padStart(2,"0"))
    .set({
      agencyId,
      month,
      shard,
      supportCoins,
      hostShareCoins,
      agencyShareCoins,
      platformShareCoins,
      giftCount,
    });
}

async function seedActivity(agencyId,month,data){
  await db.collection("agency_support_stats")
    .doc(agencyId)
    .collection("monthly")
    .doc(month)
    .set(data);
}

test("08-B month rollover settles eligible Agency Bonus into whole Diamonds with carryover",async()=>{
  await seedEconomy();
  const suffix=Date.now().toString()+"_eligible";
  const agencyId="stage08b_agency_"+suffix;
  const actorUid="stage08b_owner_"+suffix;
  const hostUid="stage08b_host_"+suffix;
  const month="2026-09";
  const now=new Date("2026-10-15T00:00:00.000Z");

  await Promise.all([
    db.collection("agency_wallets").doc(agencyId).set({
      agencyId,
      diamonds:2,
      remainderCoins:5000,
      lifetimeDiamonds:2,
    }),
    db.collection("users").doc(hostUid).set({
      agencyId,
      agencyRole:"host",
      diamonds:77,
      agencySalaryPaidDiamonds:30,
      agencyTargetMonth:month,
      agencyTargetProgressCoins:400000,
    }),
    seedActivity(agencyId,month,{
      activeHostCount:10,
      activeHostIds:Array.from({length:10},(_,index)=>"host_"+index),
    }),
    seedShard({
      agencyId,
      month,
      supportCoins:1000000,
      hostShareCoins:500000,
      agencyShareCoins:50000,
      platformShareCoins:450000,
      giftCount:10,
    }),
  ]);

  const first=await settleAgencyMonth(
    db,
    actorUid,
    agencyId,
    month,
    {now},
  );

  assert.equal(first.alreadySettled,false);
  assert.equal(first.settlement.agencyBaseShareCoins,50000);
  assert.equal(first.settlement.agencyBonusEligible,true);
  assert.equal(first.settlement.agencyBonusBps,200);
  assert.equal(first.settlement.agencyBonusCoins,20000);
  assert.equal(first.settlement.agencyPayableCoins,70000);
  assert.equal(first.settlement.agencyActiveHostCount,10);
  assert.equal(first.settlement.agencyRequiredActiveHosts,10);
  assert.equal(first.settlement.platformAfterAgencyBonusCoins,430000);
  assert.equal(first.settlement.openingRemainderCoins,5000);
  assert.equal(first.settlement.agencyDiamonds,7);
  assert.equal(first.settlement.agencyRemainderCoins,5000);
  assert.equal(first.settlement.hostSalaryMode,"target_immediate");
  assert.equal(first.settlement.hostSalaryRepaidAtMonthEnd,false);

  const statementId=agencyId+"__"+month;
  const [wallet,host,bonusAccrual,ledger,statement]=await Promise.all([
    db.collection("agency_wallets").doc(agencyId).get(),
    db.collection("users").doc(hostUid).get(),
    db.collection("agency_bonus_accruals").doc(statementId).get(),
    db.collection("financial_ledger")
      .doc("agency_monthly_share_"+statementId).get(),
    db.collection("agency_monthly_statements").doc(statementId).get(),
  ]);

  assert.equal(wallet.data().diamonds,9);
  assert.equal(wallet.data().remainderCoins,5000);
  assert.equal(wallet.data().lifetimeDiamonds,9);

  assert.equal(host.data().diamonds,77);
  assert.equal(host.data().agencySalaryPaidDiamonds,30);
  assert.equal(host.data().agencyTargetProgressCoins,400000);

  assert.equal(bonusAccrual.data().eligible,true);
  assert.equal(bonusAccrual.data().bonusBps,200);
  assert.equal(bonusAccrual.data().bonusCoins,20000);
  assert.equal(bonusAccrual.data().agencyPayableCoins,70000);
  assert.equal(bonusAccrual.data().platformAfterAgencyBonusCoins,430000);
  assert.equal(bonusAccrual.data().status,"settled");

  assert.equal(ledger.data().payableCoins,70000);
  assert.equal(ledger.data().baseAgencyShareCoins,50000);
  assert.equal(ledger.data().agencyBonusCoins,20000);
  assert.equal(ledger.data().platformAfterAgencyBonusCoins,430000);
  assert.equal(ledger.data().delta,7);

  assert.equal(
    statement.data().hostShareCoins+
      statement.data().agencyPayableCoins+
      statement.data().platformAfterAgencyBonusCoins,
    statement.data().supportCoins,
  );

  const replay=await settleAgencyMonth(
    db,
    actorUid,
    agencyId,
    month,
    {now},
  );
  assert.equal(replay.alreadySettled,true);

  const walletAfterReplay=await db.collection("agency_wallets").doc(agencyId).get();
  assert.equal(walletAfterReplay.data().diamonds,9);
  assert.equal(walletAfterReplay.data().remainderCoins,5000);
});

test("08-B per-agency Bonus override wins over Global at closed-month settlement",async()=>{
  await seedEconomy({
    agencyPerformanceBonusBps:200,
    agencyBonusActiveHosts:10,
  });
  const suffix=Date.now().toString()+"_override";
  const agencyId="stage08b_override_agency_"+suffix;
  const actorUid="stage08b_owner_"+suffix;
  const month="2026-09";
  const now=new Date("2026-10-15T00:00:00.000Z");

  await Promise.all([
    db.collection("agency_policy_overrides").doc(agencyId).set({
      agencyId,
      agencyPerformanceBonusBps:125,
      agencyBonusActiveHosts:3,
    }),
    db.collection("agency_wallets").doc(agencyId).set({
      agencyId,
      diamonds:0,
      remainderCoins:9999,
      lifetimeDiamonds:0,
    }),
    seedActivity(agencyId,month,{
      activeHostCount:3,
      activeHostIds:["h1","h2","h3"],
    }),
    seedShard({
      agencyId,
      month,
      shard:7,
      supportCoins:800000,
      hostShareCoins:400000,
      agencyShareCoins:40000,
      platformShareCoins:360000,
      giftCount:8,
    }),
  ]);

  const result=await settleAgencyMonth(
    db,
    actorUid,
    agencyId,
    month,
    {now},
  );

  assert.equal(result.settlement.bonusPolicySource,"agency_override");
  assert.equal(result.settlement.agencyRequiredActiveHosts,3);
  assert.equal(result.settlement.agencyBonusBps,125);
  assert.equal(result.settlement.agencyBonusCoins,10000);
  assert.equal(result.settlement.agencyPayableCoins,50000);
  assert.equal(result.settlement.platformAfterAgencyBonusCoins,350000);
  assert.equal(result.settlement.agencyDiamonds,5);
  assert.equal(result.settlement.agencyRemainderCoins,9999);

  const bonus=await db.collection("agency_bonus_accruals")
    .doc(agencyId+"__"+month).get();
  assert.equal(bonus.data().policySource,"agency_override");
  assert.equal(bonus.data().requiredActiveHosts,3);
  assert.equal(bonus.data().bonusBps,125);
  assert.equal(bonus.data().bonusCoins,10000);
});

test("08-B below activity threshold records zero Bonus and still settles Base Agency Share",async()=>{
  await seedEconomy();
  const suffix=Date.now().toString()+"_below";
  const agencyId="stage08b_below_agency_"+suffix;
  const actorUid="stage08b_owner_"+suffix;
  const month="2026-09";
  const now=new Date("2026-10-15T00:00:00.000Z");

  await Promise.all([
    seedActivity(agencyId,month,{
      activeHostIds:Array.from({length:9},(_,index)=>"legacy_host_"+index),
    }),
    seedShard({
      agencyId,
      month,
      shard:12,
      supportCoins:200000,
      hostShareCoins:100000,
      agencyShareCoins:10000,
      platformShareCoins:90000,
      giftCount:2,
    }),
  ]);

  const result=await settleAgencyMonth(
    db,
    actorUid,
    agencyId,
    month,
    {now},
  );

  assert.equal(result.settlement.agencyActiveHostCount,9);
  assert.equal(result.settlement.agencyBonusEligible,false);
  assert.equal(result.settlement.agencyBonusBps,0);
  assert.equal(result.settlement.agencyBonusCoins,0);
  assert.equal(result.settlement.agencyPayableCoins,10000);
  assert.equal(result.settlement.platformAfterAgencyBonusCoins,90000);
  assert.equal(result.settlement.agencyDiamonds,1);
  assert.equal(result.settlement.agencyRemainderCoins,0);

  const bonus=await db.collection("agency_bonus_accruals")
    .doc(agencyId+"__"+month).get();
  assert.equal(bonus.data().eligible,false);
  assert.equal(bonus.data().bonusCoins,0);
});
