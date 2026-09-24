import { json, readJson } from "./http.js";
import { verifyFirebaseIdToken } from "./firebase-auth.js";
import { firestoreClient } from "./firestore.js";

const clean = (value) => String(value ?? "").trim();
const validKey = (value) => /^[A-Za-z0-9_-]{12,220}$/.test(clean(value));
const bounded = (value, fallback, min, max) => {
  const n = Number(value);
  return Number.isFinite(n) ? Math.max(min, Math.min(max, Math.floor(n))) : fallback;
};

class ApiError extends Error {
  constructor(code, status = 400) {
    super(code);
    this.code = code;
    this.status = status;
  }
}

function timestampMs(value) {
  const ms = Date.parse(String(value || ""));
  return Number.isFinite(ms) ? ms : 0;
}

async function runTransaction(db, body) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const transaction = await db.beginTransaction();
    try {
      return await body(transaction);
    } catch (error) {
      await db.rollback(transaction);
      if (error instanceof ApiError) throw error;
      if ((error?.message === "ABORTED" || error?.status === 409) && attempt < 2) continue;
      throw error;
    }
  }
  throw new ApiError("transaction_failed", 500);
}

async function safetyStatus(db, uid, body) {
  const targetUserId = clean(body.targetUserId);
  if (!targetUserId || targetUserId === uid) {
    throw new ApiError("invalid_request", 400);
  }

  const [target, outgoingBlock, incomingBlock] = await Promise.all([
    db.get(`users/${targetUserId}`),
    db.get(`user_blocks/${uid}/items/${targetUserId}`),
    db.get(`user_blocks/${targetUserId}/items/${uid}`),
  ]);

  if (!target.exists) throw new ApiError("not_found", 404);
  return {
    ok: true,
    blockedByMe: outgoingBlock.exists,
    blockedByOther: incomingBlock.exists,
    blocked: outgoingBlock.exists || incomingBlock.exists,
  };
}

async function setBlock(db, uid, body) {
  const targetUserId = clean(body.targetUserId);
  const blocked = body.blocked === true;
  if (!targetUserId || targetUserId === uid) {
    throw new ApiError("invalid_request", 400);
  }

  return runTransaction(db, async (transaction) => {
    const targetPath = `users/${targetUserId}`;
    const blockPath = `user_blocks/${uid}/items/${targetUserId}`;
    const outgoingFollowPath = `follows/${uid}__${targetUserId}`;
    const incomingFollowPath = `follows/${targetUserId}__${uid}`;

    const [target, currentBlock, outgoingFollow, incomingFollow] = await Promise.all([
      db.get(targetPath, transaction),
      db.get(blockPath, transaction),
      db.get(outgoingFollowPath, transaction),
      db.get(incomingFollowPath, transaction),
    ]);

    if (!target.exists) throw new ApiError("not_found", 404);

    const writes = [];
    if (blocked) {
      const now = new Date();
      const oldCreatedMs = timestampMs(currentBlock.data?.createdAt);
      writes.push(db.writeUpdate(blockPath, {
        blockerUid: uid,
        blockedUid: targetUserId,
        createdAt: oldCreatedMs > 0 ? new Date(oldCreatedMs) : now,
        updatedAt: now,
      }, ["blockerUid", "blockedUid", "createdAt", "updatedAt"]));

      if (outgoingFollow.exists) writes.push(db.writeDelete(outgoingFollowPath));
      if (incomingFollow.exists) writes.push(db.writeDelete(incomingFollowPath));
    } else if (currentBlock.exists) {
      writes.push(db.writeDelete(blockPath));
    }

    if (writes.length) await db.commit(transaction, writes);
    else await db.rollback(transaction);

    return { ok: true, blocked };
  });
}

