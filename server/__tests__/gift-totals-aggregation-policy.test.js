import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  giftTotalsAggregationRequest,
  giftPeriodBounds,
  giftCustomRangeBounds,
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
  assert.match(source,/db\.client\.readGiftTransactionTotals\(bounds\)/);
  assert.match(source,/ttlMs: 5 \* 60_000/);
  const room=readFileSync(new URL("../../cloudflare-worker/src/room-gift.js",import.meta.url),"utf8");
  assert.doesNotMatch(room,/readGiftTransactionTotals/);
});

test("UTC day and month calendar bounds are exact and enforce 366-day horizon", () => {
  const now = new Date("2026-10-27T22:00:00Z");
  assert.deepEqual(giftPeriodBounds("day", "2026-10-27", now), {
    start: "2026-10-27T00:00:00.000Z", end: "2026-10-28T00:00:00.000Z",
  });
  assert.deepEqual(giftPeriodBounds("month", "2026-02-28", now), {
    start: "2026-02-01T00:00:00.000Z", end: "2026-03-01T00:00:00.000Z",
  });
  for (const [period, date] of [["week","2026-10-27"],["day","2026-02-30"],
    ["day","2027-01-01"],["month","2024-03-01"],["day","invalid"]]) {
    assert.throws(() => giftPeriodBounds(period, date, now));
  }
});

test("period totals apply indexed half-open timestamps without scanning documents", () => {
  const bounds = giftPeriodBounds("month","2026-10-15",new Date("2026-10-27T22:00:00Z"));
  const request = giftTotalsAggregationRequest(bounds);
  assert.deepEqual(request.structuredAggregationQuery.structuredQuery.where, {
    compositeFilter: {op:"AND",filters:[
      {fieldFilter:{field:{fieldPath:"createdAt"},op:"GREATER_THAN_OR_EQUAL",value:{timestampValue:"2026-10-01T00:00:00.000Z"}}},
      {fieldFilter:{field:{fieldPath:"createdAt"},op:"LESS_THAN",value:{timestampValue:"2026-11-01T00:00:00.000Z"}}},
    ]},
  });
});

test("custom gift totals date range is inclusive and capped to 31 days", () => {
  const now = new Date("2026-10-27T20:00:00Z");
  assert.deepEqual(giftCustomRangeBounds("2026-10-01", "2026-10-27", now), {
    start: "2026-10-01T00:00:00.000Z",
    end: "2026-10-28T00:00:00.000Z",
  });
  assert.deepEqual(giftCustomRangeBounds("2026-02-28", "2026-03-01", now), {
    start: "2026-02-28T00:00:00.000Z",
    end: "2026-03-02T00:00:00.000Z",
  });
  for (const [start, end] of [
    ["2026-10-20","2026-10-19"], ["2026-09-01","2026-10-27"],
    ["2027-01-01","2027-01-01"], ["2026-02-30","2026-03-01"],
    ["2024-05-01","2024-05-03"], ["2026-10-27","2026-10-28"],
  ]) assert.throws(() => giftCustomRangeBounds(start, end, now));
});

test("custom period reuses permission-checked, cached, read-only receipt totals", () => {
  const source = readFileSync(new URL("../../cloudflare-worker/src/legacy-economy/gift-catalog.js", import.meta.url), "utf8");
  const handler = source.slice(source.indexOf('if (action === "statsTotals")'), source.indexOf('if (action === "statsRecent")'));
  assert.match(handler, /giftCustomRangeBounds\(startDate, endDate\)/);
  assert.match(handler, /readGiftTransactionTotals\(bounds\)/);
  assert.match(handler, /ttlMs: 5 \* 60_000/);
  assert.doesNotMatch(handler, /collection\("gift_transactions"\)\.get\(/);
  const request = giftTotalsAggregationRequest(giftCustomRangeBounds("2026-10-03","2026-10-04",new Date("2026-10-27T20:00:00Z")));
  assert.equal(request.structuredAggregationQuery.structuredQuery.where.compositeFilter.filters.length, 2);
});
