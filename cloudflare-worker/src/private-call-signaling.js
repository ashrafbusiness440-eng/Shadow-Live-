import { json, readJson } from "./http.js";
import { verifyFirebaseIdToken } from "./firebase-auth.js";
import { firestoreClient } from "./firestore.js";
import { issueScopedPrivateCallVoiceToken } from "./voice-session-legacy.js";
import { dispatchPrivateCallPush } from "./private-call-push.js";
import {
  PRIVATE_VOICE_RING_MS, requireMutualPrivateVoice, validPrivateVoiceParties,
  PrivateVoicePolicyError,
} from "./private-voice-eligibility.js";

// Stage 4A: server-authoritative private 1:1 invitation and busy-state.
// The feature remains OFF. Media tokens and Flutter call UI are not issued here.
const clean = (value) => String(value ?? "").trim();
const idPattern = /^[A-Za-z0-9_-]{12,100}$/;
const callIdPattern = /^[a-f0-9]{32}$/;
const ringGraceMs = 5_000;
const activeLeaseMs = 120_000;
const validOperation = (value) => idPattern.test(clean(value));
const slotPath = (uid) => "private_call_slots/" + uid;
const callPath = (id) => "private_calls/" + id;

export class PrivateCallError extends Error {
  constructor(code, status = 400) {
    super(code);
    this.code = code;
    this.status = status;
  }
}

async function runTransaction(db, action) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const tx = await db.beginTransaction();
    try { return await action(tx); }
    catch (error) {
      await db.rollback(tx).catch(() => {});
      if ((error?.status === 409 || error?.message === "ABORTED") &&
          !(error instanceof PrivateCallError) && attempt < 2) continue;
      throw error;
    }
  }
  throw new PrivateCallError("call_transaction_unavailable", 503);
}

function belongsToCall(call, actorUid) {
  if (actorUid !== call.callerUid && actorUid !== call.calleeUid) {
    throw new PrivateCallError("not_a_call_participant", 403);
  }
}

function currentSlot(slot, nowMs) {
  return slot.exists && Number(slot.data?.expiresAtMs || 0) > nowMs;
}

function callIdFrom(body) {
  const value = clean(body.callId);
  if (!callIdPattern.test(value)) throw new PrivateCallError("invalid_call_id");
  return value;
}

async function releaseSlots(db, tx, call) {
  const [first, second] = await Promise.all([
    db.get(slotPath(call.callerUid), tx), db.get(slotPath(call.calleeUid), tx),
  ]);
  return [
    ...(first.data?.callId === call.callId
      ? [db.writeDelete(slotPath(call.callerUid))] : []),
    ...(second.data?.callId === call.callId
      ? [db.writeDelete(slotPath(call.calleeUid))] : []),
  ];
}

async function finishInTransaction(db, tx, call, status, nowMs) {
  const endedAt = new Date(nowMs);
  const durationSeconds = call.startedAtMs
    ? Math.max(0, Math.floor((nowMs - Number(call.startedAtMs)) / 1000))
    : 0;
  const label = {
    missed: "مكالمة فائتة",
    rejected: "مكالمة مرفوضة",
    cancelled: "مكالمة ملغاة",
    completed: "مكالمة مكتملة",
    interrupted: "مكالمة منقطعة",
  }[status] || "مكالمة خاصة";
  const releases = await releaseSlots(db, tx, call);
  const messageId = "call_" + call.callId;
  const missedNotification = status === "missed" ? [
    db.writeCreate("notifications/private_call_missed_" + call.callId, {
      userId: call.calleeUid, type: "private_call_missed",
      callId: call.callId, conversationId: call.conversationId,
      senderId: call.callerUid, title: "مكالمة فائتة",
      body: "لم يتم الرد على المكالمة الصوتية.",
      read: false, createdAt: endedAt,
    }),
  ] : [];
  await db.commit(tx, [
    db.writeUpdate(callPath(call.callId), {
      status, endedAt, endedAtMs: nowMs, durationSeconds,
    }, ["status", "endedAt", "endedAtMs", "durationSeconds"]),
    db.writeCreate(`conversations/${call.conversationId}/messages/${messageId}`, {
      type: "call_event", callId: call.callId,
      senderId: call.callerUid, receiverId: call.calleeUid,
      status, durationSeconds, createdAt: endedAt,
    }),
    db.writeUpdate("conversations/" + call.conversationId, {
      lastMessage: label, lastMessageId: messageId,
      lastSenderId: call.callerUid, updatedAt: endedAt,
    }, ["lastMessage", "lastMessageId", "lastSenderId", "updatedAt"]),
    db.writeDelete("private_call_ringing_queue/" + call.callId),
    ...missedNotification,
    ...releases,
  ]);
  return { ok: true, callId: call.callId, status, durationSeconds };
}