async function reportUser(db, uid, body) {
  const targetUserId = clean(body.targetUserId);
  const conversationId = clean(body.conversationId);
  const reason = clean(body.reason);
  const details = clean(body.details);
  const key = clean(body.idempotencyKey);
  const allowedReasons = new Set([
    "spam",
    "harassment",
    "inappropriate_content",
    "scam",
    "other",
  ]);

  if (
    !targetUserId ||
    targetUserId === uid ||
    !conversationId ||
    conversationId.includes("/") ||
    !allowedReasons.has(reason) ||
    details.length > 500 ||
    !validKey(key)
  ) {
    throw new ApiError("invalid_request", 400);
  }

  const nowMs = Date.now();

  return runTransaction(db, async (transaction) => {
    const opPath = `report_operations/${key}`;
    const targetPath = `users/${targetUserId}`;
    const conversationPath = `conversations/${conversationId}`;
    const ratePath = `report_rate_limits/${uid}`;
    const configPath = "system_config/messaging";
    const reportPath = `reports/report_${key}`;

    const [op, target, conversation, rate, config] = await Promise.all([
      db.get(opPath, transaction),
      db.get(targetPath, transaction),
      db.get(conversationPath, transaction),
      db.get(ratePath, transaction),
      db.get(configPath, transaction),
    ]);

    if (op.exists) {
      await db.rollback(transaction);
      return { ok: true, code: "duplicate", ...(op.data?.result || {}) };
    }
    if (!target.exists || !conversation.exists) {
      throw new ApiError("not_found", 404);
    }

    const participants = Array.isArray(conversation.data?.participants)
      ? conversation.data.participants
      : [];
    if (
      participants.length !== 2 ||
      !participants.includes(uid) ||
      !participants.includes(targetUserId)
    ) {
      throw new ApiError("invalid_conversation", 409);
    }

    const cfg = config.data || {};
    const windowMinutes = bounded(cfg.reportRateWindowMinutes, 60, 5, 1440);
    const maxReports = bounded(cfg.reportRateMax, 5, 1, 20);
    const startedMs = timestampMs(rate.data?.windowStartedAt);
    const sameWindow = startedMs > 0 && (nowMs - startedMs) < windowMinutes * 60 * 1000;
    const currentCount = sameWindow ? Math.max(0, Number(rate.data?.count || 0)) : 0;
    if (currentCount >= maxReports) throw new ApiError("rate_limited", 429);

    const windowStartedAt = new Date(sameWindow ? startedMs : nowMs);
    const now = new Date();
    const resultData = { reportId: `report_${key}` };

    await db.commit(transaction, [
      db.writeUpdate(ratePath, {
        windowStartedAt,
        count: currentCount + 1,
        updatedAt: now,
      }, ["windowStartedAt", "count", "updatedAt"]),
      db.writeCreate(reportPath, {
        type: "user",
        reporterId: uid,
        targetUserId,
        conversationId,
        reason,
        details,
        source: "private_chat",
        status: "open",
        createdAt: now,
        updatedAt: now,
      }),
      db.writeCreate(opPath, {
        reporterId: uid,
        targetUserId,
        action: "reportUser",
        status: "completed",
        result: resultData,
        createdAt: now,
      }),
    ]);

    return { ok: true, code: "ok", ...resultData };
  });
}

export async function chatSafetyActions(request, env) {
  if (request.method !== "POST") {
    return json(request, env, { ok: false, code: "method_not_allowed" }, 405);
  }

  try {
    const decoded = await verifyFirebaseIdToken(request, env);
    const body = await readJson(request);
    const action = clean(body.action);
    const db = firestoreClient(env);

    let result;
    switch (action) {
      case "safetyStatus":
        result = await safetyStatus(db, decoded.sub, body);
        break;
      case "setBlock":
        result = await setBlock(db, decoded.sub, body);
        break;
      case "reportUser":
        result = await reportUser(db, decoded.sub, body);
        break;
      default:
        throw new ApiError("action_not_migrated", 400);
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
    return json(request, env, { ok: false, code: "server_failed" }, 500);
  }
}
