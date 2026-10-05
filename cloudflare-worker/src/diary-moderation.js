import { json, readJson, firestoreQuotaResponse } from "./http.js";
import {
  assertUserDocumentSessionState,
  verifyFirebaseIdToken,
} from "./firebase-auth.js";
import { firestoreClient } from "./firestore.js";
import { deleteDiary, deleteComment } from "./diaries.js";

const clean = (value) => String(value ?? "").trim();
const KEY_PATTERN = /^[A-Za-z0-9_-]{12,180}$/;
const STATUS_TRANSITIONS = Object.freeze({
  new: new Set(["under_review", "rejected"]),
  under_review: new Set(["actioned", "rejected"]),
  actioned: new Set(),
  rejected: new Set(),
});

class ModerationApiError extends Error {
  constructor(code, status = 400) {
    super(code);
    this.code = code;
    this.status = status;
  }
}

function safeId(value, code = "invalid_id") {
  const id = clean(value);
  if (!id || id.length > 220 || id.includes("/") || id.includes("\\")) {
    throw new ModerationApiError(code, 400);
  }
  return id;
}

function operationKey(value) {
  const key = clean(value);
  if (!KEY_PATTERN.test(key)) {
    throw new ModerationApiError("invalid_idempotency_key", 400);
  }
  return key;
}

function pageLimit(value) {
  const parsed = Number(value || 20);
  if (!Number.isFinite(parsed)) return 20;
  return Math.max(1, Math.min(30, Math.trunc(parsed)));
}

function parseCursor(value) {
  const raw = clean(value);
  if (!raw) return null;
  const separator = raw.indexOf("|");
  if (separator <= 0 || separator >= raw.length - 1) {
    throw new ModerationApiError("invalid_cursor", 400);
  }
  const createdAtMs = Number(raw.slice(0, separator));
  const reportId = raw.slice(separator + 1);
  if (!Number.isSafeInteger(createdAtMs) || createdAtMs <= 0) {
    throw new ModerationApiError("invalid_cursor", 400);
  }
  safeId(reportId, "invalid_cursor");
  return { createdAtMs, reportId };
}

async function requireCapability(db, decoded, capability, { recentAuth = false } = {}) {
  const uid = clean(decoded?.sub);
  if (!uid) throw new ModerationApiError("unauthorized", 401);

  if (recentAuth) {
    const authAge = Math.floor(Date.now() / 1000) - Number(decoded.auth_time || 0);
    if (!Number.isFinite(authAge) || authAge > 1800) {
      throw new ModerationApiError("recent_auth_required", 401);
    }
  }

  const actorSnap = await db.get(`users/${uid}`);
  const actor = actorSnap.data || {};
  if (actorSnap.exists) assertUserDocumentSessionState(decoded, actor);
  const role = clean(actor.role);
  const enabled = actor.adminEnabled === true;
  const capabilities = Array.isArray(actor.capabilities)
    ? actor.capabilities.map(clean).filter(Boolean)
    : [];
  const owner = role === "owner" && enabled;
  const required = Array.isArray(capability) ? capability : [capability];
  const allowed = owner || (enabled && required.some((item) => capabilities.includes(item)));
  if (!actorSnap.exists || !allowed) {
    throw new ModerationApiError("forbidden", 403);
  }
  return { uid, owner, role, capabilities };
}

function normalizeReport(id, data = {}) {
  return {
    reportId: id,
    targetType: clean(data.targetType),
    targetId: clean(data.targetId),
    diaryId: clean(data.diaryId),
    commentId: clean(data.commentId),
    targetOwnerUid: clean(data.targetOwnerUid),
    targetAuthorUid: clean(data.targetAuthorUid),
    reporterUid: clean(data.reporterUid),
    reason: clean(data.reason),
    reasonLabel: clean(data.reasonLabel),
    status: clean(data.status || "new") || "new",
    evidence: data.evidence && typeof data.evidence === "object" ? data.evidence : {},
    createdAt: data.createdAt || null,
    createdAtMs: Math.max(0, Number(data.createdAtMs || 0)),
    updatedAt: data.updatedAt || null,
    reviewedBy: clean(data.reviewedBy),
    reviewReason: clean(data.reviewReason),
  };
}

