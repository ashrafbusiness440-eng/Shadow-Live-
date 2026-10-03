import { json, readJson } from "./http.js";
import { verifyFirebaseIdToken } from "./firebase-auth.js";
import { firestoreClient } from "./firestore.js";
import { annotatePressureRequest } from "./pressure-telemetry.js";

const clean = (value) => String(value ?? "").trim();
const validOperationKey = (value) => /^[A-Za-z0-9_-]{12,220}$/.test(clean(value));
const validTypeKey = (value) => /^[a-z0-9_]{2,32}$/.test(clean(value));
const MAX_TYPES = 20;

const DEFAULT_TYPES = Object.freeze([
  { key: "cp", labelAr: "CP", enabled: true, order: 10, assetKey: "" },
  { key: "bff", labelAr: "BFF", enabled: true, order: 20, assetKey: "" },
  { key: "brother", labelAr: "أخ", enabled: true, order: 30, assetKey: "" },
  { key: "sister", labelAr: "أخت", enabled: true, order: 40, assetKey: "" },
  { key: "close_friend", labelAr: "صديق مقرّب", enabled: true, order: 50, assetKey: "" },
]);

class ApiError extends Error {
  constructor(code, status = 400) {
    super(code);
    this.code = code;
    this.status = status;
  }
}

function randomId(prefix) {
  return `${prefix}_${crypto.randomUUID().replace(/-/g, "")}`;
}

function pathSafe(value) {
  const bytes = new TextEncoder().encode(clean(value));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function pairKey(firstUid, secondUid, type) {
  const [left, right] = [clean(firstUid), clean(secondUid)].sort();
  return `${type}__${pathSafe(left)}__${pathSafe(right)}`;
}

function slotPath(uid, type) {
  return `relationship_slots/${pathSafe(uid)}__${type}`;
}

function pendingPath(firstUid, secondUid, type) {
  return `relationship_pending/${pairKey(firstUid, secondUid, type)}`;
}

function activePairPath(firstUid, secondUid, type) {
  return `relationship_active_pairs/${pairKey(firstUid, secondUid, type)}`;
}

function normalizeTypes(raw) {
  const source = Array.isArray(raw?.types) ? raw.types : DEFAULT_TYPES;
  const seen = new Set();
  const normalized = [];
  for (const item of source) {
    const key = clean(item?.key).toLowerCase();
    if (!validTypeKey(key) || seen.has(key)) continue;
    seen.add(key);
    normalized.push({
      key,
      labelAr: clean(item?.labelAr || item?.label || key).slice(0, 40),
      enabled: item?.enabled !== false,
      order: Number.isFinite(Number(item?.order)) ? Math.trunc(Number(item.order)) : 999,
      assetKey: clean(item?.assetKey).slice(0, 160),
    });
    if (normalized.length >= MAX_TYPES) break;
  }
  if (!normalized.length) return DEFAULT_TYPES.map((item) => ({ ...item }));
  normalized.sort((a, b) => a.order - b.order || a.key.localeCompare(b.key));
  return normalized;
}

async function relationshipTypes(db, transaction = null) {
  const config = await db.get("system_config/relationship_types", transaction);
  return normalizeTypes(config.exists ? config.data : null);
}

async function requireEnabledType(db, type, transaction = null) {
  const key = clean(type).toLowerCase();
  if (!validTypeKey(key)) throw new ApiError("invalid_relationship_type", 400);
  const types = await relationshipTypes(db, transaction);
  const found = types.find((item) => item.key === key && item.enabled !== false);
  if (!found) throw new ApiError("relationship_type_disabled", 409);
  return found;
}

function assertSafeUserId(value) {
  const uid = clean(value);
  if (!uid || uid.includes("/") || uid.length > 220) {
    throw new ApiError("invalid_user", 400);
  }
  return uid;
}

async function runTransaction(db, body) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const transaction = await db.beginTransaction();
    try {
      return await body(transaction);
    } catch (error) {
      await db.rollback(transaction);
      if (error instanceof ApiError) throw error;
      if ((error?.message === "ABORTED" || error?.status === 409) && attempt < 2) {
        continue;
      }
      throw error;
    }
  }
  throw new ApiError("transaction_failed", 500);
}

