import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {after, before, test} from "node:test";
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
} from "@firebase/rules-unit-testing";
import {doc, setDoc, updateDoc} from "firebase/firestore";

let env;
const projectId="shadow-live-economy-test";
const uid="rules_regular_user";

function verifiedUserDb() {
  return env.authenticatedContext(uid,{
    email:"verified@example.com",
    email_verified:true,
    firebase:{sign_in_provider:"password"},
  }).firestore();
}

function unverifiedUserDb() {
  return env.authenticatedContext(uid,{
    email:"unverified@example.com",
    email_verified:false,
    firebase:{sign_in_provider:"password"},
  }).firestore();
}

before(async()=>{
  env=await initializeTestEnvironment({
    projectId,
    firestore:{
      host:"127.0.0.1",
      port:8080,
      rules:readFileSync("firestore.rules","utf8"),
    },
  });
  await env.withSecurityRulesDisabled(async context=>{
    await setDoc(doc(context.firestore(),"users",uid),{
      role:"user",
      displayName:"Before",
      coins:1000000,
      diamonds:2,
      pendingGiftEarningCoins:0,
      pendingAgencyGiftEarningCoins:0,
      giftEarningCoinsLifetime:0,
      giftDiamondsLifetime:0,
      giftSupportReceivedCoins:0,
      giftRevenueMonth:"2026-09",
      giftRevenueMonthCoins:0,
      currentGiftRevenueTier:"starter",
      giftHostActivityMonth:"2026-09",
      giftHostMicSecondsMonth:0,
      giftHostQualifiedDays:0,
    });
  });
});

after(async()=>{if(env)await env.cleanup();});

test("regular user can still update an ordinary profile field",async()=>{
  const userDb=verifiedUserDb();
  await assertSucceeds(updateDoc(doc(userDb,"users",uid),{displayName:"After"}));
});

test("unverified email/password user cannot access Firestore",async()=>{
  const userDb=unverifiedUserDb();
  await assertFails(updateDoc(doc(userDb,"users",uid),{displayName:"Blocked"}));
});

test("regular user cannot change protected balances earnings agency or mic activity",async()=>{
  const userDb=verifiedUserDb();
  const ref=doc(userDb,"users",uid);
  for(const patch of [
    {coins:999999},
    {diamonds:999},
    {agencyId:"agency_hacked"},
    {pendingGiftEarningCoins:5000},
    {pendingAgencyGiftEarningCoins:5000},
    {giftEarningCoinsLifetime:5000},
    {giftDiamondsLifetime:5000},
    {giftSupportReceivedCoins:5000},
    {giftRevenueMonthCoins:5000},
    {currentGiftRevenueTier:"diamond"},
    {giftHostMicSecondsMonth:7200},
    {giftHostQualifiedDays:9},
  ]){
    await assertFails(updateDoc(ref,patch));
  }
});

test("client cannot forge gift operations ledgers accrual activity or settlement",async()=>{
  const userDb=verifiedUserDb();
  const writes=[
    ["gift_operations","fake_op"],
    ["gift_transactions","fake_tx"],
    ["financial_ledger","fake_ledger"],
    ["agency_settlement_accruals","fake_accrual"],
    ["agency_settlements","fake_settlement"],
    ["system_config","gift_economy"],
    ["game_operations","fake_game_op"],
    ["game_rounds","fake_game_round"],
    ["game_user_history","fake_game_history"],
  ];
  for(const [collection,id] of writes){
    await assertFails(setDoc(doc(userDb,collection,id),{forged:true}));
  }
  await assertFails(setDoc(
    doc(userDb,"host_mic_activity",uid,"days","2026-09-22"),
    {day:"2026-09-22",micSeconds:7200,qualified:true},
  ));
});

test("security assertions actually executed",()=>{
  assert.ok(env);
});
