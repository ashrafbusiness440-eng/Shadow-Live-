// Central fail-closed eligibility for private voice notes and 1:1 calls.
// This module does not expose a route or enable a feature by itself.
const clean = (value) => String(value ?? "").trim();
export class PrivateVoicePolicyError extends Error {
  constructor(code, status = 403) {
    super(code);
    this.code = code;
    this.status = status;
  }
}
export const PRIVATE_VOICE_RING_MS = 30_000;
export const PRIVATE_VOICE_NOTE_MAX_SECONDS = 60;
export function validVoiceDuration(seconds) {
  return Number.isInteger(seconds) && seconds > 0 &&
    seconds <= PRIVATE_VOICE_NOTE_MAX_SECONDS;
}
export function validPrivateVoiceParties(actorUid, otherUid, conversationId) {
  const a = clean(actorUid), b = clean(otherUid), c = clean(conversationId);
  if (!a || !b || !c || a === b || [a,b,c].some(x => x.includes("/") || x.length > 220)) {
    throw new PrivateVoicePolicyError("invalid_private_voice_target", 400);
  }
  return { actorUid:a, otherUid:b, conversationId:c };
}
export async function requireMutualPrivateVoice(db, params) {
  const transaction = params.transaction || null;
  const {actorUid, otherUid, conversationId} = validPrivateVoiceParties(
    params.actorUid, params.otherUid, params.conversationId,
  );
  const kind = clean(params.kind);
  if (kind !== "voice_note" && kind !== "call") {
    throw new PrivateVoicePolicyError("invalid_private_voice_kind", 400);
  }
  // All reads are exact document lookups; no scans, listeners, or per-item polling.
  const [
    conversation, forward, backward, sentBlock, receivedBlock,
    actor, other, settings, actorCallSlot,
  ] = await Promise.all([
    db.get(`conversations/${conversationId}`, transaction),
    db.get(`follows/${actorUid}__${otherUid}`, transaction),
    db.get(`follows/${otherUid}__${actorUid}`, transaction),
    db.get(`user_blocks/${actorUid}/items/${otherUid}`, transaction),
    db.get(`user_blocks/${otherUid}/items/${actorUid}`, transaction),
    db.get(`users/${actorUid}`, transaction),
    db.get(`users/${otherUid}`, transaction),
    db.get("system_config/messaging", transaction),
    kind === "voice_note" && params.allowReadDuringCall !== true
      ? db.get(`private_call_slots/${actorUid}`, transaction)
      : Promise.resolve({ exists: false }),
  ]);
  const members = conversation.data?.participants;
  if (!conversation.exists || !Array.isArray(members) ||
      members.length !== 2 || !members.includes(actorUid) ||
      !members.includes(otherUid) || !actor.exists || !other.exists) {
    throw new PrivateVoicePolicyError("private_voice_conversation_unavailable", 404);
  }
  if (sentBlock.exists || receivedBlock.exists) {
    throw new PrivateVoicePolicyError("blocked", 403);
  }
  // No VIP/owner/moderator/customer-service bypass. 3 unanswered texts never
  // authorize voice notes or calls.
  if (!forward.exists || !backward.exists) {
    throw new PrivateVoicePolicyError("mutual_follow_required", 403);
  }
  if (actor.data?.isGuest === true || other.data?.isGuest === true ||
      actor.data?.accountType === "guest" || other.data?.accountType === "guest") {
    throw new PrivateVoicePolicyError("registered_account_required", 403);
  }
  if (kind === "voice_note") {
    if (settings.data?.voiceNotesEnabled !== true) {
      throw new PrivateVoicePolicyError("voice_notes_disabled", 403);
    }
    // A live/ringing call occupies the same user audio resource. Reject at
    // the server for every voice-note stage, including transactional commit;
    // a second device must not bypass the local microphone guard.
    const nowMs = Number.isFinite(params.nowMs) ? params.nowMs : Date.now();
    if (actorCallSlot.exists &&
        Number(actorCallSlot.data?.expiresAtMs || 0) > nowMs) {
      throw new PrivateVoicePolicyError("voice_note_during_private_call", 409);
    }
  } else {
    if (settings.data?.privateCallsEnabled !== true) {
      throw new PrivateVoicePolicyError("private_calls_disabled", 403);
    }
    if (actor.data?.allowPrivateCalls === false ||
        other.data?.allowPrivateCalls === false ||
        other.data?.doNotDisturbCalls === true) {
      throw new PrivateVoicePolicyError("calls_not_allowed", 403);
    }
  }
  return Object.freeze({actorUid, otherUid, conversationId, kind});
}
