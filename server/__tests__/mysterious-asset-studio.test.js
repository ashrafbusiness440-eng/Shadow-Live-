import assert from "node:assert/strict";
import { test } from "node:test";

import {
  assetStudioTemplateById,
  validateAssetStudioMetadata,
} from "../../cloudflare-worker/src/asset-studio-templates.js";

const cases = [
  ["mysterious.room_identity.v1", "mic_effect"],
  ["mysterious.identity_card.v1", "profile_card"],
  ["mysterious.id_plate.v1", "profile_card"],
  ["mysterious.badge.v1", "badge"],
  ["mysterious.entrance.v1", "entrance"],
  ["mysterious.vehicle.v1", "system_cosmetic"],
  ["mysterious.room_presence_skin.v1", "profile_card"],
  ["mysterious.voice_option_icon.v1", "badge"],
];

test("mysterious assets use the existing Asset Studio template registry", () => {
  for (const [id, type] of cases) {
    const item = assetStudioTemplateById(id);
    assert.ok(item, id);
    assert.equal(item.type, type);
    assert.equal(item.directories.includes("assets/images/mysterious"), true);
    assert.match(item.prompt, /real|dynamic|user|ID/i);
  }
});

test("mysterious identity artwork validates through the normal studio contract", () => {
  const result = validateAssetStudioMetadata({
    studioVersion: 1,
    assetKey: "mysterious.room_identity",
    assetType: "mic_effect",
    templateId: "mysterious.room_identity.v1",
    channels: ["system"],
    directory: "assets/images/mysterious",
    fileName: "room_identity.webp",
    byteSize: 220000,
  });
  assert.equal(result.ok, true);
  assert.equal(result.legacy, false);
});
