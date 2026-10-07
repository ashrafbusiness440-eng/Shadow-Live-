import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function source(path) {
  return readFileSync(new URL(path, import.meta.url), "utf8");
}

test("gift picker uses wealth progress instead of featured banner", () => {
  const picker = source(
    "../../lib/features/gift/widgets/unified_gift_picker_sheet.dart",
  );

  assert.equal(picker.includes("_featuredStrip"), false);
  assert.equal(picker.includes("Featured"), false);
  assert.equal(picker.includes("_wealthStrip()"), true);
  assert.equal(picker.includes("امتيازاتي"), true);
  assert.equal(
    picker.includes("UserLevelScreen(initialTabIndex: 0)"),
    true,
  );
  assert.equal(
    picker.includes("كل 1 كوين مُرسل = 1 نقطة ثروة"),
    true,
  );
  assert.equal(picker.includes("Navigator.pop(context);"), false);
});

test("room and direct gifts advance wealth by exact paid gift value", () => {
  const room = source(
    "../../lib/features/gift/widgets/room_gift_sheet.dart",
  );
  const direct = source(
    "../../lib/features/gift/widgets/direct_gift_sheet.dart",
  );
  const policy = source(
    "../../cloudflare-worker/src/user-level-policy.js",
  );

  assert.equal(room.includes("wealthDeltaCoins: totalCost"), true);
  assert.equal(direct.includes("wealthDeltaCoins: totalCost"), true);
  assert.equal(policy.includes("wealthPoints: paid"), true);
});

test("wealth progress stays bounded without a per-gift level fetch", () => {
  const picker = source(
    "../../lib/features/gift/widgets/unified_gift_picker_sheet.dart",
  );

  assert.equal(
    picker.includes("final nextPoints = current.points + delta;"),
    true,
  );
  assert.equal(
    picker.includes("if (nextPoints >= nextThreshold)"),
    true,
  );
  assert.equal(
    picker.includes("unawaited(_loadWealth());"),
    true,
  );
  assert.equal(
    picker.includes("Crossing a level is rare"),
    true,
  );
});
