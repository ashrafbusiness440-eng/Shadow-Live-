import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {test} from "node:test";
import {
  canViewStoreAudit,projectStoreCatalogAudit,loadStoreCatalogAudit,
  manageStoreAudit,
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
  assert.doesNotMatch(code,/db\.commit\(|db\.writeCreate\(|db\.writeUpdate\(|user_store_entitlements\//);
  assert.match(code,/Cache-Control":"no-store/);
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
