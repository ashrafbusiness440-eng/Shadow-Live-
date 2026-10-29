import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {test} from "node:test";
import {commitStoreGrantRevokeOffline}
  from "../../cloudflare-worker/src/store-grant-revoke-transaction.js";
import {manageStoreGrantRevoke,storeGrantRevokeEnabled}
  from "../../cloudflare-worker/src/manage-store-grant-revoke.js";

const now=1761740000000;
const owner={sub:"owner_1",iat:Math.floor(now/1000),
  auth_time:Math.floor(now/1000)};
const body=(operationId="store_revoke_0001")=>({
  action:"revoke",confirmation:"confirmed",
  targetUid:"user_1",productId:"200007",operationId,
  reason:"سحب منحة بطلب المالك",
});
function fixture({
  equipped=true,status="active",source="admin_grant",actorRole="owner",
}={}){
  const records=new Map([
    ["users/owner_1",{role:actorRole,accountStatus:"active"}],
    ["users/user_1",{role:"user",accountStatus:"active"}],
    ["user_store_entitlements/user_1/items/200007",{
      ownerUid:"user_1",productId:"200007",nameAr:"موجة",
      category:"voiceWaves",assetKey:"store.item.200007.icon",
      status,source,equipped,expiresAtMs:now+86400000,
      acquiredAtMs:now-1000,
    }],
    ["user_store_equipped/user_1",{
      ownerUid:"user_1",
      slots:equipped?{voiceWaves:"200007",frames:"200099"}:
        {frames:"200099"},
    }],
  ]);
  let commits=0;
  const db={
    async beginTransaction(){return {active:true}},
    async rollback(){},
    async get(path){return {exists:records.has(path),data:records.get(path)}},
    writeUpdate(path,data){return {kind:"update",path,data}},
    writeCreate(path,data){return {kind:"create",path,data}},
    async commit(tx,writes){
      for(const w of writes){
        if(w.kind==="create"&&records.has(w.path))
          throw Error("ALREADY_EXISTS");
      }
      for(const w of writes){
        records.set(w.path,w.kind==="update"
          ?{...records.get(w.path),...w.data}:w.data);
      }
      commits++;
    },
  };
  return {records,db,commits:()=>commits};
}
test("grant revoke clears only the equipped product and retains other categories",async()=>{
  const f=fixture();
  const result=await commitStoreGrantRevokeOffline(f.db,owner,body(),now);
  assert.equal(result.ok,true);
  assert.equal(result.revoked,true);
  assert.equal(result.wasEquipped,true);
  assert.equal(f.commits(),1);
  const item=f.records.get("user_store_entitlements/user_1/items/200007");
  assert.equal(item.status,"revoked");
  assert.equal(item.equipped,false);
  assert.equal(item.revokedAtMs,now);
  const slots=f.records.get("user_store_equipped/user_1").slots;
  assert.deepEqual(slots,{frames:"200099"});
  assert.equal(f.records.get(
    "admin_audit_logs/store_grant_revoke_owner_1__store_revoke_0001"
  ).action,"revokeStoreGrant");
  const replay=await commitStoreGrantRevokeOffline(f.db,owner,body(),now+1000);
  assert.equal(replay.duplicate,true);
  assert.equal(f.commits(),1);
  assert.equal(f.records.has("financial_ledger/store_revoke_0001"),false);
});
test("unequipped grant gets revoked without altering another slot",async()=>{
  const f=fixture({equipped:false});
  const result=await commitStoreGrantRevokeOffline(f.db,owner,body(),now);
  assert.equal(result.wasEquipped,false);
  assert.deepEqual(f.records.get("user_store_equipped/user_1").slots,
    {frames:"200099"});
  assert.equal(f.commits(),1);
});
test("no revocation of purchase, already revoked or forged/inconsistent grant",async()=>{
  for(const opts of [
    {source:"purchase"},{source:"reward"},{status:"revoked"},
    {actorRole:"admin"},
  ]){
    const f=fixture(opts);
    await assert.rejects(
      ()=>commitStoreGrantRevokeOffline(f.db,owner,body(),now),
      /store_entitlement_not_revocable|forbidden/);
    assert.equal(f.commits(),0);
  }
  const f=fixture();
  f.records.get("user_store_equipped/user_1").slots={};
  await assert.rejects(
    ()=>commitStoreGrantRevokeOffline(f.db,owner,body(),now),
    /store_equipment_conflict/);
  assert.equal(f.commits(),0);
  const foreign=fixture();
  foreign.records.get("user_store_entitlements/user_1/items/200007")
    .ownerUid="other";
  await assert.rejects(
    ()=>commitStoreGrantRevokeOffline(foreign.db,owner,body(),now),
    /store_entitlement_not_revocable/);
  assert.equal(foreign.commits(),0);
});
test("replayed operation with changed target or reason cannot revoke more items",async()=>{
  const f=fixture();
  await commitStoreGrantRevokeOffline(f.db,owner,body(),now);
  await assert.rejects(()=>commitStoreGrantRevokeOffline(f.db,owner,{
    ...body(),reason:"مختلف تمامًا عن السابق",
  },now+10),/revocation_operation_id_conflict/);
  await assert.rejects(()=>commitStoreGrantRevokeOffline(f.db,owner,{
    ...body(),productId:"200008",
  },now+10),/revocation_operation_id_conflict/);
  assert.equal(f.commits(),1);
});
test("expired sign-in, missing owner, invalid IDs and reason all fail before write",async()=>{
  for(const input of [
    {token:{...owner,auth_time:0}},
    {token:{...owner,sub:"guest_1"}},
    {request:{...body(),operationId:"a"}},
    {request:{...body(),reason:"x"}},
    {request:{...body(),targetUid:"INVALID TARGET"}},
  ]){
    const f=fixture();
    await assert.rejects(()=>commitStoreGrantRevokeOffline(
      f.db,input.token??owner,input.request??body(),now));
    assert.equal(f.commits(),0);
  }
});
test("production route is independently disabled before authentication and DB",async()=>{
  const env={STORE_GRANT_ISSUANCE_ENABLED:"owner-grants-v1",
    STORE_PURCHASE_ISSUANCE_ENABLED:"owner-purchases-v1"};
  assert.equal(storeGrantRevokeEnabled(env),false);
  const response=await manageStoreGrantRevoke(new Request(
    "https://example.test/api/manage-store-grant-revoke",
    {method:"POST",headers:{"content-type":"application/json"},
      body:JSON.stringify(body())}),env);
  assert.equal(response.status,423);
  assert.equal((await response.json()).code,"store_grant_revocation_disabled");
  const source=readFileSync(new URL(
    "../../cloudflare-worker/src/index.js",import.meta.url),"utf8");
  assert.match(source,/\/api\/manage-store-grant-revoke/);
  assert.doesNotMatch(source,/STORE_GRANT_REVOCATION_ENABLED/);
});