function operationConflict(data, expected) {
  return (
    clean(data?.action) !== clean(expected.action) ||
    clean(data?.actorUid) !== clean(expected.actorUid) ||
    (expected.targetUid && clean(data?.targetUid) !== clean(expected.targetUid)) ||
    (expected.requestId && clean(data?.requestId) !== clean(expected.requestId)) ||
    (expected.relationshipId &&
      clean(data?.relationshipId) !== clean(expected.relationshipId)) ||
    (expected.relationshipType &&
      clean(data?.relationshipType) !== clean(expected.relationshipType))
  );
}

function notificationPath(kind, id, uid) {
  return `notifications/${kind}_${id}_${pathSafe(uid).slice(0, 48)}`;
}

function relationshipRequestNotification({
  requestId,
  targetUid,
  actorUid,
  actorName,
  type,
  typeLabel,
  now,
}) {
  return {
    userId: targetUid,
    title: "طلب علاقة جديد",
    body: `${actorName || "مستخدم Shadow Live"} أرسل لك طلب ${typeLabel}`,
    type: "relationship_request",
    read: false,
    requestId,
    relationshipType: type,
    relationshipTypeLabel: typeLabel,
    applicantUid: actorUid,
    actionState: "pending",
    createdAt: now,
  };
}

function relationshipResponseNotification({
  requestId,
  actorUid,
  targetName,
  type,
  typeLabel,
  decision,
  relationshipId,
  now,
}) {
  const accepted = decision === "accept";
  return {
    userId: actorUid,
    title: accepted ? "تم قبول طلب العلاقة" : "تم رفض طلب العلاقة",
    body: accepted
      ? `${targetName || "المستخدم"} قبل طلب ${typeLabel}`
      : `${targetName || "المستخدم"} رفض طلب ${typeLabel}`,
    type: "relationship_response",
    read: false,
    requestId,
    relationshipId: relationshipId || "",
    relationshipType: type,
    relationshipTypeLabel: typeLabel,
    actionState: "resolved",
    finalStatus: accepted ? "accepted" : "rejected",
    createdAt: now,
  };
}

