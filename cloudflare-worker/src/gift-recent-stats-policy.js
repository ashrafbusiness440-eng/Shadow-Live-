// Read-only report over bounded, idempotent gift_transactions records.
// This is intentionally NOT an all-time aggregate. Reporting an estimated
// global total from a small page of ledger rows would be misleading.
const asInt = (value) => {
  const number = Number(value);
  return Number.isSafeInteger(number) && number >= 0 ? number : 0;
};
const text = (value, max = 80) => String(value ?? "").trim().slice(0, max);
export const GIFT_STATS_PAGE_LIMIT = 30;

export function safeGiftTransactionRow(id, raw = {}) {
  const context = text(raw.contextType, 20);
  return {
    id: text(id, 180),
    giftId: text(raw.giftId, 64),
    giftName: text(raw.giftName || "هدية", 80),
    context: ["room", "chat", "diary"].includes(context) ? context : "unknown",
    quantity: asInt(raw.quantity),
    totalCoins: asInt(raw.totalCost),
    paidCoins: asInt(raw.paidCost),
    fromBag: raw.useGiftBag === true,
    createdAtMs:
      typeof raw.createdAt?.toMillis === "function"
        ? asInt(raw.createdAt.toMillis())
        : asInt(raw.createdAtMs),
  };
}

export function summarizeRecentGiftTransactions(rows = []) {
  const byGift = new Map();
  let totalCoins = 0;
  let paidCoins = 0;
  let quantities = 0;
  const contexts = { room: 0, chat: 0, diary: 0, unknown: 0 };
  for (const row of rows) {
    // A multi-recipient room transaction is one ledger entry per recipient.
    // Reporting here counts entries, not unique idempotency keys.
    totalCoins += asInt(row.totalCoins);
    paidCoins += asInt(row.paidCoins);
    quantities += asInt(row.quantity);
    const context = Object.hasOwn(contexts, row.context) ? row.context : "unknown";
    contexts[context] += 1;
    const giftId = text(row.giftId, 64);
    if (!giftId) continue;
    const state = byGift.get(giftId) || {
      giftId, giftName: text(row.giftName) || giftId,
      entries: 0, quantity: 0, totalCoins: 0,
    };
    state.entries += 1;
    state.quantity += asInt(row.quantity);
    state.totalCoins += asInt(row.totalCoins);
    byGift.set(giftId, state);
  }
  return {
    entries: rows.length,
    quantities,
    totalCoins,
    paidCoins,
    contexts,
    topGifts: [...byGift.values()]
      .sort((a, b) => b.quantity - a.quantity || a.giftId.localeCompare(b.giftId))
      .slice(0, 10),
  };
}
