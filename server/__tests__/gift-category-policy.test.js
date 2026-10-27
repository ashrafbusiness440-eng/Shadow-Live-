import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_GIFT_CATEGORIES,
  giftCategoryDefinitions,
  giftCategoryEnabled,
  giftCategoryIdSet,
  validateGiftCategoryDefinitions,
} from "../../cloudflare-worker/src/gift-category-policy.js";

const old = { gifts: [{ id: "rose", category: "general" }] };
test("legacy gift category catalog preserves eight established categories", () => {
  assert.equal(giftCategoryDefinitions(old).length, 8);
  assert.equal(giftCategoryEnabled(old, "cp"), true);
  assert.equal(giftCategoryEnabled(old, "unknown"), false);
});
test("can add and hide a seasonal category while preserving protected IDs", () => {
  const values = [...DEFAULT_GIFT_CATEGORIES, {
    id: "ramadan", nameAr: "رمضان", enabled: false, assetKey: "",
  }];
  const next = validateGiftCategoryDefinitions(values, old, old.gifts);
  assert.equal(next[8].sortOrder, 8);
  assert.equal(giftCategoryEnabled({ categoryDefinitions: next }, "ramadan"), false);
  assert.equal(giftCategoryIdSet({ categoryDefinitions: next }).has("ramadan"), true);
});
test("hiding a category blocks its gifts without rewriting historical records", () => {
  const next = validateGiftCategoryDefinitions(
    DEFAULT_GIFT_CATEGORIES.map((x) => x.id === "general" ? { ...x, enabled: false } : x),
    old, old.gifts,
  );
  assert.equal(giftCategoryEnabled({ categoryDefinitions: next }, "general"), false);
  assert.equal(old.gifts[0].category, "general");
});
test("existing categories cannot be removed or illegally renamed by ID", () => {
  assert.throws(
    () => validateGiftCategoryDefinitions(DEFAULT_GIFT_CATEGORIES.filter((x) => x.id !== "cp"), old, old.gifts),
    /gift_category_missing/,
  );
  assert.throws(
    () => validateGiftCategoryDefinitions(
      DEFAULT_GIFT_CATEGORIES.map((x) => x.id === "vip" ? { ...x, id: "premium" } : x),
      old, old.gifts,
    ), /gift_category_missing/,
  );
});
test("reject duplicate and unsafe IDs or malformed images", () => {
  for (const bad of [
    { id: "general", nameAr: "مكرر" },
    { id: "../bad", nameAr: "خطر" },
    { id: "safe", nameAr: "سليم", assetKey: "/unsafe" },
  ]) {
    assert.throws(() => validateGiftCategoryDefinitions(
      [...DEFAULT_GIFT_CATEGORIES, bad], old, old.gifts,
    ));
  }
});
