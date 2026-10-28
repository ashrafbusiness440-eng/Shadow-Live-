import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {test} from "node:test";
import {
  STORE_CATEGORIES, STORE_DURATIONS, normalizeStoreCatalogItems,
  validateStoreCatalogUpdate, nextStoreNumericId,
} from "../../cloudflare-worker/src/store-catalog-policy.js";
import {canManageStoreCatalog, canViewStoreCatalog, storeCatalogInternals} from "../../cloudflare-worker/src/manage-store-catalog.js";

const make = (id = "200001") => ({
  id, nameAr: "إطار ملكي", category: "frames", priceCoins: 2500,
  durationDays: 7, rarity: "rare", minVipLevel: 0, enabled: false, sortOrder: 3,
  assetKey: "store.item." + id + ".icon",
  minWealthLevel: 0, visibleFromMs: null, visibleUntilMs: null,
});
test("store catalog categories and durations remain bounded and Arabic", () => {
  assert.ok(Object.keys(STORE_CATEGORIES).length >= 8);
  assert.deepEqual(STORE_DURATIONS, [0,3,7,30]);
  assert.equal(STORE_CATEGORIES.frames, "الإطارات");
  assert.deepEqual(normalizeStoreCatalogItems([make()]), [make()]);
  assert.deepEqual(nextStoreNumericId([make()]), "200002");
});

test("store catalog accepts edits without enabling purchases or changing old IDs", () => {
  const old = make();
  const revised = {...old, category:"backgrounds", priceCoins:5000,
    enabled:true, durationDays:30, sortOrder:1};
  assert.deepEqual(validateStoreCatalogUpdate({
    revision:6,items:[old],
  },[revised,make("200002")],6),{
    revision:7, items:[revised,make("200002")],
    changedIds:["200001","200002"],
  });
  assert.equal(revised.assetKey, old.assetKey);
});

test("concurrent, deleted, duplicate and malformed products fail closed", () => {
  const original = {revision:5,items:[make()]};
  assert.throws(()=>validateStoreCatalogUpdate(original,[],5),
    /store_catalog_existing_id_missing/);
  assert.throws(()=>validateStoreCatalogUpdate(original,[make()],4),
    /store_catalog_conflict/);
  assert.throws(()=>normalizeStoreCatalogItems([make(),make()]),
    /invalid_store_item_id/);
  for (const field of [
    {priceCoins:-1},{priceCoins:1.5},{durationDays:99},{sortOrder:-2},
    {minVipLevel:-1},{minVipLevel:11},
    {enabled:"true"},{rarity:"unknown"},{category:"payments"},
    {minWealthLevel:-1},{minWealthLevel:36},
    {visibleFromMs:-5},{visibleUntilMs:"not-a-date"},
    {visibleFromMs:300,visibleUntilMs:300},
    {visibleFromMs:500,visibleUntilMs:300},
    {assetKey:"store.item.200002.icon"},{id:"../other"},
  ]) assert.throws(()=>normalizeStoreCatalogItems([{...make(),...field}]));
  assert.throws(()=>normalizeStoreCatalogItems(
    Array.from({length:101},(_,i)=>make(String(200001+i)))),
    /invalid_store_catalog/);
});

test("store editing uses exact manageStore capability with no user access", () => {
  assert.equal(canManageStoreCatalog({role:"owner"}),true);
  assert.equal(canManageStoreCatalog({role:"admin",adminEnabled:true,
    capabilities:["manageStore"]}),true);
  assert.equal(canManageStoreCatalog({role:"super_admin",adminEnabled:true,
    capabilities:["manageStore"]}),true);
  for(const actor of [
    {},{role:"user",adminEnabled:true,capabilities:["manageStore"]},
    {role:"admin",adminEnabled:false,capabilities:["manageStore"]},
    {role:"admin",adminEnabled:true,capabilities:["manageGiftCatalog"]},
    {role:"admin",adminEnabled:true,capabilities:["manageEconomy"]},
  ]) assert.equal(canManageStoreCatalog(actor),false);
});

