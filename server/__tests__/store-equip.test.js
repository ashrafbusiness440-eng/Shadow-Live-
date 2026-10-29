import assert from "node:assert/strict";
import {test} from "node:test";
import {
  commitStoreEquip,readStoreEquipSlots,storeEntitlementEquipped,storeEquip,
} from "../../cloudflare-worker/src/store-equip.js";

const uid="user_equips_1";
const now=120000;
function item(id,category="frames",extra={}){
  return {
    ownerUid:uid,productId:id,category,nameAr:"إطار",
    assetKey:"store.item."+id+".icon",
    source:"purchase",status:"active",acquiredAtMs:10000,
    expiresAtMs:200000,equipped:false,...extra,
  };
}
function setup(){
  const records=new Map([
    ["users/"+uid,{role:"user",accountStatus:"active",coins:32100}],
    ["user_store_entitlements/"+uid+"/items/200001",item("200001")],
    ["user_store_entitlements/"+uid+"/items/200002",item("200002")],
    ["user_store_entitlements/"+uid+"/items/200003",item("200003","chatBubbles")],
    ...["200001","200002","200003"].map(id=>[
      "app_asset_registry/store.item."+id+".icon",
      {published:true,rawUrl:"https://example.com/"+id+".webp"},
    ]),
  ]);
  const writesLog=[];
  const db={
    async beginTransaction(){return {active:true};},
    async rollback(){},
    async get(path){return {exists:records.has(path),data:records.get(path)};},
    writeCreate(path,data){return {kind:"create",path,data};},
    writeUpdate(path,data){return {kind:"update",path,data};},
    async commit(tx,writes){
      // Minimal test fake; real Firestore commits all writes in one transaction.
      for(const w of writes){
        if(w.kind==="create"&&records.has(w.path))
          throw Error("ALREADY_EXISTS");
      }
      for(const w of writes){
        records.set(w.path,w.kind==="update"
          ?{...records.get(w.path),...w.data}:w.data);
      }
      writesLog.push(writes);
    },
  };
  return {db,records,writesLog};
}
const token={sub:uid,iat:Math.floor(Date.now()/1000)};

test("equip, replace and unequip are atomic per-category and no Coins move",async()=>{
  const {db,records,writesLog}=setup();
  const first=await commitStoreEquip(db,token,{action:"equip",
    productId:"200001",uid:"another_user"},now);
  assert.equal(first.changed,true);
  assert.equal(first.category,"frames");
  assert.equal(first.productId,"200001");
  assert.equal(records.get("user_store_equipped/"+uid).slots.frames,"200001");
  assert.equal(records.get("user_store_entitlements/"+uid+"/items/200001").equipped,true);
  const repeat=await commitStoreEquip(db,token,{action:"equip",
    productId:"200001"},now+1);
  assert.equal(repeat.changed,false);
  assert.equal(writesLog.length,1);
  await commitStoreEquip(db,token,{action:"equip",productId:"200003"},now+2);
  assert.deepEqual(records.get("user_store_equipped/"+uid).slots,
    {frames:"200001",chatBubbles:"200003"});
  await commitStoreEquip(db,token,{action:"equip",productId:"200002"},now+3);
  assert.deepEqual(records.get("user_store_equipped/"+uid).slots,
    {frames:"200002",chatBubbles:"200003"});
  assert.equal(records.get("user_store_entitlements/"+uid+"/items/200001").equipped,false);
  assert.equal(records.get("user_store_entitlements/"+uid+"/items/200002").equipped,true);
  assert.equal(writesLog[2].length,3);
  const cleared=await commitStoreEquip(db,token,{
    action:"unequip",category:"frames",uid:"another_user"},now+4);
  assert.equal(cleared.productId,null);
  assert.deepEqual(records.get("user_store_equipped/"+uid).slots,
    {chatBubbles:"200003"});
  const noOp=await commitStoreEquip(db,token,{
    action:"unequip",category:"frames"},now+5);
  assert.equal(noOp.changed,false);
  assert.equal(writesLog.length,4);
  assert.equal(records.get("users/"+uid).coins,32100);
  assert.equal([...records.keys()].filter(k=>
    /financial_ledger|store_purchase_operations/.test(k)).length,0);
});