async function listReports(db, body) {
  const limit = pageLimit(body.limit);
  const cursor = parseCursor(body.cursor);
  const rows = await db.runQuery("diary_reports", {
    orderBy: [
      { field: "createdAtMs", direction: "desc" },
      { field: "__name__", direction: "desc" },
    ],
    limit: limit + 1,
    startAfter: cursor
      ? [
          { value: cursor.createdAtMs },
          { referencePath: `diary_reports/${cursor.reportId}` },
        ]
      : [],
  });
  const hasMore = rows.length > limit;
  const visible = rows.slice(0, limit);
  const last = visible[visible.length - 1];
  return {
    ok: true,
    items: visible.map((row) => normalizeReport(row.id, row.data || {})),
    hasMore,
    nextCursor:
      hasMore && last
        ? `${Math.max(0, Number(last.data?.createdAtMs || 0))}|${last.id}`
        : null,
  };
}

async function reviewReport(db, actorUid, body) {
  const reportId = safeId(body.reportId, "invalid_report_id");
  const nextStatus = clean(body.status);
  const reason = clean(body.reason);
  const key = operationKey(body.idempotencyKey);
  if (!reason || reason.length < 3 || reason.length > 200) {
    throw new ModerationApiError("invalid_reason", 400);
  }

  const operationPath = `control_operations/${key}`;
  const reportPath = `diary_reports/${reportId}`;
  const globalPath = `reports/${reportId}`;
  const transaction = await db.beginTransaction();
  try {
    const [operation, report] = await Promise.all([
      db.get(operationPath, transaction),
      db.get(reportPath, transaction),
    ]);
    if (operation.exists) {
      await db.rollback(transaction);
      return { ok: true, code: "duplicate", ...(operation.data?.result || {}) };
    }
    if (!report.exists) throw new ModerationApiError("report_not_found", 404);

    const from = clean(report.data?.status || "new") || "new";
    if (!STATUS_TRANSITIONS[from]?.has(nextStatus)) {
      throw new ModerationApiError("invalid_report_transition", 409);
    }

    const now = new Date();
    const patch = {
      status: nextStatus,
      reviewedBy: actorUid,
      reviewReason: reason,
      reviewedAt: now,
      updatedAt: now,
    };
    const mask = Object.keys(patch);
    const result = { reportId, status: nextStatus };
    await db.commit(transaction, [
      db.writeUpdate(reportPath, patch, mask),
      db.writeUpdate(globalPath, patch, mask),
      db.writeCreate(`admin_audit_logs/diary_report_${key}`, {
        actorUid,
        action: "reviewDiaryReport",
        targetType: clean(report.data?.targetType),
        targetId: clean(report.data?.targetId),
        reportId,
        reason,
        before: { status: from },
        after: { status: nextStatus },
        operationId: key,
        createdAt: now,
      }),
      db.writeCreate(operationPath, {
        action: "reviewDiaryReport",
        actorUid,
        targetType: "report",
        targetId: reportId,
        status: "completed",
        result,
        createdAt: now,
      }),
    ]);
    return { ok: true, code: "ok", ...result };
  } catch (error) {
    await db.rollback(transaction);
    throw error;
  }
}

async function markReportActioned(db, actorUid, reportId, reason, key) {
  if (!reportId) return;
  const reportPath = `diary_reports/${reportId}`;
  const report = await db.get(reportPath);
  if (!report.exists) return;
  const now = new Date();
  const patch = {
    status: "actioned",
    reviewedBy: actorUid,
    reviewReason: reason,
    reviewedAt: now,
    updatedAt: now,
  };
  const mask = Object.keys(patch);
  await db.commit(null, [
    db.writeUpdate(reportPath, patch, mask),
    db.writeUpdate(`reports/${reportId}`, patch, mask),
    db.writeCreate(`admin_audit_logs/diary_report_action_${key}`, {
      actorUid,
      action: "actionDiaryReport",
      targetType: clean(report.data?.targetType),
      targetId: clean(report.data?.targetId),
      reportId,
      reason,
      before: { status: clean(report.data?.status || "new") },
      after: { status: "actioned" },
      operationId: key,
      createdAt: now,
    }),
  ]);
}

