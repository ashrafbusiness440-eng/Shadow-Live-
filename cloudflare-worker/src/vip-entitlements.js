import { activeEffectiveVipLevelFromUser } from "./vip-runtime.js";

const clean = (value) => String(value ?? "").trim();

export const VIP_ENTITLEMENT_LEVELS = Object.freeze({
  hideOnlineStatus: 5,
  hideRoomPresence: 5,
  kickProtection: 6,
  hiddenRoomEntry: 7,
  hideRankingLists: 7,
  entryStrip: 8,
  roomEntryBroadcast: 9,
  hideProfileVisits: 9,
  muteProtection: 10,
});

export function vipEntitlementsFromUser(user = {}, nowMs = Date.now()) {
  const level = activeEffectiveVipLevelFromUser(user, nowMs);
  return {
    level,
    hideOnlineStatus: level >= VIP_ENTITLEMENT_LEVELS.hideOnlineStatus,
    hideRoomPresence: level >= VIP_ENTITLEMENT_LEVELS.hideRoomPresence,
    kickProtection: level >= VIP_ENTITLEMENT_LEVELS.kickProtection,
    hiddenRoomEntry: level >= VIP_ENTITLEMENT_LEVELS.hiddenRoomEntry,
    hideRankingLists: level >= VIP_ENTITLEMENT_LEVELS.hideRankingLists,
    entryStrip: level >= VIP_ENTITLEMENT_LEVELS.entryStrip,
    roomEntryBroadcast: level >= VIP_ENTITLEMENT_LEVELS.roomEntryBroadcast,
    hideProfileVisits: level >= VIP_ENTITLEMENT_LEVELS.hideProfileVisits,
    muteProtection: level >= VIP_ENTITLEMENT_LEVELS.muteProtection,
  };
}

export function canOverrideVipRoomProtection(user = {}) {
  return canInspectHiddenRoomPresence(user);
}

export function canInspectHiddenRankingLists(user = {}) {
  const role = clean(user.role);
  if (role === "owner") return true;
  if (user.adminEnabled !== true) return false;
  const capabilities = new Set(
    Array.isArray(user.capabilities)
      ? user.capabilities.map(clean).filter(Boolean)
      : [],
  );
  return (
    capabilities.has("reviewReports") ||
    capabilities.has("manageUsers") ||
    capabilities.has("manageUserLevels") ||
    capabilities.has("globalRoomControl") ||
    capabilities.has("manageRooms")
  );
}

export function canInspectHiddenRoomPresence(user = {}) {
  const role = clean(user.role);
  if (role === "owner") return true;
  if (user.adminEnabled !== true) return false;
  const capabilities = new Set(
    Array.isArray(user.capabilities)
      ? user.capabilities.map(clean).filter(Boolean)
      : [],
  );
  return (
    capabilities.has("globalRoomControl") ||
    capabilities.has("manageRooms") ||
    capabilities.has("reviewReports") ||
    capabilities.has("manageUsers")
  );
}

export function canUseRoomGhostMode(user = {}, nowMs = Date.now()) {
  return (
    vipEntitlementsFromUser(user, nowMs).hideRoomPresence ||
    canInspectHiddenRoomPresence(user)
  );
}

export function activeRoomGhostMode(user = {}, nowMs = Date.now()) {
  return user.roomGhostMode === true && canUseRoomGhostMode(user, nowMs);
}

export function canUseHiddenRoomEntry(user = {}, nowMs = Date.now()) {
  return vipEntitlementsFromUser(user, nowMs).hiddenRoomEntry;
}

export function activeHiddenRoomEntry(user = {}, nowMs = Date.now()) {
  return (
    user.roomHiddenEntry === true &&
    vipEntitlementsFromUser(user, nowMs).hiddenRoomEntry
  );
}

export function canUseRankingListHiding(user = {}, nowMs = Date.now()) {
  return vipEntitlementsFromUser(user, nowMs).hideRankingLists;
}

export function activeHideRankingLists(user = {}, nowMs = Date.now()) {
  return (
    user.hideRankingLists === true &&
    canUseRankingListHiding(user, nowMs)
  );
}
