const clean = (value) => String(value ?? "").trim();

export function vipUpgradeBroadcastEvent(
  uid,
  user,
  beforeState,
  afterState,
  sourceId,
  nowMs = Date.now(),
) {
  const before = Number(beforeState?.earnedVipLevel || 0);
  const after = Number(afterState?.earnedVipLevel || 0);
  if (
    !Number.isSafeInteger(before) ||
    !Number.isSafeInteger(after) ||
    after <= before ||
    after < 5
  ) {
    return null;
  }
  const safeSource = clean(sourceId)
    .replace(/[^A-Za-z0-9_.-]/g, "_")
    .slice(0, 140);
  if (!safeSource) return null;
  return {
    eventId: `vip_upgrade_${uid}_${safeSource}`,
    kind: "vip_level_upgrade",
    startsAtMs: nowMs,
    endsAtMs: nowMs + 12_000,
    uid,
    displayName:
      clean(user?.displayName || user?.username) || "مستخدم Shadow Live",
    profileImageUrl: clean(user?.profileImageUrl),
    publicId: clean(user?.publicId),
    vipLevel: after,
    assetKey: `vip.v${after}.globalEntryBanner`,
  };
}
