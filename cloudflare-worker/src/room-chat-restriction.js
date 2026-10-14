import { timestampToEpochMs } from "./vip-runtime.js";

// One authoritative user field, read by both the realtime room transport
// and the existing legacy room chat endpoint. Expiry is evaluated on use.
export function roomChatRestricted(user = {}, nowMs = Date.now()) {
  return timestampToEpochMs(user?.roomChatRestrictedUntil) > nowMs;
}

// No listeners, polling or unbounded user scans. Concurrent messages for the
// same sender share a single read; the short cache expires lazily. An outage
// is propagated so the caller can fail closed instead of publishing a chat.
export function createRoomChatRestrictionGate(loadUser, {
  ttlMs = 5000,
  maxEntries = 128,
  now = () => Date.now(),
} = {}) {
  const cache = new Map();
  return async (uid) => {
    const id = String(uid || "").trim();
    if (!id) throw new Error("room_chat_sender_missing");
    const current = now();
    const existing = cache.get(id);
    if (existing?.pending) return existing.pending;
    if (existing && existing.expiresAtMs > current) {
      return existing.restrictedUntilMs > current;
    }

    const pending = Promise.resolve().then(() => loadUser(id))
      .then((user) => {
        if (!user || typeof user !== "object") {
          throw new Error("room_chat_user_unavailable");
        }
        const restrictedUntilMs = timestampToEpochMs(
          user.roomChatRestrictedUntil,
        );
        cache.delete(id);
        cache.set(id, {
          restrictedUntilMs,
          expiresAtMs: now() + Math.max(1000, Math.min(10000, ttlMs)),
        });
        while (cache.size > Math.max(1, Math.min(256, maxEntries))) {
          cache.delete(cache.keys().next().value);
        }
        return restrictedUntilMs > now();
      })
      .catch((error) => {
        cache.delete(id);
        throw error;
      });
    cache.set(id, { pending });
    return pending;
  };
}
