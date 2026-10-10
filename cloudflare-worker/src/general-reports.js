import { json, readJson, firestoreQuotaResponse } from "./http.js";
import {
  assertUserDocumentSessionState,
  verifyFirebaseIdToken,
} from "./firebase-auth.js";
import { firestoreClient } from "./firestore.js";
import {
  adminInboxDeleteWrite,
  adminInboxUpsertWrite,
} from "./admin-inbox-index.js";
import { loadPublicProfilePresentations } from "./public-profile-presentation.js";

const clean = (value) => String(value ?? "").trim();
const ACTIVE_STATUSES = new Set(["open", "new", "under_review"]);
const TERMINAL_STATUSES = new Set(["rejected", "actioned", "closed"]);
const TRANSITIONS = {
  open: new Set(["under_review", "rejected"]),
  new: new Set(["under_review", "rejected"]),
  under_review: new Set(["actioned", "rejected", "closed"]),
  actioned: new Set(["closed"]),
};
const READ_CAPABILITIES = ["viewReports", "reviewReports"];

class GeneralReportError extends Error {
  constructor(code, status = 400) {
    super(code);
    this.code = code;
    this.status = status;
  }
}

function safeId(input, code = "invalid_report_id") {
  const value = clean(input);
  if (!/^[A-Za-z0-9_-]{1,180}$/.test(value)) {
    throw new GeneralReportError(code, 400);
  }
  return value;
}

function timestampMs(value) {
  if (value instanceof Date) return value.getTime();
  if (typeof value?.toDate === "function") return value.toDate().getTime();
  if (typeof value === "number") return value;
  if (value && typeof value === "object") {
    const seconds = Number(value.seconds ?? value._seconds ?? 0);
    if (seconds > 0) return seconds * 1000;
  }
  const valueMs = Date.parse(String(value || ""));
  return Number.isFinite(valueMs) ? valueMs : 0;
}

export function generalReportType(data = {}) {
  const targetType = clean(data.targetType);
  if (targetType === "room_message") return "room_message_report";
  if (targetType === "room") return "room_report";
  if (clean(data.type) === "user" && clean(data.source) === "private_chat") {
    return "user_report";
  }
  return "";
}

function normalizeGeneralReport(reportId, data = {}) {
  const type = generalReportType(data);
  if (!type) return null;
  return {
    reportId,
    type,
    reporterUid: clean(data.reporterUid || data.reporterId),
    targetUid: clean(data.targetUid || data.targetUserId),
    conversationId: clean(data.conversationId),
    roomId: clean(data.roomId),
    messageId: clean(data.messageId),
    reason: clean(data.reason),
    details: clean(data.details),
    status: clean(data.status) || "new",
    evidence: type === "room_message_report" &&
        data.evidence && typeof data.evidence === "object"
      ? data.evidence
      : null,
    createdAtMs: timestampMs(data.createdAt),
    reviewReason: clean(data.reviewReason),
    reviewedBy: clean(data.reviewedBy),
  };
}

async function withGeneralReportProfiles(db, items) {
  const uids = items.flatMap((item) => [item.reporterUid, item.targetUid])
    .filter(Boolean);
  // At most 25 rows / 50 distinct profile lookups, batched in the existing
  // presentation helper. Do not query users/* or infer online/hidden state.
  const profiles = await loadPublicProfilePresentations(db, uids, {
    limit: 50,
    concurrency: 8,
  }).catch(() => new Map());
  return items.map((item) => ({
    ...item,
    reporterProfile: profiles.get(item.reporterUid) || null,
    targetProfile: profiles.get(item.targetUid) || null,
  }));
}

async function listGeneralReports(db, body = {}) {
  const limit = Math.max(1, Math.min(25, Number(body.limit || 20) || 20));
  // Existing room and private chat reports differ in schema. Three bounded
  // queries, not a scan or a listener, cover old and new documents.
  const [chat, roomMessages, rooms] = await Promise.all([
    db.runQuery("reports", {
      filters: [{ field: "type", op: "==", value: "user" }],
      limit: 30,
    }),
    db.runQuery("reports", {
      filters: [{ field: "targetType", op: "==", value: "room_message" }],
      limit: 30,
    }),
    db.runQuery("reports", {
      filters: [{ field: "targetType", op: "==", value: "room" }],
      limit: 30,
    }),
  ]);
  const seen = new Set();
  const normalized = [...chat, ...roomMessages, ...rooms]
    .map((row) => normalizeGeneralReport(row?.id || "", row?.data || {}))
    .filter((item) => {
      if (!item || !ACTIVE_STATUSES.has(item.status) ||
          seen.has(item.reportId)) return false;
      seen.add(item.reportId);
      return true;
    })
    .sort((a, b) => b.createdAtMs - a.createdAtMs ||
      b.reportId.localeCompare(a.reportId));
  const selected = normalized.slice(0, limit);
  return {
    ok: true,
    items: await withGeneralReportProfiles(db, selected),
    capped: normalized.length > limit ||
      chat.length === 30 || roomMessages.length === 30 || rooms.length === 30,
    limit,
  };
}

async function getGeneralReport(db, body = {}) {
  const reportId = safeId(body.reportId);
  const snap = await db.get("reports/" + reportId);
  const report = snap.exists
    ? normalizeGeneralReport(reportId, snap.data || {})
    : null;
  if (!report) throw new GeneralReportError("report_not_found", 404);
  const [enriched] = await withGeneralReportProfiles(db, [report]);
  return { ok: true, item: enriched };
}