export async function startPrivateCall(db, actorUid, body, nowMs = Date.now()) {
  const { otherUid, conversationId } = {
    otherUid: clean(body.otherUid),
    conversationId: clean(body.conversationId),
  };
  validPrivateVoiceParties(actorUid, otherUid, conversationId);
  const key = clean(body.idempotencyKey);
  if (!validOperation(key)) throw new PrivateCallError("invalid_call_operation");
  const opPath = "private_call_operations/" + actorUid + "__" + key;
  return runTransaction(db, async (tx) => {
    const previous = await db.get(opPath, tx);
    if (previous.exists) {
      if (previous.data?.actorUid !== actorUid ||
          previous.data?.otherUid !== otherUid ||
          previous.data?.conversationId !== conversationId) {
        throw new PrivateCallError("call_operation_conflict", 409);
      }
      await db.rollback(tx);
      return { ok: true, code: "duplicate", callId: previous.data.callId };
    }
    await requireMutualPrivateVoice(db, {
      actorUid, otherUid, conversationId, kind: "call", transaction: tx,
    });
    const ratePath = "private_call_rates/" + actorUid;
    const [callerSlot, calleeSlot, previousRate] = await Promise.all([
      db.get(slotPath(actorUid), tx), db.get(slotPath(otherUid), tx),
      db.get(ratePath, tx),
    ]);
    if (currentSlot(callerSlot, nowMs) || currentSlot(calleeSlot, nowMs)) {
      throw new PrivateCallError("call_busy", 409);
    }
    const windowStartedAtMs = Number(previousRate.data?.windowStartedAtMs || 0);
    const inWindow = windowStartedAtMs > 0 &&
      nowMs >= windowStartedAtMs && nowMs - windowStartedAtMs < 60_000;
    const count = inWindow ? Math.max(0, Number(previousRate.data?.count || 0)) : 0;
    if (count >= 4) throw new PrivateCallError("call_rate_limited", 429);
    const callId = crypto.randomUUID().replaceAll("-", "");
    const deadlineMs = nowMs + PRIVATE_VOICE_RING_MS;
    const call = {
      callId, callerUid: actorUid, calleeUid: otherUid, conversationId,
      status: "ringing", createdAt: new Date(nowMs), createdAtMs: nowMs,
      ringDeadlineMs: deadlineMs,
    };
    await db.commit(tx, [
      db.writeUpdate(ratePath, {
        windowStartedAtMs: inWindow ? windowStartedAtMs : nowMs,
        count: count + 1, updatedAt: new Date(nowMs),
      }),
      db.writeCreate(callPath(callId), call),
      db.writeCreate("private_call_ringing_queue/" + callId, {
        callId, callerUid: actorUid, expiresAt: new Date(deadlineMs),
      }),
      db.writeUpdate(slotPath(actorUid), {
        callId, status: "ringing", expiresAtMs: deadlineMs + ringGraceMs,
      }),
      db.writeUpdate(slotPath(otherUid), {
        callId, status: "ringing", expiresAtMs: deadlineMs + ringGraceMs,
      }),
      db.writeCreate(opPath, {
        callId, actorUid, otherUid, conversationId, createdAt: new Date(nowMs),
      }),
      // Existing private notifications collection, not a new parallel inbox.
      db.writeCreate("notifications/private_call_" + callId, {
        userId: otherUid, type: "private_call_incoming",
        callId, conversationId, senderId: actorUid,
        title: "مكالمة صوتية واردة", body: "لديك مكالمة صوتية خاصة.",
        read: false, createdAt: new Date(nowMs),
      }),
    ]);
    return { ok: true, callId, status: "ringing", ringDeadlineMs: deadlineMs };
  });
}

