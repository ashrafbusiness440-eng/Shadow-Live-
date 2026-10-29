// Store financial certification against the *real* Firestore Emulator
// transaction protocol. Never reaches production Firebase or real balances.
import assert from "node:assert/strict";
import {after, test} from "node:test";
import {initializeApp,deleteApp} from "firebase-admin/app";
import {getFirestore} from "firebase-admin/firestore";
import {commitStorePurchaseOffline} from
  "../../cloudflare-worker/src/store-purchase-transaction.js";

const projectId="shadow-live-economy-test";
const host=process.env.FIRESTORE_EMULATOR_HOST;
if(host!=="127.0.0.1:8080" && host!=="localhost:8080") {
  throw Error("store_578b_emulator_only: refusing to touch real Firestore");
}
const app=initializeApp({projectId},
  "store-578b-emulator-"+process.pid);
const firestore=getFirestore(app);
after(async()=>{await deleteApp(app);});

const NOW=100000;
const PRICE=25000;
const productId="200001";
const product={
  id:productId,nameAr:"إطار تجريبي",category:"frames",
  priceCoins:PRICE,durationDays:7,rarity:"normal",
  minVipLevel:1,enabled:true,sortOrder:1,
  assetKey:"store.item.200001.icon",
};
const userId=suffix=>"store578b_"+suffix;
const operationId=suffix=>"store_578b_"+suffix+"_op_000001";
const request=(suffix,overrides={})=>({
  action:"purchase",productId,operationId:operationId(suffix),
  expectedPriceCoins:PRICE,expectedDurationDays:7,...overrides,
});
const verifiedToken=uid=>({sub:uid,iat:Math.floor(Date.now()/1000)});

// Adapter exercises the exact production commitStorePurchaseOffline engine
// with real Firebase Admin Firestore transactions, doc locking and commit.
// The engine controls begin/get/commit; a deferred write signal completes the
// Firestore SDK callback only after all the engine's read preconditions.
// Disable SDK auto-retries because the engine already owns its retry policy.
function emulatorStoreClient(db){
  return {
    async beginTransaction(){
      let signalReady,signalWrites;
      const ready=new Promise(resolve=>{signalReady=resolve});
      const writesReady=new Promise(resolve=>{signalWrites=resolve});
      const completed=db.runTransaction(async tx=>{
        signalReady(tx);
        const writes=await writesReady;
        for(const write of writes){
          const ref=db.doc(write.path);
          if(write.kind==="create")tx.create(ref,write.data);
          else if(write.kind==="update")tx.update(ref,write.data);
          else throw Error("invalid_emulator_store_write");
        }
      },{maxAttempts:1});
      const native=await ready;
      return {native,signalWrites,completed,finished:false};
    },
    async rollback(token){
      if(token.finished)return;
      token.finished=true;
      token.signalWrites([]);
      await token.completed;
    },
    async get(path,token){
      if(!token || token.finished)throw Error("invalid_emulator_tx");
      const snap=await token.native.get(db.doc(path));
      return {exists:snap.exists,data:snap.exists?snap.data():null};
    },
    writeUpdate(path,data,fields){
      if(!Array.isArray(fields)||fields.some(f=>!(f in data)))
        throw Error("invalid_store_update_mask");
      return {kind:"update",path,data};
    },
    writeCreate(path,data){return {kind:"create",path,data}},
    async commit(token,writes){
      if(token.finished)throw Error("emulator_tx_finished");
      token.finished=true;
      token.signalWrites(writes);
      await token.completed;
    },
  };
}
async function seed(suffix,{coins=40000,purchasingEnabled=true,
  walletMirror=coins}={}){
  const uid=userId(suffix);
  const user={coins,accountStatus:"active",role:"user",
    wealthPoints:0,effectiveVipLevel:2};
  if(walletMirror!==undefined)user.balance=walletMirror;
  await Promise.all([
    firestore.doc("users/"+uid).set(user),
    firestore.doc("system_config/store_catalog").set({
      purchasingEnabled,revision:1,items:[product],
    }),
    firestore.doc("app_asset_registry/"+product.assetKey).set({
      published:true,rawUrl:"https://example.com/store-test.webp",
    }),
  ]);
  return {uid,db:emulatorStoreClient(firestore)};
}
async function inspect(uid,key){
  const base="user_store_entitlements/"+uid+"/items/"+productId;
  const [user,entitlement,ledger,receipt,op,audit]=await Promise.all([
    firestore.doc("users/"+uid).get(),
    firestore.doc(base).get(),
    firestore.doc("financial_ledger/store_"+uid+"__"+key).get(),
    firestore.doc("store_purchase_receipts/"+uid+"__"+key).get(),
    firestore.doc("store_purchase_operations/"+uid+"__"+key).get(),
    firestore.doc("admin_audit_logs/store_purchase_"+uid+"__"+key).get(),
  ]);
  return {user:user.data(),entitlement,ledger,receipt,op,audit};
}
test("578B purchase commits wallet/entitlement/ledger/receipt/audit atomically in Firestore",async()=>{
  const suffix="one";
  const {uid,db}=await seed(suffix);
  const result=await commitStorePurchaseOffline(db,verifiedToken(uid),
    request(suffix),null,NOW);
  assert.equal(result.priceCoins,PRICE);
  assert.equal(result.deliveryStatus,"delivered");
  const row=await inspect(uid,operationId(suffix));
  assert.equal(row.user.coins,15000);
  assert.equal(row.user.balance,40000);
  assert.equal(row.entitlement.data().ownerUid,uid);
  assert.equal(row.entitlement.data().source,"purchase");
  assert.equal(row.entitlement.data().expiresAtMs,NOW+7*86400000);
  assert.equal(row.ledger.data().delta,-PRICE);
  assert.equal(row.ledger.data().openingBalance,40000);
  assert.equal(row.ledger.data().closingBalance,15000);
  assert.equal(row.receipt.data().priceCoins,PRICE);
  assert.equal(row.receipt.data().deliveryStatus,"delivered");
  assert.equal(row.op.data().status,"completed");
  assert.equal(row.audit.data().action,"purchaseStoreItem");
});