async function sendRequest(db, uid, body) {
  const targetUid = assertSafeUserId(body.targetUserId);
  if (targetUid === uid) throw new ApiError("cannot_request_self", 400);
  const typeKey = clean(body.relationshipType).toLowerCase();
  const idempotencyKey = clean(body.idempotencyKey);
  if (!validOperationKey(idempotencyKey)) throw new ApiError("invalid_idempotency_key", 400);

  return runTransaction(db, async (transaction) => {
    const type = await requireEnabledType(db, typeKey, transaction);
    const opPath = `relationship_operations/${idempotencyKey}`;
    const actorPath = `users/${uid}`;
    const targetPath = `users/${targetUid}`;
    const actorBlockPath = `user_blocks/${uid}/items/${targetUid}`;
    const targetBlockPath = `user_blocks/${targetUid}/items/${uid}`;
    const actorSlotPath = slotPath(uid, type.key);
    const targetSlotPath = slotPath(targetUid, type.key);
    const pairPendingPath = pendingPath(uid, targetUid, type.key);
    const pairActivePath = activePairPath(uid, targetUid, type.key);

    const [op, actor, target, actorBlock, targetBlock, actorSlot, targetSlot, pending, activePair] =
      await Promise.all([
        db.get(opPath, transaction),
        db.get(actorPath, transaction),
        db.get(targetPath, transaction),
        db.get(actorBlockPath, transaction),
        db.get(targetBlockPath, transaction),
        db.get(actorSlotPath, transaction),
        db.get(targetSlotPath, transaction),
        db.get(pairPendingPath, transaction),
        db.get(pairActivePath, transaction),
      ]);

    if (op.exists) {
      if (operationConflict(op.data, {
        action: "sendRequest",
        actorUid: uid,
        targetUid,
        relationshipType: type.key,
      })) {
        throw new ApiError("idempotency_conflict", 409);
      }
      await db.rollback(transaction);
      return { ok: true, code: "duplicate", ...(op.data?.result || {}) };
    }
    if (!actor.exists || !target.exists) throw new ApiError("not_found", 404);
    if (actorBlock.exists || targetBlock.exists) throw new ApiError("blocked", 403);
    if (actorSlot.exists || targetSlot.exists) throw new ApiError("relationship_slot_occupied", 409);
    if (activePair.exists) throw new ApiError("relationship_already_active", 409);
    if (pending.exists) {
      throw new ApiError("relationship_request_already_pending", 409);
    }

    const requestId = randomId("relreq");
    const requestPath = `relationship_requests/${requestId}`;
    const now = new Date();
    const actorName = clean(actor.data?.displayName || actor.data?.name || "");
    const targetName = clean(target.data?.displayName || target.data?.name || "");
    const requestData = {
      requestId,
      actorUid: uid,
      targetUid,
      relationshipType: type.key,
      relationshipTypeLabel: type.labelAr,
      status: "pending",
      actorName,
      targetName,
      createdAt: now,
      updatedAt: now,
    };
    const result = {
      requestId,
      relationshipType: type.key,
      relationshipTypeLabel: type.labelAr,
      status: "pending",
    };

    await db.commit(transaction, [
      db.writeCreate(requestPath, requestData),
      db.writeCreate(pairPendingPath, {
        requestId,
        actorUid: uid,
        targetUid,
        relationshipType: type.key,
        createdAt: now,
      }),
      db.writeCreate(
        notificationPath("relationship_request", requestId, targetUid),
        relationshipRequestNotification({
          requestId,
          targetUid,
          actorUid: uid,
          actorName,
          type: type.key,
          typeLabel: type.labelAr,
          now,
        }),
      ),
      db.writeCreate(opPath, {
        action: "sendRequest",
        actorUid: uid,
        targetUid,
        relationshipType: type.key,
        status: "completed",
        result,
        createdAt: now,
      }),
      db.writeCreate(`relationship_audit_logs/${randomId("relaudit")}`, {
        action: "sendRequest",
        actorUid: uid,
        targetUid,
        requestId,
        relationshipType: type.key,
        createdAt: now,
      }),
    ]);

    return { ok: true, code: "ok", ...result };
  });
}

