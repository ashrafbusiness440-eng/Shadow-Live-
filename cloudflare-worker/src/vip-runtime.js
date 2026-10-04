export function timestampToEpochMs(value) {
  if (value == null || value === "") return 0;
  if (value instanceof Date) {
    const ms = value.getTime();
    return Number.isSafeInteger(ms) && ms >= 0 ? ms : 0;
  }
  if (typeof value?.toMillis === "function") {
    const ms = Number(value.toMillis());
    return Number.isSafeInteger(ms) && ms >= 0 ? ms : 0;
  }
  if (typeof value === "string") {
    const ms = Date.parse(value);
    return Number.isSafeInteger(ms) && ms >= 0 ? ms : 0;
  }
  const ms = Number(value);
  return Number.isSafeInteger(ms) && ms >= 0 ? ms : 0;
}

export function vipStateFromUser(user = {}) {
  return {
    earnedVipLevel: Number(user.earnedVipLevel || 0),
    earnedVipExpiresAtMs: timestampToEpochMs(user.earnedVipExpiresAt),
    adminGrantVipLevel: Number(user.adminGrantVipLevel || 0),
    adminGrantExpiresAtMs: timestampToEpochMs(user.adminGrantExpiresAt),
    growthPoints: Number(user.vipGrowthPoints || 0),
    maintenancePoints: Number(user.vipMaintenancePoints || 0),
  };
}

export function vipUserPatch(state, now = new Date()) {
  const earnedExpiry = Number(state?.earnedVipExpiresAtMs || 0);
  const grantExpiry = Number(state?.adminGrantExpiresAtMs || 0);
  const source = String(state?.effectiveVipSource || "none");
  const effectiveExpiry =
    source === "admin_grant" ? grantExpiry :
    source === "progression" ? earnedExpiry :
    0;

  return {
    earnedVipLevel: Number(state?.earnedVipLevel || 0),
    effectiveVipLevel: Number(state?.effectiveVipLevel || 0),
    adminGrantVipLevel: Number(state?.adminGrantVipLevel || 0),
    earnedVipExpiresAt: earnedExpiry > 0 ? new Date(earnedExpiry) : null,
    adminGrantExpiresAt: grantExpiry > 0 ? new Date(grantExpiry) : null,
    effectiveVipSource: source,
    vipGrowthPoints: Number(state?.growthPoints || 0),
    vipMaintenancePoints: Number(state?.maintenancePoints || 0),
    vipLevel: Number(state?.effectiveVipLevel || 0),
    vipExpiresAt: effectiveExpiry > 0 ? new Date(effectiveExpiry) : null,
    vipSource: source,
    vipUpdatedAt: now,
  };
}
