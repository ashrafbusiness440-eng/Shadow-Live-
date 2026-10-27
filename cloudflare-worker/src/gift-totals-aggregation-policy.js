// A single index-based Firestore aggregation over existing financial receipts.
// No transaction document downloads, global counters, cron jobs or extra
// payment-path writes. Aggregate calculations never change the ledger.
export const GIFT_TOTALS_COLLECTION = "gift_transactions";

// UTC calendar reporting only; bounded indexed filters and no raw receipt reads.
export function giftPeriodBounds(period, date, now = new Date()) {
  if (!["day", "month"].includes(period) || typeof date !== "string" ||
      !/^\d{4}-\d{2}-\d{2}$/.test(date)) throw Error("invalid_gift_report_period");
  const day = new Date(date + "T00:00:00.000Z");
  if (!Number.isFinite(day.getTime()) ||
      day.toISOString().slice(0, 10) !== date) throw Error("invalid_gift_report_date");
  const year = day.getUTCFullYear(), month = day.getUTCMonth();
  const start = period === "month" ? new Date(Date.UTC(year, month, 1)) : day;
  const end = period === "month"
    ? new Date(Date.UTC(year, month + 1, 1))
    : new Date(day.getTime() + 86400000);
  if (start.getTime() > now.getTime() ||
      now.getTime() - start.getTime() > 366 * 86400000) {
    throw Error("gift_report_period_out_of_range");
  }
  return {start: start.toISOString(), end: end.toISOString()};
}

export function giftTotalsAggregationRequest(bounds = null) {
  return {
    structuredAggregationQuery: {
      structuredQuery: {
        from: [{ collectionId: GIFT_TOTALS_COLLECTION }],
        ...(bounds ? {where: {compositeFilter: {op: "AND", filters: [
          {fieldFilter: {field: {fieldPath: "createdAt"}, op: "GREATER_THAN_OR_EQUAL", value: {timestampValue: bounds.start}}},
          {fieldFilter: {field: {fieldPath: "createdAt"}, op: "LESS_THAN", value: {timestampValue: bounds.end}}},
        ]}}} : {}),
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
    nonPaidCoins: faceCoins - paidCoins,
    // These totals cover only the gift_transactions collection. They do NOT
    // imply all legacy gifts outside that financial ledger were counted.
    scope: "gift_transactions_collection",
    readTime: String(record.readTime || "").slice(0, 40),
  };
}
