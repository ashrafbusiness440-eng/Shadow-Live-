import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {test} from "node:test";
import {
  commitStorePurchaseOffline,
} from "../../cloudflare-worker/src/store-purchase-transaction.js";

const product = () => ({
  id:"200001",nameAr:"إطار",category:"frames",
  priceCoins:25000,durationDays:7,rarity:"normal",
  minVipLevel:1,enabled:true,sortOrder:1,
  assetKey:"store.item.200001.icon",
});

function setup({coins=40000, purchasingEnabled=true, published=true} = {}) {
  const records = new Map([
    ["users/buyer_1",{coins,accountStatus:"active",role:"user",
      wealthPoints:0,effectiveVipLevel:2}],
    ["system_config/store_catalog",{
      purchasingEnabled,revision:1,items:[product()],
    }],
    ["app_asset_registry/store.item.200001.icon",{
      published,rawUrl:"https://example.com/frame.webp",
    }],
  ]);
  let commits = 0;
  const db = {
    async beginTransaction() { return {active:true}; },
    async rollback() {},
    async get(path) {
      return {exists:records.has(path),data:records.get(path)};
    },
    writeUpdate(path,data) { return {kind:"update",path,data}; },
    writeCreate(path,data) { return {kind:"create",path,data}; },
    async commit(transaction,writes) {
      for(const w of writes) {
        if (w.kind==="create" && records.has(w.path)) {
          throw Error("ALREADY_EXISTS");
        }
      }
      for(const w of writes) {
        if(w.kind==="update") records.set(w.path,{...records.get(w.path),...w.data});
        else records.set(w.path,w.data);
      }
      commits++;
    },
  };
  return {db,records,commits:()=>commits};
}
const user={sub:"buyer_1",iat:Math.floor(Date.now()/1000)};
const request={productId:"200001",operationId:"store_transaction_safe_0001"};
const levels={vipLevel:2,wealthLevel:5};

test("offline store purchase commits wallet, receipt, ownership, ledger atomically",async()=>{
  const {db,records,commits}=setup();
  const result=await commitStorePurchaseOffline(db,user,request,levels,100000);
  assert.equal(result.ok,true);
  assert.equal(result.priceCoins,25000);
  assert.equal(commits(),1);
  assert.equal(records.get("users/buyer_1").coins,15000);
  const ent=records.get("user_store_entitlements/buyer_1/items/200001");
  assert.equal(ent.ownerUid,"buyer_1");
  assert.equal(ent.status,"active");
  assert.equal(ent.expiresAtMs,100000 + 7*86400000);
  const ledger=records.get("financial_ledger/store_buyer_1__"+request.operationId);
  assert.equal(ledger.delta,-25000);
  assert.equal(ledger.closingBalance,15000);
  const receipt=records.get("store_purchase_receipts/buyer_1__"+request.operationId);
  assert.equal(receipt.priceCoins,25000);
  assert.equal(receipt.deliveryStatus,"delivered");
  assert.equal(records.get("admin_audit_logs/store_purchase_buyer_1__"+
    request.operationId).action,"purchaseStoreItem");
  const repeat=await commitStorePurchaseOffline(db,user,request,levels,150000);
  assert.equal(repeat.duplicate,true);
  assert.equal(repeat.priceCoins,25000);
  assert.equal(commits(),1);
  assert.equal(records.get("users/buyer_1").coins,15000);
  await assert.rejects(()=>commitStorePurchaseOffline(db,user,{
    ...request,productId:"200002",
  },levels,200000),/store_operation_id_conflict/);
});

test("offline store transaction rejects disabled switch, insufficient coins, draft images",async()=>{
  for(const setting of [
    {purchasingEnabled:false},
    {coins:100},
    {published:false},
  ]){
    const {db,records,commits}=setup(setting);
    await assert.rejects(()=>commitStorePurchaseOffline(db,user,request,levels,100000));
    assert.equal(commits(),0);
    assert.equal(records.get("users/buyer_1").coins,setting.coins??40000);
    assert.equal(records.has("user_store_entitlements/buyer_1/items/200001"),false);
    assert.equal(records.has("financial_ledger/store_buyer_1__"+request.operationId),false);
  }
});

test("offline store transactions refuse duplicate ownership and invalid VIP",async()=>{
  const {db,records,commits}=setup();
  records.set("user_store_entitlements/buyer_1/items/200001",{status:"active"});
  await assert.rejects(()=>commitStorePurchaseOffline(db,user,request,levels,100000),
    /store_item_already_owned/);
  records.delete("user_store_entitlements/buyer_1/items/200001");
  records.get("users/buyer_1").effectiveVipLevel=0;
  await assert.rejects(()=>commitStorePurchaseOffline(db,user,request,{
    ...levels,vipLevel:10,
  },100000),/store_vip_level_required/);
  assert.equal(commits(),0);
});