async function reviewGeneralReport(db, actorUid, body = {}) {
  const reportId = safeId(body.reportId);
  const status = clean(body.status);
  const reason = clean(body.reason);
  const key = clean(body.idempotencyKey);
  if (!/^[A-Za-z0-9_-]{12,180}$/.test(key)) {
    throw new GeneralReportError("invalid_idempotency_key", 400);
  }
  if (reason.length < 3 || reason.length > 200) {
    throw new GeneralReportError("invalid_reason", 400);
  }
  if (![...TERMINAL_STATUSES, "under_review"].includes(status)) {
    throw new GeneralReportError("invalid_report_transition", 400);
  }
  const trx = await db.beginTransaction();
  try {
    const operationPath = "control_operations/" + key;
    const reportPath = "reports/" + reportId;
    const [operation, report] = await Promise.all([
      db.get(operationPath, trx),
      db.get(reportPath, trx),
    ]);
    if (operation.exists) {
      await db.rollback(trx);
      return { ok: true, code: "duplicate", ...(operation.data?.result || {}) };
    }
    const item = report.exists
      ? normalizeGeneralReport(reportId, report.data || {})
      : null;
    if (!item) throw new GeneralReportError("report_not_found", 404);
    if (!TRANSITIONS[item.status]?.has(status)) {
      throw new GeneralReportError("invalid_report_transition", 409);
    }
    const now = new Date();
    const patch = {
      status,
      reviewReason: reason,
      reviewedBy: actorUid,
      reviewedAt: now,
      updatedAt: now,
    };
    const result = { reportId, status };
    const indexWrite = ACTIVE_STATUSES.has(status)
      ? adminInboxUpsertWrite(db, {
          type: item.type,
          title: item.type === "user_report"
            ? "بلاغ عن مستخدم في محادثة خاصة"
            : item.type === "room_report" ? "بلاغ عن غرفة"
              : "بلاغ عن رسالة داخل غرفة",
          body: "بلاغ قيد مراجعة الإدارة",
          targetId: reportId,
          route: "general_reports",
          createdAt: new Date(item.createdAtMs || now.getTime()),
          priority: "high",
          meta: {
            reporterUid: item.reporterUid,
            targetUid: item.targetUid,
            roomId: item.roomId || null,
            conversationId: item.conversationId || null,
            status,
          },
        })
      : adminInboxDeleteWrite(db, item.type, reportId);
    await db.commit(trx, [
      db.writeUpdate(reportPath, patch, Object.keys(patch)),
      indexWrite,
      db.writeCreate("admin_audit_logs/general_report_" + key, {
        action: "reviewGeneralReport",
        actorUid,
        reportId,
        targetType: item.type,
        targetUid: item.targetUid,
        reason,
        before: { status: item.status },
        after: { status },
        createdAt: now,
      }),
      db.writeCreate(operationPath, {
        action: "reviewGeneralReport",
        actorUid,
        targetType: item.type,
        targetId: reportId,
        status: "completed",
        result,
        createdAt: now,
      }),
    ]);
    return { ok: true, code: "ok", ...result };
  } catch (error) {
    await db.rollback(trx);
    throw error;
  }
}

async function requireAdmin(db, decoded, write = false) {
  const uid = clean(decoded?.sub);
  if (!uid) throw new GeneralReportError("unauthorized", 401);
  if (write) {
    const seconds = Math.floor(Date.now() / 1000) - Number(decoded.auth_time || 0);
    if (!Number.isFinite(seconds) || seconds < 0 || seconds > 1800) {
      throw new GeneralReportError("recent_auth_required", 401);
    }
  }
  const user = await db.get("users/" + uid);
  const data = user?.data || {};
  if (user.exists) assertUserDocumentSessionState(decoded, data);
  const owner = clean(data.role) === "owner";
  const caps = Array.isArray(data.capabilities) ? data.capabilities.map(clean) : [];
  const allowed = user.exists && (owner || data.adminEnabled === true) &&
    (owner || (write ? caps.includes("reviewReports")
      : READ_CAPABILITIES.some((cap) => caps.includes(cap))));
  if (!allowed) throw new GeneralReportError("forbidden", 403);
  return { uid, canReview: owner || caps.includes("reviewReports") };
}

export async function generalReports(request, env) {
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
    const actor = await requireAdmin(db, decoded, action === "reviewReport");
    const result = action === "listReports"
      ? await listGeneralReports(db, body)
      : action === "getReport"
        ? await getGeneralReport(db, body)
        : action === "reviewReport"
          ? await reviewGeneralReport(db, actor.uid, body)
          : null;
    if (!result) throw new GeneralReportError("unsupported_action", 400);
    return json(request, env, { ...result, canReview: actor.canReview });
  } catch (error) {
    const quota = firestoreQuotaResponse(request, env, error);
    if (quota) return quota;
    if (error instanceof GeneralReportError) {
      return json(request, env, { ok: false, code: error.code }, error.status);
    }
    const code = clean(error?.code || error?.message || "general_reports_failed");
    return json(request, env, { ok: false, code }, code === "unauthorized" ? 401 : 500);
  }
}

export const generalReportsTestHooks = Object.freeze({
  generalReportType,
  normalizeGeneralReport,
  listGeneralReports,
  getGeneralReport,
  reviewGeneralReport,
});