async function respondRequest(db, uid, body) {
  const requestId = clean(body.requestId);
  const decision = clean(body.decision).toLowerCase();
  const idempotencyKey = clean(body.idempotencyKey);
  if (!requestId || requestId.includes("/")) throw new ApiError("invalid_request", 400);
  if (!["accept", "reject"].includes(decision)) throw new ApiError("invalid_decision", 400);
  if (!validOperationKey(idempotencyKey)) throw new ApiError("invalid_idempotency_key", 400);

  return runTransaction(db, async (transaction) => {
    const opPath = `relationship_operations/${idempotencyKey}`;
    const requestPath = `relationship_requests/${requestId}`;
    const [op, request] = await Promise.all([
      db.get(opPath, transaction),
      db.get(requestPath, transaction),
    ]);

    if (op.exists) {
      if (operationConflict(op.data, {
        action: "respondRequest",
        actorUid: uid,
        requestId,
      })) {
        throw new ApiError("idempotency_conflict", 409);
      }
      await db.rollback(transaction);
      return { ok: true, code: "duplicate", ...(op.data?.result || {}) };
    }
    if (!request.exists) throw new ApiError("request_not_found", 404);

    const data = request.data || {};
    const actorUid = assertSafeUserId(data.actorUid);
    const targetUid = assertSafeUserId(data.targetUid);
    const type = await requireEnabledType(db, data.relationshipType, transaction);
    if (targetUid !== uid) throw new ApiError("forbidden", 403);
    if (clean(data.status) !== "pending") throw new ApiError("request_already_resolved", 409);

    const pairPendingPath = pendingPath(actorUid, targetUid, type.key);
    const actorSlotPath = slotPath(actorUid, type.key);
    const targetSlotPath = slotPath(targetUid, type.key);
    const pairActivePath = activePairPath(actorUid, targetUid, type.key);
    const actorBlockPath = `user_blocks/${actorUid}/items/${targetUid}`;
    const targetBlockPath = `user_blocks/${targetUid}/items/${actorUid}`;

    const [pending, actorSlot, targetSlot, activePair, actorBlock, targetBlock] =
      await Promise.all([
        db.get(pairPendingPath, transaction),
        db.get(actorSlotPath, transaction),
        db.get(targetSlotPath, transaction),
        db.get(pairActivePath, transaction),
        db.get(actorBlockPath, transaction),
        db.get(targetBlockPath, transaction),
      ]);

    if (!pending.exists || clean(pending.data?.requestId) !== requestId) {
      throw new ApiError("request_lock_missing", 409);
    }

    const now = new Date();
    const writes = [];
    let relationshipId = "";

    if (decision === "accept") {
      if (actorBlock.exists || targetBlock.exists) throw new ApiError("blocked", 403);
      if (actorSlot.exists || targetSlot.exists) throw new ApiError("relationship_slot_occupied", 409);
      if (activePair.exists) throw new ApiError("relationship_already_active", 409);

      relationshipId = randomId("rel");
      const relationshipPath = `relationships/${relationshipId}`;
      const shared = {
        relationshipId,
        relationshipType: type.key,
        relationshipTypeLabel: type.labelAr,
        status: "active",
        participants: [actorUid, targetUid].sort(),
        actorUid,
        targetUid,
        requestId,
        startedAt: now,
        updatedAt: now,
      };
      writes.push(
        db.writeCreate(relationshipPath, shared),
        db.writeCreate(actorSlotPath, {
          userId: actorUid,
          partnerUid: targetUid,
          relationshipId,
          relationshipType: type.key,
          relationshipTypeLabel: type.labelAr,
          startedAt: now,
          updatedAt: now,
        }),
        db.writeCreate(targetSlotPath, {
          userId: targetUid,
          partnerUid: actorUid,
          relationshipId,
          relationshipType: type.key,
          relationshipTypeLabel: type.labelAr,
          startedAt: now,
          updatedAt: now,
        }),
        db.writeCreate(pairActivePath, {
          relationshipId,
          relationshipType: type.key,
          participants: [actorUid, targetUid].sort(),
          startedAt: now,
        }),
      );
    }

    const finalStatus = decision === "accept" ? "accepted" : "rejected";
    writes.push(
      db.writeUpdate(requestPath, {
        status: finalStatus,
        decision,
        relationshipId,
        resolvedBy: uid,
        resolvedAt: now,
        updatedAt: now,
      }, ["status", "decision", "relationshipId", "resolvedBy", "resolvedAt", "updatedAt"]),
      db.writeDelete(pairPendingPath),
      db.writeUpdate(
        notificationPath("relationship_request", requestId, targetUid),
        {
          actionState: "resolved",
          finalStatus,
          finalDecision: decision,
          relationshipId,
          resolvedBy: uid,
          resolvedAt: now,
          read: true,
        },
        [
          "actionState",
          "finalStatus",
          "finalDecision",
          "relationshipId",
          "resolvedBy",
          "resolvedAt",
          "read",
        ],
      ),
      db.writeCreate(
        notificationPath("relationship_response", requestId, actorUid),
        relationshipResponseNotification({
          requestId,
          actorUid,
          targetName: clean(data.targetName),
          type: type.key,
          typeLabel: type.labelAr,
          decision,
          relationshipId,
          now,
        }),
      ),
    );

    const result = {
      requestId,
      decision,
      status: finalStatus,
      relationshipId: relationshipId || null,
      relationshipType: type.key,
    };
    writes.push(
      db.writeCreate(opPath, {
        action: "respondRequest",
        actorUid: uid,
        requestId,
        relationshipType: type.key,
        status: "completed",
        result,
        createdAt: now,
      }),
      db.writeCreate(`relationship_audit_logs/${randomId("relaudit")}`, {
        action: decision === "accept" ? "acceptRequest" : "rejectRequest",
        actorUid: uid,
        otherUid: actorUid,
        requestId,
        relationshipId,
        relationshipType: type.key,
        createdAt: now,
      }),
    );

    await db.commit(transaction, writes);
    return { ok: true, code: "ok", ...result };
  });
}

