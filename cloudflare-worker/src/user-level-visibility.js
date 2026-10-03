const METRICS = Object.freeze({
  wealth: { hideField: "hideWealthLevel", capability: "manageWealthLevel" },
  attraction: { hideField: "hideAttractionLevel", capability: "manageAttractionLevel" },
  games: { hideField: "hideGameLevel", capability: "manageGameLevel" },
});

const clean = (value) => String(value ?? "").trim();

export function effectiveVipLevel(user = {}) {
  const value = Number(user?.effectiveVipLevel ?? 0);
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(10, Math.trunc(value)));
}

export function levelVisibilityPreferences(user = {}) {
  const effectiveLevel = effectiveVipLevel(user);
  const hiddenLevelEntitled = effectiveLevel >= 3;
  const prefs = {
    hiddenLevelEntitled,
    hideWealthLevel:
      hiddenLevelEntitled && user?.hideWealthLevel === true,
    hideAttractionLevel:
      hiddenLevelEntitled && user?.hideAttractionLevel === true,
    hideGameLevel:
      hiddenLevelEntitled && user?.hideGameLevel === true,
  };
  return {
    ...prefs,
    hasAnyHiddenLevel:
      prefs.hideWealthLevel ||
      prefs.hideAttractionLevel ||
      prefs.hideGameLevel,
  };
}

export function publicLevelMetadata(levels = {}, user = {}) {
  const visibility = levelVisibilityPreferences(user);
  return {
    wealthLevel: visibility.hideWealthLevel
      ? 0
      : Math.max(0, Math.min(35, Number(levels.wealthLevel || 0))),
    attractionLevel: visibility.hideAttractionLevel
      ? 0
      : Math.max(0, Math.min(35, Number(levels.attractionLevel || 0))),
    gameLevel: visibility.hideGameLevel
      ? 0
      : Math.max(0, Math.min(21, Number(levels.gameLevel || 0))),
  };
}

function actorCapabilities(actor = {}) {
  return new Set(
    Array.isArray(actor?.capabilities)
      ? actor.capabilities.map(clean).filter(Boolean)
      : [],
  );
}

export function canViewHiddenUserLevelMetric(actor = {}, metric) {
  if (actor?.role === "owner") return true;
  if (actor?.adminEnabled !== true) return false;
  const caps = actorCapabilities(actor);
  if (caps.has("viewHiddenUserLevels")) return true;
  if (actor?.role !== "admin" && actor?.role !== "super_admin") return false;
  const config = METRICS[metric];
  if (!config) return false;
  return caps.has("manageUserLevels") || caps.has(config.capability);
}

function redactedSection(section = {}, metric) {
  const base = {
    ...section,
    hidden: true,
    publiclyHidden: true,
    level: 0,
    points: 0,
    minimumThreshold: 0,
    nextThreshold: null,
    remaining: 0,
    progressBps: 0,
  };
  if (metric === "games") {
    return {
      ...base,
      storedPoints: 0,
      pendingDecayPoints: 0,
      pendingDecayDays: 0,
      lastGameActivityAtMs: null,
      decayAppliedPoints: 0,
      decayAppliedDays: 0,
    };
  }
  return base;
}

function visibleSection(section = {}, publiclyHidden = false) {
  return {
    ...section,
    hidden: false,
    publiclyHidden,
  };
}

export function applyUserLevelVisibilityForViewer(
  summary = {},
  {
    actorUid = "",
    targetUid = "",
    actorUser = null,
  } = {},
) {
  const rawVisibility = summary?.visibility || {};
  const visibility = {
    hiddenLevelEntitled: rawVisibility.hiddenLevelEntitled === true,
    hideWealthLevel: rawVisibility.hideWealthLevel === true,
    hideAttractionLevel: rawVisibility.hideAttractionLevel === true,
    hideGameLevel: rawVisibility.hideGameLevel === true,
  };
  const self = clean(actorUid) !== "" && clean(actorUid) === clean(targetUid);

  const output = { ...summary };
  const viewerOverride = {};
  for (const metric of Object.keys(METRICS)) {
    const hideField = METRICS[metric].hideField;
    const publiclyHidden = visibility[hideField] === true;
    const override =
      !self &&
      publiclyHidden &&
      canViewHiddenUserLevelMetric(actorUser || {}, metric);
    viewerOverride[metric] = override;
    output[metric] =
      publiclyHidden && !self && !override
        ? redactedSection(summary?.[metric] || {}, metric)
        : visibleSection(summary?.[metric] || {}, publiclyHidden);
  }

  output.visibility = {
    ...visibility,
    canEdit: self && visibility.hiddenLevelEntitled,
    viewerOverride,
  };
  return output;
}

export const userLevelVisibilityInternals = Object.freeze({
  METRICS,
});
