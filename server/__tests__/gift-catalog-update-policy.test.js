import assert from "node:assert/strict";
import { test } from "node:test";
import { validateGiftCatalogUpdate } from "../../cloudflare-worker/src/gift-catalog-update-policy.js";

const gift = (id, category = "general", priceCoins = 100) => ({
  id, category, priceCoins, nameAr: "هدية", enabled: true,
  featured: false, minVipLevel: category === "vip" ? 4 : 0,
  sortOrder: 0, assetKey: "gifts.sample.icon",
  effectAssetKey: "gifts.sample.effect", effectMode: "none",
  effectMinQuantity: 0, effectDurationMs: 2200, effectSize: 0,
  effectSoundAssetKey: "", premiumBannerMinQuantity: 0, affinityBasePoints: 0,
});

test("catalog saves increment revision and audit exact price changes", () => {
  const oldGift = gift("rose");
  const update = [{ ...oldGift, priceCoins: 200 }];
  assert.deepEqual(validateGiftCatalogUpdate({ revision: 5, gifts: [oldGift] }, update, 5), {
    revision: 6,
    changes: [{ giftId: "rose", fields: { priceCoins: { before: 100, after: 200 } } }],
  });
});

test("stale versions cannot overwrite more recent catalog updates", () => {
  assert.throws(
    () => validateGiftCatalogUpdate({ revision: 7, gifts: [gift("rose")] }, [gift("rose")], 6),
    /gift_catalog_conflict/,
  );
  assert.throws(
    () => validateGiftCatalogUpdate({ revision: 7, gifts: [gift("rose")] }, [gift("rose")], undefined),
    /invalid_catalog_revision/,
  );
});

test("existing IDs cannot be removed, and restricted gift categories cannot be bypassed", () => {
  assert.throws(
    () => validateGiftCatalogUpdate({ gifts: [gift("rose")] }, [gift("new_rose")], 0),
    /gift_catalog_existing_id_missing/,
  );
  for (const category of ["vip", "cp", "friends"]) {
    assert.throws(
      () => validateGiftCatalogUpdate(
        { gifts: [gift("exclusive", category)] },
        [gift("exclusive", "general")], 0,
      ),
      /gift_catalog_restricted_category/,
    );
  }
  assert.equal(
    validateGiftCatalogUpdate({ gifts: [gift("rose")] }, [{ ...gift("rose"), enabled: false }], 0).changes[0].fields.enabled.after,
    false,
  );
});

test("new gifts may be added without deleting existing history", () => {
  const value = validateGiftCatalogUpdate({ revision: 0, gifts: [gift("rose")] }, [gift("rose"), gift("coffee")], 0);
  assert.equal(value.revision, 1);
  assert.equal(value.changes[0].giftId, "coffee");
});

test("gift schedule and placement changes are audited, without false array diffs", () => {
  const old = { ...gift("rose"), allowedContexts: ["room", "chat"], visibleFromMs: 0, visibleUntilMs: 0 };
  const changed = { ...old, allowedContexts: ["chat"], visibleFromMs: 1000, visibleUntilMs: 2000 };
  const diff = validateGiftCatalogUpdate({ revision: 3, gifts: [old] }, [changed], 3).changes;
  assert.deepEqual(diff, [{
    giftId: "rose",
    fields: {
      allowedContexts: { before: ["room", "chat"], after: ["chat"] },
      visibleFromMs: { before: 0, after: 1000 },
      visibleUntilMs: { before: 0, after: 2000 },
    },
  }]);
  assert.deepEqual(
    validateGiftCatalogUpdate({ revision: 3, gifts: [old] },
      [{ ...old, allowedContexts: ["room", "chat"] }], 3).changes,
    [],
  );
});
