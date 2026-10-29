import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {test} from "node:test";
import {commitStoreGrantOffline} from "../../cloudflare-worker/src/store-grant-transaction-offline.js";

const NOW=200000;
const ownerToken={sub:"owner_1",iat:200,auth_time:200};
const operation={targetId:"١٢٣٤٥٦",productId:"200001",
  operationId:"owner_grant_offline_0001",reason:"منحة تقديرية من المالك"};
const item={id:"200001",nameAr:"إطار ملكي",category:"frames",
  assetKey:"store.item.200001.icon",priceCoins:30000,durationDays:7,
  sortOrder:0,rarity:"normal",minVipLevel:0,minWealthLevel:0,
  visibleFromMs:null,visibleUntilMs:null,enabled:true};
function setup() {
  const records=new Map([
    ["users/owner_1",{role:"owner",accountStatus:"active"}],
    ["users/target_1",{accountStatus:"active",publicId:"123456",
      effectiveVipLevel:0,wealthPoints:0,coins:10000}],
    ["public_ids/123456",{uid:"target_1"}],
    ["system_config/store_catalog",{revision:2,items:[item]}],
    ["app_asset_registry/store.item.200001.icon",{
      published:true,rawUrl:"https://example.com/frame.webp",
    }],
  ]);
  let commits=0;
  const reads=[];
  const db={
    async beginTransaction(){return {active:true};},
    async rollback(){},
    async get(path,tx){
      assert.ok(tx?.active,"reads must be bound to the transaction");
      reads.push(path);
      return {exists:records.has(path),data:records.get(path)};
    },
    writeCreate(path,data){return {kind:"create",path,data};},
    async commit(tx,writes){
      assert.ok(tx?.active);
      if(writes.some(w=>w.kind!=="create"))throw Error("unexpected_update");
      if(writes.some(w=>records.has(w.path)))throw Error("ALREADY_EXISTS");
      for(const write of writes)records.set(write.path,write.data);
      commits++;
    },
  };
  return {db,reads,records,commits:()=>commits};
}

test("offline Owner grant atomically creates item + operation + audit, never debits Coins",async()=>{
  const {db,records,commits}=setup();
  const result=await commitStoreGrantOffline(db,ownerToken,operation,NOW);
  assert.equal(result.ok,true);
  assert.equal(result.duplicate,undefined);
  assert.equal(result.targetUid,"target_1");
  assert.equal(result.expiresAtMs,NOW+7*86400000);
  assert.equal(commits(),1);
  const entitlement=records.get("user_store_entitlements/target_1/items/200001");
  assert.equal(entitlement.source,"admin_grant");
  assert.equal(entitlement.ownerUid,"target_1");
  assert.equal(entitlement.status,"active");
  assert.equal(entitlement.equipped,false);
  assert.equal(records.get("users/target_1").coins,10000);
  assert.equal(records.has("financial_ledger/store_target_1"),false);
  assert.equal([...records.keys()].filter(x=>x.startsWith("financial_ledger/")).length,0);
  assert.equal([...records.keys()].filter(x=>x.startsWith("store_purchase_receipts/")).length,0);
  const op=records.get("store_grant_operations/owner_1__"+operation.operationId);
  assert.equal(op.status,"completed");
  assert.equal(op.targetUid,"target_1");
  assert.equal(records.get(
    "admin_audit_logs/store_grant_owner_1__"+operation.operationId).action,
    "grantStoreItem");
  const repeat=await commitStoreGrantOffline(db,ownerToken,operation,NOW+1);
  assert.equal(repeat.duplicate,true);
  assert.equal(commits(),1);
  await assert.rejects(()=>commitStoreGrantOffline(db,ownerToken,{
    ...operation,productId:"200002",
  },NOW+2),/grant_operation_id_conflict/);
});

test("offline grant never permits admins, previewers, stale auth or inactive target",async()=>{
  const admin=setup();
  admin.records.set("users/owner_1",{
    role:"admin",adminEnabled:true,capabilities:["previewStoreGrants"],
    accountStatus:"active",
  });
  await assert.rejects(()=>commitStoreGrantOffline(
    admin.db,ownerToken,operation,NOW),/forbidden/);
  assert.equal(admin.commits(),0);
  const stale=setup();
  await assert.rejects(()=>commitStoreGrantOffline(
    stale.db,{...ownerToken,auth_time:0},operation,NOW+1860000),
    /recent_auth_required/);
  assert.equal(stale.commits(),0);
  const deleted=setup();
  deleted.records.set("users/target_1",{
    accountStatus:"deleting",publicId:"123456",coins:10000,
  });
  await assert.rejects(()=>commitStoreGrantOffline(
    deleted.db,ownerToken,operation,NOW),/target_not_active/);
  assert.equal(deleted.commits(),0);
  const reassigned=setup();
  reassigned.records.get("users/target_1").publicId="555555";
  await assert.rejects(()=>commitStoreGrantOffline(
    reassigned.db,ownerToken,operation,NOW),/target_not_found/);
  assert.equal(reassigned.commits(),0);
});