async function cancelRequest(db, uid, body) {
  const requestId = clean(body.requestId);
  const idempotencyKey = clean(body.idempotencyKey);
  if (!requestId || requestId.includes("/") || !validOperationKey(idempotencyKey)) {
    throw new ApiError("invalid_request", 400);
  }

  return runTransaction(db, async (transaction) => {
    const opPath = `relationship_operations/${idempotencyKey}`;
    const requestPath = `relationship_requests/${requestId}`;
    const [op, request] = await Promise.all([
      db.get(opPath, transaction),
      db.get(requestPath, transaction),
    ]);
    if (op.exists) {
      if (operationConflict(op.data, {
        action: "cancelRequest",
        actorUid: uid,
        requestId,
      })) {
        throw new ApiError("idempotency_conflict", 409);
      }
      await db.rollback(transaction);
      return { ok: true, code: "duplicate", ...(op.data?.result || {}) };
    }
    if (!request.exists) throw new ApiError("request_not_found", 404);
    const data = request.data || {};
    if (clean(data.actorUid) !== uid) throw new ApiError("forbidden", 403);
    if (clean(data.status) !== "pending") throw new ApiError("request_already_resolved", 409);

    const targetUid = assertSafeUserId(data.targetUid);
    const type = await requireEnabledType(db, data.relationshipType, transaction);
    const pairPendingPath = pendingPath(uid, targetUid, type.key);
    const pending = await db.get(pairPendingPath, transaction);
    if (!pending.exists || clean(pending.data?.requestId) !== requestId) {
      throw new ApiError("request_lock_missing", 409);
    }

    const now = new Date();
    const result = { requestId, status: "cancelled", relationshipType: type.key };
    await db.commit(transaction, [
      db.writeUpdate(requestPath, {
        status: "cancelled",
        decision: "cancel",
        resolvedBy: uid,
        resolvedAt: now,
        updatedAt: now,
      }, ["status", "decision", "resolvedBy", "resolvedAt", "updatedAt"]),
      db.writeDelete(pairPendingPath),
      db.writeUpdate(
        notificationPath("relationship_request", requestId, targetUid),
        {
          actionState: "resolved",
          finalStatus: "cancelled",
          finalDecision: "cancel",
          resolvedBy: uid,
          resolvedAt: now,
        },
        ["actionState", "finalStatus", "finalDecision", "resolvedBy", "resolvedAt"],
      ),
      db.writeCreate(opPath, {
        action: "cancelRequest",
        actorUid: uid,
        requestId,
        relationshipType: type.key,
        status: "completed",
        result,
        createdAt: now,
      }),
      db.writeCreate(`relationship_audit_logs/${randomId("relaudit")}`, {
        action: "cancelRequest",
        actorUid: uid,
        targetUid,
        requestId,
        relationshipType: type.key,
        createdAt: now,
      }),
    ]);
    return { ok: true, code: "ok", ...result };
  });
}

