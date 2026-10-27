import {test} from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {catalogGiftRankingPage, GIFT_RANK_PAGE_LIMIT} from "../../cloudflare-worker/src/gift-ranking-policy.js";
import {giftTotalsAggregationRequest, parseGiftTotalsAggregationResponse} from "../../cloudflare-worker/src/gift-totals-aggregation-policy.js";
import {giftAdminAccess} from "../../cloudflare-worker/src/gift-admin-permissions.js";

const makeConfig = (n = 14, revision = 3) => ({
  revision,
  gifts: Array.from({length:n}, (_, i) => ({
    id: "gift_" + String(n - i).padStart(3, "0"),
    nameAr: "هدية " + i, enabled: i % 2 === 0,
  })),
});
test("catalog ranking is deterministic and paginated across even hidden published gifts", () => {
  const cfg = makeConfig();
  const first = catalogGiftRankingPage(cfg, 0, null, true);
  assert.equal(first.total, 14);
  assert.equal(first.revision, 3);
  assert.equal(first.page.length, GIFT_RANK_PAGE_LIMIT);
  assert.equal(first.nextOffset, 6);
  assert.equal(first.hasMore, true);
  const second = catalogGiftRankingPage(cfg, 6, 3, true);
  const third = catalogGiftRankingPage(cfg, 12, 3, true);
  assert.equal(third.hasMore, false);
  const ids = [...first.page, ...second.page, ...third.page].map(x => x.giftId);
  assert.deepEqual(ids, [...ids].sort());
  assert.equal(new Set(ids).size, 14);
});
test("statistics-only viewer never receives hidden catalog gift IDs or names", () => {
  const cfg = makeConfig(8);
  const visible = catalogGiftRankingPage(cfg, 0);
  const editor = catalogGiftRankingPage(cfg, 0, null, true);
  assert.equal(visible.total, 4);
  assert.equal(editor.total, 8);
  assert.ok(visible.page.every(item => cfg.gifts.some(gift => gift.id === item.giftId && gift.enabled === true)));
});

test("pagination detects catalog revisions and refuses malformed/overlarge requests", () => {
  const cfg = makeConfig();
  for (const offset of [-1,1,7,101,1.5,"6",null]) {
    assert.throws(()=>catalogGiftRankingPage(cfg,offset,3));
  }
  assert.throws(()=>catalogGiftRankingPage(cfg,6,2),/gift_catalog_conflict/);
  assert.throws(()=>catalogGiftRankingPage(makeConfig(101),0),/invalid_gift_report_catalog/);
  assert.throws(()=>catalogGiftRankingPage({revision:1,gifts:[{id:"rose"},{id:"rose"}]},0));
  assert.throws(()=>catalogGiftRankingPage({revision:1,gifts:[{id:"INVALID?"}]},0));
});
test("historical per-gift aggregation is exact single-ID Firestore index query; not a last-150 sample", () => {
  const query = giftTotalsAggregationRequest(null, "gift_001");
  assert.deepEqual(query.structuredAggregationQuery.structuredQuery.where, {
    fieldFilter:{field:{fieldPath:"giftId"},op:"EQUAL",value:{stringValue:"gift_001"}},
  });
  assert.equal(query.structuredAggregationQuery.aggregations.length,4);
  assert.equal(query.structuredAggregationQuery.structuredQuery.limit,undefined);
  assert.throws(()=>giftTotalsAggregationRequest(null,"not valid!"),/invalid_gift_id/);
  const values = [{result:{aggregateFields:{
    receipts:{integerValue:"3"},gifts:{integerValue:"22"},
    faceCoins:{integerValue:"5000"},paidCoins:{integerValue:"2500"},
  }}}];
  assert.equal(parseGiftTotalsAggregationResponse(values).gifts,22);
  assert.equal(parseGiftTotalsAggregationResponse(values).faceCoins,5000);
});
test("report only permissions and no financial writes, with bounded on-demand reads", () => {
  assert.equal(giftAdminAccess({role:"owner"},"statsGiftRanking").allowed,true);
  assert.equal(giftAdminAccess({role:"admin",adminEnabled:true,capabilities:["viewGiftStats"]},"statsGiftRanking").allowed,true);
  assert.equal(giftAdminAccess({role:"admin",adminEnabled:true,capabilities:["manageGiftCatalog"]},"statsGiftRanking").allowed,true);
  assert.equal(giftAdminAccess({role:"user"},"statsGiftRanking").allowed,false);
  assert.equal(giftAdminAccess({role:"admin",adminEnabled:true,capabilities:["viewGiftStats"]},"grantBagGift").allowed,false);
  const source = readFileSync(new URL("../../cloudflare-worker/src/legacy-economy/gift-catalog.js",import.meta.url),"utf8");
  const section = source.slice(source.indexOf('if (action === "statsGiftRanking")'),source.indexOf('if (action === "statsRecent")'));
  assert.match(section,/catalogGiftRankingPage\(state\.config, offset, expectedRevision, canManageCatalog\)/);
  assert.match(section,/i \+= 2/);
  assert.match(section,/readGiftTransactionTotals\(null, gift\.giftId\)/);
  assert.match(section,/15 \* 60_000/);
  assert.doesNotMatch(section,/writeCreate|writeUpdate|writeDelete/);
  const room = readFileSync(new URL("../../cloudflare-worker/src/room-gift.js",import.meta.url),"utf8");
  assert.doesNotMatch(room,/statsGiftRanking/);
});
