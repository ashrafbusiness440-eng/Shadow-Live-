import { adminInboxUpsertWrite } from "./admin-inbox-index.js";

const clean = (v) => String(v ?? "").trim();
const SAFE = /^[A-Za-z0-9_-]{1,180}$/;
const RANKS = Object.freeze({ normal: 0, high: 1, urgent: 2 });
const WINDOW_MS = 24 * 60 * 60 * 1000;
const MAX_REFS = 12;

export function filterRulePriority(group) {
  if (group === "threats") return "urgent";
  if (["bullying", "sexual"].includes(group)) return "high";
  return "normal";
}

export function higherFilterPriority(a = "normal", b = "normal") {
  return (RANKS[b] ?? 0) > (RANKS[a] ?? 0) ? b : a;
}

// A flag occurrence is a potential moderation signal, never a proven offence.
// One finite per-account state record; no historical reports scan, listener,
// punitive action, or original text in the group or admin notification.
export async function filterRepeatGroupWrites(db, transaction, {
  actorUid, surface, referenceId, priority = "normal", now = new Date(),
}) {
  const uid = clean(actorUid);
  const ref = clean(referenceId);
  if (!SAFE.test(uid) || !SAFE.test(ref) ||
      !["private_chat", "room_chat", "diary_post", "diary_comment"].includes(surface) ||
      !Object.hasOwn(RANKS, priority)) {
    throw new Error("invalid_filter_group_occurrence");
  }
  const when = now.getTime();
  const path = "moderation_flag_groups/" + uid;
  const snapshot = await db.get(path, transaction);
  const prior = snapshot.exists ? snapshot.data || {} : {};
  const start = Number(prior.windowStartMs || 0);
  const sameWindow = start > 0 && when >= start && when - start < WINDOW_MS;
  const groupId = sameWindow && SAFE.test(clean(prior.groupId))
    ? clean(prior.groupId) : uid + "_" + when;
  if (groupId.length > 320) throw new Error("invalid_filter_group_occurrence");
  const previous = sameWindow && groupId === prior.groupId ? prior : {};
  const latest = Array.isArray(previous.recentReferences)
    ? previous.recentReferences.slice(-MAX_REFS) : [];
  if (latest.some((entry) =>
    clean(entry?.surface) === surface && clean(entry?.referenceId) === ref)) {
    return { writes: [], groupId, count: Number(previous.count || 1),
      notified: false, duplicate: true };
  }
  const count = Math.max(0, Math.min(100000000, Number(previous.count || 0))) + 1;
  const bestPriority = higherFilterPriority(
    clean(previous.highestPriority) || "normal", priority);
  const previousNotified = clean(previous.notifiedPriority);
  // Exactly one inbox item when count reaches 2, then only a new item
  // for a higher risk band. Same-band events do not re-notify.
  const notified = count >= 2 &&
    (!Object.hasOwn(RANKS, previousNotified) ||
      RANKS[bestPriority] > RANKS[previousNotified]);
  const refs = [...latest, {
    surface, referenceId: ref, createdAtMs: when,
  }].slice(-MAX_REFS);
  const state = {
    groupId,
    actorUid: uid,
    windowStartMs: sameWindow ? start : when,
    count,
    highestPriority: bestPriority,
    notifiedPriority: notified ? bestPriority : previousNotified,
    recentReferences: refs,
    updatedAt: now,
    // Flag groups are for administrative triage; source evidence retains
    // its own 90-day lifetime and is never copied into this document.
    evidenceCopied: false,
  };
  const writes = [
    db.writeUpdate(path, state, Object.keys(state)),
  ];
  if (notified) {
    const notificationId = groupId + "_" + bestPriority;
    writes.push(adminInboxUpsertWrite(db, {
      type: "system_repeat_flag",
      title: "تنبيهات محتوى متكررة بحاجة للمراجعة",
      body: "ظهرت تنبيهات متكررة لنفس الحساب؛ يلزم التحقق من الأدلة.",
      targetId: notificationId,
      route: "general_reports",
      priority: bestPriority,
      createdAt: now,
      meta: {
        actorUid: uid, groupId, count, priority: bestPriority,
        status: "needs_review", groupOnly: true,
      },
    }));
  }
  return { writes, groupId, count, notified, duplicate: false,
    priority: bestPriority };
}

// For non-Firestore room flags, a single separate transaction updates the
// same per-user group state. The DO keeps the independently readable evidence.
export async function recordRoomFilterRepeat(db, occurrence) {
  const tx = await db.beginTransaction();
  try {
    const uid = clean(occurrence.actorUid);
    const ref = clean(occurrence.referenceId);
    if (!SAFE.test(uid) || !/^room_[1-9][0-9]{0,15}$/.test(ref)) {
      throw new Error("invalid_filter_group_occurrence");
    }
    const receiptPath = "moderation_flag_group_receipts/" + uid + "__" + ref;
    const receipt = await db.get(receiptPath, tx);
    if (receipt.exists) {
      await db.rollback(tx);
      return { duplicate: true, notified: false };
    }
    const result = await filterRepeatGroupWrites(db, tx, occurrence);
    await db.commit(tx, [...result.writes, db.writeCreate(receiptPath, {
      actorUid: uid, referenceId: ref, surface: "room_chat",
      groupId: result.groupId, createdAt: occurrence.now || new Date(),
    })]);
    return result;
  } catch (error) {
    await db.rollback(tx).catch(() => {});
    throw error;
  }
}
