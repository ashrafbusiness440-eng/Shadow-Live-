import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  ASSET_STUDIO_TEMPLATES,
} from "../../cloudflare-worker/src/asset-studio-templates.js";

function source(path) {
  return readFileSync(new URL("../../" + path, import.meta.url), "utf8");
}

test("VIP final closure keeps vehicles removed and entrances active", () => {
  const policy = source("lib/admin/control_vip.dart");
  const registry = source("lib/core/assets/shadow_asset_registry.dart");
  const entitlements = source("cloudflare-worker/src/vip-entitlements.js");

  for (const forbidden of [
    "static bool vehicle(",
    "profileVehicleDisplay",
    "specialVehicle",
    "vipVehicle",
    "vehicleAssetKey",
  ]) {
    assert.equal(policy.includes(forbidden), false);
    assert.equal(registry.includes(forbidden), false);
    assert.equal(entitlements.includes(forbidden), false);
  }

  assert.equal(registry.includes("vipEntryStrip"), true);
  assert.equal(
    ASSET_STUDIO_TEMPLATES.some((item) => item.id === "entrance.base.v1"),
    true,
  );
});

test("VIP final closure locks the official cumulative benefit count to 38", () => {
  const policy = source("lib/admin/control_vip.dart");
  for (const value of ["1 => 3", "2 => 7", "3 => 10", "4 => 16", "5 => 21",
    "6 => 23", "7 => 27", "8 => 28", "9 => 32", "_ => 38"]) {
    assert.equal(policy.includes(value), true);
  }
});

test("Batch H runtime is remote cached and Asset Studio preserves animation", () => {
  const runtime = source("lib/features/vip/widgets/vip_cosmetic_asset.dart");
  const manager = source("lib/admin/control_asset_manager_page.dart");
  const registry = source("lib/core/assets/shadow_asset_registry.dart");

  assert.equal(runtime.includes("CachedNetworkImage"), true);
  assert.equal(runtime.includes("Image.network("), false);
  assert.equal(manager.includes("decoded.numFrames > 1"), true);
  assert.equal(manager.includes("Animated Preview"), true);
  assert.equal(manager.includes("تم الحفاظ على Animation الأصلية"), true);
  assert.equal(registry.includes("vipBatchHKeys"), true);
  assert.equal(registry.includes("vipEntryStrip(value)"), true);
  assert.equal(registry.toLowerCase().includes("vehicle"), false);
});
