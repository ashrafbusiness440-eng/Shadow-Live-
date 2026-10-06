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
    trialVipLevel: Number(user.trialVipLevel || 0),
    trialVipExpiresAtMs: timestampToEpochMs(user.trialVipExpiresAt),
    growthPoints: Number(user.vipGrowthPoints || 0),
    maintenancePoints: Number(user.vipMaintenancePoints || 0),
  };
}

export function vipUserPatch(state, now = new Date()) {
  const earnedExpiry = Number(state?.earnedVipExpiresAtMs || 0);
  const grantExpiry = Number(state?.adminGrantExpiresAtMs || 0);
  const trialExpiry = Number(state?.trialVipExpiresAtMs || 0);
  const source = String(state?.effectiveVipSource || "none");
  const effectiveExpiry =
    source === "admin_grant" ? grantExpiry :
    source === "progression" ? earnedExpiry :
    source === "trial" ? trialExpiry :
    0;

  return {
    earnedVipLevel: Number(state?.earnedVipLevel || 0),
    effectiveVipLevel: Number(state?.effectiveVipLevel || 0),
    adminGrantVipLevel: Number(state?.adminGrantVipLevel || 0),
    trialVipLevel: Number(state?.trialVipLevel || 0),
    earnedVipExpiresAt: earnedExpiry > 0 ? new Date(earnedExpiry) : null,
    adminGrantExpiresAt: grantExpiry > 0 ? new Date(grantExpiry) : null,
    trialVipExpiresAt: trialExpiry > 0 ? new Date(trialExpiry) : null,
    effectiveVipSource: source,
    vipGrowthPoints: Number(state?.growthPoints || 0),
    vipMaintenancePoints: Number(state?.maintenancePoints || 0),
    vipLevel: Number(state?.effectiveVipLevel || 0),
    vipExpiresAt: effectiveExpiry > 0 ? new Date(effectiveExpiry) : null,
    vipSource: source,
    vipUpdatedAt: now,
  };
}


export function activeEffectiveVipLevelFromUser(
  user = {},
  nowMs = Date.now(),
) {
  const now = Number(nowMs);
  const clampLevel = (value) =>
    Math.max(0, Math.min(10, Number(value || 0) || 0));

  const earnedLevel = clampLevel(user.earnedVipLevel);
  const earnedExpiry = timestampToEpochMs(user.earnedVipExpiresAt);
  const activeEarned =
    earnedLevel > 0 && (earnedExpiry === 0 || earnedExpiry > now)
      ? earnedLevel
      : 0;

  const adminLevel = clampLevel(user.adminGrantVipLevel);
  const adminExpiry = timestampToEpochMs(user.adminGrantExpiresAt);
  const activeAdmin =
    adminLevel > 0 && adminExpiry > now ? adminLevel : 0;

  const trialLevel = clampLevel(user.trialVipLevel);
  const trialExpiry = timestampToEpochMs(user.trialVipExpiresAt);
  const activeTrial =
    trialLevel > 0 && trialExpiry > now ? trialLevel : 0;

  const sourced = Math.max(activeEarned, activeAdmin, activeTrial);
  if (sourced > 0) return sourced;

  // Backward-compatible fallback for legacy users that only have the
  // materialized effective fields.
  const legacyLevel = clampLevel(
    user.effectiveVipLevel ?? user.vipLevel,
  );
  if (legacyLevel <= 0) return 0;
  const legacyExpiry = timestampToEpochMs(user.vipExpiresAt);
  return legacyExpiry > now ? legacyLevel : 0;
}

export function vipPublicProfilePatch(state, now = new Date()) {
  const userPatch = vipUserPatch(state, now);
  return {
    vipLevel: userPatch.effectiveVipLevel,
    effectiveVipLevel: userPatch.effectiveVipLevel,
    vipExpiresAt: userPatch.vipExpiresAt,
    updatedAt: now,
  };
}
