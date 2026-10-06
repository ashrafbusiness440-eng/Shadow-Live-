import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  ASSET_STUDIO_CHANNELS,
  ASSET_STUDIO_TEMPLATES,
  validateAssetStudioMetadata,
} from "../../cloudflare-worker/src/asset-studio-templates.js";

function source(relative) {
  return readFileSync(new URL("../../" + relative, import.meta.url), "utf8");
}

test("asset studio catalog has unique stable templates and approved channels", () => {
  assert.deepEqual(ASSET_STUDIO_CHANNELS, [
    "store",
    "agency_packages",
    "events",
    "vip",
    "agency",
    "admin_grants",
    "system",
  ]);

  assert.ok(ASSET_STUDIO_TEMPLATES.length >= 15);
  const ids = ASSET_STUDIO_TEMPLATES.map((item) => item.id);
  assert.equal(new Set(ids).size, ids.length);

  for (const template of ASSET_STUDIO_TEMPLATES) {
    assert.ok(template.id.endsWith(".v1"));
    assert.ok(template.type);
    assert.ok(template.directories.length > 0);
    assert.ok(template.extensions.length > 0);
    assert.equal(template.maxBytes, 2500000);
    assert.equal(template.dimensionsStatus, "tbd");
    assert.equal(template.width, null);
    assert.equal(template.height, null);
    assert.ok(template.prompt.length > 20);
  }
});

test("studio validation accepts matching metadata and rejects mismatches", () => {
  const valid = validateAssetStudioMetadata({
    studioVersion: 1,
    assetType: "badge",
    templateId: "badge.base.v1",
    channels: ["vip", "system", "vip"],
    directory: "assets/images/vip",
    fileName: "vip_badge_1.webp",
    byteSize: 120000,
  });
  assert.equal(valid.ok, true);
  assert.equal(valid.legacy, false);
  assert.deepEqual(valid.channels, ["vip", "system"]);

  assert.equal(validateAssetStudioMetadata({
    studioVersion: 1,
    assetType: "badge",
    templateId: "frame.base.v1",
    channels: ["vip"],
    directory: "assets/images/vip",
    fileName: "x.webp",
    byteSize: 100,
  }).code, "invalid_asset_template");

  assert.equal(validateAssetStudioMetadata({
    studioVersion: 1,
    assetType: "badge",
    templateId: "badge.base.v1",
    channels: [],
    directory: "assets/images/vip",
    fileName: "x.webp",
    byteSize: 100,
  }).code, "invalid_asset_channels");

  assert.equal(validateAssetStudioMetadata({
    studioVersion: 1,
    assetType: "badge",
    templateId: "badge.base.v1",
    channels: ["vip"],
    directory: "assets/images/rooms",
    fileName: "x.webp",
    byteSize: 100,
  }).code, "template_directory_mismatch");

  assert.equal(validateAssetStudioMetadata({
    studioVersion: 1,
    assetType: "badge",
    templateId: "badge.base.v1",
    channels: ["vip"],
    directory: "assets/images/vip",
    fileName: "x.jpg",
    byteSize: 100,
  }).code, "template_extension_mismatch");
});

test("studio validation accepts safe level subdirectories and blocks traversal", () => {
  const nested = validateAssetStudioMetadata({
    studioVersion: 1,
    assetType: "badge",
    templateId: "badge.base.v1",
    channels: ["system"],
    directory: "assets/images/levels/game/lv01_03",
    fileName: "game_main_lv01_03.webp",
    byteSize: 120000,
  });
  assert.equal(nested.ok, true);

  for (const directory of [
    "assets/images/levels/../secrets",
    "assets/images/levels/game/../../vip",
    "/assets/images/levels/game",
    "assets/images/levels//game",
  ]) {
    assert.equal(validateAssetStudioMetadata({
      studioVersion: 1,
      assetType: "badge",
      templateId: "badge.base.v1",
      channels: ["system"],
      directory,
      fileName: "game_main_lv01_03.webp",
      byteSize: 120000,
    }).code, "template_directory_mismatch");
  }
});

