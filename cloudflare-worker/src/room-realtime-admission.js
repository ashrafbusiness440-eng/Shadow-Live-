import { scryptSync, timingSafeEqual } from "node:crypto";
import { roomInviteAllowsPasswordAccess } from "./room-invite-lock-policy.js";

const clean = (value) => String(value ?? "").trim();

export function verifyRealtimeRoomPassword(room, candidate) {
  if (typeof candidate !== "string" || candidate.length < 4 || candidate.length > 32) return false;
  const salt = clean(room?.passwordSalt);
  const expectedHex = clean(room?.passwordHash);
  if (!salt || salt.length > 256 || !/^[a-f0-9]{128}$/i.test(expectedHex)) return false;
  try {
    const expected = Buffer.from(expectedHex, "hex");
    const actual = scryptSync(candidate, salt, 64);
    return expected.length === actual.length && timingSafeEqual(expected, actual);
  } catch {
    return false;
  }
}

function privilegedHiddenRoomViewer(user) {
  const capabilities = Array.isArray(user?.capabilities) ? user.capabilities : [];
  return (clean(user?.role) === "owner" && user?.ownerAbsoluteRoomAccess !== false) ||
    (user?.adminEnabled === true &&
      (capabilities.includes("manageRooms") || capabilities.includes("manage_rooms") ||
        capabilities.includes("canCreateHiddenRoom")));
}

// Realtime tickets are a separate admission path from voice credentials.
// Do not trust a caller-supplied invite, role, or "previously authorized" flag.
export async function authorizeRoomRealtimeTicket({
  room, roomId, uid, user, roomPassword = "", loadInvite,
  nowMs = Date.now(),
}) {
  const ownerUid = clean(room?.ownerUid || room?.ownerId || room?.hostId);
  if (ownerUid && ownerUid === clean(uid)) return { allowed: true };
  const visibility = clean(room?.visibility || "public");
  if (visibility === "hidden" || room?.isHidden === true) {
    return privilegedHiddenRoomViewer(user)
      ? { allowed: true }
      : { allowed: false, code: "room_private" };
  }
  if (visibility !== "password") return { allowed: true };
  if (verifyRealtimeRoomPassword(room, roomPassword)) return { allowed: true };

  // Read only one recipient-scoped invite for a password room if necessary.
  // A changed passwordLockVersion, revoked, expired or unrelated invite fails.
  const invite = await loadInvite();
  if (invite?.exists && roomInviteAllowsPasswordAccess({
    room, invite: invite.data, roomId, recipientUid: uid, nowMs,
  })) return { allowed: true };
  return { allowed: false, code: roomPassword ? "room_password_invalid" : "room_password_required" };
}