export async function respondPrivateCall(db, actorUid, body, nowMs = Date.now()) {
  const callId = callIdFrom(body), decision = clean(body.decision);
  if (decision !== "accept" && decision !== "reject") {
    throw new PrivateCallError("invalid_call_decision");
  }
  return runTransaction(db, async (tx) => {
    const record = await db.get(callPath(callId), tx);
    if (!record.exists) throw new PrivateCallError("call_not_found", 404);
    const call = record.data;
    if (call.calleeUid !== actorUid) {
      throw new PrivateCallError("not_call_recipient", 403);
    }
    if (call.status === "active" && decision === "accept") {
      await db.rollback(tx);
      return { ok: true, callId, status: "active", code: "already_accepted" };
    }
    if (call.status !== "ringing") {
      throw new PrivateCallError("call_already_resolved", 409);
    }
    if (nowMs >= Number(call.ringDeadlineMs)) {
      return finishInTransaction(db, tx, call, "missed", nowMs);
    }
    if (decision === "reject") {
      return finishInTransaction(db, tx, call, "rejected", nowMs);
    }
    await requireMutualPrivateVoice(db, {
      actorUid, otherUid: call.callerUid, conversationId: call.conversationId,
      kind: "call", transaction: tx,
    });
    const [callerSlot, calleeSlot] = await Promise.all([
      db.get(slotPath(call.callerUid), tx),
      db.get(slotPath(call.calleeUid), tx),
    ]);
    if (callerSlot.data?.callId !== callId ||
        calleeSlot.data?.callId !== callId) {
      throw new PrivateCallError("call_no_longer_available", 409);
    }
    const lease = nowMs + activeLeaseMs;
    await db.commit(tx, [
      db.writeUpdate(callPath(callId), {
        status: "active", startedAtMs: nowMs, startedAt: new Date(nowMs),
      }, ["status", "startedAtMs", "startedAt"]),
      db.writeDelete("private_call_ringing_queue/" + callId),
      db.writeUpdate(slotPath(call.callerUid), {
        callId, status: "active", expiresAtMs: lease,
      }),
      db.writeUpdate(slotPath(call.calleeUid), {
        callId, status: "active", expiresAtMs: lease,
      }),
    ]);
    return { ok: true, callId, status: "active" };
  });
}

export async function finishPrivateCall(db, actorUid, body, nowMs = Date.now()) {
  const callId = callIdFrom(body);
  return runTransaction(db, async (tx) => {
    const record = await db.get(callPath(callId), tx);
    if (!record.exists) throw new PrivateCallError("call_not_found", 404);
    const call = record.data;
    belongsToCall(call, actorUid);
    if (["completed", "rejected", "cancelled", "missed", "interrupted"].includes(call.status)) {
      await db.rollback(tx);
      return { ok: true, callId, status: call.status, code: "already_finished",
        durationSeconds: Number(call.durationSeconds || 0) };
    }
    const status = call.status === "active"
      ? "completed" : nowMs >= Number(call.ringDeadlineMs)
        ? "missed" : actorUid === call.callerUid
          ? "cancelled" : "rejected";
    return finishInTransaction(db, tx, call, status, nowMs);
  });
}

export async function renewPrivateCall(db, actorUid, body, nowMs = Date.now()) {
  const callId = callIdFrom(body);
  return runTransaction(db, async (tx) => {
    const record = await db.get(callPath(callId), tx);
    if (!record.exists) throw new PrivateCallError("call_not_found", 404);
    const call = record.data;
    belongsToCall(call, actorUid);
    if (call.status !== "active") {
      throw new PrivateCallError("call_not_active", 409);
    }
    try {
      await requireMutualPrivateVoice(db, {
        actorUid, otherUid: actorUid === call.callerUid
          ? call.calleeUid : call.callerUid,
        conversationId: call.conversationId, kind: "call", transaction: tx,
      });
    } catch (error) {
      // A block, unfollow or disabled call permission terminates eligibility.
      if (error instanceof PrivateVoicePolicyError) {
        return finishInTransaction(db, tx, call, "interrupted", nowMs);
      }
      throw error;
    }
    const [first, second] = await Promise.all([
      db.get(slotPath(call.callerUid), tx),
      db.get(slotPath(call.calleeUid), tx),
    ]);
    if (first.data?.callId !== callId || second.data?.callId !== callId) {
      return finishInTransaction(db, tx, call, "interrupted", nowMs);
    }
    const expiresAtMs = nowMs + activeLeaseMs;
    await db.commit(tx, [
      db.writeUpdate(slotPath(call.callerUid), {
        callId, status: "active", expiresAtMs,
      }),
      db.writeUpdate(slotPath(call.calleeUid), {
        callId, status: "active", expiresAtMs,
      }),
    ]);
    return { ok: true, callId, status: "active", expiresAtMs };
  });
}

// Existing Worker cron, 10 expired invitations max per invocation. Never
// scan the full calls collection and never leave missed calls only in memory.
export async function runPrivateCallTimeoutCleanup(env, nowMs = Date.now()) {
  const db = firestoreClient(env);
  const due = await db.runQuery("private_call_ringing_queue", {
    filters: [{ field: "expiresAt", op: "<=", value: new Date(nowMs) }],
    orderBy: [{ field: "expiresAt", direction: "asc" }],
    limit: 10,
  });
  let completed = 0, failed = 0;
  for (const item of due) {
    const callId = clean(item.data?.callId || item.id);
    const callerUid = clean(item.data?.callerUid);
    if (!callIdPattern.test(callId) || !callerUid) { failed++; continue; }
    try {
      const record = await db.get(callPath(callId));
      if (!record.exists || record.data?.status !== "ringing") {
        await db.commit(null, [db.writeDelete("private_call_ringing_queue/" + callId)]);
      } else {
        await finishPrivateCall(db, callerUid, { callId }, nowMs);
      }
      completed++;
    } catch (_) { failed++; }
  }
  return { checked: due.length, completed, failed };
}