test("store catalog is administration-only, never purchases or credits users", () => {
  const s=readFileSync(new URL("../../cloudflare-worker/src/manage-store-catalog.js",
    import.meta.url),"utf8");
  const route=readFileSync(new URL("../../cloudflare-worker/src/index.js",
    import.meta.url),"utf8");
  const nav=readFileSync(new URL("../../lib/main_control.dart",
    import.meta.url),"utf8");
  const ui=readFileSync(new URL("../../lib/admin/store_catalog_control_page.dart",
    import.meta.url),"utf8");
  assert.match(s,/purchasingEnabled: false/);
  assert.match(s,/readActor\(db, payload, tx\)/);
  assert.match(s,/db\.beginTransaction\(\)/);
  assert.match(s,/validateStoreCatalogUpdate\(config\.data/);
  assert.match(s,/db\.writeCreate\("admin_audit_logs\/store_catalog_/);
  assert.match(s,/control_operations\/store_catalog_/);
  assert.match(s,/recent_auth_required/);
  assert.doesNotMatch(s,/adjustBalance|walletActions|purchaseItem|grantEntitlement|coinBalance/);
  assert.match(route,/url\.pathname === "\/api\/manage-store-catalog"/);
  assert.match(nav,/capabilities\.contains\('manageStore'\)/);
  assert.match(nav,/StoreCatalogControlPage\(\)/);
  assert.match(ui,/ControlAssetManagerPage\(/);
  assert.match(ui,/store\.item\.\$id\.icon/);
  assert.match(ui,/الشراء غير مفعل/);
});

test("store saves are atomic, retryable and reject stale revisions without purchases", async () => {
  const documents = new Map([["users/owner_test", {role:"owner"}]]);
  const committed = [];
  const db = {
    async beginTransaction() { return {}; },
    async get(path) {
      return {exists:documents.has(path), data:documents.get(path)};
    },
    writeCreate(path, data) { return {kind:"create", path, data}; },
    writeUpdate(path, data) { return {kind:"update", path, data}; },
    async rollback() {},
    async commit(tx, writes) {
      for (const w of writes) {
        if (w.kind === "create" && documents.has(w.path)) {
          throw Error("already_exists");
        }
      }
      for (const w of writes) documents.set(w.path, w.data);
      committed.push(writes);
    },
  };
  const actor = {sub:"owner_test", iat:Math.floor(Date.now()/1000)};
  const operationId = "store_safe_retry_0001";
  const body = {operationId, expectedRevision:0, items:[make()]};
  const first = await storeCatalogInternals.saveCatalog(db,actor,body);
  assert.equal(first.ok,true);
  assert.equal(first.revision,1);
  assert.equal(first.duplicate,undefined);
  assert.equal(committed.length,1);
  assert.equal(committed[0].length,3);
  assert.equal(documents.get("system_config/store_catalog").purchasingEnabled,false);
  assert.equal(documents.get("admin_audit_logs/store_catalog_"+operationId).actorUid,
    "owner_test");

  // A server commit with a lost reply is safely retried using the same ID.
  const duplicate = await storeCatalogInternals.saveCatalog(db,actor,body);
  assert.equal(duplicate.ok,true);
  assert.equal(duplicate.duplicate,true);
  assert.equal(duplicate.revision,1);
  assert.equal(committed.length,1);

  // A different ID must not overwrite data based on a stale snapshot.
  await assert.rejects(() => storeCatalogInternals.saveCatalog(db,actor,{
    ...body,operationId:"store_safe_retry_0002",
  }),/store_catalog_conflict/);
  assert.equal(committed.length,1);

  // A non-admin cannot read or edit the catalog, even with a valid session.
  await assert.rejects(() => storeCatalogInternals.loadState(db,{
    sub:"missing_user", iat:actor.iat,
  }),/forbidden/);
});

test("store visibility is guarded by a published Studio image, without charges", async () => {
  const hidden = make();
  const visible = {...hidden, enabled:true};
  const assets = new Map();
  const db = {
    async get(path) {
      const data = assets.get(path);
      return {exists:data !== undefined, data};
    },
  };
  await storeCatalogInternals.assertStorePublishableAssets(db, null,
    [hidden], [hidden]);
  await assert.rejects(
    () => storeCatalogInternals.assertStorePublishableAssets(db, null, [hidden], [visible]),
    /store_asset_not_published/);
  assets.set("app_asset_registry/" + hidden.assetKey, {
    published:false, rawUrl:"https://example.com/draft.webp",
  });
  await assert.rejects(
    () => storeCatalogInternals.assertStorePublishableAssets(db, null, [hidden], [visible]),
    /store_asset_not_published/);
  assets.set("app_asset_registry/" + hidden.assetKey, {
    published:true, rawUrl:"",
  });
  await assert.rejects(
    () => storeCatalogInternals.assertStorePublishableAssets(db, null, [hidden], [visible]),
    /store_asset_not_published/);
  assets.set("app_asset_registry/" + hidden.assetKey, {
    published:true, rawUrl:"https://example.com/published.webp",
  });
  await storeCatalogInternals.assertStorePublishableAssets(db, null,
    [hidden], [visible]);
  // Hiding an already published item remains allowed even if its asset vanishes.
  assets.clear();
  await storeCatalogInternals.assertStorePublishableAssets(db, null,
    [visible], [hidden]);
  // Visible legacy items can be edited without unrelated availability failures.
  await storeCatalogInternals.assertStorePublishableAssets(db, null,
    [visible], [{...visible, priceCoins:2700}]);
});

test("catalog transaction refuses a visible item whose Studio asset is missing", async () => {
  const documents = new Map([["users/owner_test", {role:"owner"}]]);
  const db = {
    async beginTransaction() { return {}; },
    async get(path) { return {
      exists:documents.has(path), data:documents.get(path),
    }; },
    writeCreate(path, data) { return {kind:"create", path, data}; },
    writeUpdate(path, data) { return {kind:"update", path, data}; },
    async rollback() {},
    async commit(tx, writes) {
      for (const write of writes) documents.set(write.path, write.data);
    },
  };
  const actor = {sub:"owner_test",iat:Math.floor(Date.now()/1000)};
  const shown = {...make(),enabled:true};
  const body = {items:[shown],expectedRevision:0,
    operationId:"store_publish_guard_01"};
  await assert.rejects(
    () => storeCatalogInternals.saveCatalog(db,actor,body),
    /store_asset_not_published/);
  assert.equal(documents.has("system_config/store_catalog"), false);
  assert.equal(documents.has("control_operations/store_catalog_" + body.operationId), false);
  // The same draft can be published once the Studio asset is published.
  documents.set("app_asset_registry/" + shown.assetKey,
    {published:true,rawUrl:"https://example.com/store/200001.webp"});
  const result = await storeCatalogInternals.saveCatalog(db,actor,body);
  assert.equal(result.revision,1);
  assert.equal(documents.get("system_config/store_catalog").purchasingEnabled,false);
});

test("store hub exposes seven Arabic sections with preview and no financial actions", () => {
  const ui=readFileSync(new URL(
    "../../lib/admin/store_catalog_control_page.dart",import.meta.url),"utf8");
  for (const tab of ["نظرة عامة","المنتجات","المشتريات","المنح",
    "مقتنيات المستخدمين","الإحصاءات","الإعدادات والصلاحيات"]) {
    assert.ok(ui.includes(tab), tab);
  }
  assert.match(ui,/Future<void> _preview\(/);
  assert.match(ui,/if \(previewOpen\) return;/);
  assert.match(ui,/previewOpen = false;/);
  assert.match(ui,/draftItem\(\)/);
  assert.match(ui,/store_asset_not_published/);
  assert.match(ui,/ShadowAssetRegistry\.remoteUrl/);
  assert.match(ui,/الشراء والمنح غير مفعلين/);
});

test("store editor preserves the operation ID across uncertain retries", () => {
  const ui=readFileSync(new URL(
    "../../lib/admin/store_catalog_control_page.dart",import.meta.url),"utf8");
  assert.match(ui,/pendingSaveOperationId \?\?=/);
  assert.match(ui,/final operation = pendingSaveOperationId!/);
  assert.match(ui,/pendingSaveOperationId = null;/);
  // Rapid taps must not stack multiple add/edit dialogs.
  assert.match(ui,/if \(saving \|\| loading \|\| editorOpen\) return;/);
  assert.match(ui,/editorOpen = true;/);
  assert.match(ui,/finally \{\s*editorOpen = false;/);
});

test("store cloning creates a new ID and asset key without mutating prior ownership", () => {
  const source = make("200001");
  const copiedId = nextStoreNumericId([source]);
  const copied = {...source, id:copiedId, assetKey:`store.item.${copiedId}.icon`,
    enabled:false};
  assert.equal(copiedId,"200002");
  assert.notEqual(copied.assetKey,source.assetKey);
  assert.equal(copied.enabled,false);
  assert.equal(copied.priceCoins,source.priceCoins);
  assert.deepEqual(validateStoreCatalogUpdate({
    revision:1,items:normalizeStoreCatalogItems([source]),
  },[source,copied],1).changedIds,["200002"]);
  const ui=readFileSync(new URL("../../lib/admin/store_catalog_control_page.dart",
    import.meta.url),"utf8");
  assert.match(ui,/bool duplicate = false/);
  assert.match(ui,/original != null && !duplicate/);
  assert.match(ui,/var enabled = !duplicate && original\?\['enabled'\] == true;/);
  assert.match(ui,/duplicate: value == 'copy'/);
  assert.match(ui,/نسخ المنتج/);
});

test("store viewers cannot save, copy, or replay catalog operations", async () => {
  const viewer = {role:"admin",adminEnabled:true,capabilities:["viewStore"]};
  const editor = {role:"admin",adminEnabled:true,capabilities:["manageStore"]};
  assert.equal(canViewStoreCatalog(viewer), true);
  assert.equal(canManageStoreCatalog(viewer), false);
  assert.equal(canViewStoreCatalog(editor), true);
  assert.equal(canManageStoreCatalog(editor), true);
  assert.equal(canViewStoreCatalog({role:"super_admin",adminEnabled:true,
    capabilities:["viewStore"]}),true);
  assert.equal(canViewStoreCatalog({role:"moderator",adminEnabled:true,
    capabilities:["viewStore"]}),false);
  assert.equal(canViewStoreCatalog({role:"user",adminEnabled:true,
    capabilities:["viewStore"]}),false);
  assert.equal(canViewStoreCatalog({role:"admin",adminEnabled:false,
    capabilities:["viewStore"]}),false);

  const savedItems=[make()];
  const docs = new Map([
    ["users/view_user",viewer],
    ["users/editor_user",editor],
    ["system_config/store_catalog",{revision:0,items:savedItems}],
    ["control_operations/store_catalog_safe_edit_01",{
      actorUid:"view_user",result:{revision:99},
    }],
  ]);
  let writeCount = 0;
  const db={
    async get(path) {
      return {exists:docs.has(path),data:docs.get(path)};
    },
    async beginTransaction(){return {};},
    async rollback(){},
    async commit(){writeCount++;},
  };
  const viewerToken={sub:"view_user",iat:Math.floor(Date.now()/1000)};
  const state=await storeCatalogInternals.loadState(db,viewerToken);
  assert.equal(state.ok,true);
  assert.equal(state.canEdit,false);
  assert.deepEqual(state.items,savedItems);
  await assert.rejects(()=>storeCatalogInternals.saveCatalog(
    db,viewerToken,{
      operationId:"store_catalog_safe_edit_01",
      expectedRevision:0,items:savedItems,
    }),/forbidden/);
  await assert.rejects(()=>storeCatalogInternals.saveCatalog(
    db,viewerToken,{
      operationId:"store_catalog_safe_edit_02",
      expectedRevision:0,items:savedItems,
    }),/forbidden/);
  assert.equal(writeCount,0);
  const editorState=await storeCatalogInternals.loadState(db,{
    sub:"editor_user",iat:viewerToken.iat,
  });
  assert.equal(editorState.canEdit,true);
  const ui=readFileSync(new URL(
    "../../lib/admin/store_catalog_control_page.dart",import.meta.url),"utf8");
  assert.match(ui,/result\['canEdit'\] == true/);
  assert.match(ui,/if \(!canEdit \|\| saving \|\| loading \|\| editorOpen\)/);
  assert.match(ui,/if \(canEdit\) PopupMenuButton<String>/);
  const nav=readFileSync(new URL("../../lib/main_control.dart",import.meta.url),"utf8");
  assert.match(nav,/capabilities\.contains\('viewStore'\)/);
});
