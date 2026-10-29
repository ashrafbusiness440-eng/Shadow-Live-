import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {test} from "node:test";
import {
  canViewStoreAudit,projectStoreCatalogAudit,projectStoreOperationAudit,
  loadStoreCatalogAudit,manageStoreAudit,
} from "../../cloudflare-worker/src/manage-store-audit.js";
import {storeCatalogInternals} from "../../cloudflare-worker/src/manage-store-catalog.js";
import {manageUserAccessInternals} from "../../cloudflare-worker/src/manage-user-access.js";

const viewer={role:"admin",adminEnabled:true,accountStatus:"active",
  capabilities:["viewStoreAudit"]};
const token={sub:"auditor_uid",iat:Math.floor(Date.now()/1000),
  auth_time:Math.floor(Date.now()/1000)};
const log={
  actorUid:"admin_who_saved",targetType:"store_catalog",
  targetId:"system_config/store_catalog",action:"saveStoreCatalog",
  changedIds:["200001","200003"],fromRevision:2,toRevision:3,
  createdAt:"2026-10-28T16:00:00.000Z",
  operationId:"PRIVATE_OP",reason:"PRIVATE_NOTE",
  userEmail:"private@never-show.invalid",
};
function mockDb(user=viewer) {
  const reads=[];
  return {reads,
    async get(path) {
      reads.push(path);
      if(path==="users/auditor_uid")return {exists:true,data:user};
      return {exists:false,data:null};
    },
    async runQuery(path,params) {
      reads.push({path,params});
      return [{data:log},{data:{...log,targetType:"user",userEmail:"private"}}];
    },
  };
}

test("catalog audit requires its dedicated viewer permission",()=>{
  assert.equal(canViewStoreAudit({role:"owner"}),true);
  assert.equal(canViewStoreAudit(viewer),true);
  for(const u of [
    {role:"admin",adminEnabled:true,capabilities:["manageStore"]},
    {role:"admin",adminEnabled:true,capabilities:["viewStoreInventory"]},
    {role:"moderator",adminEnabled:true,capabilities:["viewStoreAudit"]},
    {role:"admin",adminEnabled:false,capabilities:["viewStoreAudit"]},
    {role:"user",adminEnabled:true,capabilities:["viewStoreAudit"]},
  ])assert.equal(canViewStoreAudit(u),false);
});

test("projection sanitizes audit row and refuses unrelated logs",()=>{
  const safe=projectStoreCatalogAudit(log);
  assert.deepEqual(Object.keys(safe).sort(),[
    "actorUid","fromRevision","toRevision","changedIds","at",
  ].sort());
  assert.equal(safe.actorUid,"admin_who_saved");
  assert.equal(safe.at,"2026-10-28T16:00:00.000Z");
  assert.ok(!JSON.stringify(safe).includes("PRIVATE"));
  assert.equal(projectStoreCatalogAudit({...log,targetType:"user"}),null);
  assert.equal(projectStoreCatalogAudit({...log,fromRevision:4}),null);
  assert.equal(projectStoreCatalogAudit({...log,actorUid:"../bad"}),null);
});

