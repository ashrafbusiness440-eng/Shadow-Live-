import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  giftTotalsAggregationRequest,
  parseGiftTotalsAggregationResponse,
} from "../../cloudflare-worker/src/gift-totals-aggregation-policy.js";
import { parseFirestoreAggregationRows } from "../../cloudflare-worker/src/firestore.js";
import { giftAdminAccess } from "../../cloudflare-worker/src/gift-admin-permissions.js";

function response(values = ["3","8","2500","1500"]) {
  const fields = Object.fromEntries(
    ["receipts","gifts","faceCoins","paidCoins"].map((key, i) =>
      [key, { integerValue: values[i] }]),
  );
  return [{ result: { aggregateFields: fields }, readTime: "2026-10-27T12:30:00Z" }];
}

test("indexed Firestore REST aggregation includes only receipt counts and numeric sums", () => {
  assert.deepEqual(giftTotalsAggregationRequest(), {
    structuredAggregationQuery: {
      structuredQuery: { from: [{ collectionId: "gift_transactions" }] },
      aggregations: [
        { alias: "receipts", count: {} },
        { alias: "gifts", sum: { field: { fieldPath: "quantity" } } },
        { alias: "faceCoins", sum: { field: { fieldPath: "totalCost" } } },
        { alias: "paidCoins", sum: { field: { fieldPath: "paidCost" } } },
      ],
    },
  });
});

test("totals from server aggregation are exact, including unpaid face-value difference", () => {
  assert.deepEqual(parseGiftTotalsAggregationResponse(response()), {
    receipts: 3,
    gifts: 8,
    faceCoins: 2500,
    paidCoins: 1500,
    nonPaidCoins: 1000,
    scope: "gift_transactions_collection",
    readTime: "2026-10-27T12:30:00Z",
  });
});

test("accept Firestore JSON array, object and streaming NDJSON", () => {
  const entry = response()[0];
  assert.deepEqual(parseFirestoreAggregationRows(JSON.stringify(response())),response());
  assert.deepEqual(parseFirestoreAggregationRows(JSON.stringify(entry)),response());
  assert.deepEqual(parseFirestoreAggregationRows(JSON.stringify(entry)+"\n"+JSON.stringify({ readTime: "later" })),[entry,{readTime:"later"}]);
});

test("reject non-integer, unsafe, negative, missing and inconsistent monetary totals", () => {
  for(const vals of [
    ["1","2","25","26"],
    ["1","2","-3","0"],
    ["1","2","9007199254740994","0"],
    ["1","2","2.25","1"],
    ["nan","2","3","0"],
  ]) {
    assert.throws(() => parseGiftTotalsAggregationResponse(response(vals)));
  }
  assert.throws(()=>parseGiftTotalsAggregationResponse([]));
  assert.throws(()=>parseGiftTotalsAggregationResponse([{}]));
});

test("only existing gift-report privileges may request aggregate totals", () => {
  assert.equal(giftAdminAccess({role:"owner"},"statsTotals").allowed,true);
  assert.equal(giftAdminAccess({role:"admin",adminEnabled:true,capabilities:["viewGiftStats"]},"statsTotals").allowed,true);
  assert.equal(giftAdminAccess({role:"moderator",adminEnabled:false,capabilities:["viewGiftStats"]},"statsTotals").allowed,false);
  assert.equal(giftAdminAccess({role:"user"},"statsTotals").allowed,false);
});

test("admin endpoint caches read-only aggregate; no payment path modifications", () => {
  const source=readFileSync(new URL("../../cloudflare-worker/src/legacy-economy/gift-catalog.js",import.meta.url),"utf8");
  assert.match(source,/if \(action === "statsTotals"\)/);
  assert.match(source,/db\.client\.readGiftTransactionTotals\(\)/);
  assert.match(source,/ttlMs: 5 \* 60_000/);
  const room=readFileSync(new URL("../../cloudflare-worker/src/room-gift.js",import.meta.url),"utf8");
  assert.doesNotMatch(room,/readGiftTransactionTotals/);
});
