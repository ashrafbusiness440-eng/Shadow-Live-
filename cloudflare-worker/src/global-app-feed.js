export const GLOBAL_APP_FEED_STORAGE_PREFIX = "global:event:";
export const GLOBAL_APP_FEED_MAX_EVENTS = 20;
export const GLOBAL_APP_FEED_RETAIN_MS = 120_000;

const clean = (value) => String(value ?? "").trim();

function integer(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.trunc(n) : fallback;
}

export function globalAppFeedStorageKey(eventId) {
  const id = clean(eventId)
    .replace(/[^A-Za-z0-9_.-]/g, "_")
    .slice(0, 220);
  return id ? `${GLOBAL_APP_FEED_STORAGE_PREFIX}${id}` : "";
}

export function normalizeGlobalAppFeedEvent(raw, nowMs = Date.now()) {
  if (!raw || typeof raw !== "object") return null;
  const eventId = clean(raw.eventId || raw.id);
  const kind = clean(raw.kind);
  const startsAtMs = integer(raw.startsAtMs);
  const endsAtMs = integer(raw.endsAtMs);
  if (
    !eventId ||
    kind !== "vip10_global_entry" ||
    startsAtMs <= 0 ||
    endsAtMs <= startsAtMs ||
    endsAtMs + GLOBAL_APP_FEED_RETAIN_MS <= nowMs
  ) {
    return null;
  }
  return {
    eventId,
    kind,
    startsAtMs,
    endsAtMs,
    uid: clean(raw.uid),
    displayName: clean(raw.displayName) || "مستخدم Shadow Live",
    profileImageUrl: clean(raw.profileImageUrl),
    publicId: clean(raw.publicId),
    vipLevel: Math.max(0, Math.min(10, integer(raw.vipLevel))),
    assetKey: clean(raw.assetKey),
  };
}

export function globalAppFeedRetainUntilMs(event) {
  return Math.max(integer(event?.endsAtMs), 0) + GLOBAL_APP_FEED_RETAIN_MS;
}
