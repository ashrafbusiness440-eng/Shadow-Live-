// A single index-based Firestore aggregation over existing financial receipts.
// No transaction document downloads, global counters, cron jobs or extra
// payment-path writes. Aggregate calculations never change the ledger.
export const GIFT_TOTALS_COLLECTION = "gift_transactions";

export function giftTotalsAggregationRequest() {
  return {
    structuredAggregationQuery: {
      structuredQuery: {
        from: [{ collectionId: GIFT_TOTALS_COLLECTION }],
      },
      aggregations: [
        { alias: "receipts", count: {} },
        { alias: "gifts", sum: { field: { fieldPath: "quantity" } } },
        { alias: "faceCoins", sum: { field: { fieldPath: "totalCost" } } },
        { alias: "paidCoins", sum: { field: { fieldPath: "paidCost" } } },
      ],
    },
  };
}

function safeTotal(value, name) {
  if (!value || typeof value !== "object") {
    throw Error("gift_aggregate_missing_" + name);
  }
  const primitive = value.integerValue ?? value.doubleValue;
  const total = Number(primitive);
  if (!Number.isSafeInteger(total) || total < 0) {
    // Never silently round money that has exceeded JS safe integer range.
    throw Error("gift_aggregate_invalid_" + name);
  }
  return total;
}

export function parseGiftTotalsAggregationResponse(response) {
  if (!Array.isArray(response)) throw Error("gift_aggregate_response_missing");
  const record = response.find((entry) => entry?.result?.aggregateFields);
  if (!record) throw Error("gift_aggregate_response_missing");
  const fields = record.result.aggregateFields;
  const receipts = safeTotal(fields.receipts, "receipts");
  const gifts = safeTotal(fields.gifts, "gifts");
  const faceCoins = safeTotal(fields.faceCoins, "faceCoins");
  const paidCoins = safeTotal(fields.paidCoins, "paidCoins");
  if (paidCoins > faceCoins) throw Error("gift_aggregate_inconsistent");
  return {
    receipts,
    gifts,
    faceCoins,
    paidCoins,
    giftBagCoins: faceCoins - paidCoins,
    // These totals cover only the gift_transactions collection. They do NOT
    // imply all legacy gifts outside that financial ledger were counted.
    scope: "gift_transactions_collection",
    readTime: String(record.readTime || "").slice(0, 40),
  };
}
