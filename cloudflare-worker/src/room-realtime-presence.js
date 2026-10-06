function clean(value) {
  return String(value || "").trim();
}

export function presenceSnapshotFromAttachments(
  attachments,
  nowMs = Date.now(),
  { includeGhost = false } = {},
) {
  const byUid = new Map();
  for (const raw of attachments || []) {
    if (!includeGhost && raw?.ghostMode === true) continue;
    const item = raw && typeof raw === "object" ? raw : {};
    const uid = clean(item.uid);
    if (!uid) continue;

    const connectedAtMs = Math.max(0, Number(item.connectedAtMs || 0));
    const joinedAtMs = Math.max(
      0,
      Number(item.joinedAtMs || connectedAtMs || nowMs),
    );
    const vipLevel = Math.max(
      0,
      Math.min(10, Number(item.vipLevel || 0)),
    );
    const existing = byUid.get(uid);
    if (!existing) {
      byUid.set(uid, {
        uid,
        displayName: clean(item.displayName) || "مستخدم Shadow Live",
        profileImageUrl: clean(item.profileImageUrl),
        vipLevel,
        vipOnlinePriority: vipLevel >= 2,
        joinedAtMs,
        lastSeenAtMs: Number(nowMs),
      });
      continue;
    }

    existing.joinedAtMs = Math.min(existing.joinedAtMs, joinedAtMs);
    existing.vipLevel = Math.max(existing.vipLevel || 0, vipLevel);
    existing.vipOnlinePriority = existing.vipLevel >= 2;
    if (!existing.profileImageUrl && clean(item.profileImageUrl)) {
      existing.profileImageUrl = clean(item.profileImageUrl);
    }
    if (existing.displayName === "مستخدم Shadow Live" && clean(item.displayName)) {
      existing.displayName = clean(item.displayName);
    }
  }

  return Array.from(byUid.values()).sort((a, b) => {
    const priority =
      Number(b.vipOnlinePriority === true) - Number(a.vipOnlinePriority === true);
    if (priority !== 0) return priority;
    return a.joinedAtMs - b.joinedAtMs || a.uid.localeCompare(b.uid);
  });
}

export function presenceCountFromAttachments(attachments) {
  return presenceSnapshotFromAttachments(attachments, Date.now()).length;
}

export function hasPresenceUid(attachments, uid) {
  const target = clean(uid);
  if (!target) return false;
  return (attachments || []).some((raw) => clean(raw?.uid) === target);
}
