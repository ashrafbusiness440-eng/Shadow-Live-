import { firestoreQuotaResponse, json, readJson } from "./http.js";
import {
  verifyFirebaseIdToken,
  assertUserDocumentSessionState,
} from "./firebase-auth.js";
import { firestoreClient } from "./firestore.js";
import { evidenceDeadline } from "./report-evidence-retention.js";
import {
  CONTENT_FILTER_PATH, CONTENT_FILTER_COORDINATOR_ID,
  validateFilterConfig, loadContentFilter, applyContentFilter, primeContentFilter,
} from "./content-filter.js";

const clean = (value) => String(value ?? "").trim();
const OP_KEY = /^[A-Za-z0-9_-]{12,180}$/;

class FilterControlError extends Error {
  constructor(code, status = 400) {
    super(code); this.code = code; this.status = status;
  }
}

async function requireManager(request, env, db) {
  const decoded = await verifyFirebaseIdToken(request, env);
  const uid = clean(decoded?.sub);
  if (!uid) throw new FilterControlError("unauthorized", 401);
  const snapshot = await db.get(`users/${uid}`);
  const actor = snapshot.data || {};
  if (!snapshot.exists) throw new FilterControlError("forbidden", 403);
  assertUserDocumentSessionState(decoded, actor);
  const allowed = actor.role === "owner" ||
    (actor.adminEnabled === true &&
      Array.isArray(actor.capabilities) &&
      actor.capabilities.includes("manageSystem"));
  if (!allowed) throw new FilterControlError("forbidden", 403);
  return { uid, decoded };
}

async function savePolicy(db, actorUid, body) {
  const key = clean(body.idempotencyKey);
  const reason = clean(body.reason);
  if (!OP_KEY.test(key) || reason.length < 3 || reason.length > 180)
    throw new FilterControlError("invalid_request");
  let next;
  try { next = validateFilterConfig(body.config); }
  catch (error) {
    throw new FilterControlError(clean(error?.message) === "duplicate_filter_rule"
      ? "duplicate_filter_rule" : "invalid_filter_config");
  }
  const tx = await db.beginTransaction();
  try {
    const operationPath = `control_operations/${key}`;
    const [operation, existing] = await Promise.all([
      db.get(operationPath, tx), db.get(CONTENT_FILTER_PATH, tx),
    ]);
    if (operation.exists) {
      await db.rollback(tx);
      if (operation.data?.action !== "updateContentFilter" ||
          operation.data?.actorUid !== actorUid) {
        throw new FilterControlError("idempotency_conflict", 409);
      }
      return { ok: true, code: "duplicate", config: operation.data.result.config };
    }
    const currentVersion = Number(existing.data?.version || 0);
    if (currentVersion !== Number(body.expectedVersion || 0)) {
      throw new FilterControlError("filter_conflict", 409);
    }
    const version = currentVersion + 1;
    const config = { ...next, version };
    const now = new Date();
    const writes = [
      existing.exists
        ? db.writeUpdate(CONTENT_FILTER_PATH, {
            ...config, updatedBy: actorUid, updatedAt: now,
          })
        : db.writeCreate(CONTENT_FILTER_PATH, {
            ...config, updatedBy: actorUid, updatedAt: now,
          }),
      db.writeCreate(`admin_audit_logs/content_filter_${key}`, {
        action: "updateContentFilter", actorUid,
        targetType: "system_config", targetId: "content_filter",
        beforeVersion: currentVersion, afterVersion: version,
        beforeEnabled: existing.data?.enabled === true,
        afterEnabled: config.enabled,
        beforeCount: Array.isArray(existing.data?.rules) ? existing.data.rules.length : 0,
        afterCount: config.rules.length, reason, createdAt: now,
      }),
      db.writeCreate(operationPath, {
        action: "updateContentFilter", actorUid, status: "completed",
        result: { config }, createdAt: now,
      }),
    ];
    await db.commit(tx, writes);
    primeContentFilter(config);
    return { ok: true, code: "ok", config };
  } catch (error) {
    await db.rollback(tx).catch(() => {});
    throw error;
  }
}

