import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {test} from "node:test";
import {canViewStoreInventory,loadStoreUserInventory} from "../../cloudflare-worker/src/manage-store-inventory.js";
import {storeCatalogInternals} from "../../cloudflare-worker/src/manage-store-catalog.js";
import {manageUserAccessInternals} from "../../cloudflare-worker/src/manage-user-access.js";

const actor={role:"admin",adminEnabled:true,
  capabilities:["viewStoreInventory"],accountStatus:"active"};
const token={sub:"admin_uid",iat:Math.floor(Date.now()/1000),
  auth_time:Math.floor(Date.now()/1000)};
const item={
  ownerUid:"target_uid",productId:"200001",
  nameAr:"إطار متجر",category:"frames",assetKey:"store.item.200001.icon",
  source:"purchase",status:"active",acquiredAtMs:1000,expiresAtMs:null,
  grantedBy:"PRIVATE_ADMIN",operationId:"PRIVATE_OP",priceCoins:1500,
};
function fakeDb(currentActor=actor) {
  const reads=[],docs=new Map([
    ["users/admin_uid",currentActor],
    ["users/target_uid",{role:"user",accountStatus:"active"}],
    ["system_config/store_catalog",{revision:9,items:[{
      id:"200001",nameAr:"PRIVATE_HIDDEN_CATALOG",enabled:false,
    }]}],
  ]);
  return {reads,docs,
    async get(path) {reads.push(path);return {
      exists:docs.has(path),data:docs.get(path),
    };},
    async list(path,limit) {
      reads.push(`${path}?limit=${limit}`);
      return [{data:item,id:"200001"}];
    },
  };
}
test("viewStoreInventory needs explicit admin authorization; no implicit manageStore permission",()=>{
  assert.equal(canViewStoreInventory({role:"owner"}),true);
  assert.equal(canViewStoreInventory(actor),true);
  for(const user of [
    {role:"admin",adminEnabled:true,capabilities:["manageStore"]},
    {role:"admin",adminEnabled:true,capabilities:["viewStore"]},
    {role:"admin",adminEnabled:false,capabilities:["viewStoreInventory"]},
    {role:"moderator",adminEnabled:true,capabilities:["viewStoreInventory"]},
    {role:"user",adminEnabled:true,capabilities:["viewStoreInventory"]},
  ]) assert.equal(canViewStoreInventory(user),false);
});

test("separate inventory-only permission does not expose hidden admin catalog",async()=>{
  const db=fakeDb();
  const state=await storeCatalogInternals.loadState(db,token);
  assert.equal(state.canEdit,false);
  assert.equal(state.canViewInventory,true);
  assert.equal(state.canViewCatalog,false);
  assert.equal(state.revision,0);
  assert.deepEqual(state.items,[]);
  await assert.rejects(()=>storeCatalogInternals.saveCatalog(db,token,{
    operationId:"read_only_admin_01",expectedRevision:0,items:[],
  }),/forbidden/);
});

test("admin can inspect only one target's bounded entitlements with sanitized fields",async()=>{
  const db=fakeDb();
  const view=await loadStoreUserInventory(db,token,"target_uid",2000);
  assert.equal(view.ok,true);
  assert.equal(view.purchasingEnabled,false);
  assert.equal(view.targetUid,"target_uid");
  assert.equal(view.items.length,1);
  assert.equal(view.items[0].active,true);
  assert.equal(view.resultLimit,100);
  assert.equal(view.moreMayExist,false);
  assert.ok(!JSON.stringify(view).includes("PRIVATE"));
  assert.ok(db.reads.includes("user_store_entitlements/target_uid/items?limit=100"));
  assert.deepEqual(db.reads.filter(x=>x.startsWith("user_store_entitlements/")),
    ["user_store_entitlements/target_uid/items?limit=100"]);
  const service=readFileSync(new URL(
    "../../cloudflare-worker/src/manage-store-inventory.js", import.meta.url),"utf8");
  assert.doesNotMatch(service,/db\.commit\(|db\.writeCreate\(|db\.writeUpdate\(|db\.runQuery\(/);
});

test("reject unauthorized, missing user, stale auth and malformed IDs before target data reads",async()=>{
  for(const bad of [
    {role:"admin",adminEnabled:false,capabilities:["viewStoreInventory"]},
    {role:"user",adminEnabled:true,capabilities:["viewStoreInventory"]},
  ]){
    const db=fakeDb(bad);
    await assert.rejects(()=>loadStoreUserInventory(db,token,"target_uid"),/forbidden/);
    assert.deepEqual(db.reads,["users/admin_uid"]);
  }
  const badUidDb=fakeDb();
  await assert.rejects(()=>loadStoreUserInventory(
    badUidDb,token,"../other"),/invalid_target_id/);
  assert.ok(!badUidDb.reads.some(s=>s.startsWith("user_store_entitlements/")));
  await assert.rejects(()=>loadStoreUserInventory(
    fakeDb(),{...token,auth_time:1},"target_uid"),/recent_auth_required/);
  const missing=fakeDb();
  missing.docs.delete("users/target_uid");
  await assert.rejects(()=>loadStoreUserInventory(
    missing,token,"target_uid"),/not_found/);
  assert.ok(!missing.reads.some(s=>s.startsWith("user_store_entitlements/")));
  const deleted=fakeDb({...actor,accountStatus:"deleting"});
  await assert.rejects(()=>loadStoreUserInventory(deleted,token,"target_uid"),
    /unauthorized/);
});

test("Owner permission workflow recognizes Store inventory as distinct permission",async()=>{
  assert.deepEqual(manageUserAccessInternals.normalizeCapabilities(
    ["viewStoreInventory","viewStore"]),["viewStore","viewStoreInventory"]);
  const ownerUi=readFileSync(new URL(
    "../../lib/admin/user_access_control_card.dart",import.meta.url),"utf8");
  const control=readFileSync(new URL(
    "../../lib/admin/store_catalog_control_page.dart",import.meta.url),"utf8");
  const main=readFileSync(new URL("../../lib/main_control.dart",import.meta.url),"utf8");
  assert.match(ownerUi,/'viewStoreInventory': 'عرض مقتنيات مستخدمي المتجر'/);
  assert.match(control,/if \(activeSection == 4\)/);
  assert.match(control,/StoreUserInventoryPanel\(/);
  assert.match(main,/capabilities\.contains\('viewStoreInventory'\)/);
  const accessCode=readFileSync(new URL(
    "../../cloudflare-worker/src/manage-user-access.js",import.meta.url),"utf8");
  assert.match(accessCode,/capabilities\.includes\("viewStoreInventory"\)/);
  assert.match(accessCode,/"viewStoreInventory"/);
});
