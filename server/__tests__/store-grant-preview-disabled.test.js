import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {test} from "node:test";

import {
  STORE_GRANTS_ENABLED,canPreviewStoreGrants,previewStoreGrant,
  manageStoreGrantPreview,
} from "../../cloudflare-worker/src/manage-store-grant-preview.js";
import {storeCatalogInternals} from "../../cloudflare-worker/src/manage-store-catalog.js";
import {manageUserAccessInternals} from "../../cloudflare-worker/src/manage-user-access.js";

const token={
  sub:"admin_1",iat:Math.floor(Date.now()/1000),
  auth_time:Math.floor(Date.now()/1000),
};
const viewer={
  role:"admin",adminEnabled:true,accountStatus:"active",
  capabilities:["previewStoreGrants"],
};
const product={
  id:"200001",nameAr:"إطار ملكي",category:"frames",
  priceCoins:50000,durationDays:7,sortOrder:0,rarity:"normal",
  minVipLevel:0,minWealthLevel:0,visibleFromMs:null,visibleUntilMs:null,
  enabled:true,assetKey:"store.item.200001.icon",
};

function mockDb(actor=viewer) {
  const reads=[];
  const docs=new Map([
    ["users/admin_1",actor],
    ["users/target_1",{accountStatus:"active",publicId:"123456"}],
    ["public_ids/123456",{uid:"target_1"}],
    ["system_config/store_catalog",{revision:10,items:[product]}],
    ["app_asset_registry/store.item.200001.icon",{
      published:true,rawUrl:"https://example.com/store-item.webp",
    }],
  ]);
  return {
    docs,reads,
    async get(path){
      reads.push(path);
      return {exists:docs.has(path),data:docs.get(path)};
    },
  };
}