async function endRelationship(db, uid, body) {
  const relationshipId = clean(body.relationshipId);
  const idempotencyKey = clean(body.idempotencyKey);
  if (
    !relationshipId ||
    relationshipId.includes("/") ||
    !validOperationKey(idempotencyKey)
  ) {
    throw new ApiError("invalid_request", 400);
  }

  return runTransaction(db, async (transaction) => {
    const opPath = `relationship_operations/${idempotencyKey}`;
    const relationshipPath = `relationships/${relationshipId}`;
    const [op, relationship] = await Promise.all([
      db.get(opPath, transaction),
      db.get(relationshipPath, transaction),
    ]);
    if (op.exists) {
      if (operationConflict(op.data, {
        action: "endRelationship",
        actorUid: uid,
        relationshipId,
      })) {
        throw new ApiError("idempotency_conflict", 409);
      }
      await db.rollback(transaction);
      return { ok: true, code: "duplicate", ...(op.data?.result || {}) };
    }
    if (!relationship.exists) throw new ApiError("relationship_not_found", 404);
    const data = relationship.data || {};
    const participants = Array.isArray(data.participants)
      ? data.participants.map(clean).filter(Boolean)
      : [];
    if (!participants.includes(uid) || participants.length !== 2) {
      throw new ApiError("forbidden", 403);
    }
    if (clean(data.status) !== "active") throw new ApiError("relationship_not_active", 409);

    const otherUid = participants.find((item) => item !== uid);
    const type = await requireEnabledType(db, data.relationshipType, transaction);
    const minePath = slotPath(uid, type.key);
    const otherPath = slotPath(otherUid, type.key);
    const pairPath = activePairPath(uid, otherUid, type.key);
    const [mine, other, pair] = await Promise.all([
      db.get(minePath, transaction),
      db.get(otherPath, transaction),
      db.get(pairPath, transaction),
    ]);

    const now = new Date();
    const result = {
      relationshipId,
      relationshipType: type.key,
      status: "ended",
      otherUid,
    };
    const writes = [
      db.writeUpdate(relationshipPath, {
        status: "ended",
        endedBy: uid,
        endedAt: now,
        updatedAt: now,
      }, ["status", "endedBy", "endedAt", "updatedAt"]),
      db.writeCreate(
        notificationPath("relationship_ended", relationshipId, otherUid),
        {
          userId: otherUid,
          title: "تم إنهاء العلاقة",
          body: `تم إنهاء علاقة ${type.labelAr}`,
          type: "relationship_ended",
          read: false,
          relationshipId,
          relationshipType: type.key,
          relationshipTypeLabel: type.labelAr,
          applicantUid: uid,
          createdAt: now,
        },
      ),
      db.writeCreate(opPath, {
        action: "endRelationship",
        actorUid: uid,
        relationshipId,
        relationshipType: type.key,
        status: "completed",
        result,
        createdAt: now,
      }),
      db.writeCreate(`relationship_audit_logs/${randomId("relaudit")}`, {
        action: "endRelationship",
        actorUid: uid,
        otherUid,
        relationshipId,
        relationshipType: type.key,
        createdAt: now,
      }),
    ];
    if (mine.exists && clean(mine.data?.relationshipId) === relationshipId) {
      writes.push(db.writeDelete(minePath));
    }
    if (other.exists && clean(other.data?.relationshipId) === relationshipId) {
      writes.push(db.writeDelete(otherPath));
    }
    if (pair.exists && clean(pair.data?.relationshipId) === relationshipId) {
      writes.push(db.writeDelete(pairPath));
    }

    await db.commit(transaction, writes);
    return { ok: true, code: "ok", ...result };
  });
}

