import assert from "node:assert/strict";
import {after, test} from "node:test";
import {deleteApp, getApps, initializeApp} from "firebase-admin/app";
import {getFirestore} from "firebase-admin/firestore";
import {
  setWalletPassword,
  exchangeDiamonds,
  giftDiamonds,
} from "../../cloudflare-worker/src/wallet-actions.js";
import {cloudflareFirestoreAdapter} from "./helpers/cloudflare-firestore-adapter.js";

const app=getApps()[0]||initializeApp({projectId:"shadow-live-economy-test"});
const db=getFirestore(app);
const cloudflareDb=cloudflareFirestoreAdapter(db);
const fixtureSecret=()=>["fixture","wallet",Date.now().toString()].join("_");

after(async()=>{await deleteApp(app);});

test("diamond exchange debits once and records both ledgers",async()=>{
  const suffix=Date.now().toString()+"_exchange";
  const uid="wallet_"+suffix;
  const key="wallet_exchange_"+suffix;
  const secret=fixtureSecret();

  await Promise.all([
    db.collection("users").doc(uid).set({role:"user",coins:1000,diamonds:5}),
    db.collection("system_config").doc("emergency_lock").set({
      enabled:false,economyLocked:false,transfersLocked:false,
    }),
  ]);
  await setWalletPassword(cloudflareDb,uid,{password:secret});

  const first=await exchangeDiamonds(cloudflareDb,uid,{
    diamonds:2,password:secret,idempotencyKey:key,
  });
  assert.equal(first.code,"ok");
  assert.equal(first.coinsReceived,20000);
  assert.equal(first.diamonds,3);
  assert.equal(first.coins,21000);

  const duplicate=await exchangeDiamonds(cloudflareDb,uid,{
    diamonds:2,password:secret,idempotencyKey:key,
  });
  assert.equal(duplicate.code,"duplicate");

  const [user,op,diamondLedger,coinLedger]=await Promise.all([
    db.collection("users").doc(uid).get(),
    db.collection("wallet_operations").doc(uid+"__"+key).get(),
    db.collection("financial_ledger").doc(uid+"__"+key+"__diamond").get(),
    db.collection("financial_ledger").doc(uid+"__"+key+"__coin").get(),
  ]);
  assert.equal(user.data().diamonds,3);
  assert.equal(user.data().coins,21000);
  assert.equal(op.data().status,"completed");
  assert.equal(diamondLedger.data().delta,-2);
  assert.equal(coinLedger.data().delta,20000);
});

test("diamond gift credits recipient coins once",async()=>{
  const suffix=Date.now().toString()+"_gift";
  const sender="sender_"+suffix;
  const recipient="recipient_"+suffix;
  const key="wallet_gift_"+suffix;
  const secret=fixtureSecret();

  await Promise.all([
    db.collection("users").doc(sender).set({role:"user",coins:0,diamonds:4}),
    db.collection("users").doc(recipient).set({role:"user",coins:2500,diamonds:0}),
    db.collection("system_config").doc("emergency_lock").set({
      enabled:false,economyLocked:false,transfersLocked:false,
    }),
  ]);
  await setWalletPassword(cloudflareDb,sender,{password:secret});

  const first=await giftDiamonds(cloudflareDb,sender,{
    recipientUid:recipient,diamonds:3,password:secret,idempotencyKey:key,
  });
  assert.equal(first.code,"ok");
  assert.equal(first.diamondsSent,3);
  assert.equal(first.coinsReceived,30000);
  assert.equal(first.diamonds,1);

  const duplicate=await giftDiamonds(cloudflareDb,sender,{
    recipientUid:recipient,diamonds:3,password:secret,idempotencyKey:key,
  });
  assert.equal(duplicate.code,"duplicate");

  const [senderDoc,recipientDoc,transfer]=await Promise.all([
    db.collection("users").doc(sender).get(),
    db.collection("users").doc(recipient).get(),
    db.collection("wallet_transfers").doc(sender+"__"+key).get(),
  ]);
  assert.equal(senderDoc.data().diamonds,1);
  assert.equal(recipientDoc.data().coins,32500);
  assert.equal(transfer.data().coinsReceived,30000);
});

test("emergency lock blocks exchange without mutating wallet",async()=>{
  const suffix=Date.now().toString()+"_lock";
  const uid="wallet_"+suffix;
  const secret=fixtureSecret();

  await Promise.all([
    db.collection("users").doc(uid).set({role:"user",coins:7000,diamonds:2}),
    db.collection("system_config").doc("emergency_lock").set({
      enabled:false,economyLocked:true,transfersLocked:false,
    }),
  ]);
  await setWalletPassword(cloudflareDb,uid,{password:secret});

  await assert.rejects(
    exchangeDiamonds(cloudflareDb,uid,{
      diamonds:1,password:secret,idempotencyKey:"wallet_locked_"+suffix,
    }),
    /emergency_locked/,
  );

  const user=await db.collection("users").doc(uid).get();
  assert.equal(user.data().diamonds,2);
  assert.equal(user.data().coins,7000);
});

test("erasure processing blocks new transfers and wallet exchange without touching money", async () => {
  const suffix=Date.now().toString()+"_deleted_wallet";
  const sender="wallet_sender_"+suffix;
  const recipient="wallet_receiver_"+suffix;
  const secret=fixtureSecret();
  const senderRef=db.collection("users").doc(sender);
  const recipientRef=db.collection("users").doc(recipient);
  const opKey="wallet_erasure_"+suffix;
  await Promise.all([
    senderRef.set({role:"user",accountStatus:"active",diamonds:4,coins:250}),
    recipientRef.set({role:"user",accountStatus:"deletion_processing",diamonds:0,coins:1000}),
    db.collection("system_config").doc("emergency_lock").set({
      enabled:false,economyLocked:false,transfersLocked:false,
    }),
  ]);
  await setWalletPassword(cloudflareDb,sender,{password:secret});
  const params={recipientUid:recipient,diamonds:2,password:secret,idempotencyKey:opKey};
  await assert.rejects(giftDiamonds(cloudflareDb,sender,params),
    e=>e.code==="wallet_account_deleted" && e.status===409);
  assert.equal((await senderRef.get()).data().diamonds,4);
  assert.equal((await recipientRef.get()).data().coins,1000);
  assert.equal((await db.collection("wallet_transfers").doc(sender+"__"+opKey).get()).exists,false);
  await recipientRef.update({accountStatus:"active"});
  await senderRef.update({accountStatus:"deletion_processing"});
  await assert.rejects(giftDiamonds(cloudflareDb,sender,params),
    e=>e.code==="wallet_account_deleted" && e.status===409);
  await assert.rejects(exchangeDiamonds(cloudflareDb,sender,{
    diamonds:2,password:secret,idempotencyKey:"exchange_erasure_"+suffix,
  }),e=>e.code==="wallet_account_deleted" && e.status===409);
  assert.equal((await senderRef.get()).data().diamonds,4);
  assert.equal((await recipientRef.get()).data().coins,1000);
  assert.equal((await db.collection("financial_ledger").doc(sender+"__"+opKey+"__sender").get()).exists,false);
});