test("offline grants obey emergency economy stop and deleted-target guards",async()=>{
  for(const lock of [{enabled:true},{economyLocked:true}]){
    const sample=setup();
    sample.records.set("system_config/emergency_lock",lock);
    await assert.rejects(()=>commitStoreGrantOffline(
      sample.db,ownerToken,operation,NOW),/emergency_locked/);
    assert.equal(sample.commits(),0);
    assert.equal(sample.records.has(
      "user_store_entitlements/target_1/items/200001"),false);
    assert.equal(sample.records.get("users/target_1").coins,10000);
  }
  for(const patch of [
    {authDeleted:true},{deletionProcessing:true},
    {deletedAt:"2026-10-29"},{deletionRequestedAt:"2026-10-29"},
    {accountStatus:"suspended"},
  ]){
    const sample=setup();
    Object.assign(sample.records.get("users/target_1"),patch);
    await assert.rejects(()=>commitStoreGrantOffline(
      sample.db,ownerToken,operation,NOW),/target_not_active/);
    assert.equal(sample.commits(),0);
  }
});

test("grant replay remains idempotent after emergency lock is enabled",async()=>{
  const sample=setup();
  const first=await commitStoreGrantOffline(
    sample.db,ownerToken,operation,NOW);
  assert.equal(first.ok,true);
  sample.records.set("system_config/emergency_lock",{economyLocked:true});
  const again=await commitStoreGrantOffline(
    sample.db,ownerToken,operation,NOW+1);
  assert.equal(again.duplicate,true);
  assert.equal(sample.commits(),1);
  assert.equal(sample.records.get("users/target_1").coins,10000);
});

test("offline grant rejects hidden, future, expired and unpublished products",async()=>{
  const mutations=[
    {enabled:false},
    {visibleFromMs:NOW+1},
    {visibleUntilMs:NOW},
  ];
  for(const patch of mutations) {
    const {db,records,commits}=setup();
    records.get("system_config/store_catalog").items=[{...item,...patch}];
    await assert.rejects(()=>commitStoreGrantOffline(
      db,ownerToken,operation,NOW),/store_product_unavailable/);
    assert.equal(commits(),0);
  }
  const unpublished=setup();
  unpublished.records.get("app_asset_registry/store.item.200001.icon")
    .published=false;
  await assert.rejects(()=>commitStoreGrantOffline(
    unpublished.db,ownerToken,operation,NOW),/store_asset_not_published/);
  assert.equal(unpublished.commits(),0);
});

test("offline grant uses server VIP and policy-driven wealth levels",async()=>{
  const blocked=setup();
  blocked.records.get("system_config/store_catalog").items=[
    {...item,minVipLevel:4,minWealthLevel:20},
  ];
  await assert.rejects(()=>commitStoreGrantOffline(
    blocked.db,ownerToken,operation,NOW),/store_vip_level_required/);
  assert.equal(blocked.commits(),0);
  blocked.records.get("users/target_1").effectiveVipLevel=7;
  await assert.rejects(()=>commitStoreGrantOffline(
    blocked.db,ownerToken,operation,NOW),/store_wealth_level_required/);
  assert.equal(blocked.commits(),0);
  blocked.records.get("users/target_1").wealthPoints=1000000000000;
  const yes=await commitStoreGrantOffline(blocked.db,ownerToken,operation,NOW);
  assert.equal(yes.ok,true);
  assert.equal(blocked.commits(),1);

  const invalid=setup();
  invalid.records.get("system_config/store_catalog").items=[
    {...item,minWealthLevel:2},
  ];
  invalid.records.get("users/target_1").wealthPoints=-20;
  await assert.rejects(()=>commitStoreGrantOffline(
    invalid.db,ownerToken,operation,NOW),/invalid_target_level_data/);
  assert.equal(invalid.commits(),0);
});

test("existing entitlement including expired or revoked requires separate renewal policy",async()=>{
  for(const status of ["active","revoked"]){
    const {db,records,commits}=setup();
    records.set("user_store_entitlements/target_1/items/200001",{
      ownerUid:"target_1",status,expiresAtMs:100,
    });
    await assert.rejects(()=>commitStoreGrantOffline(db,ownerToken,operation,NOW),
      /store_item_already_owned/);
    assert.equal(commits(),0);
  }
});

test("unknown network ACK is retried with same idempotency marker",async()=>{
  const {db,commits,records}=setup();
  const real=db.commit;
  let first=true;
  db.commit=async(...args)=>{
    await real(...args);
    if(first){first=false;throw Error("firestore_network_error");}
  };
  const result=await commitStoreGrantOffline(db,ownerToken,operation,NOW);
  assert.equal(result.duplicate,true);
  assert.equal(commits(),1);
  assert.equal(records.get("users/target_1").coins,10000);
});

test("offline grants are not imported by any production route or preview handler",()=>{
  const entry=readFileSync(new URL(
    "../../cloudflare-worker/src/index.js",import.meta.url),"utf8");
  const preview=readFileSync(new URL(
    "../../cloudflare-worker/src/manage-store-grant-preview.js",import.meta.url),"utf8");
  const purchase=readFileSync(new URL(
    "../../cloudflare-worker/src/store-entitlements.js",import.meta.url),"utf8");
  const core=readFileSync(new URL(
    "../../cloudflare-worker/src/store-grant-transaction-offline.js",import.meta.url),"utf8");
  for(const src of [entry,preview,purchase]){
    assert.doesNotMatch(src,/commitStoreGrantOffline|store-grant-transaction-offline/);
  }
  assert.match(preview,/store_grants_disabled/);
  assert.match(preview,/423/);
  assert.match(purchase,/purchasing_disabled/);
  assert.doesNotMatch(core,/writeUpdate\(|financial_ledger\//);
});