async function requestDetail(db, uid, body) {
  const requestId = clean(body.requestId);
  if (!requestId || requestId.includes("/")) throw new ApiError("invalid_request", 400);
  const request = await db.get(`relationship_requests/${requestId}`);
  if (!request.exists) throw new ApiError("request_not_found", 404);
  const data = request.data || {};
  if (clean(data.actorUid) !== uid && clean(data.targetUid) !== uid) {
    throw new ApiError("forbidden", 403);
  }
  return {
    ok: true,
    request: {
      requestId,
      actorUid: clean(data.actorUid),
      targetUid: clean(data.targetUid),
      actorName: clean(data.actorName),
      targetName: clean(data.targetName),
      relationshipType: clean(data.relationshipType),
      relationshipTypeLabel: clean(data.relationshipTypeLabel),
      status: clean(data.status),
      decision: clean(data.decision),
      relationshipId: clean(data.relationshipId) || null,
      createdAt: data.createdAt || null,
      resolvedAt: data.resolvedAt || null,
    },
  };
}

async function listMine(db, uid) {
  const types = (await relationshipTypes(db)).filter((item) => item.enabled !== false);
  const slots = await Promise.all(
    types.slice(0, MAX_TYPES).map(async (type) => ({
      type,
      doc: await db.get(slotPath(uid, type.key)),
    })),
  );
  const active = slots
    .filter((entry) => entry.doc.exists)
    .map((entry) => ({
      relationshipId: clean(entry.doc.data?.relationshipId),
      relationshipType: entry.type.key,
      relationshipTypeLabel: entry.type.labelAr,
      assetKey: entry.type.assetKey,
      partnerUid: clean(entry.doc.data?.partnerUid),
      startedAt: entry.doc.data?.startedAt || null,
    }))
    .filter((entry) => entry.relationshipId && entry.partnerUid);

  const profiles = await Promise.all(
    active.map((entry) => db.get(`public_profiles/${entry.partnerUid}`)),
  );
  return {
    ok: true,
    items: active.map((entry, index) => {
      const profile = profiles[index]?.data || {};
      return {
        ...entry,
        partnerName: clean(profile.displayName || "مستخدم Shadow Live"),
        partnerPublicId: clean(profile.publicId),
        partnerProfileImageUrl: clean(profile.profileImageUrl),
        partnerProfileAvatarAsset: clean(profile.profileAvatarAsset),
      };
    }),
    types,
  };
}

export async function relationships(request, env) {
  if (request.method !== "POST") {
    return json(request, env, { ok: false, code: "method_not_allowed" }, 405);
  }

  try {
    const decoded = await verifyFirebaseIdToken(request, env);
    const uid = assertSafeUserId(decoded.sub);
    const body = await readJson(request);
    const action = clean(body.action);
    annotatePressureRequest(request, { action: `relationships:${action}` });
    const db = firestoreClient(env);

    let result;
    switch (action) {
      case "types":
        result = { ok: true, types: await relationshipTypes(db) };
        break;
      case "sendRequest":
        result = await sendRequest(db, uid, body);
        break;
      case "respondRequest":
        result = await respondRequest(db, uid, body);
        break;
      case "cancelRequest":
        result = await cancelRequest(db, uid, body);
        break;
      case "endRelationship":
        result = await endRelationship(db, uid, body);
        break;
      case "requestDetail":
        result = await requestDetail(db, uid, body);
        break;
      case "listMine":
        result = await listMine(db, uid);
        break;
      default:
        throw new ApiError("invalid_action", 400);
    }
    return json(request, env, result, 200);
  } catch (error) {
    if (error instanceof ApiError) {
      return json(request, env, { ok: false, code: error.code }, error.status);
    }
    const code = clean(error?.message);
    if (code === "unauthorized") {
      return json(request, env, { ok: false, code: "unauthorized" }, 401);
    }
    if (code === "server_not_configured" || code === "invalid_service_account_json") {
      return json(request, env, { ok: false, code }, 503);
    }
    return json(request, env, { ok: false, code: "relationships_failed" }, 500);
  }
}
