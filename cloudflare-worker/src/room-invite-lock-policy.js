// The password-invite exemption is a server-issued, recipient-bound grant.
// A room password rotation or newly-enabled lock invalidates all earlier grants.
const clean = (value) => String(value ?? "").trim();

export function roomPasswordLockVersion(room) {
  const raw = room?.passwordLockVersion;
  if (raw === undefined || raw === null || raw === "") return 0;
  const value = Number(raw);
  return Number.isSafeInteger(value) && value >= 0 ? value : 0;
}

export function nextRoomPasswordLockVersion(room, nextVisibility, password) {
  const current = roomPasswordLockVersion(room);
  const alreadyLocked = clean(room?.visibility) === "password";
  const mustRotate =
    clean(nextVisibility) === "password" &&
    (!alreadyLocked || String(password ?? "").length > 0);
  if (!mustRotate) return current;
  // Overflow must fail closed instead of ever reusing an old invitation epoch.
  if (current >= Number.MAX_SAFE_INTEGER) {
    throw new Error("room_lock_version_overflow");
  }
  return current + 1;
}

function timestampMs(value) {
  if (value instanceof Date) return value.getTime();
  if (typeof value?.toMillis === "function") return value.toMillis();
  if (typeof value === "string") {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

export function roomInviteAllowsPasswordAccess({
  room,
  invite,
  roomId,
  recipientUid,
  nowMs = Date.now(),
}) {
  if (clean(room?.visibility) !== "password") return false;
  if (!invite || invite.passwordProtectedAtIssue !== true) return false;
  if (clean(invite.roomId) !== clean(roomId)) return false;
  if (clean(invite.userId) !== clean(recipientUid)) return false;
  if (!clean(invite.invitedBy) || !clean(invite.inviteId)) return false;
  const issuedVersion = invite.passwordLockVersion;
  if (!Number.isSafeInteger(issuedVersion) || issuedVersion < 0) return false;
  if (issuedVersion !== roomPasswordLockVersion(room)) return false;
  const createdMs = timestampMs(invite.createdAt);
  const expiresMs = timestampMs(invite.expiresAt);
  const now = Number(nowMs);
  if (!Number.isFinite(now) || createdMs <= 0 || createdMs > now) return false;
  if (!Number.isFinite(expiresMs) || expiresMs <= now) return false;
  // This exemption is bounded to the existing 12-hour invitation lifetime.
  if (expiresMs <= createdMs ||
      expiresMs - createdMs > 12 * 60 * 60 * 1000 + 60000) {
    return false;
  }
  return true;
}
