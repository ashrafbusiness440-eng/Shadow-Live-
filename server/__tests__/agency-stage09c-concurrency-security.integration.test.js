import assert from "node:assert/strict";
import {after, test} from "node:test";
import {deleteApp, initializeApp} from "firebase-admin/app";
import {getFirestore} from "firebase-admin/firestore";

import {settleAgencyHostSurplusPage} from "../economy/economy-control.js";

const app=initializeApp(
  {projectId:"shadow-live-economy-test"},
  "agency-stage09c-"+Date.now(),
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
  hostShareCoins=70000,
  targetThresholdCoins=50000,
  salaryPaidDiamonds=5,
  coins=1000,
}){
  const id=hostMonthId(agencyId,month,hostUid);
  await Promise.all([
    db.collection("users").doc(hostUid).set({coins,diamonds:salaryPaidDiamonds}),
    db.collection("agency_host_monthly").doc(id).set({
      agencyId,
      month,
      hostUid,
      surplusPageKey:id,
      hostShareCoins,
      targetThresholdCoins,
      salaryPaidDiamonds,
      giftCount:1,
    }),
  ]);
  return id;
}

async function seedPolicy(agencyId,surplusToShadow){
  await db.collection("agency_policy_overrides").doc(agencyId).set({
    agencyId,
    surplusToShadow,
  });
}

test("09-C concurrent first-page settlement credits Host exactly once",async()=>{
  const suffix=Date.now().toString()+"_race";
  const agencyId="stage09c_race_"+suffix;
  const month="2026-09";
  const hostUid="host_"+suffix;
  const id=await seedHostMonth({
    agencyId,month,hostUid,coins:500,
  });
  await seedPolicy(agencyId,false);
  const now=new Date("2026-10-15T00:00:00.000Z");

  const [a,b]=await Promise.all([
    settleAgencyHostSurplusPage(db,"owner_a",agencyId,month,{now,limit:1}),
    settleAgencyHostSurplusPage(db,"owner_b",agencyId,month,{now,limit:1}),
  ]);

  assert.equal(a.processedCount,1);
  assert.equal(b.processedCount,1);
  assert.equal(a.settledCount+b.settledCount,1);
  assert.equal(a.duplicateCount+b.duplicateCount,1);

  const [user,snapshot,settlement,ledger,audit]=await Promise.all([
    db.collection("users").doc(hostUid).get(),
    db.collection("agency_surplus_policy_snapshots")
      .doc(agencyId+"__"+month).get(),
    db.collection("agency_surplus_settlements").doc(id).get(),
    db.collection("financial_ledger").doc("agency_host_surplus_"+id).get(),
    db.collection("admin_audit_logs").doc("agency_host_surplus_"+id).get(),
  ]);

  assert.equal(user.data().coins,20500);
  assert.equal(snapshot.data().status,"frozen");
  assert.equal(snapshot.data().surplusToShadow,false);
  assert.equal(settlement.data().surplusCoins,20000);
  assert.equal(settlement.data().hostWalletCoins,20000);
  assert.equal(settlement.data().shadowProfitCoins,0);
  assert.equal(ledger.data().delta,20000);
  assert.equal(ledger.data().openingBalance,500);
  assert.equal(ledger.data().closingBalance,20500);
  assert.equal(audit.data().action,"settleAgencyHostSurplus");
});

