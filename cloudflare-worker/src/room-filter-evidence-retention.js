// One fixed-size Durable Object ring of room content-filter flags.
// The retention clock starts when a human marks a flag reviewed.
// Unknown historic timestamps are preserved rather than guessed.
export const ROOM_FILTER_EVIDENCE_RETENTION_MS = 90 * 24 * 60 * 60 * 1000;
export const ROOM_FILTER_FLAG_RING_SIZE = 1000;
export const ROOM_FILTER_FLAG_PURGE_BATCH = 25;

export function roomFlagEvidenceExpired(item = {}, nowMs = Date.now()) {
  const reviewedAtMs = Number(item.reviewedAtMs || 0);
  return item.status === "reviewed" &&
    Number.isFinite(reviewedAtMs) && reviewedAtMs > 0 &&
    reviewedAtMs + ROOM_FILTER_EVIDENCE_RETENTION_MS <= nowMs;
}

// Never return the original text in a flag list, including to the caller
// who has ordinary report permissions. Only a distinct audited endpoint
// can reveal the original; the server enforces its expiry before disclosure.
export function roomFlagPublicItem(item = {}, nowMs = Date.now()) {
  const { evidence, ...publicFields } = item;
  return {
    ...publicFields,
    hasSensitiveEvidence: Boolean(evidence?.text) &&
      !roomFlagEvidenceExpired(item, nowMs),
  };
}
