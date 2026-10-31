// Explicit owner-only maintenance helper (authorization is enforced by the
// voice-session route before calling). Never invoked by room browsing.
// One bounded page per administrator action; no full scans or schedulers.
const ROOM_ID = /^[A-Za-z0-9_-]{1,180}$/;
const UID = /^[A-Za-z0-9_-]{1,128}$/;

export async function backfillRoomModeratorIndexPage({
  db,
  actorUid,
  cursor = '',
  limit = 10,
  confirm = false,
  normalizeModerators,
  serverTimestamp,
}) {
  if (!UID.test(actorUid) || !Number.isInteger(limit) ||
      limit < 1 || limit > 10 ||
      (cursor !== '' && !ROOM_ID.test(cursor)) ||
      typeof normalizeModerators !== 'function' ||
      typeof serverTimestamp !== 'function') {
    throw new Error('invalid_room_moderator_backfill_arguments');
  }

  let query = db.collection('rooms').orderBy('__name__').limit(limit);
  if (cursor) {
    const cursorDoc = await db.collection('rooms').doc(cursor).get();
    // The shim only accepts an existing, verified snapshot as a cursor.
    // If the document was deleted, fail closed instead of restarting a scan.
    if (!cursorDoc.exists) throw new Error('room_backfill_cursor_not_found');
    query = query.startAfter(cursorDoc);
  }
  const page = await query.get();
  let candidateMemberships = 0;
  let migratedMemberships = 0;
  let candidateRooms = 0;
  let malformedUidsSkipped = 0;

  for (const candidate of page.docs) {
    const mods = normalizeModerators(candidate.data() || {});
    const userIds = [...new Set(mods.map(item => String(item.uid || '').trim()))];
    const validUids = userIds.filter(uid => UID.test(uid));
    malformedUidsSkipped += userIds.length - validUids.length;
    if (!validUids.length) continue;
    candidateRooms++;
    candidateMemberships += validUids.length;
    if (!confirm) continue; // Preflight is guaranteed read-only.

    // Re-read the room IN the transaction: removing an old moderator while
    // a migration runs must never recreate their membership as authoritative.
    migratedMemberships += await db.runTransaction(async tx => {
      const currentSnap = await tx.get(candidate.ref);
      if (!currentSnap.exists) return 0;
      const actual = normalizeModerators(currentSnap.data() || {});
      const actualUids = [...new Set(
        actual.map(item => String(item.uid || '').trim()),
      )].filter(uid => UID.test(uid));
      if (!actualUids.length) return 0;
      for (const moderatorUid of actualUids) {
        const ref = db.collection('room_moderator_memberships')
          .doc(moderatorUid).collection('rooms').doc(candidate.id);
        tx.set(ref, {
          roomId: candidate.id,
          updatedAt: serverTimestamp(),
        }, { merge: true });
      }
      // One deterministic audit entry per room (repeatable migration).
      const audit = db.collection('room_audit_logs').doc(candidate.id)
        .collection('items').doc('historical_moderator_index_v1');
      tx.set(audit, {
        action: 'backfillModeratorMembershipIndex',
        actorUid,
        count: actualUids.length,
        updatedAt: serverTimestamp(),
      }, { merge: true });
      return actualUids.length;
    });
  }

  const nextCursor = page.docs.length === limit
    ? page.docs[page.docs.length - 1].id : null;
  return {
    dryRun: !confirm,
    scannedRooms: page.docs.length,
    candidateRooms,
    candidateMemberships,
    upsertedMemberships: migratedMemberships,
    malformedUidsSkipped,
    nextCursor,
    complete: nextCursor === null,
  };
}