test("audit history query stays bounded and never reads or writes user purchases",async()=>{
  const db=mockDb();
  const view=await loadStoreCatalogAudit(db,token);
  assert.equal(view.ok,true);
  assert.equal(view.purchasingEnabled,false);
  assert.equal(view.entries.length,1);
  assert.equal(view.resultLimit,50);
  assert.equal(view.moreMayExist,false);
  assert.deepEqual(db.reads,[ "users/auditor_uid",{
    path:"admin_audit_logs",params:{
      filters:[{field:"targetType",op:"==",value:"store_catalog"}],
      limit:50,
    },
  }]);
  const code=readFileSync(new URL(
    "../../cloudflare-worker/src/manage-store-audit.js",import.meta.url),"utf8");
  assert.doesNotMatch(code,/db\.commit\(|db\.writeCreate\(|db\.writeUpdate\(/);
  assert.match(code,/Cache-Control":"no-store/);
  const routes=readFileSync(new URL(
    "../../cloudflare-worker/src/index.js",import.meta.url),"utf8");
  assert.match(routes,/url\.pathname === "\/api\/manage-store-audit"/);
});

test("unauthorized, inactive and stale-auth auditors cannot fetch history",async()=>{
  for(const u of [
    {role:"admin",adminEnabled:true,capabilities:["viewStore"]},
    {role:"admin",adminEnabled:false,capabilities:["viewStoreAudit"]},
    {...viewer,accountStatus:"deleting"},
  ]){
    const db=mockDb(u);
    await assert.rejects(()=>loadStoreCatalogAudit(db,token));
    assert.deepEqual(db.reads,["users/auditor_uid"]);
  }
  const stale=mockDb();
  await assert.rejects(()=>loadStoreCatalogAudit(
    stale,{...token,auth_time:1}),/recent_auth_required/);
  assert.deepEqual(stale.reads,["users/auditor_uid"]);
  const invalid=await manageStoreAudit(new Request(
    "https://example.com/api/manage-store-audit",{method:"GET"}),{});
  assert.equal(invalid.status,405);
});

test("audit-only admin enters Store Hub without private catalog or inventory",async()=>{
  const db=mockDb();
  db.get=async(path)=>{
    if(path==="users/auditor_uid")return {exists:true,data:viewer};
    if(path==="system_config/store_catalog")return {exists:true,
      data:{revision:5,items:[{id:"200001",nameAr:"PRIVATE_HIDDEN"}]}};
    return {exists:false,data:null};
  };
  const state=await storeCatalogInternals.loadState(db,token);
  assert.equal(state.canViewAudit,true);
  assert.equal(state.canViewInventory,false);
  assert.equal(state.canViewCatalog,false);
  assert.equal(state.canEdit,false);
  assert.equal(state.revision,0);
  assert.deepEqual(state.items,[]);
  assert.deepEqual(manageUserAccessInternals.normalizeCapabilities(
    ["viewStoreAudit","viewStore"]),["viewStore","viewStoreAudit"]);
  const ui=readFileSync(new URL(
    "../../lib/admin/store_catalog_control_page.dart",import.meta.url),"utf8");
  const ownerUi=readFileSync(new URL(
    "../../lib/admin/user_access_control_card.dart",import.meta.url),"utf8");
  assert.match(ui,/if \(activeSection == 7\)/);
  assert.match(ui,/StoreAuditHistoryPanel\(/);
  assert.match(ownerUi,/'viewStoreAudit': 'عرض سجل تعديلات المتجر'/);
});

test("audit projection bounds product IDs and warns when more than 50 rows may exist",async()=>{
  const safe=projectStoreCatalogAudit({
    ...log,changedIds:["../user","200010","200010","INVALID",...Array(150).fill("200011")],
  });
  assert.equal(safe.changedIds.length,100);
  assert.ok(safe.changedIds.every(id=>/^[1-9][0-9]{5,8}$/.test(id)));
  const db=mockDb();
  db.runQuery=async()=>Array(50).fill({data:log});
  const result=await loadStoreCatalogAudit(db,token);
  assert.equal(result.entries.length,50);
  assert.equal(result.moreMayExist,true);
  assert.equal(result.resultLimit,50);
});

const opLog={
  actorUid:"owner_uid",targetType:"store_entitlement",
  targetId:"user_store_entitlements/target_uid/items/200001",
  action:"purchaseStoreItem",operationId:"store_purchase_operation_0001",
  priceCoins:25000,createdAt:new Date("2026-10-29T12:00:00.000Z"),
  reason:"PRIVATE_REASON",walletBalance:45000,
  email:"private@never-show.invalid",authToken:"PRIVATE_TOKEN",
};
test("579B operational audit projection excludes financial/privacy secrets",()=>{
  const purchase=projectStoreOperationAudit(opLog);
  assert.deepEqual(purchase,{
    action:"purchase",actorUid:"owner_uid",targetUid:"target_uid",
    productId:"200001",at:"2026-10-29T12:00:00.000Z",
    priceCoins:25000,
  });
  assert.equal(JSON.stringify(purchase).includes("PRIVATE"),false);
  for(const [action,expected] of [
    ["grantStoreItem","grant"],["revokeStoreGrant","revoke"],
    ["renewStoreItem","renew"]]){
    const row={...opLog,action};
    const value=projectStoreOperationAudit(row);
    assert.equal(value.action,expected);
    assert.equal(Object.hasOwn(value,"priceCoins"),
      expected==="renew");
  }
  for(const invalid of [
    {...opLog,targetType:"users"},
    {...opLog,targetId:"users/target_uid"},
    {...opLog,targetId:"user_store_entitlements/../items/200001"},
    {...opLog,targetId:"user_store_entitlements/target_uid/items/000001"},
    {...opLog,actorUid:"bad/uid"},
    {...opLog,operationId:"short"},
    {...opLog,action:"toString"},
    {...opLog,action:"updateUserBalance"},
    {...opLog,createdAt:"invalid-date"},
    {...opLog,priceCoins:"25000"},
    {...opLog,priceCoins:null},
    {...opLog,priceCoins:-1},
  ])assert.equal(projectStoreOperationAudit(invalid),null);
});

test("579B Owner gets bounded operation list; audit-only admin gets no private query",async()=>{
  const ownerDb=mockDb({role:"owner",accountStatus:"active"});
  ownerDb.runQuery=async(path,params)=>{
    ownerDb.reads.push({path,params});
    return params.filters[0].value==="store_entitlement"
      ?[{data:opLog},{data:{...opLog,action:"unknown_action"}}]
      :[{data:log}];
  };
  const owner=await loadStoreCatalogAudit(ownerDb,token);
  assert.equal(owner.canViewOperations,true);
  assert.equal(owner.operationEntries.length,1);
  assert.equal(owner.operationEntries[0].targetUid,"target_uid");
  assert.equal(owner.moreOperationsMayExist,false);
  assert.deepEqual(ownerDb.reads,[
    "users/auditor_uid",
    {path:"admin_audit_logs",params:{
      filters:[{field:"targetType",op:"==",value:"store_catalog"}],
      limit:50,
    }},
    {path:"admin_audit_logs",params:{
      filters:[{field:"targetType",op:"==",value:"store_entitlement"}],
      limit:50,
    }},
  ]);
  const staff=mockDb();
  const staffResult=await loadStoreCatalogAudit(staff,token);
  assert.equal(staffResult.canViewOperations,false);
  assert.deepEqual(staffResult.operationEntries,[]);
  assert.equal(staffResult.moreOperationsMayExist,false);
  assert.equal(staff.reads.filter(x=>typeof x==="object").length,1);
});

test("579B limits Owner operation results and exposes partial list as partial",async()=>{
  const ownerDb=mockDb({role:"owner",accountStatus:"active"});
  ownerDb.runQuery=async(path,params)=>{
    assert.equal(path,"admin_audit_logs");
    assert.equal(params.limit,50);
    if(params.filters[0].value==="store_entitlement"){
      return Array.from({length:50},(_,i)=>({data:{
        ...opLog,createdAt:new Date(
          Date.parse("2026-10-29T12:00:00.000Z")+i*1000),
      }}));
    }
    return [];
  };
  const result=await loadStoreCatalogAudit(ownerDb,token);
  assert.equal(result.operationEntries.length,50);
  assert.equal(result.moreOperationsMayExist,true);
  assert.ok(result.operationEntries[0].at>result.operationEntries[49].at);
  const source=readFileSync(new URL(
    "../../cloudflare-worker/src/manage-store-audit.js",import.meta.url),"utf8");
  assert.doesNotMatch(source,/db\.list\(|db\.commit\(|db\.writeCreate\(|financial_ledger\//);
  const ui=readFileSync(new URL(
    "../../lib/admin/store_audit_history_panel.dart",import.meta.url),"utf8");
  assert.match(ui,/_canViewOperations/);
  assert.match(ui,/if \(_canViewOperations\)/);
  assert.match(ui,/سجل عمليات المتجر/);
  assert.match(ui,/قد توجد عمليات أقدم خارج النتائج الحالية/);
  assert.match(ui,/parsed\['canViewOperations'\] == true/);
});
