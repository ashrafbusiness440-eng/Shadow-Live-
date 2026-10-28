import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {test} from "node:test";
import {selectPublicStoreItems} from "../../cloudflare-worker/src/public-store-catalog.js";

const item = (id, enabled = true) => ({
  id, nameAr:"إطار ملكي", category:"frames", priceCoins:2500,
  durationDays:7, rarity:"rare", minVipLevel:0, sortOrder:1,
  enabled, assetKey:`store.item.${id}.icon`,
  updatedBy:"PRIVATE_OWNER_UID", secret:"PRIVATE_ADMIN_NOTE",
});

test("public store projection never includes hidden products or administrator metadata", () => {
  const view = selectPublicStoreItems([
    item("200001",false),
    item("200002"),
    {...item("200003"),assetKey:"asset.admin.secret"},
    {...item("200004"),priceCoins:-1},
  ]);
  assert.equal(view.length,1);
  assert.equal(view[0].id,"200002");
  assert.deepEqual(Object.keys(view[0]).sort(), [
    "assetKey","category","durationDays","id","minVipLevel",
    "nameAr","priceCoins","rarity","sortOrder",
  ].sort());
  assert.ok(!JSON.stringify(view).includes("PRIVATE"));
  assert.equal(view[0].priceCoins,2500);
});

test("public store projection is bounded and stable across sorted products", () => {
  const raw = Array.from({length:101},(_,i) => ({
    ...item(String(200001+i)),sortOrder:101-i,
  }));
  const view = selectPublicStoreItems(raw);
  assert.equal(view.length,100);
  assert.equal(view[0].id,"200101");
  assert.equal(view.at(-1).id,"200002");
  assert.deepEqual(selectPublicStoreItems(null),[]);
});

test("public store endpoint and Flutter screen have no purchase or grants", () => {
  const api = readFileSync(new URL(
    "../../cloudflare-worker/src/public-store-catalog.js",import.meta.url),"utf8");
  const route = readFileSync(new URL(
    "../../cloudflare-worker/src/index.js",import.meta.url),"utf8");
  const screen = readFileSync(new URL(
    "../../lib/features/store/screens/public_store_catalog_screen.dart",
    import.meta.url),"utf8");
  const menu = readFileSync(new URL("../../lib/main.dart",import.meta.url),"utf8");
  assert.match(api,/purchasingEnabled:false/);
  assert.match(api,/item\.enabled !== true/);
  assert.match(api,/method_not_allowed/);
  assert.match(route,/url\.pathname === "\/api\/store-catalog"/);
  assert.match(screen,/onPressed: null/);
  assert.match(screen,/الشراء قريباً/);
  assert.match(menu,/PublicStoreCatalogScreen\(\)/);
  assert.doesNotMatch(api,/adjustBalance|grantEntitlement|coinBalance|writeUpdate|writeCreate/);
});