test("578B same operation ID replays stored receipt; lost acknowledgment cannot debit twice",async()=>{
  const suffix="replay";
  const {uid,db}=await seed(suffix);
  const originalCommit=db.commit;
  let dropReply=true;
  db.commit=async(...args)=>{
    await originalCommit(...args);
    if(dropReply){
      dropReply=false;
      const error=Error("FIRESTORE_NETWORK_ERROR: receipt lost");
      error.status=503;
      throw error;
    }
  };
  const first=await commitStorePurchaseOffline(db,verifiedToken(uid),
    request(suffix),null,NOW);
  assert.equal(first.duplicate,true);
  const second=await commitStorePurchaseOffline(db,verifiedToken(uid),
    request(suffix),null,NOW+100);
  assert.equal(second.duplicate,true);
  const row=await inspect(uid,operationId(suffix));
  assert.equal(row.user.coins,15000);
  assert.equal(row.receipt.data().priceCoins,PRICE);
  assert.equal(row.op.data().result.operationId,operationId(suffix));
  await assert.rejects(
    ()=>commitStorePurchaseOffline(db,verifiedToken(uid),
      request(suffix,{productId:"200002"}),null,NOW+200),
    /store_operation_id_conflict/);
  assert.equal((await inspect(uid,operationId(suffix))).user.coins,15000);
});

test("578B no partial writes for insufficient wallet or changed consent",async()=>{
  for(const [suffix,options,requestOverrides,error] of [
    ["insufficient",{coins:100},{},"insufficient_balance"],
    ["stale",{coins:40000},{expectedPriceCoins:100},"store_purchase_quote_changed"],
    ["disabled",{purchasingEnabled:false},{},"purchasing_disabled"],
    ["mismatch",{coins:40000,walletMirror:50000},{},"invalid_wallet_state"],
  ]){
    const {uid,db}=await seed(suffix,options);
    await assert.rejects(
      ()=>commitStorePurchaseOffline(db,verifiedToken(uid),
        request(suffix,requestOverrides),null,NOW),
      new RegExp(error),
    );
    const row=await inspect(uid,operationId(suffix));
    assert.equal(row.user.coins,options.coins??40000);
    assert.equal(row.entitlement.exists,false);
    assert.equal(row.ledger.exists,false);
    assert.equal(row.receipt.exists,false);
    assert.equal(row.op.exists,false);
    assert.equal(row.audit.exists,false);
  }
});

test("578B renewal charges once and extends active paid term without another entitlement",async()=>{
  const suffix="renew";
  const {uid,db}=await seed(suffix,{coins:100000});
  await commitStorePurchaseOffline(db,verifiedToken(uid),
    request(suffix),null,NOW);
  const oldExpiry=NOW+7*86400000;
  const renewalKey="store_578b_renew_op_000002";
  const renewal=await commitStorePurchaseOffline(db,verifiedToken(uid),{
    action:"renew",productId,operationId:renewalKey,
    expectedPriceCoins:PRICE,expectedDurationDays:7,
    expectedCurrentExpiresAtMs:oldExpiry,
  },null,NOW+100);
  assert.equal(renewal.renewal,true);
  assert.equal(renewal.expiresAtMs,oldExpiry+7*86400000);
  const receipt=await inspect(uid,renewalKey);
  assert.equal(receipt.user.coins,50000);
  assert.equal(receipt.entitlement.data().renewalCount,1);
  assert.equal(receipt.entitlement.data().expiresAtMs,oldExpiry+7*86400000);
  assert.equal(receipt.receipt.data().renewal,true);
  assert.equal(receipt.ledger.data().delta,-PRICE);
  const again=await commitStorePurchaseOffline(db,verifiedToken(uid),{
    action:"renew",productId,operationId:renewalKey,
    expectedPriceCoins:PRICE,expectedDurationDays:7,
    expectedCurrentExpiresAtMs:oldExpiry,
  },null,NOW+200);
  assert.equal(again.duplicate,true);
  assert.equal((await inspect(uid,renewalKey)).user.coins,50000);
});
