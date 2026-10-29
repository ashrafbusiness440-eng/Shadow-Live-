import assert from "node:assert/strict";
import {test} from "node:test";
import {prepareStoreRenewal} from "../../cloudflare-worker/src/store-renewal-policy.js";
import {commitStorePurchaseOffline} from "../../cloudflare-worker/src/store-purchase-transaction.js";

const now=1761740000000,day=86_400_000;
const product=()=>({
  id:"200001",nameAr:"إطار",category:"frames",
  priceCoins:25000,durationDays:7,rarity:"normal",minVipLevel:1,
  enabled:true,sortOrder:1,assetKey:"store.item.200001.icon",
});
const ent=(patch={})=>({
  ownerUid:"buyer_1",productId:"200001",category:"frames",
  assetKey:"store.item.200001.icon",status:"active",
  source:"purchase",equipped:true,acquiredAtMs:now-10*day,
  expiresAtMs:now+3*day,renewalCount:0,...patch,
});
const quote=()=>({productId:"200001",category:"frames",
  assetKey:"store.item.200001.icon",durationDays:7,
  expiresAtMs:now+7*day});
const term=existing=>prepareStoreRenewal({
  existing,uid:"buyer_1",quote:quote(),nowMs:now,
});
test("active ownership extends from current deadline, not the purchase time",()=>{
  const t=term(ent());
  assert.equal(t.renewal,true);
  assert.equal(t.expiresAtMs,now+10*day);
  assert.equal(t.equipped,true);
  assert.equal(t.renewalCount,1);
  assert.equal(t.originalAcquiredAtMs,now-10*day);
  assert.equal(t.previousExpiresAtMs,now+3*day);
});
test("expired ownership renews from now without carrying lost time or silently equipping",()=>{
  const t=term(ent({expiresAtMs:now-day,equipped:true,status:"expired"}));
  assert.equal(t.expiresAtMs,now+7*day);
  assert.equal(t.equipped,false);
  assert.equal(t.renewalCount,1);
});
test("approved permanent upgrade is final and permanent entitlement cannot be extended",()=>{
  const t=prepareStoreRenewal({existing:ent(),uid:"buyer_1",
    quote:{...quote(),durationDays:0,expiresAtMs:null},nowMs:now});
  assert.equal(t.expiresAtMs,null);
  assert.throws(()=>term(ent({expiresAtMs:null})),/store_item_already_owned/);
});
test("revoked, forged, changed-category, malformed and foreign ownership all reject charge",()=>{
  for(const patch of [
    {status:"revoked"},{ownerUid:"other"},
    {category:"nameEffects"},{productId:"200099"},
    {assetKey:"store.item.200099.icon"},
    {source:"unknown"},{expiresAtMs:-3},
    {acquiredAtMs:"bad"},{renewalCount:-1},
  ])assert.throws(()=>term(ent(patch)),/store_item_already_owned/,
    JSON.stringify(patch));
});
function fixture({coins=100000,existing=ent(),durationDays=7}={}){
  const records=new Map([
    ["users/buyer_1",{coins,accountStatus:"active",role:"user",
      wealthPoints:0,effectiveVipLevel:2}],
    ["system_config/store_catalog",{purchasingEnabled:true,revision:1,
      items:[{...product(),durationDays}]}],
    ["app_asset_registry/store.item.200001.icon",
      {published:true,rawUrl:"https://example.test/icon.webp"}],
    ...(existing?[["user_store_entitlements/buyer_1/items/200001",existing]]:[]),
  ]);
  let commits=0;
  const db={
    async beginTransaction(){return {active:true}},
    async rollback(){},
    async get(path){return {exists:records.has(path),data:records.get(path)}},
    writeUpdate(path,data){return {kind:"update",path,data}},
    writeCreate(path,data){return {kind:"create",path,data}},
    async commit(tx,writes){
      for(const w of writes)
        if(w.kind==="create"&&records.has(w.path))
          throw Error("ALREADY_EXISTS");
      for(const w of writes)
        records.set(w.path,w.kind==="update"
          ?{...records.get(w.path),...w.data}:w.data);
      commits++;
    },
  };
  return {db,records,commits:()=>commits};
}
const user={sub:"buyer_1",iat:Math.floor(Date.now()/1000)};
const req=(operationId="renewal_safely_0001")=>({
  productId:"200001",operationId,
  expectedPriceCoins:25000,expectedDurationDays:7,
});
test("offline renewal uses one wallet debit, one entitlement update and new unique receipt",async()=>{
  const f=fixture();
  const result=await commitStorePurchaseOffline(f.db,user,req(),null,now);
  assert.equal(result.renewal,true);
  assert.equal(result.expiresAtMs,now+10*day);
  assert.equal(result.renewalCount,1);
  assert.equal(f.commits(),1);
  assert.equal(f.records.get("users/buyer_1").coins,75000);
  assert.equal(f.records.get("user_store_entitlements/buyer_1/items/200001")
    .expiresAtMs,now+10*day);
  assert.equal(f.records.get("user_store_entitlements/buyer_1/items/200001")
    .acquiredAtMs,now-10*day);
  assert.equal(f.records.get("financial_ledger/store_buyer_1__renewal_safely_0001")
    .delta,-25000);
  assert.equal(f.records.get("store_purchase_receipts/buyer_1__renewal_safely_0001")
    .renewal,true);
  assert.equal(f.records.get("admin_audit_logs/store_purchase_buyer_1__renewal_safely_0001")
    .action,"renewStoreItem");
  const replay=await commitStorePurchaseOffline(f.db,user,req(),null,now+1000);
  assert.equal(replay.duplicate,true);
  assert.equal(f.records.get("users/buyer_1").coins,75000);
  assert.equal(f.commits(),1);
  const second=await commitStorePurchaseOffline(f.db,user,
    req("renewal_safely_0002"),null,now+1000);
  assert.equal(second.expiresAtMs,now+17*day);
  assert.equal(f.commits(),2);
  assert.equal(f.records.get("users/buyer_1").coins,50000);
});
test("revoked, invalid entitlement, price changes and insufficient coins never debit",async()=>{
  for(const config of [
    {existing:ent({status:"revoked"})},
    {existing:ent({ownerUid:"other"})},
    {existing:ent({expiresAtMs:null})},
    {coins:100},
  ]){
    const f=fixture(config);
    await assert.rejects(()=>commitStorePurchaseOffline(
      f.db,user,req(),null,now));
    assert.equal(f.commits(),0);
    assert.equal(f.records.get("users/buyer_1").coins,config.coins??100000);
  }
  const f=fixture();
  await assert.rejects(()=>commitStorePurchaseOffline(
    f.db,user,{...req(),expectedPriceCoins:1000},null,now),
    /store_purchase_quote_changed/);
  assert.equal(f.commits(),0);
});
test("offline gates remain authoritative: users cannot unlock purchase via request body",async()=>{
  const f=fixture();
  f.records.get("system_config/store_catalog").purchasingEnabled=false;
  await assert.rejects(()=>commitStorePurchaseOffline(
    f.db,user,{...req(),purchasingEnabled:true,grantEnabled:true},null,now),
    /purchasing_disabled/);
  assert.equal(f.commits(),0);
});