test("equipped projection only displays valid active owned selection",()=>{
  const sample={active:true,category:"frames",productId:"200001"};
  assert.equal(storeEntitlementEquipped(sample,{frames:"200001"}),true);
  assert.equal(storeEntitlementEquipped({...sample,active:false},
    {frames:"200001"}),false);
  assert.equal(storeEntitlementEquipped(sample,{frames:"200002"}),false);
  assert.deepEqual(readStoreEquipSlots({exists:false},uid),{});
  assert.throws(()=>readStoreEquipSlots({exists:true,
    data:{ownerUid:"other",slots:{frames:"200001"}}},uid),
    /store_equipment_invalid/);
  assert.throws(()=>readStoreEquipSlots({exists:true,
    data:{ownerUid:uid,slots:{forged:"200001"}}},uid),
    /store_equipment_invalid/);
});

test("equip fails closed for expired, revoked, wrong owner, draft assets",async()=>{
  for(const change of [
    {expiresAtMs:now},
    {status:"revoked"},
    {ownerUid:"other"},
    {category:"unknown"},
    {assetKey:"evil.asset"},
  ]){
    const c=setup();
    Object.assign(c.records.get("user_store_entitlements/"+uid+
      "/items/200001"),change);
    await assert.rejects(()=>commitStoreEquip(c.db,token,{
      action:"equip",productId:"200001"},now),/store_entitlement_not_usable/);
    assert.equal(c.writesLog.length,0);
  }
  for(const change of [{published:false},{rawUrl:"http://unsafe"}]){
    const c=setup();
    Object.assign(c.records.get("app_asset_registry/store.item.200001.icon"),
      change);
    await assert.rejects(()=>commitStoreEquip(c.db,token,{
      action:"equip",productId:"200001"},now),/store_asset_not_published/);
    assert.equal(c.writesLog.length,0);
  }
});

test("account state and input are server-enforced",async()=>{
  for(const change of [
    {accountStatus:"suspended"},{deletionRequestedAt:"2026-10-29"},
    {authDeleted:true},{deletionProcessing:true},
  ]){
    const c=setup();
    Object.assign(c.records.get("users/"+uid),change);
    await assert.rejects(()=>commitStoreEquip(c.db,token,{
      action:"equip",productId:"200001"},now),/store_equipment_account_inactive/);
    assert.equal(c.writesLog.length,0);
  }
  for(const body of [
    {action:"buy",productId:"200001"},
    {action:"equip",productId:"../../users/other"},
    {action:"unequip",category:"admin"},
    {action:"equip"},
  ]){
    const c=setup();
    await assert.rejects(()=>commitStoreEquip(c.db,token,body,now),
      /invalid_store/);
    assert.equal(c.writesLog.length,0);
  }
  const c=setup();
  await assert.rejects(()=>commitStoreEquip(c.db,{sub:"other"},{
    action:"equip",productId:"200001"},now),/unauthorized/);
  assert.equal(c.writesLog.length,0);
});

test("unequip permits cleaning a revoked item without re-enabling it",async()=>{
  const c=setup();
  await commitStoreEquip(c.db,token,{
    action:"equip",productId:"200001"},now);
  c.records.get("user_store_entitlements/"+uid+
    "/items/200001").status="revoked";
  const cleared=await commitStoreEquip(c.db,token,{
    action:"unequip",category:"frames"},now+100);
  assert.equal(cleared.changed,true);
  assert.deepEqual(c.records.get("user_store_equipped/"+uid).slots,{});
  assert.equal(c.records.get("user_store_entitlements/"+uid+
    "/items/200001").equipped,false);
});

test("route is POST only; no browser direct mutation or wallet route",async()=>{
  const response=await storeEquip(
    new Request("https://example.com/api/store-equip"),{});
  assert.equal(response.status,405);
  assert.equal((await response.json()).code,"method_not_allowed");
});
