// Exact per-gift lifetime aggregation is paginated over immutable catalog IDs.
// This is *not* a historical global leaderboard: orphan legacy IDs may exist
// outside the catalog, and partial pages must never be called "Top 10".
export const GIFT_RANK_PAGE_LIMIT = 6;
export const GIFT_RANK_CATALOG_LIMIT = 100;

export function catalogGiftRankingPage(config, offset, expectedRevision = null, includeHidden = false) {
  const raw = Array.isArray(config?.gifts) ? config.gifts : [];
  const revision = Number(config?.revision ?? 0);
  if (!Number.isSafeInteger(revision) || revision < 0 ||
      raw.length > GIFT_RANK_CATALOG_LIMIT) {
    throw Error("invalid_gift_report_catalog");
  }
  if (!Number.isSafeInteger(offset) || offset < 0 ||
      offset > GIFT_RANK_CATALOG_LIMIT ||
      offset % GIFT_RANK_PAGE_LIMIT !== 0) {
    throw Error("invalid_gift_ranking_offset");
  }
  if (expectedRevision != null && expectedRevision !== revision) {
    throw Error("gift_catalog_conflict");
  }
  const gifts = raw.filter((gift) => includeHidden || gift?.enabled !== false).map((gift) => ({
    giftId: String(gift?.id ?? ""),
    giftName: String(gift?.nameAr || "هدية").slice(0, 80),
  }));
  if (gifts.some((gift) => !/^[a-z0-9_]{2,64}$/.test(gift.giftId)) ||
      new Set(gifts.map((gift) => gift.giftId)).size !== gifts.length) {
    throw Error("invalid_gift_report_catalog");
  }
  gifts.sort((a, b) => a.giftId.localeCompare(b.giftId));
  const page = gifts.slice(offset, offset + GIFT_RANK_PAGE_LIMIT);
  return {
    revision, total: gifts.length, offset,
    page, nextOffset: offset + page.length,
    hasMore: offset + page.length < gifts.length,
  };
}
