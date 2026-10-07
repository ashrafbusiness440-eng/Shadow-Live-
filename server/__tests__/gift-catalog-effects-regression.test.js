import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function source(path) {
  return readFileSync(new URL(path, import.meta.url), "utf8");
}

test("gift catalog owns reusable effect and relationship metadata", () => {
  const backend = source(
    "../../cloudflare-worker/src/legacy-economy/gift-catalog.js",
  );
  const client = source(
    "../../lib/features/gift/services/gift_catalog_service.dart",
  );
  const control = source("../../lib/admin/gift_catalog_control_page.dart");
  const picker = source(
    "../../lib/features/gift/widgets/unified_gift_picker_sheet.dart",
  );

  for (const key of [
    "isAnimated",
    "effectMode",
    "effectAssetKey",
    "effectMinQuantity",
    "effectDurationMs",
    "premiumBannerMinQuantity",
    "affinityBasePoints",
  ]) {
    assert.equal(backend.includes(key), true, key);
    assert.equal(client.includes(key), true, key);
  }
  assert.equal(backend.includes('"cp"'), true);
  assert.equal(backend.includes('"friends"'), true);
  assert.equal(
    backend.includes("affinityBasePoints % 2 !== 0"),
    true,
  );
  assert.equal(client.includes("'cp' => 'CP'"), true);
  assert.equal(client.includes("'friends' => 'أصدقاء'"), true);
  assert.equal(control.includes("نوع مؤثر الغرفة"), true);
  assert.equal(control.includes("أقل كمية لتشغيل المؤثر"), true);
  assert.equal(control.includes("نقاط العلاقة الأساسية — عدد زوجي"), true);
  assert.equal(picker.includes("gift.isRelationshipGift ? 'relationship'"), true);
  assert.equal(picker.includes("? 'علاقة'"), true);
  assert.equal(picker.includes("gift.category == 'cp' ? 'CP' : 'صديق'"), true);
  assert.equal(picker.includes("GiftCatalogService.categoryLabel(value)"), true);
  assert.equal(
    control.match(/Future<void> editGift/g)?.length ?? 0,
    1,
    "gift editor must not be duplicated",
  );
  assert.equal(
    control.match(/Widget build\(BuildContext context\)/g)?.length ?? 0,
    1,
    "gift catalog page must have one build tree",
  );
  assert.equal(
    control.includes("isAnimated: item.isAnimated"),
    true,
    "enable/disable edits must preserve effect metadata",
  );
  assert.equal(
    control.includes("affinityBasePoints: item.affinityBasePoints"),
    true,
    "enable/disable edits must preserve relationship metadata",
  );
});
