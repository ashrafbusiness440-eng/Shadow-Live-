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
  const supportedKinds = new Set([
    "vip10_global_entry",
    "vip_level_upgrade",
    "game_win",
    "relationship_level_up",
    "premium_gift",
  ]);
  if (
    !eventId ||
    !supportedKinds.has(kind) ||
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
    secondaryUid: clean(raw.secondaryUid),
    secondaryDisplayName: clean(raw.secondaryDisplayName),
    secondaryProfileImageUrl: clean(raw.secondaryProfileImageUrl),
    relationshipType: clean(raw.relationshipType),
    relationshipLevel: Math.max(0, integer(raw.relationshipLevel)),
    giftId: clean(raw.giftId),
    giftName: clean(raw.giftName),
    giftQuantity: Math.max(0, integer(raw.giftQuantity)),
    giftTotalCoins: Math.max(0, integer(raw.giftTotalCoins)),
    payoutCoins: Math.max(0, integer(raw.payoutCoins)),
    roomId: clean(raw.roomId),
    messageAr: clean(raw.messageAr).slice(0, 160),
  };
}

export function globalAppFeedRetainUntilMs(event) {
  return Math.max(integer(event?.endsAtMs), 0) + GLOBAL_APP_FEED_RETAIN_MS;
}
