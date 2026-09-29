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
  });
}

async function seedShard({
  agencyId,
  month,
  shard,
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

test("07-B carries Agency Share remainder across months and credits whole Diamonds exactly once",async()=>{
  await seedEconomy();
  const suffix=Date.now().toString()+"_chain";
  const agencyId="stage07b_agency_"+suffix;
  const actorUid="stage07b_owner_"+suffix;
  const hostUid="stage07b_host_"+suffix;
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
    db.collection("users").doc(hostUid).set({
      agencyId,
      agencyRole:"host",
      diamonds:99,
      agencySalaryPaidDiamonds:42,
      agencyTargetMonth:october,
      agencyTargetProgressCoins:123456,
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

  const first=await settleAgencyMonth(
    db,
    actorUid,
    agencyId,
    september,
    {now},
  );
  assert.equal(first.alreadySettled,false);
  assert.equal(first.settlement.openingRemainderCoins,7000);
  assert.equal(first.settlement.agencyShareCoins,5000);
  assert.equal(first.settlement.agencyDiamonds,1);
  assert.equal(first.settlement.agencyRemainderCoins,2000);
  assert.equal(first.settlement.hostSalaryMode,"target_immediate");
  assert.equal(first.settlement.hostSalaryRepaidAtMonthEnd,false);

  const walletAfterSeptember=await db.collection("agency_wallets").doc(agencyId).get();
  assert.equal(walletAfterSeptember.data().diamonds,3);
  assert.equal(walletAfterSeptember.data().remainderCoins,2000);
  assert.equal(walletAfterSeptember.data().lifetimeDiamonds,3);

  const second=await settleAgencyMonth(
    db,
    actorUid,
    agencyId,
    october,
    {now},
  );
  assert.equal(second.alreadySettled,false);
  assert.equal(second.settlement.openingRemainderCoins,2000);
  assert.equal(second.settlement.agencyShareCoins,18000);
  assert.equal(second.settlement.agencyDiamonds,2);
  assert.equal(second.settlement.agencyRemainderCoins,0);
  assert.equal(second.settlement.hostSalaryRepaidAtMonthEnd,false);

  const [wallet,host,sepStatement,octStatement,sepLedger,octLedger]=await Promise.all([
    db.collection("agency_wallets").doc(agencyId).get(),
    db.collection("users").doc(hostUid).get(),
    db.collection("agency_monthly_statements").doc(agencyId+"__"+september).get(),
    db.collection("agency_monthly_statements").doc(agencyId+"__"+october).get(),
    db.collection("financial_ledger").doc("agency_monthly_share_"+agencyId+"__"+september).get(),
    db.collection("financial_ledger").doc("agency_monthly_share_"+agencyId+"__"+october).get(),
  ]);

  assert.equal(wallet.data().diamonds,5);
  assert.equal(wallet.data().remainderCoins,0);
  assert.equal(wallet.data().lifetimeDiamonds,5);

  assert.equal(host.data().diamonds,99);
  assert.equal(host.data().agencySalaryPaidDiamonds,42);
  assert.equal(host.data().agencyTargetProgressCoins,123456);

  assert.equal(sepStatement.data().agencyDiamonds,1);
  assert.equal(sepStatement.data().openingRemainderCoins,7000);
  assert.equal(sepStatement.data().agencyRemainderCoins,2000);
  assert.equal(sepStatement.data().ledgerId,"agency_monthly_share_"+agencyId+"__"+september);
  assert.equal(octStatement.data().agencyDiamonds,2);
  assert.equal(octStatement.data().openingRemainderCoins,2000);
  assert.equal(octStatement.data().agencyRemainderCoins,0);

  assert.equal(sepLedger.data().reason,"agency_monthly_share");
  assert.equal(sepLedger.data().sourceType,"agency_monthly_statement");
  assert.equal(sepLedger.data().sourceId,agencyId+"__"+september);
  assert.equal(sepLedger.data().delta,1);
  assert.equal(sepLedger.data().openingBalance,2);
  assert.equal(sepLedger.data().closingBalance,3);
  assert.equal(sepLedger.data().payableCoins,5000);
  assert.equal(sepLedger.data().openingRemainderCoins,7000);
  assert.equal(sepLedger.data().remainderCoins,2000);

  assert.equal(octLedger.data().delta,2);
  assert.equal(octLedger.data().openingBalance,3);
  assert.equal(octLedger.data().closingBalance,5);
  assert.equal(octLedger.data().payableCoins,18000);
  assert.equal(octLedger.data().openingRemainderCoins,2000);
  assert.equal(octLedger.data().remainderCoins,0);

  const septemberAgain=await settleAgencyMonth(
    db,
    actorUid,
    agencyId,
    september,
    {now},
  );
  const octoberAgain=await settleAgencyMonth(
    db,
    actorUid,
    agencyId,
    october,
    {now},
  );
  assert.equal(septemberAgain.alreadySettled,true);
  assert.equal(octoberAgain.alreadySettled,true);

  const walletAfterRetries=await db.collection("agency_wallets").doc(agencyId).get();
  assert.equal(walletAfterRetries.data().diamonds,5);
  assert.equal(walletAfterRetries.data().remainderCoins,0);
  assert.equal(walletAfterRetries.data().lifetimeDiamonds,5);
});

test("07-B zero-Diamond carryover still requires its source Ledger on idempotent replay",async()=>{
  await seedEconomy();
  const suffix=Date.now().toString()+"_zero";
  const agencyId="stage07b_zero_agency_"+suffix;
  const actorUid="stage07b_owner_"+suffix;
  const month="2026-09";
  const now=new Date("2026-11-15T00:00:00.000Z");
  const statementId=agencyId+"__"+month;

  await Promise.all([
    db.collection("agency_wallets").doc(agencyId).set({
      agencyId,
      diamonds:4,
      remainderCoins:1000,
      lifetimeDiamonds:4,
    }),
    seedShard({
      agencyId,
      month,
      shard:3,
      supportCoins:100000,
      hostShareCoins:91000,
      agencyShareCoins:4000,
      platformShareCoins:5000,
      giftCount:1,
    }),
  ]);

  const first=await settleAgencyMonth(db,actorUid,agencyId,month,{now});
  assert.equal(first.settlement.agencyDiamonds,0);
  assert.equal(first.settlement.openingRemainderCoins,1000);
  assert.equal(first.settlement.agencyRemainderCoins,5000);

  const ledgerRef=db.collection("financial_ledger")
    .doc("agency_monthly_share_"+statementId);
  const ledger=await ledgerRef.get();
  assert.equal(ledger.exists,true);
  assert.equal(ledger.data().delta,0);
  assert.equal(ledger.data().payableCoins,4000);
  assert.equal(ledger.data().openingRemainderCoins,1000);
  assert.equal(ledger.data().remainderCoins,5000);

  await ledgerRef.delete();

  await assert.rejects(
    settleAgencyMonth(db,actorUid,agencyId,month,{now}),
    /settlement_ledger_missing/,
  );

  const wallet=await db.collection("agency_wallets").doc(agencyId).get();
  assert.equal(wallet.data().diamonds,4);
  assert.equal(wallet.data().remainderCoins,5000);
});

test("07-B exact conversion boundary credits one Diamond and clears remainder",async()=>{
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
  assert.equal(result.settlement.agencyShareCoins,1);
  assert.equal(result.settlement.agencyDiamonds,1);
  assert.equal(result.settlement.agencyRemainderCoins,0);

  const wallet=await db.collection("agency_wallets").doc(agencyId).get();
  assert.equal(wallet.data().diamonds,1);
  assert.equal(wallet.data().remainderCoins,0);
  assert.equal(wallet.data().lifetimeDiamonds,1);
});