async function syncRoomPolicy(env, policy) {
  try {
    if (!env?.ROOM_REALTIME) return false;
    const object = env.ROOM_REALTIME.get(
      env.ROOM_REALTIME.idFromName(CONTENT_FILTER_COORDINATOR_ID),
    );
    const response = await object.fetch("https://internal/filter/update", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(policy),
    });
    return response.ok;
  } catch {
    return false;
  }
}

function flagItem(id, data = {}) {
  const date = data.createdAt;
  const timestamp = date instanceof Date ? date.getTime() : Date.parse(String(date || ""));
  return {
    id,
    surface: clean(data.surface),
    moderationGroupId: clean(data.moderationGroupId),
    priority: clean(data.priority) || "normal",
    actorUid: clean(data.actorUid),
    referenceId: clean(data.referenceId),
    conversationId: clean(data.conversationId),
    roomId: clean(data.roomId),
    diaryId: clean(data.diaryId),
    ruleIds: Array.isArray(data.ruleIds) ? data.ruleIds.map(clean).slice(0, 12) : [],
    status: clean(data.status) || "pending",
    hasSensitiveEvidence: data.hasSensitiveEvidence === true ||
      Boolean(data.evidence &&
      typeof data.evidence.text === "string" && data.evidence.text.length),
    createdAtMs: Number.isFinite(data.createdAtMs)
      ? data.createdAtMs : Number.isFinite(timestamp) ? timestamp : 0,
  };
}

function roomFilterCoordinator(env) {
  if (!env?.ROOM_REALTIME) throw new FilterControlError("room_filter_not_available", 503);
  return env.ROOM_REALTIME.get(
    env.ROOM_REALTIME.idFromName(CONTENT_FILTER_COORDINATOR_ID),
  );
}

// Repeat indication is strictly scoped to an already-authorized 40-item
// report sample. It never estimates a user's lifetime violations and
// cannot cause an automatic warning, ban or accusation.
export function flagSampleRepeatCount(items, item, windowMs = 86_400_000) {
  const uid = clean(item?.actorUid);
  const when = Number(item?.createdAtMs || 0);
  if (!uid || !Number.isFinite(when) || when <= 0) return 0;
  return items.filter(row =>
    clean(row.actorUid) === uid &&
    Number.isFinite(Number(row.createdAtMs)) &&
    Math.abs(Number(row.createdAtMs) - when) <= windowMs).length;
}

async function listFlags(db, env) {
  // Explicit admin action only: a fixed number of stored records, no watch.
  const stored = await db.runQuery("content_filter_flags", {
    orderBy: [{ field: "createdAt", direction: "desc" }],
    limit: 30,
  });
  let roomItems = [];
  let roomUnavailable = false;
  try {
    const response = await roomFilterCoordinator(env).fetch("https://internal/filter/flags");
    if (!response.ok) throw Error("unavailable");
    const body = await response.json();
    roomItems = (Array.isArray(body?.items) ? body.items : []).slice(0, 30)
      .map((data) => flagItem(clean(data.id), data));
  } catch {
    roomUnavailable = true;
  }
  const items = [
    ...stored.map((entry) => flagItem(`saved_${entry.id}`, entry.data)),
    ...roomItems,
  ].sort((a, b) => b.createdAtMs - a.createdAtMs).slice(0, 40);
  return { ok: true, items: items.map(item => ({
    ...item,
    repeatsInSample24h: flagSampleRepeatCount(items, item),
    repeatSampleOnly: true,
  })), roomUnavailable };
}