export async function readPrivateCall(db, actorUid, body, nowMs = Date.now()) {
  const callId = callIdFrom(body);
  const record = await db.get(callPath(callId));
  if (!record.exists) throw new PrivateCallError("call_not_found", 404);
  const call = record.data;
  belongsToCall(call, actorUid);
  if (call.status === "ringing" && nowMs >= Number(call.ringDeadlineMs)) {
    return finishPrivateCall(db, actorUid, { callId }, nowMs);
  }
  return {
    ok: true, callId, status: call.status, callerUid: call.callerUid,
    calleeUid: call.calleeUid, conversationId: call.conversationId,
    ringDeadlineMs: Number(call.ringDeadlineMs || 0),
    durationSeconds: Number(call.durationSeconds || 0),
  };
}

/// MEDIA TODO (Flutter Stage 4C): Only the live call may request a
/// short-lived room-scoped ZEGO credential. A ringing or terminal invitation
/// never grants microphone or speaker access.
export async function privateCallMediaSession(
  db, actorUid, body, mint, nowMs = Date.now()
) {
  const callId = callIdFrom(body);
  const record = await db.get(callPath(callId));
  if (!record.exists) throw new PrivateCallError("call_not_found", 404);
  const call = record.data;
  belongsToCall(call, actorUid);
  if (call.status !== "active") {
    throw new PrivateCallError("call_not_active", 409);
  }
  const [callerSlot, calleeSlot] = await Promise.all([
    db.get(slotPath(call.callerUid)),
    db.get(slotPath(call.calleeUid)),
  ]);
  if (!currentSlot(callerSlot, nowMs) || !currentSlot(calleeSlot, nowMs) ||
      callerSlot.data?.callId !== callId ||
      calleeSlot.data?.callId !== callId) {
    throw new PrivateCallError("call_no_longer_available", 409);
  }
  await requireMutualPrivateVoice(db, {
    actorUid,
    otherUid: actorUid === call.callerUid ? call.calleeUid : call.callerUid,
    conversationId: call.conversationId,
    kind: "call",
  });
  const roomId = "private_call_" + callId;
  const credentials = await mint(actorUid, roomId);
  if (!credentials?.token || credentials.roomId !== roomId ||
      !credentials.userId || !credentials.streamId || !credentials.appId) {
    throw new PrivateCallError("call_media_unavailable", 503);
  }
  return { ok: true, callId, status: "active", ...credentials };
}

export async function privateCallSignaling(request, env, ctx = null) {
  // Deployment-readiness gate stays OFF until ZEGO token transport, room
  // handoff and Android acceptance work have been released together.
  if (env?.PRIVATE_CALL_MEDIA_READY !== "true") {
    return json(request, env, { ok: false, code: "private_calls_not_ready" }, 503);
  }
  if (request.method !== "POST") {
    return json(request, env, { ok: false, code: "method_not_allowed" }, 405);
  }
  try {
    const token = await verifyFirebaseIdToken(request, env);
    if (token?.firebase?.sign_in_provider === "anonymous") {
      throw new PrivateCallError("registered_account_required", 403);
    }
    const uid = clean(token?.sub);
    if (!uid) throw new PrivateCallError("unauthorized", 401);
    const body = await readJson(request);
    const action = clean(body.action), db = firestoreClient(env);
    const result = action === "start"
      ? await startPrivateCall(db, uid, body)
      : action === "respond" ? await respondPrivateCall(db, uid, body)
      : action === "finish" ? await finishPrivateCall(db, uid, body)
      : action === "get" ? await readPrivateCall(db, uid, body)
      : action === "renew" ? await renewPrivateCall(db, uid, body)
      : action === "mediaSession" ? await privateCallMediaSession(
          db, uid, body,
          (actorUid, callRoomId) => issueScopedPrivateCallVoiceToken(
            env, actorUid, callRoomId,
          ),
        )
      : null;
    if (!result) throw new PrivateCallError("invalid_call_action");
    if (action === "start" && result.status === "ringing" &&
        result.code !== "duplicate" && ctx?.waitUntil) {
      // Only a new, committed call may trigger background delivery.
      // Push failures must not delay or duplicate the invitation.
      ctx.waitUntil(dispatchPrivateCallPush(
        env, clean(body.otherUid), result.callId,
      ).catch(() => {}));
    }
    return json(request, env, result, 200);
  } catch (error) {
    const expected = error instanceof PrivateCallError ||
      error instanceof PrivateVoicePolicyError ||
      error?.code === "zego_not_configured";
    return json(request, env, {
      ok: false, code: expected ? error.code : "private_call_unavailable",
    }, expected ? error.status : 500);
  }
}
