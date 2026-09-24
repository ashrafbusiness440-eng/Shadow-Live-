import { FieldValue } from "firebase-admin/firestore";
import { activeMicSegments } from "./mic-activity.js";

const clean = (value) => String(value ?? "").trim();

export async function recordMicActivity(tx, db, userId, seat, endedAtMs = Date.now()) {
  const segments = activeMicSegments(seat, endedAtMs);
  if (!userId || segments.length === 0) return;

  const userRef = db.collection("users").doc(userId);
  const economyRef = db.collection("system_config").doc("gift_economy");
  const dayRefs = segments.map((segment) =>
    db.collection("host_mic_activity").doc(userId).collection("days").doc(segment.day)
  );

  const [userSnap, economySnap, ...daySnaps] = await Promise.all([
    tx.get(userRef),
    tx.get(economyRef),
    ...dayRefs.map((ref) => tx.get(ref)),
  ]);
  if (!userSnap.exists) return;

  const user = userSnap.data() || {};
  const economy = economySnap.data() || {};
  const requiredMinutes = Math.max(
    1,
    Math.min(1440, Number(economy.hostBonusMinutesPerQualifiedDay || 120)),
  );
  const thresholdSeconds = requiredMinutes * 60;
  const newlyQualifiedByMonth = new Map();
  const addedSecondsByMonth = new Map();

  for (let index = 0; index < segments.length; index++) {
    const segment = segments[index];
    const activity = daySnaps[index].data() || {};
    const previousSeconds = Math.max(0, Number(activity.micSeconds || 0));
    const nextSeconds = previousSeconds + segment.seconds;
    const wasQualified =
      activity.qualified === true || previousSeconds >= thresholdSeconds;
    const qualified = nextSeconds >= thresholdSeconds;

    if (!wasQualified && qualified) {
      newlyQualifiedByMonth.set(
        segment.month,
        (newlyQualifiedByMonth.get(segment.month) || 0) + 1,
      );
    }
    addedSecondsByMonth.set(
      segment.month,
      (addedSecondsByMonth.get(segment.month) || 0) + segment.seconds,
    );

    tx.set(dayRefs[index], {
      day: segment.day,
      micSeconds: nextSeconds,
      qualified,
      requiredMinutes,
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
  }

  const currentMonth = segments[segments.length - 1].month;
  const sameMonth = String(user.giftHostActivityMonth || "") === currentMonth;
  const previousMonthSeconds = sameMonth
    ? Math.max(0, Number(user.giftHostMicSecondsMonth || 0))
    : 0;
  const previousQualifiedDays = sameMonth
    ? Math.max(0, Number(user.giftHostQualifiedDays || 0))
    : 0;

  tx.set(userRef, {
    giftHostActivityMonth: currentMonth,
    giftHostMicSecondsMonth:
      previousMonthSeconds + (addedSecondsByMonth.get(currentMonth) || 0),
    giftHostQualifiedDays:
      previousQualifiedDays + (newlyQualifiedByMonth.get(currentMonth) || 0),
    giftHostActivityUpdatedAt: FieldValue.serverTimestamp(),
  }, { merge: true });

  const agencyId = clean(user.agencyId);
  if (agencyId) {
    for (const [month, count] of newlyQualifiedByMonth.entries()) {
      if (count <= 0) continue;
      const agencyMonthRef = db
        .collection("agency_support_stats")
        .doc(agencyId)
        .collection("monthly")
        .doc(month);
      tx.set(agencyMonthRef, {
        activeHostIds: FieldValue.arrayUnion(userId),
        updatedAt: FieldValue.serverTimestamp(),
      }, { merge: true });
    }
  }
}
