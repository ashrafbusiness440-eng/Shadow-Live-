import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  normalizeVipQuickPurchaseOffers,
  normalizeVipPolicy,
} from "../../cloudflare-worker/src/vip-policy.js";

function source(path) {
  return readFileSync(new URL("../../" + path, import.meta.url), "utf8");
}

test("VIP quick offers are bounded and server-derived from the live purchase ratio", () => {
  const offers = normalizeVipQuickPurchaseOffers(
    [
      {
        id: "starter",
        labelAr: "سريع",
        growthPoints: 3000,
        baseCoinCost: 1200,
        enabled: true,
        sortOrder: 0,
      },
    ],
    3,
  );
  assert.equal(offers.length, 1);
  assert.equal(offers[0].finalCoinCost, 1000);
  assert.equal(offers[0].discountBps, 1666);

  assert.deepEqual(
    normalizeVipQuickPurchaseOffers(
      [{ id: "bad", growthPoints: 1000, baseCoinCost: 1000 }],
      3,
    ),
    [],
  );

  const policy = normalizeVipPolicy({
    purchasedGrowthPerCoin: 3,
    quickPurchaseOffers: Array.from({ length: 12 }, (_, index) => ({
      id: `offer_${index + 1}`,
      growthPoints: 3000 * (index + 1),
      baseCoinCost: 1200 * (index + 1),
    })),
  });
  assert.equal(policy.quickPurchaseOffers.length, 8);
});

test("VIP history is paginated, bounded and excludes duplicate growth audit actions", () => {
  const actions = source("cloudflare-worker/src/vip-actions.js");
  const indexes = JSON.parse(source("firestore.indexes.json"));

  assert.equal(actions.includes("const VIP_HISTORY_PAGE_SIZE = 20;"), true);
  assert.equal(actions.includes("const VIP_HISTORY_MAX_PAGE_SIZE = 20;"), true);
  assert.equal(actions.includes('action === "history"'), true);
  assert.equal(actions.includes('db.runQuery("vip_growth_history"'), true);
  assert.equal(actions.includes('db.runQuery("vip_audit_logs"'), true);
  assert.equal(actions.includes('"manageVipLevels"'), true);
  assert.equal(actions.includes('"buyVipGrowth",\n]);'), false);
  assert.equal(actions.includes('limit: sourceLimit'), true);
  assert.equal(actions.includes('startAfter: startAfter(cursor.growth)'), true);
  assert.equal(actions.includes('startAfter: startAfter(cursor.audit)'), true);

  const names = indexes.indexes.map((item) => item.collectionGroup);
  assert.equal(names.includes("vip_growth_history"), true);
  assert.equal(names.includes("vip_audit_logs"), true);
});

test("VIP information control is separated from level grants and audited", () => {
  const control = source("cloudflare-worker/src/manage-vip-information.js");
  const router = source("cloudflare-worker/src/index.js");

  assert.equal(control.includes('actorCapabilities(actor).has("manageVipPolicy")'), true);
  assert.equal(control.includes("manageVipLevels"), false);
  assert.equal(control.includes('has("manageVip")'), false);
  assert.equal(control.includes("rawOffers.length > 8"), true);
  assert.equal(control.includes("recent_auth_required"), true);
  assert.equal(control.includes("control_operations/"), true);
  assert.equal(control.includes("admin_audit_logs/vip_info_"), true);
  assert.equal(control.includes("setVipQuickPurchaseOffers"), true);
  assert.equal(
    router.includes('url.pathname === "/api/manage-vip-information"'),
    true,
  );
});