async function deleteDiaryTarget(db, actorUid, body) {
  const diaryId = safeId(body.diaryId, "invalid_diary_id");
  const reportId = clean(body.reportId);
  if (reportId) safeId(reportId, "invalid_report_id");
  const reason = clean(body.reason);
  const key = operationKey(body.idempotencyKey);
  if (reason.length < 3 || reason.length > 200) {
    throw new ModerationApiError("invalid_reason", 400);
  }
  const result = await deleteDiary(
    db,
    actorUid,
    { diaryId, idempotencyKey: key },
    {
      allowAnyOwner: true,
      operationAction: "moderatorDeleteDiary",
      reason,
    },
  );
  await db.commit(null, [
    db.writeCreate(`admin_audit_logs/diary_delete_${key}`, {
      actorUid,
      action: "moderatorDeleteDiary",
      targetType: "diary",
      targetId: diaryId,
      reportId: reportId || null,
      reason,
      operationId: key,
      createdAt: new Date(),
    }),
  ]);
  await markReportActioned(db, actorUid, reportId, reason, key);
  return { ok: true, code: result.code || "ok", ...result };
}

async function deleteCommentTarget(db, actorUid, body) {
  const diaryId = safeId(body.diaryId, "invalid_diary_id");
  const commentId = safeId(body.commentId, "invalid_comment_id");
  const reportId = clean(body.reportId);
  if (reportId) safeId(reportId, "invalid_report_id");
  const reason = clean(body.reason);
  const key = operationKey(body.idempotencyKey);
  if (reason.length < 3 || reason.length > 200) {
    throw new ModerationApiError("invalid_reason", 400);
  }
  const result = await deleteComment(
    db,
    actorUid,
    { diaryId, commentId, idempotencyKey: key },
    {
      allowAnyAuthor: true,
      operationAction: "moderatorDeleteDiaryComment",
      reason,
    },
  );
  await db.commit(null, [
    db.writeCreate(`admin_audit_logs/diary_comment_delete_${key}`, {
      actorUid,
      action: "moderatorDeleteDiaryComment",
      targetType: "diary_comment",
      targetId: commentId,
      diaryId,
      reportId: reportId || null,
      reason,
      operationId: key,
      createdAt: new Date(),
    }),
  ]);
  await markReportActioned(db, actorUid, reportId, reason, key);
  return { ok: true, code: result.code || "ok", ...result };
}

export async function diaryModeration(request, env) {
  if (request.method !== "POST") {
    return json(request, env, { ok: false, code: "method_not_allowed" }, 405);
  }

  try {
    const decoded = await verifyFirebaseIdToken(request, env, {
      checkUserState: false,
    });
    const body = await readJson(request);
    const action = clean(body.action);
    const db = firestoreClient(env);

    if (action === "listReports") {
      await requireCapability(db, decoded, [
        "viewReports",
        "reviewReports",
        "manageDiaries",
        "deleteDiaryComment",
      ]);
      return json(request, env, await listReports(db, body));
    }
    if (action === "reviewReport") {
      const actor = await requireCapability(db, decoded, "reviewReports", {
        recentAuth: true,
      });
      return json(request, env, await reviewReport(db, actor.uid, body));
    }
    if (action === "deleteDiary") {
      const actor = await requireCapability(db, decoded, "manageDiaries", {
        recentAuth: true,
      });
      return json(request, env, await deleteDiaryTarget(db, actor.uid, body));
    }
    if (action === "deleteDiaryComment") {
      const actor = await requireCapability(db, decoded, "deleteDiaryComment", {
        recentAuth: true,
      });
      return json(request, env, await deleteCommentTarget(db, actor.uid, body));
    }

    throw new ModerationApiError("unsupported_action", 400);
  } catch (error) {
    const quota = firestoreQuotaResponse(request, env, error);
    if (quota) return quota;
    if (error instanceof ModerationApiError) {
      return json(request, env, { ok: false, code: error.code }, error.status);
    }
    const code = clean(error?.code || error?.message || "diary_moderation_failed");
    const status = code === "unauthorized" ? 401 : 500;
    return json(request, env, { ok: false, code }, status);
  }
}

export const diaryModerationTestHooks = Object.freeze({
  listReports,
  reviewReport,
  deleteDiaryTarget,
  deleteCommentTarget,
  normalizeReport,
  parseCursor,
});