test("lost commit acknowledgment never debits the user twice", async()=>{
  const {db,records,commits}=setup();
  const realCommit=db.commit;
  let loseReply=true;
  db.commit=async(...args)=>{
    await realCommit(...args);
    if(loseReply){
      loseReply=false;
      throw Error("firestore_network_error");
    }
  };
  const result=await commitStorePurchaseOffline(db,user,{
    ...request,priceCoins:1,discountCoins:999999,
  },levels,100000);
  assert.equal(result.ok,true);
  assert.equal(result.duplicate,true);
  assert.equal(commits(),1);
  assert.equal(records.get("users/buyer_1").coins,15000);
  assert.equal(records.get("store_purchase_receipts/buyer_1__"+
    request.operationId).priceCoins,25000);
});

test("production API never imports the offline transaction executor",()=>{
  const handler=readFileSync(new URL(
    "../../cloudflare-worker/src/store-entitlements.js",import.meta.url),"utf8");
  const routes=readFileSync(new URL(
    "../../cloudflare-worker/src/index.js",import.meta.url),"utf8");
  assert.doesNotMatch(handler,/commitStorePurchaseOffline|store-purchase-transaction/);
  assert.doesNotMatch(routes,/commitStorePurchaseOffline|store-purchase-transaction/);
  assert.match(handler,/return json\(request, env, \{\s*ok:false, code:"purchasing_disabled"/);
});

test("purchase rejects economy lock, suspended/deleting users and guest sign-in",async()=>{
  const locked=setup();
  locked.records.set("system_config/emergency_lock",{economyLocked:true});
  await assert.rejects(()=>commitStorePurchaseOffline(
    locked.db,user,request,levels,100000),/emergency_locked/);
  assert.equal(locked.commits(),0);
  for(const changes of [
    {accountStatus:"deleting"},
    {deletionRequestedAt:"2026-10-29"},
    {deletedAt:"2026-10-29"},
    {authDeleted:true},
    {deletionProcessing:true},
  ]){
    const sample=setup();
    Object.assign(sample.records.get("users/buyer_1"),changes);
    await assert.rejects(()=>commitStorePurchaseOffline(
      sample.db,user,request,levels,100000),/store_buyer_not_eligible/);
    assert.equal(sample.commits(),0);
  }
  const guest=setup();
  await assert.rejects(()=>commitStorePurchaseOffline(
    guest.db,{...user,firebase:{sign_in_provider:"anonymous"}},
    request,levels,100000),/account_required/);
  assert.equal(guest.commits(),0);
});

test("wallet mirrors must reconcile before charging and levels are never client-trusted",async()=>{
  for(const changes of [
    {coins:null},
    {coins:-1},
    {coins:40000,balance:100},
    {wealthPoints:-1},
  ]){
    const sample=setup();
    Object.assign(sample.records.get("users/buyer_1"),changes);
    await assert.rejects(()=>commitStorePurchaseOffline(
      sample.db,user,request,levels,100000),
      /invalid_wallet_state|invalid_store_eligibility/);
    assert.equal(sample.commits(),0);
  }
  const vip=setup();
  vip.records.get("users/buyer_1").effectiveVipLevel=0;
  await assert.rejects(()=>commitStorePurchaseOffline(
    vip.db,user,request,{vipLevel:10,wealthLevel:35},100000),
    /store_vip_level_required/);
  assert.equal(vip.commits(),0);
  const wealth=setup();
  wealth.records.get("system_config/store_catalog").items=[{
    ...product(),minVipLevel:0,minWealthLevel:3,
  }];
  await assert.rejects(()=>commitStorePurchaseOffline(
    wealth.db,user,request,{vipLevel:10,wealthLevel:35},100000),
    /store_wealth_level_required/);
  assert.equal(wealth.commits(),0);
});

test("revoked/expired ownership blocks a new charge until approved renewal policy",async()=>{
  for(const status of ["active","revoked"]){
    const sample=setup();
    sample.records.set("user_store_entitlements/buyer_1/items/200001",{
      status,expiresAtMs:0,ownerUid:"buyer_1",
    });
    await assert.rejects(()=>commitStorePurchaseOffline(
      sample.db,user,request,levels,100000),/store_item_already_owned/);
    assert.equal(sample.commits(),0);
    assert.equal(sample.records.get("users/buyer_1").coins,40000);
  }
});
