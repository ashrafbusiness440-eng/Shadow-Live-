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

export async function realtimeRoomParticipantsFromNamespace(
  namespace,
  roomId,
  limit = 24,
  requiredUid = "",
) {
  const stub = realtimeRoomStub(namespace, roomId);
  if (!stub) return null;
  const boundedLimit = Math.max(
    1,
    Math.min(64, Math.floor(Number(limit) || 24)),
  );

  try {
    const target = new URL(
      "https://room-realtime.internal/presence/bounded",
    );
    target.searchParams.set("limit", String(boundedLimit));
    const normalizedRequiredUid = clean(requiredUid);
    if (normalizedRequiredUid) {
      target.searchParams.set("requiredUid", normalizedRequiredUid);
    }
    const response = await stub.fetch(target.toString());
    if (!response.ok) return null;
    const body = await response.json().catch(() => ({}));
    const participants = Array.isArray(body.participants)
      ? body.participants
          .filter((item) => item && typeof item === "object")
          .slice(0, boundedLimit)
      : [];
    return {
      participants,
      onlineCount: Math.max(0, Number(body.onlineCount || 0)),
      truncated: body.truncated === true,
      requiredUidPresent:
        typeof body.requiredUidPresent === "boolean"
          ? body.requiredUidPresent
          : null,
    };
  } catch (_) {
    return null;
  }
}

export async function realtimeResolveRoomUidsFromNamespace(
  namespace,
  roomId,
  uids = [],
) {
  const stub = realtimeRoomStub(namespace, roomId);
  const requested = Array.from(
    new Set(
      (Array.isArray(uids) ? uids : [])
        .map(clean)
        .filter(Boolean),
    ),
  ).slice(0, 24);
  if (!stub || requested.length === 0) return null;

  try {
    const response = await stub.fetch(
      "https://room-realtime.internal/presence/resolve",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ uids: requested }),
      },
    );
    if (!response.ok) return null;
    const body = await response.json().catch(() => ({}));
    if (Array.isArray(body.presentUids)) {
      return Array.from(
        new Set(
          body.presentUids
            .map(clean)
            .filter((uid) => requested.includes(uid)),
        ),
      );
    }

    // Backward compatibility for an older realtime room object that only
    // exposes /presence/has. Current production resolves all requested UIDs
    // in the single bounded POST above; this path is used only when that
    // endpoint is unavailable during a rolling upgrade.
    if (typeof body.present === "boolean") {
      const checks = await Promise.all(
        requested.map(async (uid) => {
          const target = new URL(
            "https://room-realtime.internal/presence/has",
          );
          target.searchParams.set("uid", uid);
          const fallback = await stub.fetch(target.toString());
          if (!fallback.ok) return null;
          const payload = await fallback.json().catch(() => ({}));
          return payload.present === true ? uid : null;
        }),
      );
      return checks.filter(Boolean);
    }
    return null;
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
