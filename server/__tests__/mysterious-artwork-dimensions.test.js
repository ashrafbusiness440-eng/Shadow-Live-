import assert from "node:assert/strict";
import { test } from "node:test";

import {
  assetStudioTemplateById,
} from "../../cloudflare-worker/src/asset-studio-templates.js";

const expected = new Map([
  ["mysterious.room_identity.v1", [1024, 1024]],
  ["mysterious.identity_card.v1", [1280, 640]],
  ["mysterious.id_plate.v1", [1280, 320]],
  ["mysterious.badge.v1", [512, 512]],
  ["mysterious.entrance.v1", [1280, 320]],
  ["mysterious.vehicle.v1", [1280, 720]],
  ["mysterious.room_presence_skin.v1", [1280, 320]],
  ["mysterious.voice_option_icon.v1", [256, 256]],
]);

test("Batch I mysterious templates expose the approved fixed dimensions", () => {
  for (const [id, [width, height]] of expected) {
    const template = assetStudioTemplateById(id);
    assert.ok(template, id);
    assert.equal(template.width, width, id);
    assert.equal(template.height, height, id);
    assert.equal(template.dimensionsStatus, "fixed", id);
    assert.match(template.noteAr, new RegExp(`${width}×${height}`));
  }
});