async function reviewFlag(db, env, actorUid, body) {
  const id = clean(body.flagId);
  const reason = clean(body.reason);
  const key = clean(body.idempotencyKey);
  if (!/^(?:saved_[A-Za-z0-9_-]{1,180}|room_[0-9]{1,16})$/.test(id) ||
      !OP_KEY.test(key) || reason.length < 3 || reason.length > 180)
    throw new FilterControlError("invalid_request");
  const operationPath = `control_operations/${key}`;
  const previous = await db.get(operationPath);
  if (previous.exists) {
    if (previous.data?.actorUid !== actorUid ||
        previous.data?.flagId !== id ||
        previous.data?.action !== "reviewContentFilterFlag")
      throw new FilterControlError("idempotency_conflict", 409);
    return { ok: true, code: "duplicate" };
  }
  const now = new Date();
  const writes = [
    db.writeCreate(`admin_audit_logs/content_filter_flag_${key}`, {
      action: "reviewContentFilterFlag", actorUid, flagId: id,
      reason, createdAt: now,
    }),
    db.writeCreate(operationPath, {
      action: "reviewContentFilterFlag", actorUid,
      flagId: id, status: "completed", createdAt: now,
    }),
  ];
  if (id.startsWith("saved_")) {
    const path = `content_filter_flags/${id.slice(6)}`;
    const item = await db.get(path);
    if (!item.exists) throw new FilterControlError("flag_not_found", 404);
    writes.push(db.writeUpdate(path, {
      status: "reviewed", reviewedAt: now, reviewedBy: actorUid,
      evidencePurgeAt: evidenceDeadline(now),
      evidenceRetentionDueAt: evidenceDeadline(now),
    }, ["status", "reviewedAt", "reviewedBy",
      "evidencePurgeAt", "evidenceRetentionDueAt"]));
    await db.commit(null, writes);
  } else {
    const sequence = Number(id.slice(5));
    if (!Number.isSafeInteger(sequence) || sequence < 1)
      throw new FilterControlError("invalid_request");
    const response = await roomFilterCoordinator(env).fetch("https://internal/filter/flag/review", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ sequence }),
    });
    if (!response.ok) throw new FilterControlError("flag_not_found", 404);
    // Room state is updated before the audit record; retry remains safe.
    await db.commit(null, writes);
  }
  return { ok: true, code: "ok" };
}

export async function contentFilterControl(request, env) {
  if (request.method !== "POST") {
    return json(request, env, { ok: false, code: "method_not_allowed" }, 405);
  }
  try {
    const db = firestoreClient(env);
    const actor = await requireManager(request, env, db);
    const body = await readJson(request);
    switch (clean(body.action)) {
      case "load": {
        const config = await loadContentFilter(db, { fresh: true });
        return json(request, env, {
          ok: true, config,
          roomSynced: await syncRoomPolicy(env, config),
        });
      }
      case "preview": {
        const source = clean(body.text).slice(0, 2000);
        const surface = clean(body.surface);
        if (!["private_chat", "room_chat", "diary_post", "diary_comment"].includes(surface))
          throw new FilterControlError("invalid_request");
        // Preview the same submitted policy *before* saving any changes.
        let config;
        try { config = validateFilterConfig(body.config); }
        catch { throw new FilterControlError("invalid_filter_config"); }
        // A preview is always a safe dry run, including while the
        // global switch is still OFF before the curated list is approved.
        const result = applyContentFilter(source, {
          ...config, enabled: true,
        }, surface);
        return json(request, env, { ok: true, result });
      }
      case "save": {
        const result = await savePolicy(db, actor.uid, body);
        return json(request, env, {
          ...result,
          roomSynced: await syncRoomPolicy(env, result.config),
        });
      }
      case "listFlags":
        return json(request, env, await listFlags(db, env));
      case "reviewFlag":
        return json(request, env, await reviewFlag(db, env, actor.uid, body));
      default:
        throw new FilterControlError("invalid_action");
    }
  } catch (error) {
    if (error instanceof FilterControlError)
      return json(request, env, { ok: false, code: error.code }, error.status);
    const quota = firestoreQuotaResponse(request, env, error);
    if (quota) return quota;
    if (clean(error?.message) === "unauthorized")
      return json(request, env, { ok: false, code: "unauthorized" }, 401);
    return json(request, env, { ok: false, code: "content_filter_failed" }, 500);
  }
}

export const contentFilterControlInternals = Object.freeze({
  savePolicy, listFlags, reviewFlag,
});
