const clean = (value) => String(value ?? "").trim();

function validRoomId(value) {
  return /^[A-Za-z0-9_-]{1,180}$/.test(clean(value));
}

export function realtimeRoomStub(namespace, roomId) {
  if (!namespace || !validRoomId(roomId)) return null;
  try {
    return namespace.get(namespace.idFromName(clean(roomId)));
  } catch (_) {
    return null;
  }
}

export async function realtimeUserPresentFromNamespace(
  namespace,
  roomId,
  uid,
) {
  const targetUid = clean(uid);
  const stub = realtimeRoomStub(namespace, roomId);
  if (!stub || !targetUid) return null;

  try {
    const target = new URL("https://room-realtime.internal/presence/has");
    target.searchParams.set("uid", targetUid);
    const response = await stub.fetch(target.toString());
    if (!response.ok) return null;
    const body = await response.json().catch(() => ({}));
    return body.present === true;
  } catch (_) {
    return null;
  }
}

export function legacyPresenceFresh(
  snapshot,
  nowMs = Date.now(),
  ttlMs = 90_000,
) {
  if (!snapshot?.exists) return false;
  const data =
    typeof snapshot.data === "function"
      ? snapshot.data() || {}
      : snapshot.data || {};
  const lastSeenAtMs = Number(data.lastSeenAtMs || 0);
  return (
    Number.isFinite(lastSeenAtMs) &&
    lastSeenAtMs > 0 &&
    Math.max(0, Number(nowMs || 0)) - lastSeenAtMs <=
      Math.max(1, Number(ttlMs || 90_000))
  );
}
