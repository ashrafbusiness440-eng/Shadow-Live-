import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function source(path) {
  return readFileSync(new URL("../../" + path, import.meta.url), "utf8");
}

test("official room backgrounds are controlled independently from Room Image and Host inventory", () => {
  const voice = source("cloudflare-worker/src/voice-session-legacy.js");
  const inventory = source(
    "cloudflare-worker/src/legacy-economy/reward-inventory.js",
  );
  const control = source("lib/main_control.dart");
  const main = source("lib/main.dart");

  assert.equal(
    voice.includes('controlAction==="setOfficialRoomBackground"'),
    true,
  );
  assert.equal(
    voice.includes('activeRoomBackgroundRewardId:"system_control"'),
    true,
  );
  assert.equal(
    voice.includes('activeRoomBackgroundExpiresAtMs:0'),
    true,
  );
  assert.equal(
    control.includes("'خلفية الغرفة الرسمية'"),
    true,
  );
  assert.equal(
    control.includes("execute(\n                    'setOfficialRoomBackground'"),
    true,
  );
  assert.equal(
    control.includes("'مستقلة عن صورة الغرفة وعن مقتنيات الـHost"),
    true,
  );

  assert.equal(inventory.includes("function roomUsesOwnerInventory"), true);
  assert.equal(
    inventory.includes(
      '!["official","administrative","customer_service"].includes(type)',
    ),
    true,
  );
  assert.equal(
    main.includes("rewardBackgroundExpiresAtMs == 0"),
    true,
  );
});

test("external room image remains a separate field from official room background", () => {
  const control = source("lib/main_control.dart");
  const voice = source("cloudflare-worker/src/voice-session-legacy.js");

  assert.equal(
    control.includes("labelText:'رابط صورة الغرفة الخارجية'"),
    true,
  );
  assert.equal(
    control.includes("controller:roomBackgroundAssetKey"),
    true,
  );
  assert.equal(
    voice.includes("coverImageUrl:clean(room.coverImageUrl)"),
    true,
  );
  assert.equal(
    voice.includes(
      "activeRoomBackgroundAssetKey:clean(room.activeRoomBackgroundAssetKey)",
    ),
    true,
  );
});
