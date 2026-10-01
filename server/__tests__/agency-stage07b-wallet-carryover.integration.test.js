import assert from "node:assert/strict";
import {after, test} from "node:test";
import {deleteApp, initializeApp} from "firebase-admin/app";
import {getFirestore} from "firebase-admin/firestore";

import {settleAgencyMonth} from "../economy/economy-control.js";

const app=initializeApp(
  {projectId:"shadow-live-economy-test"},
  "agency-stage07b-"+Date.now(),
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
  supportCoins,
  hostShareCoins,
  agencyShareCoins,
  platformShareCoins,
  giftCount,
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

test("07-B month close does not repay Target-close Agency Share or consume legacy carryover",async()=>{
  await seedEconomy();
  const suffix=Date.now().toString()+"_chain";
  const agencyId="stage07b_agency_"+suffix;
  const actorUid="stage07b_owner_"+suffix;
  const september="2026-09";
  const october="2026-10";
  const now=new Date("2026-11-15T00:00:00.000Z");

  await Promise.all([
    db.collection("agency_wallets").doc(agencyId).set({
      agencyId,
      diamonds:2,
      remainderCoins:7000,
      lifetimeDiamonds:2,
    }),
    seedShard({
      agencyId,
      month:september,
      shard:0,
      supportCoins:100000,
      hostShareCoins:50000,
      agencyShareCoins:5000,
      platformShareCoins:45000,
      giftCount:1,
    }),
    seedShard({
      agencyId,
      month:october,
      shard:17,
      supportCoins:300000,
      hostShareCoins:150000,
      agencyShareCoins:18000,
      platformShareCoins:132000,
      giftCount:3,
    }),
  ]);

  const first=await settleAgencyMonth(db,actorUid,agencyId,september,{now});
  assert.equal(first.alreadySettled,false);
  assert.equal(first.settlement.potentialAgencyShareCoins,5000);
  assert.equal(first.settlement.agencyTargetShareCoins,0);
  assert.equal(first.settlement.agencyShareCoins,0);
  assert.equal(first.settlement.agencyMonthEndSharePayableCoins,0);
  assert.equal(first.settlement.unearnedPotentialAgencyShareCoins,5000);
  assert.equal(first.settlement.hostSalaryMode,"target_immediate");
  assert.equal(first.settlement.hostSalaryRepaidAtMonthEnd,false);

  const second=await settleAgencyMonth(db,actorUid,agencyId,october,{now});
  assert.equal(second.alreadySettled,false);
  assert.equal(second.settlement.potentialAgencyShareCoins,18000);
  assert.equal(second.settlement.agencyTargetShareCoins,0);
  assert.equal(second.settlement.agencyShareCoins,0);
  assert.equal(second.settlement.agencyMonthEndSharePayableCoins,0);
  assert.equal(second.settlement.unearnedPotentialAgencyShareCoins,18000);

  const [wallet,sepLedger,octLedger]=await Promise.all([
    db.collection("agency_wallets").doc(agencyId).get(),
    db.collection("financial_ledger")
      .doc("agency_month_close_"+agencyId+"__"+september).get(),
    db.collection("financial_ledger")
      .doc("agency_month_close_"+agencyId+"__"+october).get(),
  ]);

  assert.equal(wallet.data().diamonds,2);
  assert.equal(wallet.data().remainderCoins,7000);
  assert.equal(wallet.data().lifetimeDiamonds,2);

  assert.equal(sepLedger.data().asset,"coins");
  assert.equal(sepLedger.data().delta,0);
  assert.equal(sepLedger.data().payableCoins,0);
  assert.equal(sepLedger.data().potentialAgencyShareCoins,5000);
  assert.equal(sepLedger.data().agencyTargetShareCoins,0);
  assert.equal(sepLedger.data().reason,"agency_month_close_no_share_payout");

  assert.equal(octLedger.data().delta,0);
  assert.equal(octLedger.data().payableCoins,0);
  assert.equal(octLedger.data().potentialAgencyShareCoins,18000);
  assert.equal(octLedger.data().agencyTargetShareCoins,0);

  const septemberAgain=await settleAgencyMonth(db,actorUid,agencyId,september,{now});
  const octoberAgain=await settleAgencyMonth(db,actorUid,agencyId,october,{now});
  assert.equal(septemberAgain.alreadySettled,true);
  assert.equal(octoberAgain.alreadySettled,true);

  const walletAfterRetries=await db.collection("agency_wallets").doc(agencyId).get();
  assert.equal(walletAfterRetries.data().diamonds,2);
  assert.equal(walletAfterRetries.data().remainderCoins,7000);
});

test("07-B zero-payout month-close replay still requires its close Ledger",async()=>{
  await seedEconomy();
  const suffix=Date.now().toString()+"_zero";
  const agencyId="stage07b_zero_agency_"+suffix;
  const actorUid="stage07b_owner_"+suffix;
  const month="2026-09";
  const now=new Date("2026-11-15T00:00:00.000Z");
  const statementId=agencyId+"__"+month;

  await seedShard({
    agencyId,
    month,
    shard:3,
    supportCoins:100000,
    hostShareCoins:91000,
    agencyShareCoins:4000,
    platformShareCoins:5000,
    giftCount:1,
  });

  const first=await settleAgencyMonth(db,actorUid,agencyId,month,{now});
  assert.equal(first.settlement.agencyTargetShareCoins,0);
  assert.equal(first.settlement.agencyMonthEndSharePayableCoins,0);
  assert.equal(first.settlement.unearnedPotentialAgencyShareCoins,4000);

  const ledgerRef=db.collection("financial_ledger")
    .doc("agency_month_close_"+statementId);
  const ledger=await ledgerRef.get();
  assert.equal(ledger.exists,true);
  assert.equal(ledger.data().delta,0);
  assert.equal(ledger.data().payableCoins,0);

  await ledgerRef.delete();

  await assert.rejects(
    settleAgencyMonth(db,actorUid,agencyId,month,{now}),
    /settlement_ledger_missing/,
  );
});

test("07-B legacy wallet conversion boundary is not processed again at month close",async()=>{
  await seedEconomy();
  const suffix=Date.now().toString()+"_boundary";
  const agencyId="stage07b_boundary_agency_"+suffix;
  const actorUid="stage07b_owner_"+suffix;
  const month="2026-09";
  const now=new Date("2026-11-15T00:00:00.000Z");

  await Promise.all([
    db.collection("agency_wallets").doc(agencyId).set({
      agencyId,
      diamonds:0,
      remainderCoins:9999,
      lifetimeDiamonds:0,
    }),
    seedShard({
      agencyId,
      month,
      shard:11,
      supportCoins:100000,
      hostShareCoins:99999,
      agencyShareCoins:1,
      platformShareCoins:0,
      giftCount:1,
    }),
  ]);

  const result=await settleAgencyMonth(db,actorUid,agencyId,month,{now});
  assert.equal(result.settlement.potentialAgencyShareCoins,1);
  assert.equal(result.settlement.agencyTargetShareCoins,0);
  assert.equal(result.settlement.agencyMonthEndSharePayableCoins,0);

  const wallet=await db.collection("agency_wallets").doc(agencyId).get();
  assert.equal(wallet.data().diamonds,0);
  assert.equal(wallet.data().remainderCoins,9999);
  assert.equal(wallet.data().lifetimeDiamonds,0);
});
