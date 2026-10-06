import {
  applyVipGrowthCap,
  vipDowngradeState,
  vipLevelFromGrowth,
  vipMaintenanceThreshold,
  vipValidityDays,
} from "./vip-policy.js";

const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_EXPIRY_MATERIALIZATION_STEPS = 12;

function safeInt(value, fallback = 0) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number >= 0 ? number : fallback;
}

function level(value) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number >= 0 && number <= 10
    ? number
    : 0;
}

function futureExpiry(baseMs, days) {
  const base = safeInt(baseMs, 0);
  const durationDays = safeInt(days, 0);
  const result = base + durationDays * DAY_MS;
  return Number.isSafeInteger(result) ? result : null;
}

export function effectiveVipState(state, nowMs = Date.now()) {
  const now = safeInt(nowMs, Date.now());
  const earnedLevel = level(state?.earnedVipLevel);
  const earnedExpiry = safeInt(state?.earnedVipExpiresAtMs, 0);
  const earnedActive =
    earnedLevel > 0 && (earnedExpiry === 0 || earnedExpiry > now);

  const grantLevel = level(state?.adminGrantVipLevel);
  const grantExpiry = safeInt(state?.adminGrantExpiresAtMs, 0);
  const grantActive =
    grantLevel > 0 && grantExpiry > now;

  const trialLevel = level(state?.trialVipLevel);
  const trialExpiry = safeInt(state?.trialVipExpiresAtMs, 0);
  const trialActive =
    trialLevel > 0 && trialExpiry > now;

  const activeEarned = earnedActive ? earnedLevel : 0;
  const activeGrant = grantActive ? grantLevel : 0;
  const activeTrial = trialActive ? trialLevel : 0;
  const effectiveVipLevel = Math.max(activeEarned, activeGrant, activeTrial);
  const effectiveVipSource =
    activeEarned === effectiveVipLevel && activeEarned > 0 ? "progression" :
    activeGrant === effectiveVipLevel && activeGrant > 0 ? "admin_grant" :
    activeTrial > 0 ? "trial_card" :
    "none";

  return {
    effectiveVipLevel,
    effectiveVipSource,
    earnedActive,
    adminGrantActive: grantActive,
    trialVipActive: trialActive,
  };
}

export function materializeVipState(policy, inputState, nowMs = Date.now()) {
  const now = safeInt(nowMs, Date.now());
  let earnedVipLevel = level(inputState?.earnedVipLevel);
  let earnedVipExpiresAtMs = safeInt(inputState?.earnedVipExpiresAtMs, 0);
  let adminGrantVipLevel = level(inputState?.adminGrantVipLevel);
  let adminGrantExpiresAtMs = safeInt(inputState?.adminGrantExpiresAtMs, 0);
  let trialVipLevel = level(inputState?.trialVipLevel);
  let trialVipExpiresAtMs = safeInt(inputState?.trialVipExpiresAtMs, 0);
  let growthPoints = safeInt(inputState?.growthPoints, 0);
  let maintenancePoints = safeInt(inputState?.maintenancePoints, 0);

  if (adminGrantVipLevel > 0 && adminGrantExpiresAtMs <= now) {
    adminGrantVipLevel = 0;
    adminGrantExpiresAtMs = 0;
  }
  if (trialVipLevel > 0 && trialVipExpiresAtMs <= now) {
    trialVipLevel = 0;
    trialVipExpiresAtMs = 0;
  }

  let steps = 0;
  while (
    earnedVipLevel > 0 &&
    earnedVipExpiresAtMs > 0 &&
    earnedVipExpiresAtMs <= now &&
    steps < MAX_EXPIRY_MATERIALIZATION_STEPS
  ) {
    steps += 1;
    const cycleEnd = earnedVipExpiresAtMs;
    const required =
      vipMaintenanceThreshold(policy, earnedVipLevel) ?? Number.MAX_SAFE_INTEGER;

    if (maintenancePoints >= required) {
      maintenancePoints = 0;
      const days = vipValidityDays(policy, earnedVipLevel);
      earnedVipExpiresAtMs =
        days == null ? 0 : futureExpiry(cycleEnd, days) ?? 0;
      continue;
    }

    const downgraded = vipDowngradeState(policy, earnedVipLevel);
    if (!downgraded) break;
    earnedVipLevel = downgraded.level;
    growthPoints = downgraded.growthPoints;
    maintenancePoints = 0;

    if (earnedVipLevel <= 0) {
      earnedVipExpiresAtMs = 0;
      break;
    }

    const days = vipValidityDays(policy, earnedVipLevel);
    earnedVipExpiresAtMs =
      days == null ? 0 : futureExpiry(cycleEnd, days) ?? 0;
  }

  const base = {
    earnedVipLevel,
    earnedVipExpiresAtMs,
    adminGrantVipLevel,
    adminGrantExpiresAtMs,
    trialVipLevel,
    trialVipExpiresAtMs,
    growthPoints,
    maintenancePoints,
    expiryMaterializationSteps: steps,
  };
  return {
    ...base,
    ...effectiveVipState(base, now),
  };
}

export function applyVipGrowth(
  policy,
  inputState,
  addedPoints,
  nowMs = Date.now(),
) {
  const now = safeInt(nowMs, Date.now());
  const current = materializeVipState(policy, inputState, now);
  const added = safeInt(addedPoints, -1);
  if (added < 0) return null;

  const nextGrowth = applyVipGrowthCap(
    policy,
    current.growthPoints,
    added,
  );
  if (nextGrowth === null) return null;

  const reachedLevel = vipLevelFromGrowth(policy, nextGrowth);
  let earnedVipLevel = current.earnedVipLevel;
  let earnedVipExpiresAtMs = current.earnedVipExpiresAtMs;
  let maintenancePoints = current.maintenancePoints;

  if (reachedLevel > earnedVipLevel) {
    earnedVipLevel = reachedLevel;
    maintenancePoints = 0;
    const days = vipValidityDays(policy, earnedVipLevel);
    earnedVipExpiresAtMs =
      days == null ? 0 : futureExpiry(now, days) ?? 0;
  } else if (earnedVipLevel > 0 && added > 0) {
    const required =
      vipMaintenanceThreshold(policy, earnedVipLevel) ?? Number.MAX_SAFE_INTEGER;
    maintenancePoints = Math.min(required, maintenancePoints + added);
  }

  const base = {
    ...current,
    earnedVipLevel,
    earnedVipExpiresAtMs,
    growthPoints: nextGrowth,
    maintenancePoints,
  };
  return {
    ...base,
    ...effectiveVipState(base, now),
  };
}

export function applyAdminVipGrant(
  policy,
  inputState,
  { vipLevel, expiresAtMs },
  nowMs = Date.now(),
) {
  const now = safeInt(nowMs, Date.now());
  const current = materializeVipState(policy, inputState, now);
  const grantLevel = level(vipLevel);
  const grantExpiry = safeInt(expiresAtMs, 0);
  if (grantLevel < 1 || grantExpiry <= now) return null;

  const base = {
    ...current,
    adminGrantVipLevel: grantLevel,
    adminGrantExpiresAtMs: grantExpiry,
  };
  return {
    ...base,
    ...effectiveVipState(base, now),
  };
}

export function removeAdminVipGrant(
  policy,
  inputState,
  nowMs = Date.now(),
) {
  const now = safeInt(nowMs, Date.now());
  const current = materializeVipState(policy, inputState, now);
  const base = {
    ...current,
    adminGrantVipLevel: 0,
    adminGrantExpiresAtMs: 0,
  };
  return {
    ...base,
    ...effectiveVipState(base, now),
  };
}
