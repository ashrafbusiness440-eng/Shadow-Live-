export const ROCKET_FEED_SHARD_COUNT = 16;
export const ROCKET_FEED_ROOM_PREFIX = "global-rocket-feed-v1-";
export const ROCKET_FEED_STORAGE_PREFIX = "rocket:event:";
export const ROCKET_FEED_RETAIN_AFTER_END_MS = 120_000;
export const ROCKET_FEED_MAX_EVENTS = 80;

function clean(value) {
  return String(value ?? "").trim();
}

function integer(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.trunc(n) : fallback;
}

export function rocketFeedShardForUid(uid) {
  const value = clean(uid);
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) % ROCKET_FEED_SHARD_COUNT;
}

export function rocketFeedRoomIdForShard(shard) {
  const normalized = Math.max(
    0,
    Math.min(ROCKET_FEED_SHARD_COUNT - 1, integer(shard, 0)),
  );
  return `${ROCKET_FEED_ROOM_PREFIX}${normalized}`;
}

export function rocketFeedRoomIdForUid(uid) {
  return rocketFeedRoomIdForShard(rocketFeedShardForUid(uid));
}

export function rocketFeedRoomIds() {
  return Array.from(
    { length: ROCKET_FEED_SHARD_COUNT },
    (_, shard) => rocketFeedRoomIdForShard(shard),
  );
}

export function rocketFeedStorageKey(explosionId) {
  const id = clean(explosionId)
    .replace(/[^A-Za-z0-9_.-]/g, "_")
    .slice(0, 220);
  return id ? `${ROCKET_FEED_STORAGE_PREFIX}${id}` : "";
}

export function normalizeRocketFeedEvent(raw, nowMs = Date.now()) {
  if (!raw || typeof raw !== "object") return null;
  const id = clean(raw.explosionId || raw.id);
  const roomId = clean(raw.roomId);
  const startsAtMs = integer(raw.startsAtMs);
  const endsAtMs = integer(raw.endsAtMs);
  if (
    !id ||
    !roomId ||
    startsAtMs <= 0 ||
    endsAtMs <= startsAtMs ||
    endsAtMs + ROCKET_FEED_RETAIN_AFTER_END_MS <= nowMs
  ) {
    return null;
  }

  const contributorIds = Array.isArray(raw.contributorIds)
    ? raw.contributorIds
        .map(clean)
        .filter(Boolean)
        .slice(0, 500)
    : [];
  const top3 = Array.isArray(raw.top3)
    ? raw.top3
        .slice(0, 3)
        .map((item) => ({
          uid: clean(item?.uid),
          displayName: clean(item?.displayName),
          profileImageUrl: clean(item?.profileImageUrl),
          mysteriousMode: item?.mysteriousMode === true,
          mysteriousId: clean(item?.mysteriousId).slice(0, 9),
        }))
        .filter((item) => item.uid)
    : [];

  return {
    explosionId: id,
    roomId,
    level: Math.max(0, integer(raw.level)),
    startsAtMs,
    endsAtMs,
    triggerUid: clean(raw.triggerUid),
    triggerDisplayName: clean(raw.triggerDisplayName) || "مستخدم Shadow Live",
    triggerProfileImageUrl: clean(raw.triggerProfileImageUrl),
    triggerMysteriousMode: raw.triggerMysteriousMode === true,
    triggerMysteriousId: clean(raw.triggerMysteriousId).slice(0, 9),
    contributorIds,
    top3,
  };
}

export function rocketFeedRetainUntilMs(event) {
  return Math.max(
    integer(event?.endsAtMs),
    0,
  ) + ROCKET_FEED_RETAIN_AFTER_END_MS;
}
