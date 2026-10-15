import { activeHiddenRoomEntry, activeRoomGhostMode } from "./vip-entitlements.js";
import { activeMysteriousIdentity } from "./mysterious-identity.js";
import { roomEntryRestricted } from "./room-chat-restriction.js";
import { realtimeUserPresentFromNamespace } from "./room-presence-authority.js";

const clean = (x) => String(x ?? "").trim();
const UID_RE = /^[A-Za-z0-9:_-]{1,160}$/;
const ROOM_RE = /^[A-Za-z0-9_-]{1,180}$/;
export const MAX_FOLLOW_TARGETS = 8;

function activeRoomBan(ban, nowMs) {
  if (!ban?.exists) return false;
  const data = ban.data || {};
  const expiration = data.expiresAt;
  const expiry = typeof expiration === "string"
    ? Date.parse(expiration)
    : typeof expiration?.seconds === "number"
      ? expiration.seconds * 1000
      : Number(expiration || 0);
  return data.permanent === true || (Number.isFinite(expiry) && expiry > nowMs);
}

export function mayOfferRoomFollow({
  viewerUid, targetUid, roomId, room = {}, viewer = {}, target = {},
  blocked = false, banned = false,
  nowMs = Date.now(),
}) {
  if (!UID_RE.test(clean(viewerUid)) || !UID_RE.test(clean(targetUid)) ||
      !ROOM_RE.test(clean(roomId)) || viewerUid === targetUid) return false;
  if (blocked || banned || room.isActive === false ||
      room.isHidden === true || room.visibility === "hidden" ||
      room.visibility === "private" || room.visibility === "friends") return false;
  if (viewer.accountStatus && viewer.accountStatus !== "active") return false;
  if (target.accountStatus && target.accountStatus !== "active") return false;
  if (roomEntryRestricted(viewer)) return false;
  if (activeMysteriousIdentity(target, nowMs) ||
      activeHiddenRoomEntry(target, nowMs) ||
      activeRoomGhostMode(target, nowMs) ||
      target.hideRoomLocation === true ||
      target.disableRoomFollow === true) return false;
  return true;
}

async function singleFollowTarget(db, namespace, viewerUid, viewer, targetUid, nowMs) {
  if (!UID_RE.test(targetUid) || viewerUid === targetUid) return null;
  const index = await db.get(`user_room_index/${targetUid}`);
  const roomId = clean(index?.data?.roomId);
  if (!index?.exists || !ROOM_RE.test(roomId)) return null;

  // The index is ONLY a bounded locator. A user may have left since the
  // last join; DO socket membership is always the source of truth.
  const present = await realtimeUserPresentFromNamespace(
    namespace, roomId, targetUid,
  );
  if (present !== true) return null;

  const [room, target, outboundBlock, inboundBlock, roomBan] =
    await Promise.all([
      db.get(`rooms/${roomId}`),
      db.get(`users/${targetUid}`),
      db.get(`user_blocks/${viewerUid}/items/${targetUid}`),
      db.get(`user_blocks/${targetUid}/items/${viewerUid}`),
      db.get(`room_bans/${roomId}/users/${viewerUid}`),
    ]);
  if (!room?.exists || !target?.exists) return null;
  if (!mayOfferRoomFollow({
    viewerUid, targetUid, roomId, viewer, target: target.data,
    room: room.data,
    blocked: outboundBlock?.exists || inboundBlock?.exists,
    banned: activeRoomBan(roomBan, nowMs),
    nowMs,
  })) return null;

  const visibility = clean(room.data.visibility || "public");
  // A password room may be discoverable, but navigation must invoke the
  // EXISTING password gate; the resolver never grants entry or issues tickets.
  return {
    targetUid,
    roomId,
    roomName: clean(room.data.name || room.data.title || "غرفة صوتية").slice(0, 80),
    requiresPassword: visibility === "password" ||
      room.data.passwordProtected === true,
  };
}

// Single endpoint for chat headers, suggestions, visitors and inbox strip.
// Strict cap: 8 targets, one index read and at most 5 authorized metadata
// reads per candidate. No collection scans, per-avatar listeners or polling.
export async function resolveRoomFollowTargets(
  db, namespace, viewerUid, rawTargets = [], nowMs = Date.now(),
) {
  const targets = Array.from(new Set(
    (Array.isArray(rawTargets) ? rawTargets : [])
      .map(clean).filter((uid) => UID_RE.test(uid) && uid !== viewerUid),
  )).slice(0, MAX_FOLLOW_TARGETS);
  if (!UID_RE.test(clean(viewerUid)) || targets.length === 0) {
    return [];
  }
  const viewerSnap = await db.get(`users/${viewerUid}`);
  if (!viewerSnap?.exists || roomEntryRestricted(viewerSnap.data || {})) {
    return [];
  }
  const results = [];
  for (let i = 0; i < targets.length; i += 4) {
    const batch = await Promise.all(targets.slice(i, i + 4).map(
      (uid) => singleFollowTarget(
        db, namespace, viewerUid, viewerSnap.data || {}, uid, nowMs,
      ).catch(() => null),
    ));
    results.push(...batch.filter(Boolean));
  }
  return results;
}
