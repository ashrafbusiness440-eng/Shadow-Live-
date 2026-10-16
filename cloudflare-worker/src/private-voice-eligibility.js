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
    actor, other, settings,
  ] = await Promise.all([
    db.get(`conversations/${conversationId}`),
    db.get(`follows/${actorUid}__${otherUid}`),
    db.get(`follows/${otherUid}__${actorUid}`),
    db.get(`user_blocks/${actorUid}/items/${otherUid}`),
    db.get(`user_blocks/${otherUid}/items/${actorUid}`),
    db.get(`users/${actorUid}`),
    db.get(`users/${otherUid}`),
    db.get("system_config/messaging"),
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