test("grant actions and purchases always remain disabled",async()=>{
  assert.equal(STORE_GRANTS_ENABLED,false);
  for(const action of ["grant","issue","confirm"]) {
    const response=await manageStoreGrantPreview(
      new Request("https://example.com/api/manage-store-grant-preview",{
        method:"POST",
        headers:{"content-type":"application/json"},
        body:JSON.stringify({action,targetId:"123456",productId:"200001"}),
      }),{});
    assert.equal(response.status,423);
    assert.deepEqual(await response.json(),{
      ok:false,code:"store_grants_disabled",grantEnabled:false,
    });
  }
  const method=await manageStoreGrantPreview(new Request(
    "https://example.com/api/manage-store-grant-preview",{method:"GET"}),{});
  assert.equal(method.status,405);
  const purchase=readFileSync(new URL(
    "../../cloudflare-worker/src/store-entitlements.js",import.meta.url),"utf8");
  assert.match(purchase,/purchasing_disabled/);
  assert.match(purchase,/},423\)/);
  const grants=readFileSync(new URL(
    "../../cloudflare-worker/src/manage-store-grant-preview.js",
    import.meta.url),"utf8");
  assert.doesNotMatch(grants,/db\.commit\(|db\.writeCreate\(|db\.writeUpdate\(|db\.delete\(|adjustBalances|financial_ledger/);
});

test("only Owner or explicitly enabled admin can preview grants",()=>{
  assert.equal(canPreviewStoreGrants({role:"owner"}),true);
  assert.equal(canPreviewStoreGrants(viewer),true);
  for(const actor of [
    {role:"admin",adminEnabled:true,capabilities:["manageStore"]},
    {role:"admin",adminEnabled:true,capabilities:["viewStore"]},
    {role:"admin",adminEnabled:true,capabilities:["viewStorePurchases"]},
    {role:"admin",adminEnabled:true,capabilities:["viewStoreInventory"]},
    {role:"moderator",adminEnabled:true,capabilities:["previewStoreGrants"]},
    {role:"admin",adminEnabled:false,capabilities:["previewStoreGrants"]},
    {role:"user",adminEnabled:true,capabilities:["previewStoreGrants"]},
  ])assert.equal(canPreviewStoreGrants(actor),false);
});

test("preview uses public ID, published image, scoped entitlement; never sends item",async()=>{
  const db=mockDb();
  const result=await previewStoreGrant(db,token,"١٢٣٤٥٦","200001");
  assert.equal(result.ok,true);
  assert.equal(result.grantEnabled,false);
  assert.equal(result.canGrant,false);
  assert.equal(result.searchedId,"١٢٣٤٥٦");
  assert.equal(result.product.id,"200001");
  assert.equal(result.product.durationDays,7);
  assert.equal(result.alreadyHasProduct,false);
  assert.equal(result.exclusiveRequirementsUnverified,false);
  assert.equal(result.vipRequirementMet,true);
  assert.equal(result.wealthRequirementMet,true);
  assert.equal(result.meetsExclusiveRequirements,true);
  assert.ok(!JSON.stringify(result).includes("admin_1"));
  assert.ok(!JSON.stringify(result).includes("target_1"));
  assert.ok(!JSON.stringify(result).includes("rawUrl"));
  assert.deepEqual(db.reads,[
    "users/admin_1","public_ids/123456","users/target_1",
    "users/target_1","system_config/store_catalog",
    "app_asset_registry/store.item.200001.icon",
    "user_store_entitlements/target_1/items/200001",
  ]);
  db.docs.set("user_store_entitlements/target_1/items/200001",{
    status:"active",ownerUid:"target_1",
  });
  const already=await previewStoreGrant(db,token,"123456","200001");
  assert.equal(already.alreadyHasProduct,true);
  assert.equal(already.canGrant,false);
});

test("grant preview blocks hidden, scheduled, expired or unpublished products",async()=>{
  for(const [mutation,code] of [
    [{enabled:false},"store_product_unavailable"],
    [{visibleFromMs:Date.now()+60000},"store_product_unavailable"],
    [{visibleUntilMs:Date.now()-60000},"store_product_unavailable"],
  ]){
    const db=mockDb();
    db.docs.set("system_config/store_catalog",{revision:2,
      items:[{...product,...mutation}]});
    await assert.rejects(()=>previewStoreGrant(db,token,"123456","200001"),
      new RegExp(code));
  }
  const db=mockDb();
  db.docs.set("app_asset_registry/store.item.200001.icon",{
    published:false,rawUrl:"https://example.com/a.webp",
  });
  await assert.rejects(()=>previewStoreGrant(db,token,"123456","200001"),
    /store_asset_not_published/);
  const exclusive=mockDb();
  exclusive.docs.set("system_config/store_catalog",{
    items:[{...product,minVipLevel:4,minWealthLevel:15}],
  });
  const response=await previewStoreGrant(exclusive,token,"123456","200001");
  assert.equal(response.exclusiveRequirementsUnverified,false);
  assert.equal(response.vipRequirementMet,false);
  assert.equal(response.wealthRequirementMet,false);
  assert.equal(response.meetsExclusiveRequirements,false);
  assert.equal(response.canGrant,false);
  assert.ok(exclusive.reads.includes("system_config/user_levels"));

  const eligible=mockDb();
  eligible.docs.set("users/target_1",{
    publicId:"123456",accountStatus:"active",effectiveVipLevel:6,
    wealthPoints:1000000000000,
  });
  eligible.docs.set("system_config/store_catalog",{
    items:[{...product,minVipLevel:4,minWealthLevel:15}],
  });
  const yes=await previewStoreGrant(eligible,token,"123456","200001");
  assert.equal(yes.vipRequirementMet,true);
  assert.equal(yes.wealthRequirementMet,true);
  assert.equal(yes.meetsExclusiveRequirements,true);
  assert.equal(yes.exclusiveRequirementsUnverified,false);
  assert.equal(yes.canGrant,false);
  assert.equal(yes.grantEnabled,false);

  const invalidPoints=mockDb();
  invalidPoints.docs.set("users/target_1",{
    publicId:"123456",accountStatus:"active",effectiveVipLevel:9,
    wealthPoints:-42,
  });
  invalidPoints.docs.set("system_config/store_catalog",{
    items:[{...product,minWealthLevel:3}],
  });
  await assert.rejects(
    ()=>previewStoreGrant(invalidPoints,token,"123456","200001"),
    /invalid_target_level_data/,
  );
});

test("no other account or inactive/deleting account passes grant preview",async()=>{
  for(const actor of [
    {role:"admin",adminEnabled:true,capabilities:["manageStore"]},
    {...viewer,accountStatus:"deleting"},
  ]) {
    const db=mockDb(actor);
    await assert.rejects(()=>previewStoreGrant(db,token,"123456","200001"));
    assert.deepEqual(db.reads,["users/admin_1"]);
  }
  const stale=mockDb();
  await assert.rejects(()=>previewStoreGrant(stale,
    {...token,auth_time:1},"123456","200001"),/recent_auth_required/);
  assert.deepEqual(stale.reads,["users/admin_1"]);
  const deleted=mockDb();
  deleted.docs.set("users/target_1",{accountStatus:"deleting",publicId:"123456"});
  await assert.rejects(()=>previewStoreGrant(deleted,token,"123456","200001"),
    /target_not_active/);
  assert.ok(!deleted.reads.includes("system_config/store_catalog"));
  const moved=mockDb();
  moved.docs.set("users/target_1",{accountStatus:"active",publicId:"777777"});
  await assert.rejects(()=>previewStoreGrant(moved,token,"123456","200001"),
    /not_found/);
  assert.ok(!moved.reads.includes("system_config/store_catalog"));
  const invalid=mockDb();
  await assert.rejects(()=>previewStoreGrant(invalid,token,"../x","200001"),
    /invalid_target_id/);
});

test("preview-only admins see grant tab but not private catalog or financial admin data",async()=>{
  const db=mockDb();
  const response=await storeCatalogInternals.loadState(db,token);
  assert.equal(response.canPreviewGrants,true);
  assert.equal(response.canViewCatalog,false);
  assert.equal(response.canViewInventory,false);
  assert.equal(response.canViewAudit,false);
  assert.equal(response.canViewPurchases,false);
  assert.equal(response.canEdit,false);
  assert.equal(response.revision,0);
  assert.deepEqual(response.items,[]);
  assert.deepEqual(manageUserAccessInternals.normalizeCapabilities(
    ["previewStoreGrants","viewStore"]),["previewStoreGrants","viewStore"]);
  const adminUi=readFileSync(new URL(
    "../../lib/admin/store_catalog_control_page.dart",import.meta.url),"utf8");
  const previewUi=readFileSync(new URL(
    "../../lib/admin/store_grant_preview_panel.dart",import.meta.url),"utf8");
  const routes=readFileSync(new URL(
    "../../cloudflare-worker/src/index.js",import.meta.url),"utf8");
  assert.match(adminUi,/if \(activeSection == 3\)/);
  assert.match(previewUi,/StoreGrantPreviewPanel/);
  assert.doesNotMatch(previewUi,/action': 'grant'/);
  assert.match(routes,/url\.pathname === "\/api\/manage-store-grant-preview"/);
});