test("09-C historical replay keeps frozen policy after later toggle change",async()=>{
  const suffix=Date.now().toString()+"_history";
  const agencyId="stage09c_history_"+suffix;
  const month="2026-09";
  const hostUid="host_"+suffix;
  const id=await seedHostMonth({agencyId,month,hostUid,coins:700});
  await seedPolicy(agencyId,false);
  const now=new Date("2026-10-15T00:00:00.000Z");

  const first=await settleAgencyHostSurplusPage(
    db,"owner",agencyId,month,{now,limit:25},
  );
  assert.equal(first.results[0].settlement.destination,"host_wallet_coins");

  await db.collection("agency_policy_overrides").doc(agencyId).update({
    surplusToShadow:true,
  });

  const replay=await settleAgencyHostSurplusPage(
    db,"owner",agencyId,month,{now,limit:25},
  );
  assert.equal(replay.settledCount,0);
  assert.equal(replay.duplicateCount,1);
  assert.equal(replay.policySnapshot.surplusToShadow,false);
  assert.equal(replay.results[0].settlement.destination,"host_wallet_coins");

  const [user,snapshot,settlement]=await Promise.all([
    db.collection("users").doc(hostUid).get(),
    db.collection("agency_surplus_policy_snapshots")
      .doc(agencyId+"__"+month).get(),
    db.collection("agency_surplus_settlements").doc(id).get(),
  ]);
  assert.equal(user.data().coins,20700);
  assert.equal(snapshot.data().surplusToShadow,false);
  assert.equal(snapshot.data().mode,"host_wallet_coins");
  assert.equal(settlement.data().surplusToShadow,false);
});

test("09-C corrupted policy snapshot fails closed before replay",async()=>{
  const suffix=Date.now().toString()+"_snapshot";
  const agencyId="stage09c_snapshot_"+suffix;
  const month="2026-09";
  const hostUid="host_"+suffix;
  await seedHostMonth({agencyId,month,hostUid,coins:800});
  await seedPolicy(agencyId,false);
  const now=new Date("2026-10-15T00:00:00.000Z");

  await settleAgencyHostSurplusPage(
    db,"owner",agencyId,month,{now,limit:25},
  );
  await db.collection("agency_surplus_policy_snapshots")
    .doc(agencyId+"__"+month)
    .update({status:"corrupt"});

  await assert.rejects(
    settleAgencyHostSurplusPage(
      db,"owner",agencyId,month,{now,limit:25},
    ),
    /agency_surplus_policy_snapshot_conflict/,
  );

  const user=await db.collection("users").doc(hostUid).get();
  assert.equal(user.data().coins,20800);
});

test("09-C corrupted Settlement financial split fails closed on replay",async()=>{
  const suffix=Date.now().toString()+"_settlement";
  const agencyId="stage09c_settlement_"+suffix;
  const month="2026-09";
  const hostUid="host_"+suffix;
  const id=await seedHostMonth({agencyId,month,hostUid,coins:900});
  await seedPolicy(agencyId,false);
  const now=new Date("2026-10-15T00:00:00.000Z");

  await settleAgencyHostSurplusPage(
    db,"owner",agencyId,month,{now,limit:25},
  );
  await db.collection("agency_surplus_settlements").doc(id).update({
    hostWalletCoins:19999,
  });

  await assert.rejects(
    settleAgencyHostSurplusPage(
      db,"owner",agencyId,month,{now,limit:25},
    ),
    /agency_surplus_settlement_conflict/,
  );

  const user=await db.collection("users").doc(hostUid).get();
  assert.equal(user.data().coins,20900);
});

test("09-C corrupted Ledger accounting fails closed on replay",async()=>{
  const suffix=Date.now().toString()+"_ledger";
  const agencyId="stage09c_ledger_"+suffix;
  const month="2026-09";
  const hostUid="host_"+suffix;
  const id=await seedHostMonth({agencyId,month,hostUid,coins:1000});
  await seedPolicy(agencyId,false);
  const now=new Date("2026-10-15T00:00:00.000Z");

  await settleAgencyHostSurplusPage(
    db,"owner",agencyId,month,{now,limit:25},
  );
  await db.collection("financial_ledger")
    .doc("agency_host_surplus_"+id)
    .update({reason:"corrupt_reason"});

  await assert.rejects(
    settleAgencyHostSurplusPage(
      db,"owner",agencyId,month,{now,limit:25},
    ),
    /agency_surplus_ledger_conflict/,
  );

  const user=await db.collection("users").doc(hostUid).get();
  assert.equal(user.data().coins,21000);
});