test("legacy asset manager requests stay backward compatible", () => {
  const result = validateAssetStudioMetadata({
    studioVersion: 0,
    assetType: "",
    templateId: "",
    channels: [],
    directory: "assets/images/gifts",
    fileName: "gift_rose.webp",
    byteSize: 100,
  });
  assert.equal(result.ok, true);
  assert.equal(result.legacy, true);
});

test("canonical level asset keys with camelCase suffixes stay valid end-to-end", () => {
  const worker = source("cloudflare-worker/src/manage-app-asset.js");
  const publicApi = source("cloudflare-worker/src/app-assets.js");
  const controlPolicy = source("lib/admin/control_asset_policy.dart");

  for (const key of [
    "levels.game.lv01_03.mainBadge",
    "levels.game.lv01_03.miniBadge",
    "levels.wealth.lv01_05.wealthBadge",
  ]) {
    assert.match(key, /^[a-z0-9][A-Za-z0-9._-]{2,119}$/);
  }
  assert.equal(worker.includes("^[a-z0-9][A-Za-z0-9._-]{2,119}$"), true);
  assert.equal(publicApi.includes("^[a-z0-9][A-Za-z0-9._-]{2,119}$"), true);
  assert.equal(controlPolicy.includes("^[a-z0-9][A-Za-z0-9._-]{2,119}$"), true);

  for (const invalid of ["Levels.game.badge", "levels/game/badge", "levels game badge"]) {
    assert.doesNotMatch(invalid, /^[a-z0-9][A-Za-z0-9._-]{2,119}$/);
  }
});

test("asset manager keeps bounded registry and explicit draft publish flow", () => {
  const worker = source("cloudflare-worker/src/manage-app-asset.js");
  const control = source("lib/admin/control_asset_manager_page.dart");

  assert.equal(worker.includes('limit: 100'), true);
  assert.equal(worker.includes('action === "publish"'), true);
  assert.equal(worker.includes('"saveAppAssetDraft"'), true);
  assert.equal(worker.includes("asset-studio/drafts/"), true);
  assert.equal(worker.includes("env?.USER_STORAGE"), true);
  assert.equal(worker.includes("hasDraft: true"), true);
  assert.equal(worker.includes('"published_with_draft"'), true);
  assert.equal(worker.includes('"published_asset_requires_publish"'), false);
  assert.equal(worker.includes("writeFinalAssetToGithub"), true);
  assert.equal(worker.includes("publicAssetStudioTemplates()"), true);
  assert.equal(worker.includes("segment === \"..\""), true);
  assert.equal(worker.includes("directory.startsWith(`\${root}/`)"), true);

  assert.equal(control.includes("'حفظ مسودة'"), true);
  assert.equal(control.includes("'نشر'"), true);
  assert.equal(control.includes("'channels': _selectedChannels"), true);
  assert.equal(control.includes("'templateId': template.id"), true);
  assert.equal(control.includes("حفظ المسودة لا يغيّر النسخة الحية"), true);
  assert.equal(control.includes("التحديث الفعلي يتم عند النشر"), true);
  assert.equal(control.includes("سجل الأصول"), true);
  assert.equal(control.includes("البحث في الأصول"), true);
  assert.equal(control.includes("Timer.periodic"), false);
  assert.equal(control.includes(".snapshots()"), false);
});

test("login header is a first-class Asset Studio surface with bundled fallback", () => {
  const template = ASSET_STUDIO_TEMPLATES.find(
    (item) => item.id === "auth_screen.base.v1",
  );
  assert.ok(template);
  assert.equal(template.type, "auth_screen");
  assert.deepEqual(template.directories, ["assets/images"]);

  const manager = source("lib/admin/control_asset_manager_page.dart");
  const registry = source("lib/core/assets/shadow_asset_registry.dart");
  const authChoice = source("lib/features/onboarding/screens/auth_choice_screen.dart");

  assert.equal(manager.includes("auth.login.header"), true);
  assert.equal(manager.includes("auth_header.png"), true);
  assert.equal(registry.includes("authLoginHeader = 'auth.login.header'"), true);
  assert.equal(authChoice.includes("ShadowAssetKeys.authLoginHeader"), true);
  assert.equal(authChoice.includes("refresh: true"), true);
  assert.equal(authChoice.includes("assets/images/auth_header.png"), true);
});

