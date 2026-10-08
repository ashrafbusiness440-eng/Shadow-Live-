import { firestoreClient } from "./firestore.js";
import { getFirestoreForEnv } from "./legacy-firebase-admin-shim.js";
import { roomSessionLeave } from "./voice-session-legacy.js";

// Read a SINGLE room document for a bounded alarm batch. Most room
// departures are listeners, so do not open a write transaction for each one.
export async function roomDepartureCleanupCandidates(
  env,
  roomId,
  uids = [],
) {
  const allowed = new Set(
    (Array.isArray(uids) ? uids : [])
      .map((uid) => String(uid || "").trim())
      .filter(Boolean)
      .slice(0, 24),
  );
  if (!allowed.size) return new Set();
  const db = getFirestoreForEnv(env);
  const roomSnap = await db.collection("rooms").doc(roomId).get();
  if (!roomSnap.exists) return new Set();
  const room = roomSnap.data() || {};
  const candidates = new Set();
  const seats = Array.isArray(room.seats) ? room.seats : [];
  for (const seat of seats) {
    const uid = String(seat?.uid || "").trim();
    if (allowed.has(uid)) candidates.add(uid);
  }
  const music = room.musicState || {};
  const sourceUid = String(music.sourceOwnerUid || "").trim();
  if (music.status === "playing" && allowed.has(sourceUid)) {
    candidates.add(sourceUid);
  }
  return candidates;
}

// Keep durable room transport/presence separate from persistent seat state.
// The same transaction handles both explicit leave and lost connections.
export async function reclaimDepartedRoomSeat(
  env,
  roomId,
  uid,
  endedAtMs = Date.now(),
) {
  return roomSessionLeave(
    getFirestoreForEnv(env),
    uid,
    roomId,
    endedAtMs,
  );
}

export async function applyCustomerServiceMicExpiries(
  env,
  roomId,
  due,
  nowMs = Date.now(),
) {
  const db = firestoreClient(env);
  const roomSnap = await db.get(`rooms/${roomId}`);
  if (!roomSnap.exists) {
    return {
      ok: true,
      roomMissing: true,
      invitesChanged: false,
      seatsChanged: false,
    };
  }

  const room = roomSnap.data || {};
  let invites = Array.isArray(room.micInvites) ? [...room.micInvites] : [];
  let inviteExpiries =
    room.customerServiceMicInviteExpiresAtMs &&
    typeof room.customerServiceMicInviteExpiresAtMs === "object"
      ? { ...room.customerServiceMicInviteExpiresAtMs }
      : {};
  let seats = Array.isArray(room.seats)
    ? room.seats.map((seat) => ({ ...(seat || {}) }))
    : [];
  let invitesChanged = false;
  let seatsChanged = false;

  for (const schedule of due) {
    const uid = String(schedule?.uid || "").trim();
    const expiresAtMs = Number(schedule?.expiresAtMs || 0);
    if (!uid) continue;

    if (schedule.kind === "invite_expire") {
      if (
        Number(inviteExpiries[uid] || 0) === expiresAtMs &&
        expiresAtMs <= nowMs
      ) {
        invites = invites.filter((item) => String(item || "") !== uid);
        delete inviteExpiries[uid];
        invitesChanged = true;
      }
      continue;
    }

    if (schedule.kind === "mic_expire") {
      const index = seats.findIndex(
        (seat) =>
          String(seat?.uid || "") === uid &&
          Number(seat?.customerServiceMicExpiresAtMs || 0) === expiresAtMs,
      );
      if (index >= 0 && expiresAtMs <= nowMs) {
        seats[index] = {
          ...seats[index],
          uid: "",
          displayName: "",
          profileImageUrl: "",
          muted: true,
          micStartedAtMs: 0,
          customerServiceMicExpiresAtMs: 0,
          frameRewardId: "",
          frameAssetKey: "",
          frameImageUrl: "",
          frameExpiresAtMs: 0,
          voiceWaveRewardId: "",
          voiceWaveAssetKey: "",
          voiceWaveImageUrl: "",
          voiceWaveExpiresAtMs: 0,
        };
        seatsChanged = true;
      }
    }
  }

  const fields = {};
  const mask = [];
  if (invitesChanged) {
    fields.micInvites = invites;
    fields.customerServiceMicInviteExpiresAtMs = inviteExpiries;
    mask.push("micInvites", "customerServiceMicInviteExpiresAtMs");
  }
  if (seatsChanged) {
    fields.seats = seats;
    mask.push("seats");
  }
  if (mask.length > 0) {
    fields.updatedAt = new Date(nowMs);
    mask.push("updatedAt");
    await db.commit(null, [
      db.writeUpdate(`rooms/${roomId}`, fields, mask),
    ]);
  }

  return {
    ok: true,
    roomMissing: false,
    invitesChanged,
    seatsChanged,
  };
}

export async function persistRoomChatReport(
  env,
  {
    reporterUid,
    targetUid,
    roomId,
    messageId,
    reason,
    message,
    context,
    nowMs = Date.now(),
  },
) {
  const reportId =
    "room_report_" + crypto.randomUUID().replaceAll("-", "");
  const now = new Date(nowMs);
  const db = firestoreClient(env);

  await db.commit(null, [
    db.writeCreate(`reports/${reportId}`, {
      reportId,
      reporterUid,
      targetType: "room_message",
      targetUid,
      roomId,
      messageId,
      reason,
      status: "new",
      evidence: {
        source: "room_realtime_session",
        message: message || null,
        context: Array.isArray(context) ? context : [],
        contextCount: Array.isArray(context) ? context.length : 0,
      },
      createdAt: now,
      updatedAt: now,
    }),
  ]);

  return { ok: true, reportId };
}
