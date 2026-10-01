import assert from "node:assert/strict";
import {after, test} from "node:test";
import {deleteApp, initializeApp} from "firebase-admin/app";
import {getFirestore} from "firebase-admin/firestore";

import {settleAgencyMonth} from "../economy/economy-control.js";

const app=initializeApp(
  {projectId:"shadow-live-economy-test"},
  "agency-stage07c-"+Date.now(),
);
const db=getFirestore(app);

after(async()=>{await deleteApp(app);});

async function seedEconomy(){
  await db.collection("system_config").doc("gift_economy").set({
    enabled:true,
    policyMode:"tiered_host_agency",
    coinsPerDiamond:10000,
    agencyPerformanceBonusMode:"per_host_target_month_end",
    agencyPerformanceBonusBps:100,
    hostPerformanceBonusBps:0,
  });
}

async function seedShard({
  agencyId,
  month,
  shard=0,
  supportCoins=100000,
  hostShareCoins=50000,
  agencyShareCoins=5000,
  platformShareCoins=45000,
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

test("07-C concurrent month close creates one no-share-payout statement",async()=>{
  await seedEconomy();
  const suffix=Date.now().toString()+"_race";
  const agencyId="stage07c_race_agency_"+suffix;
  const actorA="stage07c_owner_a_"+suffix;
  const actorB="stage07c_owner_b_"+suffix;
  const month="2026-09";
  const now=new Date("2026-11-15T00:00:00.000Z");

  await Promise.all([
    db.collection("agency_wallets").doc(agencyId).set({
      agencyId,
      diamonds:7,
      remainderCoins:2500,
      lifetimeDiamonds:7,
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

  const results=await Promise.all([
    settleAgencyMonth(db,actorA,agencyId,month,{now}),
    settleAgencyMonth(db,actorB,agencyId,month,{now}),
  ]);

  assert.equal(results.filter(item=>item.alreadySettled===false).length,1);
  assert.equal(results.filter(item=>item.alreadySettled===true).length,1);

  const statementId=agencyId+"__"+month;
  const [wallet,statement,ledger,audits]=await Promise.all([
    db.collection("agency_wallets").doc(agencyId).get(),
    db.collection("agency_monthly_statements").doc(statementId).get(),
    db.collection("financial_ledger")
      .doc("agency_month_close_"+statementId).get(),
    db.collection("admin_audit_logs")
      .where("action","==","settleAgencyMonth")
      .where("targetId","==",statementId)
      .get(),
  ]);

  assert.equal(wallet.data().diamonds,7);
  assert.equal(wallet.data().remainderCoins,2500);
  assert.equal(wallet.data().lifetimeDiamonds,7);
  assert.equal(statement.data().potentialAgencyShareCoins,50000);
  assert.equal(statement.data().agencyTargetShareCoins,0);
  assert.equal(statement.data().agencyMonthEndSharePayableCoins,0);
  assert.equal(statement.data().unearnedPotentialAgencyShareCoins,50000);
  assert.equal(ledger.data().asset,"coins");
  assert.equal(ledger.data().delta,0);
  assert.equal(ledger.data().payableCoins,0);
  assert.equal(ledger.data().reason,"agency_month_close_no_share_payout");
  assert.equal(audits.size,1);
});

test("07-C replay fails closed when month-close Ledger is missing",async()=>{
  await seedEconomy();
  const suffix=Date.now().toString()+"_ledger";
  const agencyId="stage07c_ledger_agency_"+suffix;
  const actorUid="stage07c_owner_"+suffix;
  const month="2026-09";
  const now=new Date("2026-11-15T00:00:00.000Z");
  const statementId=agencyId+"__"+month;
  const ledgerId="agency_month_close_"+statementId;

  await seedShard({agencyId,month});
  await settleAgencyMonth(db,actorUid,agencyId,month,{now});
  await db.collection("financial_ledger").doc(ledgerId).delete();

  await assert.rejects(
    settleAgencyMonth(db,actorUid,agencyId,month,{now}),
    /settlement_ledger_missing/,
  );
});

test("07-C replay fails closed when settled Statement reverts to legacy payout mode",async()=>{
  await seedEconomy();
  const suffix=Date.now().toString()+"_statement";
  const agencyId="stage07c_statement_agency_"+suffix;
  const actorUid="stage07c_owner_"+suffix;
  const month="2026-09";
  const now=new Date("2026-11-15T00:00:00.000Z");
  const statementId=agencyId+"__"+month;

  await seedShard({agencyId,month});
  await settleAgencyMonth(db,actorUid,agencyId,month,{now});

  await db.collection("agency_monthly_statements").doc(statementId).update({
    agencySharePayoutMode:"legacy_monthly",
  });

  await assert.rejects(
    settleAgencyMonth(db,actorUid,agencyId,month,{now}),
    /settlement_statement_conflict/,
  );
});

test("07-C legacy Agency Wallet state is quarantined from month-close accounting",async()=>{
  await seedEconomy();
  const now=new Date("2026-11-15T00:00:00.000Z");

  for(const [label,walletPatch] of [
    ["lifetime",{diamonds:5,lifetimeDiamonds:4,remainderCoins:0}],
    ["remainder",{diamonds:5,lifetimeDiamonds:5,remainderCoins:10000}],
  ]){
    const suffix=Date.now().toString()+"_"+label+"_"+Math.random().toString(36).slice(2,8);
    const agencyId="stage07c_legacy_agency_"+suffix;
    const actorUid="stage07c_owner_"+suffix;
    const month="2026-09";

    await Promise.all([
      db.collection("agency_wallets").doc(agencyId).set({agencyId,...walletPatch}),
      seedShard({agencyId,month}),
    ]);

    const result=await settleAgencyMonth(db,actorUid,agencyId,month,{now});
    assert.equal(result.alreadySettled,false);
    assert.equal(result.settlement.agencyMonthEndSharePayableCoins,0);

    const wallet=await db.collection("agency_wallets").doc(agencyId).get();
    assert.equal(wallet.data().diamonds,5);
    assert.equal(wallet.data().remainderCoins,walletPatch.remainderCoins);
  }
});
