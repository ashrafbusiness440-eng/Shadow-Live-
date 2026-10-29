// Store financial certification against the *real* Firestore Emulator
// transaction protocol. Never reaches production Firebase or real balances.
import assert from "node:assert/strict";
import {after, test} from "node:test";
import {initializeApp,deleteApp} from "firebase-admin/app";
import {getFirestore} from "firebase-admin/firestore";
import {commitStorePurchaseOffline} from
  "../../cloudflare-worker/src/store-purchase-transaction.js";
import {commitStoreGrantOffline} from
  "../../cloudflare-worker/src/store-grant-transaction-offline.js";
import {commitStoreGrantRevokeOffline} from
  "../../cloudflare-worker/src/store-grant-revoke-transaction.js";
import {commitStoreEquip} from
  "../../cloudflare-worker/src/store-equip.js";
import {resolveStoreVisuals} from
  "../../cloudflare-worker/src/store-presentation.js";
import {certifyStorePurchaseEvidenceOffline} from
  "../../cloudflare-worker/src/store-purchase-reconciliation-offline.js";

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
      if(token?.finished)throw Error("invalid_emulator_tx");
      const snap=token
        ?await token.native.get(db.doc(path))
        :await db.doc(path).get();
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
  walletMirror=undefined}={}){
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
  assert.equal("balance" in row.user,false);
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

test("578C emulator legacy balance mirror stays in lockstep across purchase and renewal",async()=>{
  const suffix="mirror";
  const {uid,db}=await seed(suffix,{coins:100000,walletMirror:100000});
  await commitStorePurchaseOffline(db,verifiedToken(uid),
    request(suffix),null,NOW);
  let row=await inspect(uid,operationId(suffix));
  assert.equal(row.user.coins,75000);
  assert.equal(row.user.balance,75000);
  assert.equal(row.ledger.data().closingBalance,75000);

  const renewalKey="store_578c_mirror_renew_000002";
  const renewalRequest={
    action:"renew",productId,operationId:renewalKey,
    expectedPriceCoins:PRICE,expectedDurationDays:7,
    expectedCurrentExpiresAtMs:NOW+7*86400000,
  };
  const renewed=await commitStorePurchaseOffline(
    db,verifiedToken(uid),renewalRequest,null,NOW+100);
  assert.equal(renewed.renewal,true);
  row=await inspect(uid,renewalKey);
  assert.equal(row.user.coins,50000);
  assert.equal(row.user.balance,50000);
  assert.equal(row.ledger.data().openingBalance,75000);
  assert.equal(row.ledger.data().closingBalance,50000);
  assert.equal(row.entitlement.data().renewalCount,1);
  const repeated=await commitStorePurchaseOffline(
    db,verifiedToken(uid),renewalRequest,null,NOW+200);
  assert.equal(repeated.duplicate,true);
  assert.equal((await inspect(uid,renewalKey)).user.balance,50000);
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

test("580A paid item lifecycle purchase, equip, display, unequip is server-verified",async()=>{
  const suffix="paid_lifecycle";
  const {uid,db}=await seed(suffix,{coins:75000});
  await firestore.doc("app_asset_registry/store.item.200001.visual").set({
    published:true,rawUrl:"https://example.com/store-frame-visual.webp",
  });
  const checkout=await commitStorePurchaseOffline(
    db,verifiedToken(uid),request(suffix),null,NOW);
  assert.equal(checkout.deliveryStatus,"delivered");
  assert.equal((await resolveStoreVisuals(db,uid,NOW+5)).frames,undefined);
  const equipped=await commitStoreEquip(
    db,verifiedToken(uid),{action:"equip",productId},NOW+10);
  assert.equal(equipped.changed,true);
  assert.equal(equipped.category,"frames");
  const displayed=await resolveStoreVisuals(db,uid,NOW+20);
  assert.equal(displayed.frames.imageUrl,
    "https://example.com/store-frame-visual.webp");
  assert.equal(displayed.frames.productId,productId);
  assert.equal(displayed.frames.expiresAtMs,NOW+7*86400000);
  const repeated=await commitStoreEquip(
    db,verifiedToken(uid),{action:"equip",productId},NOW+30);
  assert.equal(repeated.changed,false);
  const removed=await commitStoreEquip(
    db,verifiedToken(uid),{action:"unequip",category:"frames"},NOW+40);
  assert.equal(removed.changed,true);
  assert.deepEqual(await resolveStoreVisuals(db,uid,NOW+50),{});
  const row=await inspect(uid,operationId(suffix));
  assert.equal(row.user.coins,50000);
  assert.equal(row.ledger.data().delta,-PRICE);
  assert.equal(row.receipt.data().deliveryStatus,"delivered");
  assert.equal(row.entitlement.data().equipped,false);
});

test("580A Owner grant, equip, revoke, and replay clean one slot without Coins",async()=>{
  const suffix="grant_lifecycle";
  const {uid,db}=await seed(suffix,{coins:50000,purchasingEnabled:false});
  const ownerUid="store580a_owner";
  await firestore.doc("users/"+ownerUid).set({
    role:"owner",accountStatus:"active",
  });
  await firestore.doc("app_asset_registry/store.item.200001.visual").set({
    published:true,rawUrl:"https://example.com/granted-frame-visual.webp",
  });
  const current=Date.now();
  const ownerToken={sub:ownerUid,iat:Math.floor(current/1000),
    auth_time:Math.floor(current/1000)};
  const grantOp="store_580a_grant_operation_001";
  const grant=await commitStoreGrantOffline(db,ownerToken,{
    targetId:uid,productId,operationId:grantOp,
    reason:"منحة اختبار دورة حياة المتجر",
  },current);
  assert.equal(grant.ok,true);
  assert.equal(grant.deliveryStatus,"delivered");
  const entPath="user_store_entitlements/"+uid+"/items/"+productId;
  let item=await firestore.doc(entPath).get();
  assert.equal(item.data().source,"admin_grant");
  assert.equal(item.data().equipped,false);
  assert.equal((await firestore.doc("users/"+uid).get()).data().coins,50000);
  assert.equal((await firestore.doc("store_purchase_receipts/"+uid+"__"+grantOp).get()).exists,false);

  const equip=await commitStoreEquip(db,verifiedToken(uid),{
    action:"equip",productId,
  },current+10);
  assert.equal(equip.changed,true);
  assert.equal((await resolveStoreVisuals(db,uid,current+20)).frames.imageUrl,
    "https://example.com/granted-frame-visual.webp");

  const revokeOp="store_580a_revoke_operation_001";
  const revokeBody={
    targetUid:uid,productId,operationId:revokeOp,
    reason:"سحب المنحة لاختبار انتهاء صلاحية المقتنى",
  };
  const revoke=await commitStoreGrantRevokeOffline(
    db,ownerToken,revokeBody,current+30);
  assert.equal(revoke.revoked,true);
  assert.equal(revoke.wasEquipped,true);
  item=await firestore.doc(entPath).get();
  assert.equal(item.data().status,"revoked");
  assert.equal(item.data().equipped,false);
  assert.deepEqual((await firestore.doc("user_store_equipped/"+uid).get())
    .data().slots,{});
  assert.deepEqual(await resolveStoreVisuals(db,uid,current+40),{});
  await assert.rejects(()=>commitStoreEquip(
    db,verifiedToken(uid),{action:"equip",productId},current+50),
    /store_entitlement_not_usable/);
  const replay=await commitStoreGrantRevokeOffline(
    db,ownerToken,revokeBody,current+60);
  assert.equal(replay.duplicate,true);
  assert.equal((await firestore.doc("users/"+uid).get()).data().coins,50000);
  assert.equal((await firestore.doc(
    "admin_audit_logs/store_grant_revoke_"+ownerUid+"__"+revokeOp
  ).get()).data().action,"revokeStoreGrant");
  assert.equal((await firestore.doc(
    "financial_ledger/store_"+uid+"__"+grantOp
  ).get()).exists,false);
});

test("580A an expired equipped grant disappears without an extra wallet write",async()=>{
  const suffix="expired_grant";
  const {uid,db}=await seed(suffix,{coins:50000,purchasingEnabled:false});
  const ownerUid="store580a_owner";
  const current=Date.now();
  await firestore.doc("users/"+ownerUid).set({
    role:"owner",accountStatus:"active",
  });
  await firestore.doc("app_asset_registry/store.item.200001.visual").set({
    published:true,rawUrl:"https://example.com/granted-frame-visual.webp",
  });
  const token={sub:ownerUid,iat:Math.floor(current/1000),
    auth_time:Math.floor(current/1000)};
  await commitStoreGrantOffline(db,token,{
    targetId:uid,productId,
    operationId:"store_580a_expiry_grant_001",
    reason:"منحة مؤقتة لأغراض اختبار الصلاحية",
  },current);
  await commitStoreEquip(db,verifiedToken(uid),
    {action:"equip",productId},current+10);
  assert.ok((await resolveStoreVisuals(db,uid,current+20)).frames);
  assert.deepEqual(await resolveStoreVisuals(
    db,uid,current+7*86400000+1),{});
  assert.equal((await firestore.doc("users/"+uid).get()).data().coins,50000);
  assert.equal((await firestore.doc(
    "user_store_entitlements/"+uid+"/items/"+productId
  ).get()).data().equipped,true);
});

test("580B concurrent checkouts with the same operation ID stay isolated by buyer",async()=>{
  const a=await seed("580b_buyer_a",{coins:75000});
  const b=await seed("580b_buyer_b",{coins:50000});
  const sharedOperation="store_580b_same_operation_two_buyers_01";
  // Identical client operation IDs are valid for distinct authenticated
  // accounts; neither buyer may share the other's receipt or entitlement.
  const [purchaseA,purchaseB]=await Promise.all([
    commitStorePurchaseOffline(a.db,verifiedToken(a.uid),
      request("580b_buyer_a",{operationId:sharedOperation}),null,NOW),
    commitStorePurchaseOffline(b.db,verifiedToken(b.uid),
      request("580b_buyer_b",{operationId:sharedOperation}),null,NOW),
  ]);
  assert.equal(purchaseA.deliveryStatus,"delivered");
  assert.equal(purchaseB.deliveryStatus,"delivered");
  const [accountA,accountB]=await Promise.all([
    inspect(a.uid,sharedOperation),inspect(b.uid,sharedOperation),
  ]);
  assert.equal(accountA.user.coins,50000);
  assert.equal(accountB.user.coins,25000);
  for(const [uid,row] of [[a.uid,accountA],[b.uid,accountB]]){
    assert.equal(row.entitlement.data().ownerUid,uid);
    assert.equal(row.receipt.data().buyerUid,uid);
    assert.equal(row.ledger.data().userId,uid);
    assert.equal(row.ledger.data().delta,-PRICE);
    assert.equal(row.op.data().buyerUid,uid);
  }
  await firestore.doc("app_asset_registry/store.item.200001.visual").set({
    published:true,rawUrl:"https://example.com/two-account-frame.webp",
  });
  const [equippedA,equippedB]=await Promise.all([
    commitStoreEquip(a.db,verifiedToken(a.uid),
      {action:"equip",productId},NOW+10),
    commitStoreEquip(b.db,verifiedToken(b.uid),
      {action:"equip",productId},NOW+10),
  ]);
  assert.equal(equippedA.changed,true);
  assert.equal(equippedB.changed,true);
  // A newly created reader simulates reconnect / re-fetch without polling
  // and proves that visual state comes from each account's server records.
  const freshReader=emulatorStoreClient(firestore);
  assert.equal((await resolveStoreVisuals(freshReader,a.uid,NOW+20))
    .frames.productId,productId);
  assert.equal((await resolveStoreVisuals(freshReader,b.uid,NOW+20))
    .frames.productId,productId);
  await commitStoreEquip(a.db,verifiedToken(a.uid),
    {action:"unequip",category:"frames"},NOW+30);
  assert.deepEqual(await resolveStoreVisuals(freshReader,a.uid,NOW+40),{});
  assert.equal((await resolveStoreVisuals(freshReader,b.uid,NOW+40))
    .frames.productId,productId);
  assert.equal((await inspect(a.uid,sharedOperation)).user.coins,50000);
  assert.equal((await inspect(b.uid,sharedOperation)).user.coins,25000);
});

test("580B revoke of one Owner grant never removes another user's equipped item",async()=>{
  const a=await seed("580b_grantee_a",
    {coins:30000,purchasingEnabled:false});
  const b=await seed("580b_grantee_b",
    {coins:60000,purchasingEnabled:false});
  const ownerUid="store580b_owner";
  const current=Date.now();
  await firestore.doc("users/"+ownerUid).set({
    role:"owner",accountStatus:"active",
  });
  await firestore.doc("app_asset_registry/store.item.200001.visual").set({
    published:true,rawUrl:"https://example.com/two-grantees-frame.webp",
  });
  const ownerToken={sub:ownerUid,iat:Math.floor(current/1000),
    auth_time:Math.floor(current/1000)};
  const grantA="store_580b_grant_grantee_a_001";
  const grantB="store_580b_grant_grantee_b_001";
  await Promise.all([
    commitStoreGrantOffline(a.db,ownerToken,{
      targetId:a.uid,productId,operationId:grantA,
      reason:"اختبار عزل المنح بين المستخدمين",
    },current),
    commitStoreGrantOffline(b.db,ownerToken,{
      targetId:b.uid,productId,operationId:grantB,
      reason:"اختبار عزل المنح بين المستخدمين",
    },current),
  ]);
  await Promise.all([
    commitStoreEquip(a.db,verifiedToken(a.uid),
      {action:"equip",productId},current+10),
    commitStoreEquip(b.db,verifiedToken(b.uid),
      {action:"equip",productId},current+10),
  ]);
  assert.ok((await resolveStoreVisuals(a.db,a.uid,current+20)).frames);
  assert.ok((await resolveStoreVisuals(b.db,b.uid,current+20)).frames);
  const revoke=await commitStoreGrantRevokeOffline(a.db,ownerToken,{
    targetUid:a.uid,productId,
    operationId:"store_580b_revoke_grantee_a_001",
    reason:"سحب منحة المستخدم الأول فقط",
  },current+30);
  assert.equal(revoke.revoked,true);
  assert.deepEqual(await resolveStoreVisuals(a.db,a.uid,current+40),{});
  assert.equal((await resolveStoreVisuals(b.db,b.uid,current+40))
    .frames.productId,productId);
  assert.equal((await firestore.doc(
    "user_store_equipped/"+b.uid).get()).data().slots.frames,productId);
  assert.equal((await firestore.doc(
    "user_store_entitlements/"+b.uid+"/items/"+productId
  ).get()).data().status,"active");
  for(const [uid,coins,operation] of [
    [a.uid,30000,grantA],[b.uid,60000,grantB],
  ]){
    assert.equal((await firestore.doc("users/"+uid).get()).data().coins,
      coins);
    assert.equal((await firestore.doc(
      "financial_ledger/store_"+uid+"__"+operation).get()).exists,false);
  }
});

test("578D verifies purchase and renewal against four Firestore evidence documents",async()=>{
  const suffix="578d_certification";
  const {uid,db}=await seed(suffix,{coins:100000,walletMirror:100000});
  const purchaseKey=operationId(suffix);
  await commitStorePurchaseOffline(db,verifiedToken(uid),
    request(suffix),null,NOW);
  const first=await certifyStorePurchaseEvidenceOffline(
    db,{buyerUid:uid,operationId:purchaseKey});
  assert.deepEqual(first,{ok:true,kind:"purchase",
    certifiedAmountCoins:PRICE});
  const renewalKey="store_578d_renewal_evidence_002";
  await commitStorePurchaseOffline(db,verifiedToken(uid),{
    action:"renew",productId,operationId:renewalKey,
    expectedPriceCoins:PRICE,expectedDurationDays:7,
    expectedCurrentExpiresAtMs:NOW+7*86400000,
  },null,NOW+100);
  const second=await certifyStorePurchaseEvidenceOffline(
    db,{buyerUid:uid,operationId:renewalKey});
  assert.deepEqual(second,{ok:true,kind:"renew",
    certifiedAmountCoins:PRICE});
  // Later activity never invalidates an earlier transaction's evidence.
  assert.equal((await certifyStorePurchaseEvidenceOffline(
    db,{buyerUid:uid,operationId:purchaseKey})).ok,true);
  const wallet=(await firestore.doc("users/"+uid).get()).data();
  assert.equal(wallet.coins,50000);
  assert.equal(wallet.balance,50000);
});

test("578D fails closed when ledger amount and receipt state disagree",async()=>{
  const suffix="578d_tampered_ledger";
  const {uid,db}=await seed(suffix);
  const key=operationId(suffix);
  await commitStorePurchaseOffline(db,verifiedToken(uid),
    request(suffix),null,NOW);
  await firestore.doc("financial_ledger/store_"+uid+"__"+key)
    .update({delta:-(PRICE-1)});
  assert.deepEqual(await certifyStorePurchaseEvidenceOffline(
    db,{buyerUid:uid,operationId:key}),
  {ok:false,code:"ledger_mismatch"});
  await firestore.doc("financial_ledger/store_"+uid+"__"+key)
    .update({delta:-PRICE});
  await firestore.doc("store_purchase_receipts/"+uid+"__"+key)
    .update({refundStatus:"refunded"});
  assert.deepEqual(await certifyStorePurchaseEvidenceOffline(
    db,{buyerUid:uid,operationId:key}),
  {ok:false,code:"requires_refund_review"});
});

test("578D never approves missing audit or mismatched operation and receipt",async()=>{
  const suffix="578d_missing_audit";
  const {uid,db}=await seed(suffix);
  const key=operationId(suffix);
  await commitStorePurchaseOffline(db,verifiedToken(uid),
    request(suffix),null,NOW);
  await firestore.doc("admin_audit_logs/store_purchase_"+uid+"__"+key)
    .delete();
  assert.deepEqual(await certifyStorePurchaseEvidenceOffline(
    db,{buyerUid:uid,operationId:key}),
  {ok:false,code:"incomplete_evidence"});
  await firestore.doc("store_purchase_receipts/"+uid+"__"+key)
    .update({priceCoins:PRICE+1});
  assert.deepEqual(await certifyStorePurchaseEvidenceOffline(
    db,{buyerUid:uid,operationId:key}),
  {ok:false,code:"incomplete_evidence"});
  assert.deepEqual(await certifyStorePurchaseEvidenceOffline(
    db,{buyerUid:"unrelated_account",operationId:key}),
  {ok:false,code:"not_found"});
});
