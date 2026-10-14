import { json, readJson, firestoreQuotaResponse } from "./http.js";
import {
  assertUserDocumentSessionState,
  verifyFirebaseIdToken,
} from "./firebase-auth.js";
import { firestoreClient } from "./firestore.js";
import {
  adminInboxDeleteWrites,
  adminInboxIndexPath,
  adminInboxLegacyIndexPath,
  adminInboxUpsertWrite,
} from "./admin-inbox-index.js";
import { loadPublicProfilePresentations } from "./public-profile-presentation.js";
import { reporterReportNotificationWrites } from "./reporter-report-notifications.js";
import { mutateAccount } from "./manage-user-account.js";

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
  // A direct complaint about a profile is not a message complaint.
  if (targetType === "user") return "account_report";
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
    moderationAction: clean(data.moderationAction),
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
  // One tab loads only its matching sources. Keep legacy no-scope callers
  // unchanged, with the same three bounded queries and no listeners/scans.
  const scope = clean(body.scope);
  if (scope && !["people", "rooms_messages"].includes(scope)) {
    throw new GeneralReportError("invalid_report_scope", 400);
  }
  const includePeople = scope !== "rooms_messages";
  const includeRooms = scope !== "people";
  const [chat, roomMessages, rooms, accounts] = await Promise.all([
    includeRooms ? db.runQuery("reports", {
      filters: [{ field: "type", op: "==", value: "user" }],
      limit: 30,
    }) : Promise.resolve([]),
    includeRooms ? db.runQuery("reports", {
      filters: [{ field: "targetType", op: "==", value: "room_message" }],
      limit: 30,
    }) : Promise.resolve([]),
    includeRooms ? db.runQuery("reports", {
      filters: [{ field: "targetType", op: "==", value: "room" }],
      limit: 30,
    }) : Promise.resolve([]),
    includePeople ? db.runQuery("reports", {
      filters: [{ field: "targetType", op: "==", value: "user" }],
      limit: 30,
    }) : Promise.resolve([]),
  ]);
  const seen = new Set();
  const normalized = [...chat, ...roomMessages, ...rooms, ...accounts]
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
      chat.length === 30 || roomMessages.length === 30 ||
      rooms.length === 30 || accounts.length === 30,
    limit,
  };
}

// Archived/closed and current reports need a browsable history, but never
// a full collection scan. Each explicit page reads at most 21 reports of ONE
// selected category. __name__ is stable even for legacy records without dates.
const HISTORY_FILTERS = Object.freeze({
  user_report: [{ field: "type", op: "==", value: "user" }],
  account_report: [{ field: "targetType", op: "==", value: "user" }],
  room_message_report: [{
    field: "targetType", op: "==", value: "room_message",
  }],
  room_report: [{ field: "targetType", op: "==", value: "room" }],
});
const HISTORY_PAGE_SIZE = 20;

