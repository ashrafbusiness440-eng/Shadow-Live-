import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

import {
  assetStudioTemplateById,
} from "../../cloudflare-worker/src/asset-studio-templates.js";

test("Batch I ready manifest stays aligned with Asset Studio templates", async () => {
  const raw = await readFile(
    new URL("../../assets/images/mysterious/BATCH_I_READY.json", import.meta.url),
    "utf8",
  );
  const manifest = JSON.parse(raw);
  assert.equal(manifest.batch, "I");
  assert.equal(manifest.feature, "mysterious_person");
  assert.equal(manifest.status, "ready_to_generate");

  const seen = new Set();
  for (const asset of manifest.assets) {
    assert.equal(seen.has(asset.assetKey), false, asset.assetKey);
    seen.add(asset.assetKey);

    const template = assetStudioTemplateById(asset.templateId);
    assert.ok(template, asset.templateId);
    assert.equal(asset.width, template.width, asset.assetKey);
    assert.equal(asset.height, template.height, asset.assetKey);
    assert.equal(template.dimensionsStatus, "fixed", asset.assetKey);
    assert.equal(asset.transparent, true, asset.assetKey);
    assert.equal(asset.mode, "remote_cached", asset.assetKey);
    assert.match(asset.fullPath, /^assets\/images\/mysterious\//);
  }

  const voiceAssets = manifest.assets.filter((item) =>
    item.assetKey.startsWith("mysterious.voice_option_icons."),
  );
  assert.equal(voiceAssets.length, 9);
  assert.equal(
    new Set(voiceAssets.map((item) => item.assetKey)).size,
    9,
  );

  for (const requiredKey of [
    "mysterious.room_identity",
    "mysterious.identity_card",
    "mysterious.id_plate",
    "mysterious.badge",
    "mysterious.entrance",
    "mysterious.vehicle",
    "mysterious.room_presence_skin",
  ]) {
    assert.equal(seen.has(requiredKey), true, requiredKey);
  }

  assert.equal(
    manifest.rules.rankingUi,
    "reuse_existing_ranking_skin_swap_identity_only",
  );
});
