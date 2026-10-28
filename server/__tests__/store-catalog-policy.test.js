import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {test} from "node:test";
import {
  STORE_CATEGORIES, STORE_DURATIONS, normalizeStoreCatalogItems,
  validateStoreCatalogUpdate, nextStoreNumericId,
} from "../../cloudflare-worker/src/store-catalog-policy.js";
import {canManageStoreCatalog} from "../../cloudflare-worker/src/manage-store-catalog.js";

const make = (id = "200001") => ({
  id, nameAr: "إطار ملكي", category: "frames", priceCoins: 2500,
  durationDays: 7, rarity: "rare", enabled: false, sortOrder: 3,
  assetKey: "store.item." + id + ".icon",
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
    {enabled:"true"},{rarity:"unknown"},{category:"payments"},
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