async function listReportHistory(db, body = {}) {
  const type = clean(body.type);
  const filters = HISTORY_FILTERS[type];
  if (!filters) throw new GeneralReportError("invalid_report_type", 400);
  const cursor = clean(body.cursor);
  if (cursor) safeId(cursor, "invalid_cursor");
  const raw = await db.runQuery("reports", {
    filters,
    orderBy: [{ field: "__name__", direction: "desc" }],
    ...(cursor ? { startAfter: [{ referencePath: "reports/" + cursor }] } : {}),
    limit: HISTORY_PAGE_SIZE + 1,
  });
  const page = raw.slice(0, HISTORY_PAGE_SIZE);
  const normalized = page
    .map((row) => normalizeGeneralReport(row?.id || "", row?.data || {}))
    .filter((item) => item?.type === type);
  // The cursor advances by the *last read* document (including filtered
  // legacy records), so no page becomes stuck on a foreign report.
  return {
    ok: true,
    type,
    items: await withGeneralReportProfiles(db, normalized),
    nextCursor: raw.length > HISTORY_PAGE_SIZE ? clean(page.at(-1)?.id) : null,
    hasMore: raw.length > HISTORY_PAGE_SIZE,
    pageSize: HISTORY_PAGE_SIZE,
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

async function reviewGeneralReport(db, actorUid, body = {}, verified = {}) {
  const reportId = safeId(body.reportId);
  const status = clean(body.status);
  const reason = clean(body.reason);
  const key = clean(body.idempotencyKey);
  if (!/^[A-Za-z0-9_-]{12,180}$/.test(key)) {
    throw new GeneralReportError("invalid_idempotency_key", 400);
  }
  // Never let a normal review request claim a completed sanction. Only
  // resolveWithAccountAction may reach this status with an authorized receipt.
  if (status === "actioned" && !clean(verified.actionKind)) {
    throw new GeneralReportError("action_requires_execution", 409);
  }
  // A rejection explanation is optional; other admin decisions still
  // require a clear internal audit reason.
  if (reason.length > 200 || (status !== "rejected" && reason.length < 3) ||
      (reason.length > 0 && reason.length < 3)) {
    throw new GeneralReportError("invalid_reason", 400);
  }
  if (![...TERMINAL_STATUSES, "under_review"].includes(status)) {
    throw new GeneralReportError("invalid_report_transition", 400);
  }
  const trx = await db.beginTransaction();
  try {
    const operationPath = "control_operations/" + key;
    const reportPath = "reports/" + reportId;
    // Resolve the authoritative type before checking an old index row.
    const [operation, report] = await Promise.all([
      db.get(operationPath, trx),
      db.get(reportPath, trx),
    ]);
    if (operation.exists) {
      const previous = operation.data || {};
      if (clean(previous.action) !== "reviewGeneralReport" ||
          clean(previous.actorUid) !== actorUid ||
          clean(previous.result?.reportId) !== reportId ||
          clean(previous.result?.status) !== status) {
        throw new GeneralReportError("idempotency_key_conflict", 409);
      }
      await db.rollback(trx);
      return { ok: true, code: "duplicate", ...(previous.result || {}) };
    }
    const item = report.exists
      ? normalizeGeneralReport(reportId, report.data || {})
      : null;
    if (!item) throw new GeneralReportError("report_not_found", 404);
    if (!TRANSITIONS[item.status]?.has(status)) {
      throw new GeneralReportError("invalid_report_transition", 409);
    }
    const legacyPath = adminInboxLegacyIndexPath(item.type, reportId);
    const hasDistinctLegacy = legacyPath !== adminInboxIndexPath(item.type, reportId);
    const legacyIndex = hasDistinctLegacy
      ? await db.get(legacyPath, trx) : null;
    // When a suspension or ban is reported to the complainant, require a
    // completed, authorized account-operation receipt for this exact user.
    const trustedAction = clean(verified.actionKind);
    if (trustedAction) {
      const opKey = clean(verified.operationKey);
      if (!/^[A-Za-z0-9_-]{12,180}$/.test(opKey) ||
          !["warning", "account_suspended", "account_banned",
            "private_messages_restricted"].includes(trustedAction) ||
          status !== "actioned") {
        throw new GeneralReportError("invalid_verified_action", 400);
      }
      const verifiedOperation = await db.get("control_operations/" + opKey, trx);
      const expected = trustedAction === "account_banned" ? "ban"
        : trustedAction === "warning" ? "warn"
          : trustedAction === "private_messages_restricted"
            ? "restrictPrivateMessages" : "suspend";
      if (!verifiedOperation.exists ||
          clean(verifiedOperation.data?.action) !== expected ||
          clean(verifiedOperation.data?.actorUid) !== actorUid ||
          clean(verifiedOperation.data?.targetId) !== item.targetUid ||
          clean(verifiedOperation.data?.status) !== "completed" ||
          clean(verifiedOperation.data?.result?.targetUid) !== item.targetUid ||
          clean(verifiedOperation.data?.result?.action) !== expected ||
          clean(verifiedOperation.data?.result?.linkedReportId) !== reportId) {
        throw new GeneralReportError("unverified_account_action", 409);
      }
    }
    const now = new Date();
    const patch = {
      ...(trustedAction ? { moderationAction: trustedAction } : {}),
      status,
      reviewReason: reason,
      reviewedBy: actorUid,
      reviewedAt: now,
      updatedAt: now,
    };
    const result = { reportId, status, ...(trustedAction ? { moderationAction: trustedAction } : {}) };
    const indexWrites = ACTIVE_STATUSES.has(status)
      ? [adminInboxUpsertWrite(db, {
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
        })]
      : adminInboxDeleteWrites(db, item.type, reportId, legacyIndex);
    await db.commit(trx, [
      db.writeUpdate(reportPath, patch, Object.keys(patch)),
      ...indexWrites,
      ...reporterReportNotificationWrites(db, {
        reportId,
        reporterUid: item.reporterUid,
        status,
        actionKind: trustedAction,
        reason: status === "rejected" ? reason : "",
        operationKey: key,
        subject: item.type,
        now,
      }),
      db.writeCreate("admin_audit_logs/general_report_" + key, {
        action: "reviewGeneralReport",
        actorUid,
        reportId,
        targetType: item.type,
        targetUid: item.targetUid,
        reason,
        before: { status: item.status },
        after: { status, ...(trustedAction ? { moderationAction: trustedAction } : {}) },
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

async function resolveWithAccountAction(db, env, decoded, actorUid, body = {}) {
  const reportId = safeId(body.reportId);
  const accountAction = clean(body.accountAction);
  const reason = clean(body.reason);
  const key = clean(body.idempotencyKey);
  if (!["warn", "suspend", "ban", "restrictPrivateMessages"].includes(accountAction) ||
      reason.length < 3 || reason.length > 160 ||
      !/^[A-Za-z0-9_-]{12,148}$/.test(key)) {
    throw new GeneralReportError("invalid_account_action", 400);
  }
  const reviewKey = key + "_resolution";
  const accountKey = key + "_account";
  const existingResolution = await db.get("control_operations/" + reviewKey);
  if (existingResolution.exists) {
    const saved = existingResolution.data || {};
    const actionKind = accountAction === "warn" ? "warning"
      : accountAction === "ban" ? "account_banned"
        : accountAction === "restrictPrivateMessages"
          ? "private_messages_restricted" : "account_suspended";
    if (clean(saved.action) !== "reviewGeneralReport" ||
        clean(saved.actorUid) !== actorUid ||
        clean(saved.result?.reportId) !== reportId ||
        clean(saved.result?.status) !== "actioned" ||
        clean(saved.result?.moderationAction) !== actionKind) {
      throw new GeneralReportError("idempotency_key_conflict", 409);
    }
    return { ok: true, code: "duplicate", ...(saved.result || {}) };
  }
  const report = await db.get("reports/" + reportId);
  const item = report.exists
    ? normalizeGeneralReport(reportId, report.data || {})
    : null;
  if (!item) throw new GeneralReportError("report_not_found", 404);
  if (item.status !== "under_review" || !item.targetUid) {
    throw new GeneralReportError("invalid_report_transition", 409);
  }

  // Uses the existing account management service, including role, capability,
  // owner-protection, duration, audit and account-state safeguards. If its
  // separate transaction committed, a retry with the SAME key is idempotent.
  await mutateAccount(db, env, decoded, {
    targetUid: item.targetUid,
    accountAction,
    reason,
    durationMinutes: body.durationMinutes,
    linkedReportId: reportId,
    idempotencyKey: accountKey,
  });
  return reviewGeneralReport(db, actorUid, {
    reportId,
    status: "actioned",
    reason,
    idempotencyKey: reviewKey,
  }, {
    operationKey: accountKey,
    actionKind: accountAction === "warn" ? "warning"
      : accountAction === "ban" ? "account_banned"
        : accountAction === "restrictPrivateMessages"
          ? "private_messages_restricted" : "account_suspended",
  });
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
  return {
    uid, canReview: owner || caps.includes("reviewReports"),
    canWarn: owner || (data.adminEnabled === true &&
      (caps.includes("suspendUsers") || caps.includes("manageUsers"))),
    canSuspend: owner || (data.adminEnabled === true &&
      (caps.includes("suspendUsers") || caps.includes("manageUsers"))),
    canRestrictPrivateMessages: owner || (data.adminEnabled === true &&
      (caps.includes("suspendUsers") || caps.includes("manageUsers"))),
    canBan: owner || (data.adminEnabled === true && caps.includes("manageUsers")),
  };
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
    const actor = await requireAdmin(db, decoded,
      action === "reviewReport" || action === "applyAccountAction");
    const result = action === "listReports"
      ? await listGeneralReports(db, body)
      : action === "listHistory"
        ? await listReportHistory(db, body)
        : action === "getReport"
        ? await getGeneralReport(db, body)
        : action === "reviewReport"
          ? await reviewGeneralReport(db, actor.uid, body)
          : action === "applyAccountAction"
            ? await resolveWithAccountAction(db, env, decoded, actor.uid, body)
            : null;
    if (!result) throw new GeneralReportError("unsupported_action", 400);
    return json(request, env, {
      ...result, canReview: actor.canReview,
      canWarn: actor.canWarn,
      canSuspend: actor.canSuspend, canBan: actor.canBan,
      canRestrictPrivateMessages: actor.canRestrictPrivateMessages,
    });
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
  listReportHistory,
  getGeneralReport,
  reviewGeneralReport,
  resolveWithAccountAction,
});
