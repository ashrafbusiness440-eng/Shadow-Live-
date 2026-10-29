import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {test} from "node:test";
import {storeCatalogInternals} from "../../cloudflare-worker/src/manage-store-catalog.js";

const now=Math.floor(Date.now()/1000);
const owner={sub:"owner_1",iat:now,auth_time:now};
const enabledEnv={STORE_PURCHASE_ISSUANCE_ENABLED:"owner-purchases-v1"};
const request={action:"purchasing",enabled:true,
  confirmation:"confirmed",operationId:"store_rollout_owner_0001",
  expectedRevision:3};

function setup({purchasingEnabled=false,ownerRole="owner"}={}){
  const records=new Map([
    ["users/owner_1",{role:ownerRole,accountStatus:"active",
      adminEnabled:true,capabilities:["manageStore"]}],
    ["system_config/store_catalog",{revision:3,purchasingEnabled,
      items:[{id:"200001",enabled:true,priceCoins:25000}]}],
  ]);
  let commits=0;
  const db={
    async beginTransaction(){return {active:true};},
    async rollback(){},
    async get(path,tx){
      assert.equal(tx?.active,true,"all Store rollout reads are transactional");
      return {exists:records.has(path),data:records.get(path)};
    },
    writeUpdate(path,data,mask){
      return {kind:"update",path,data,mask};
    },
    writeCreate(path,data){return {kind:"create",path,data};},
    async commit(tx,writes){
      assert.equal(tx?.active,true);
      assert.equal(writes.length,3);
      for(const write of writes){
        if(write.kind==="create"&&records.has(write.path))
          throw Error("ALREADY_EXISTS");
      }
      for(const write of writes){
        if(write.kind==="update"){
          assert.deepEqual(write.mask,[
            "purchasingEnabled","revision","updatedAt","updatedBy",
          ]);
          records.set(write.path,{...records.get(write.path),...write.data});
        }else{
          records.set(write.path,write.data);
        }
      }
      commits++;
    },
  };
  return {db,records,commits:()=>commits};
}

test("enabling purchasing requires private Worker rollout and Owner authority",async()=>{
  const sample=setup();
  await assert.rejects(()=>storeCatalogInternals.setStorePurchasing(
    sample.db,owner,request,{}),/purchase_release_not_ready/);
  assert.equal(sample.commits(),0);
  assert.equal(sample.records.get("system_config/store_catalog").purchasingEnabled,false);
  const admin=setup({ownerRole:"admin"});
  await assert.rejects(()=>storeCatalogInternals.setStorePurchasing(
    admin.db,owner,request,enabledEnv),/forbidden/);
  assert.equal(admin.commits(),0);
  const stale=setup();
  await assert.rejects(()=>storeCatalogInternals.setStorePurchasing(
    stale.db,{...owner,auth_time:1},request,enabledEnv),
    /recent_auth_required/);
  assert.equal(stale.commits(),0);
});

test("Owner rollout creates one catalog update, immutable audit and receipt",async()=>{
  const sample=setup();
  const result=await storeCatalogInternals.setStorePurchasing(
    sample.db,owner,request,enabledEnv);
  assert.deepEqual(result,{ok:true,purchasingEnabled:true,revision:4});
  assert.equal(sample.commits(),1);
  assert.equal(sample.records.get("system_config/store_catalog")
    .purchasingEnabled,true);
  assert.equal(sample.records.get("system_config/store_catalog").revision,4);
  assert.equal(sample.records.get("admin_audit_logs/store_purchase_rollout_"+
    request.operationId).action,"setStorePurchasing");
  assert.equal(sample.records.get("control_operations/store_purchase_rollout_"+
    request.operationId).status,"completed");
  assert.equal([...sample.records.keys()].filter(k=>
    k.startsWith("financial_ledger/")).length,0);
  const repeated=await storeCatalogInternals.setStorePurchasing(
    sample.db,owner,request,enabledEnv);
  assert.equal(repeated.duplicate,true);
  assert.equal(sample.commits(),1);
  await assert.rejects(()=>storeCatalogInternals.setStorePurchasing(
    sample.db,owner,{...request,enabled:false},enabledEnv),
    /operation_id_conflict/);
  assert.equal(sample.commits(),1);
});

test("Owner can disable purchasing even when Worker release is switched off",async()=>{
  const sample=setup({purchasingEnabled:true});
  const result=await storeCatalogInternals.setStorePurchasing(
    sample.db,owner,{...request,enabled:false}, {});
  assert.equal(result.purchasingEnabled,false);
  assert.equal(sample.records.get("system_config/store_catalog")
    .purchasingEnabled,false);
  assert.equal(sample.commits(),1);
});

test("rollout blocks economy locks, stale catalog revision and empty catalog",async()=>{
  const sample=setup();
  sample.records.set("system_config/emergency_lock",{economyLocked:true});
  await assert.rejects(()=>storeCatalogInternals.setStorePurchasing(
    sample.db,owner,request,enabledEnv),/emergency_locked/);
  assert.equal(sample.commits(),0);
  sample.records.delete("system_config/emergency_lock");
  await assert.rejects(()=>storeCatalogInternals.setStorePurchasing(
    sample.db,owner,{...request,expectedRevision:2},enabledEnv),
    /store_catalog_conflict/);
  const catalog=sample.records.get("system_config/store_catalog");
  catalog.items=[];
  await assert.rejects(()=>storeCatalogInternals.setStorePurchasing(
    sample.db,owner,request,enabledEnv),/store_purchasable_items_missing/);
  assert.equal(sample.commits(),0);
});

test("client, editor roles and invalid confirmations cannot enable purchase",async()=>{
  const sample=setup();
  for(const patch of [
    {enabled:"true"}, {confirmation:"preview"},
    {operationId:"a"}, {expectedRevision:-1},
  ]){
    await assert.rejects(()=>storeCatalogInternals.setStorePurchasing(
      sample.db,owner,{...request,...patch},enabledEnv));
  }
  assert.equal(sample.commits(),0);
});

test("previous toggle receipt cannot override a later catalog change",async()=>{
  const sample=setup();
  await storeCatalogInternals.setStorePurchasing(
    sample.db,owner,request,enabledEnv);
  sample.records.get("system_config/store_catalog").revision=5;
  sample.records.get("system_config/store_catalog").purchasingEnabled=false;
  await assert.rejects(()=>storeCatalogInternals.setStorePurchasing(
    sample.db,owner,request,enabledEnv),/store_rollout_state_changed/);
  assert.equal(sample.commits(),1);
  assert.equal(sample.records.get("system_config/store_catalog").purchasingEnabled,false);
});

test("Shadow Control gives only Owner an Arabic guarded rollout switch",()=>{
  const ui=readFileSync(new URL(
    "../../lib/admin/store_catalog_control_page.dart",import.meta.url),"utf8");
  const api=readFileSync(new URL(
    "../../cloudflare-worker/src/manage-store-catalog.js",import.meta.url),"utf8");
  assert.match(ui,/canTogglePurchasing/);
  assert.match(ui,/purchaseReleaseReady/);
  assert.match(ui,/تأكيد تشغيل الشراء/);
  assert.match(ui,/pendingPurchasingOperationId/);
  assert.match(ui,/expectedRevision': revision/);
  assert.match(api,/actor\.data\?\.role!=="owner"/);
  assert.match(api,/storeCheckoutIssuanceEnabled\(env\)/);
  assert.match(api,/control_operations\/store_purchase_rollout_/);
  assert.match(api,/store_rollout_state_changed/);
  assert.doesNotMatch(ui,/writeUpdate\(|financial_ledger\//);
});
