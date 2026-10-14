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
import { readProtectedReportEvidence } from "./report-evidence-access.js";
import { openReportScreenshot } from "./report-screenshot.js";
import { evidenceDeadline, setReportEvidenceHold } from "./report-evidence-retention.js";
import { contentFilterControlInternals } from "./content-filter-control.js";
import { CONTENT_FILTER_COORDINATOR_ID } from "./content-filter.js";
import { reportPriority, reportPriorityRank, validReportPriority } from "./report-priority-policy.js";

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
    priority: reportPriority(type, data.reason, data.priorityOverride),
    priorityOverride: validReportPriority(data.priorityOverride)
      ? clean(data.priorityOverride) : "",
    priorityReason: clean(data.priorityReason),
    priorityChangedBy: clean(data.priorityChangedBy),
    // Never return source evidence with normal report lists or details.
    // Opening it requires a different explicit capability and audited request.
    evidenceHold: data.evidenceHold === true,
    hasSensitiveEvidence: Boolean(data.evidence &&
      typeof data.evidence === "object" &&
      Object.keys(data.evidence).length > 0),
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
    .sort((a, b) =>
      reportPriorityRank(a.priority) - reportPriorityRank(b.priority) ||
      b.createdAtMs - a.createdAtMs ||
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

async function openGeneralSensitiveEvidence(db, actor, body = {}) {
  if (!actor?.canViewSensitiveEvidence) {
    throw new GeneralReportError("forbidden_evidence", 403);
  }
  const reportId = safeId(body.reportId);
  // The normal report endpoint already distinguishes this source from diaries.
  const snap = await db.get("reports/" + reportId);
  if (!snap.exists || !generalReportType(snap.data || {})) {
    throw new GeneralReportError("report_not_found", 404);
  }
  return readProtectedReportEvidence(db, {
    collection: "reports", reportId, actorUid: actor.uid,
  });
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

// On-demand context only. Never infer that a rejected report was malicious,
// never auto-penalize a reporter. Two bounded indexed queries reuse the
// existing reports collection and support legacy reporterId records.
async function getReporterContext(db, body = {}) {
  const reportId = safeId(body.reportId);
  const source = await db.get("reports/" + reportId);
  const selected = source.exists
    ? normalizeGeneralReport(reportId, source.data || {}) : null;
  if (!selected) throw new GeneralReportError("report_not_found", 404);
  const reporterUid = selected.reporterUid;
  if (!/^[A-Za-z0-9_-]{1,180}$/.test(reporterUid)) {
    throw new GeneralReportError("reporter_unavailable", 409);
  }
  const [current, legacy] = await Promise.all([
    db.runQuery("reports", {
      filters: [{ field: "reporterUid", op: "==", value: reporterUid }],
      limit: 21,
    }),
    db.runQuery("reports", {
      filters: [{ field: "reporterId", op: "==", value: reporterUid }],
      limit: 21,
    }),
  ]);
  const seen = new Set();
  const items = [...current, ...legacy].filter((row) => {
    const id = clean(row?.id);
    if (!id || seen.has(id)) return false;
    seen.add(id);
    return true;
  }).slice(0, 40);
  const counts = {
    rejected: 0, actioned: 0, pending: 0, other: 0,
  };
  for (const row of items) {
    const status = clean(row?.data?.status) || "new";
    if (status === "rejected") counts.rejected += 1;
    else if (status === "actioned") counts.actioned += 1;
    else if (ACTIVE_STATUSES.has(status)) counts.pending += 1;
    else counts.other += 1;
  }
  return {
    ok: true, reportId, reporterUid,
    sampled: items.length, counts,
    capped: current.length >= 21 || legacy.length >= 21,
    nonPunitive: true,
  };
}

// U6-E: read already-committed account operations, never complaints as
// violations. No additional collection, listener, scan or background index.
// A case is confirmed only when the completed account operation matches a
// finalized, reviewed report. Evidence bodies are deliberately never returned.
const ACCOUNT_HISTORY_ACTIONS = new Set([
  "warn", "suspend", "ban", "disable", "unban", "enable",
  "restrictPrivateMessages", "restrictRoomChat", "restrictRoomEntry",
  "restrictRoomMic", "liftPrivateMessagesRestriction",
  "liftRoomChatRestriction", "liftRoomEntryRestriction",
  "liftRoomMicRestriction",
  "moderatorDeleteDiary", "moderatorDeleteDiaryComment",
]);
const ACCOUNT_HISTORY_CASE_ACTIONS = Object.freeze({
  warn: "warning", suspend: "account_suspended",
  ban: "account_banned",
  restrictPrivateMessages: "private_messages_restricted",
  restrictRoomChat: "room_chat_restricted",
  restrictRoomEntry: "room_entry_restricted",
  restrictRoomMic: "room_mic_restricted",
  moderatorDeleteDiary: "diary_deleted",
  moderatorDeleteDiaryComment: "diary_comment_deleted",
});
const ACCOUNT_HISTORY_PAGE_SIZE = 20;
// Read only the single current user record to prove a sanction remains active.
// Legacy records without a durable origin marker are not linked by guesswork.
const ACCOUNT_HISTORY_RESTRICTIONS = Object.freeze({
  restrictPrivateMessages: ["privateMessagesRestrictionOperationId", "privateMessagesRestrictedUntil"],
  restrictRoomChat: ["roomChatRestrictionOperationId", "roomChatRestrictedUntil"],
  restrictRoomEntry: ["roomEntryRestrictionOperationId", "roomEntryRestrictedUntil"],
  restrictRoomMic: ["roomMicRestrictionOperationId", "roomMicRestrictedUntil"],
});
const ACCOUNT_HISTORY_LIFTS = new Set([
  "unban", "enable", "liftPrivateMessagesRestriction",
  "liftRoomChatRestriction", "liftRoomEntryRestriction",
  "liftRoomMicRestriction",
]);
async function accountHistoryReadMany(db, paths) {
  if (!paths.length) return [];
  if (typeof db.getMany === "function") return db.getMany(paths);
  return Promise.all(paths.map((path) => db.get(path)));
}

async function getAccountActionHistory(db, body = {}) {
  const targetUid = safeId(body.targetUid, "invalid_target_uid");
  const cursor = clean(body.cursor);
  // Indexed content-deletion keys include the 180-character source ID
  // and a deterministic prefix. Cursor characters remain path-safe.
  if (cursor && !/^[A-Za-z0-9_-]{1,220}$/.test(cursor)) {
    throw new GeneralReportError("invalid_cursor", 400);
  }
  // Firestore's single-field targetId index + document-name cursor: 21
  // operations maximum, regardless of the account's total history.
  const rows = await db.runQuery("control_operations", {
    filters: [{ field: "targetId", op: "==", value: targetUid }],
    orderBy: [{ field: "__name__", direction: "desc" }],
    ...(cursor ? {
      startAfter: [{ referencePath: "control_operations/" + cursor }],
    } : {}),
    limit: ACCOUNT_HISTORY_PAGE_SIZE + 1,
  });
  const page = rows.slice(0, ACCOUNT_HISTORY_PAGE_SIZE);
  const valid = page.filter((row) => {
    const op = row?.data || {};
    return ACCOUNT_HISTORY_ACTIONS.has(clean(op.action)) &&
      clean(op.targetType) === "user" &&
      clean(op.targetId) === targetUid &&
      clean(op.status) === "completed" &&
      clean(op.result?.action) === clean(op.action) &&
      clean(op.result?.targetUid) === targetUid;
  });
  const audits = await accountHistoryReadMany(db, valid.map((row) => {
    const action = clean(row.data?.action);
    const sourceId = clean(row.data?.result?.sourceOperationId);
    if (row.id === "history_diary_" + sourceId && sourceId &&
        action === "moderatorDeleteDiary") {
      return "admin_audit_logs/diary_delete_" + sourceId;
    }
    if (row.id === "history_diary_" + sourceId && sourceId &&
        action === "moderatorDeleteDiaryComment") {
      return "admin_audit_logs/diary_comment_delete_" + sourceId;
    }
    return "admin_audit_logs/account_" + row.id;
  }));
  const linked = valid.filter((row) => clean(row.data?.result?.linkedReportId));
  const reports = await accountHistoryReadMany(db, linked.map(
    (row) => "reports/" + clean(row.data.result.linkedReportId)));
  const reportByKey = new Map(linked.map((row, i) => [row.id, reports[i]]));
  const targetSnap = await db.get("users/" + targetUid);
  const target = targetSnap.exists ? targetSnap.data || {} : {};
  const nowMs = Date.now();
  const items = valid.map((row, i) => {
    const operation = row.data || {};
    const result = operation.result || {};
    const audit = audits[i]?.exists ? audits[i].data || {} : {};
    const reportId = clean(result.linkedReportId);
    const reportSnap = reportByKey.get(row.id);
    const report = reportSnap?.exists ? reportSnap.data || {} : {};
    const expectedKind = ACCOUNT_HISTORY_CASE_ACTIONS[clean(operation.action)];
    const caseVerified = Boolean(expectedKind && reportId &&
      reportSnap?.exists &&
      ["actioned", "closed"].includes(clean(report.status)) &&
      clean(report.moderationAction) === expectedKind &&
      // A different reviewer may later close an already-actioned case.
      // The immutable account receipt establishes who executed the action.
      clean(report.targetUid || report.targetUserId ||
        report.targetAuthorUid || report.targetOwnerUid) === targetUid);
    const action = clean(operation.action);
    const restriction = ACCOUNT_HISTORY_RESTRICTIONS[action];
    const expiry = result.privateMessagesRestrictedUntil ||
      result.roomChatRestrictedUntil || result.roomEntryRestrictedUntil ||
      result.roomMicRestrictedUntil || result.suspendedUntil || null;
    const expiryMs = timestampMs(expiry);
    const lifecycle = operation.lifecycle || {};
    const changeType = ["lifted", "replaced"].includes(clean(lifecycle.type)) &&
      /^[A-Za-z0-9_-]{12,180}$/.test(clean(lifecycle.operationId)) &&
      timestampMs(lifecycle.at) >= timestampMs(operation.createdAt)
      ? clean(lifecycle.type) : "";
    const isCurrentRestriction = Boolean(restriction &&
      clean(target[restriction[0]]) === row.id &&
      timestampMs(target[restriction[1]]) === expiryMs && expiryMs > nowMs);
    const statusForAction = { suspend: "suspended", ban: "banned", disable: "disabled" };
    const isCurrentAccountSanction = Boolean(statusForAction[action] &&
      clean(target.accountModerationOperationId) === row.id &&
      clean(target.accountStatus) === statusForAction[action] &&
      (action !== "suspend" || (expiryMs > nowMs &&
        timestampMs(target.suspendedUntil) === expiryMs)));
    const timed = Boolean(restriction || action === "suspend");
    const permanent = action === "ban" || action === "disable";
    const isLift = ACCOUNT_HISTORY_LIFTS.has(action);
    const lifecycleState = isLift ? "lift_recorded" :
      changeType || (timed && expiryMs > 0 && expiryMs <= nowMs ? "expired" :
      isCurrentRestriction || isCurrentAccountSanction
        ? permanent ? "permanent" : "active"
        : action === "warn" || action.startsWith("moderatorDelete")
          ? "completed" : "unknown");
    return {
      operationId: clean(row.id),
      action: clean(operation.action),
      actorUid: clean(operation.actorUid),
      reason: clean(audit.reason),
      createdAtMs: timestampMs(operation.createdAt),
      expiresAtMs: expiryMs,
      durationMinutes: Number.isInteger(result.durationMinutes) &&
        result.durationMinutes >= 10 && result.durationMinutes <= 43200
        ? result.durationMinutes : null,
      expired: expiryMs > 0 && expiryMs <= nowMs,
      lifecycleState,
      permanentSanction: permanent,
      originalOperationId: isLift ? clean(result.originalOperationId) : "",
      changedByOperationId: changeType ? clean(lifecycle.operationId) : "",
      changedByUid: changeType ? clean(lifecycle.actorUid) : "",
      changedAtMs: changeType ? timestampMs(lifecycle.at) : 0,
      changeReason: changeType ? clean(lifecycle.reason) : "",
      liftedRestriction: clean(result.liftedRestriction),
      restrictionLiftedAtMs: timestampMs(result.restrictionLiftedAt),
      // The case link is only trustworthy after review has actually finalized.
      caseVerified,
      reportId: caseVerified ? reportId : "",
      // Only a verified case may provide a deep link to its existing review
      // screen. The history response still never includes evidence content.
      reportSource: caseVerified
        ? (["diary", "diary_comment"].includes(clean(report.targetType))
          ? "diary" : "general") : "",
      hasCaseEvidence: caseVerified && Boolean(
        report.evidence || report.messageId || report.targetId),
    };
  });
  return {
    ok: true, targetUid, items,
    hasMore: rows.length > ACCOUNT_HISTORY_PAGE_SIZE,
    nextCursor: rows.length > ACCOUNT_HISTORY_PAGE_SIZE
      ? clean(page.at(-1)?.id) : null,
    pageSize: ACCOUNT_HISTORY_PAGE_SIZE,
    // Counts and labels apply only to this bounded page, not to all history.
    confirmedInPage: items.filter((item) => item.caseVerified).length,
  };
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
            "private_messages_restricted", "room_chat_restricted",
            "room_entry_restricted", "room_mic_restricted"].includes(trustedAction) ||
          status !== "actioned") {
        throw new GeneralReportError("invalid_verified_action", 400);
      }
      const verifiedOperation = await db.get("control_operations/" + opKey, trx);
      const expected = trustedAction === "account_banned" ? "ban"
        : trustedAction === "warning" ? "warn"
          : trustedAction === "private_messages_restricted"
            ? "restrictPrivateMessages"
            : trustedAction === "room_chat_restricted"
              ? "restrictRoomChat"
              : trustedAction === "room_entry_restricted"
                ? "restrictRoomEntry"
                : trustedAction === "room_mic_restricted"
                  ? "restrictRoomMic" : "suspend";
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
      ...(TERMINAL_STATUSES.has(status) ? {
        evidencePurgeAt: evidenceDeadline(now),
        evidenceRetentionDueAt: evidenceDeadline(now),
      } : {}),
    };
    const result = { reportId, status, ...(trustedAction ? { moderationAction: trustedAction } : {}) };
    const indexWrites = ACTIVE_STATUSES.has(status)
      ? [adminInboxUpsertWrite(db, {
          type: item.type,
          title: item.type === "user_report"
            ? "بلاغ عن مستخدم في محادثة خاصة"
            : item.type === "account_report" ? "بلاغ مباشر عن حساب"
              : item.type === "room_report" ? "بلاغ عن غرفة"
                : "بلاغ عن رسالة داخل غرفة",
          body: "بلاغ قيد مراجعة الإدارة",
          targetId: reportId,
          route: "general_reports",
          createdAt: new Date(item.createdAtMs || now.getTime()),
          priority: item.priority,
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

// Admin override is an independent, idempotent operation. It cannot mark a
// report as resolved or punish anyone; only the inbox priority is updated.
async function setReportPriority(db, actorUid, body = {}) {
  const reportId = safeId(body.reportId);
  const priority = clean(body.priority);
  const reason = clean(body.reason);
  const key = clean(body.idempotencyKey);
  if (!validReportPriority(priority)) {
    throw new GeneralReportError("invalid_report_priority", 400);
  }
  if (reason.length < 3 || reason.length > 200) {
    throw new GeneralReportError("invalid_reason", 400);
  }
  if (!/^[A-Za-z0-9_-]{12,180}$/.test(key)) {
    throw new GeneralReportError("invalid_idempotency_key", 400);
  }
  const tx = await db.beginTransaction();
  try {
    const opPath = "control_operations/" + key;
    const reportPath = "reports/" + reportId;
    const [operation, snapshot] = await Promise.all([
      db.get(opPath, tx), db.get(reportPath, tx),
    ]);
    if (operation.exists) {
      const old = operation.data || {};
      if (clean(old.action) !== "setReportPriority" ||
          clean(old.actorUid) !== actorUid ||
          clean(old.targetId) !== reportId ||
          clean(old.result?.priority) !== priority ||
          clean(old.reason) !== reason) {
        throw new GeneralReportError("idempotency_key_conflict", 409);
      }
      await db.rollback(tx);
      return { ok: true, code: "duplicate", ...(old.result || {}) };
    }
    const item = snapshot.exists
      ? normalizeGeneralReport(reportId, snapshot.data || {}) : null;
    if (!item) throw new GeneralReportError("report_not_found", 404);
    if (!ACTIVE_STATUSES.has(item.status)) {
      throw new GeneralReportError("invalid_report_transition", 409);
    }
    const now = new Date();
    const result = { reportId, priority };
    const patch = {
      priorityOverride: priority,
      priorityReason: reason,
      priorityChangedBy: actorUid,
      priorityChangedAt: now,
      updatedAt: now,
    };
    await db.commit(tx, [
      db.writeUpdate(reportPath, patch, Object.keys(patch)),
      adminInboxUpsertWrite(db, {
        type: item.type,
        title: item.type === "user_report"
          ? "بلاغ عن مستخدم في محادثة خاصة"
          : item.type === "account_report" ? "بلاغ مباشر عن حساب"
            : item.type === "room_report" ? "بلاغ عن غرفة"
              : "بلاغ عن رسالة داخل غرفة",
        body: item.status === "under_review"
          ? "بلاغ قيد مراجعة الإدارة" : "بلاغ يحتاج مراجعة",
        targetId: reportId, route: "general_reports",
        createdAt: new Date(item.createdAtMs || now.getTime()),
        priority,
        meta: {
          reporterUid: item.reporterUid,
          targetUid: item.targetUid,
          roomId: item.roomId || null,
          conversationId: item.conversationId || null,
          status: item.status,
        },
      }),
      db.writeCreate("admin_audit_logs/general_report_priority_" + key, {
        action: "setReportPriority", actorUid, reportId,
        reason, before: { priority: item.priority },
        after: { priority }, createdAt: now,
      }),
      db.writeCreate(opPath, {
        action: "setReportPriority", actorUid, targetId: reportId,
        reason, status: "completed", result, createdAt: now,
      }),
    ]);
    return { ok: true, code: "ok", ...result };
  } catch (error) {
    await db.rollback(tx);
    throw error;
  }
}

async function resolveWithAccountAction(db, env, decoded, actorUid, body = {}) {
  const reportId = safeId(body.reportId);
  const accountAction = clean(body.accountAction);
  const reason = clean(body.reason);
  const key = clean(body.idempotencyKey);
  if (!["warn", "suspend", "ban", "restrictPrivateMessages",
        "restrictRoomChat", "restrictRoomEntry",
        "restrictRoomMic"].includes(accountAction) ||
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
          ? "private_messages_restricted"
          : accountAction === "restrictRoomChat"
            ? "room_chat_restricted"
            : accountAction === "restrictRoomEntry"
              ? "room_entry_restricted"
              : accountAction === "restrictRoomMic"
                ? "room_mic_restricted" : "account_suspended";
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
          ? "private_messages_restricted"
          : accountAction === "restrictRoomChat"
            ? "room_chat_restricted"
            : accountAction === "restrictRoomEntry"
              ? "room_entry_restricted"
              : accountAction === "restrictRoomMic"
                ? "room_mic_restricted" : "account_suspended",
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
    canHoldEvidence: owner,
    canViewSensitiveEvidence: owner || caps.includes("viewReportEvidence"),
    canWarn: owner || (data.adminEnabled === true &&
      (caps.includes("suspendUsers") || caps.includes("manageUsers"))),
    canSuspend: owner || (data.adminEnabled === true &&
      (caps.includes("suspendUsers") || caps.includes("manageUsers"))),
    canRestrictPrivateMessages: owner || (data.adminEnabled === true &&
      (caps.includes("suspendUsers") || caps.includes("manageUsers"))),
    canRestrictRoomChat: owner || (data.adminEnabled === true &&
      (caps.includes("suspendUsers") || caps.includes("manageUsers"))),
    canRestrictRoomEntry: owner || (data.adminEnabled === true &&
      (caps.includes("suspendUsers") || caps.includes("manageUsers"))),
    canRestrictRoomMic: owner || (data.adminEnabled === true &&
      (caps.includes("suspendUsers") || caps.includes("manageUsers"))),
    canBan: owner || (data.adminEnabled === true && caps.includes("manageUsers")),
  };
}

// Reuse existing bounded content-filter flags, never fabricate a violation
// or expose original unmasked text. Review requires report-review capability.
async function reviewSystemFlag(db, env, actor, body) {
  if (!actor?.canReview) throw new GeneralReportError("forbidden", 403);
  return contentFilterControlInternals.reviewFlag(db, env, actor.uid, {
    flagId: body.flagId,
    reason: clean(body.reason),
    idempotencyKey: body.idempotencyKey,
  });
}

async function openSystemFlagEvidence(db, env, actor, body) {
  if (!actor?.canViewSensitiveEvidence) {
    throw new GeneralReportError("forbidden_evidence", 403);
  }
  const id = clean(body.flagId);
  if (/^saved_[A-Za-z0-9_-]{1,180}$/.test(id)) {
    return readProtectedReportEvidence(db, {
      collection: "content_filter_flags",
      reportId: id.slice(6),
      actorUid: actor.uid,
    });
  }
  const match = /^room_([1-9][0-9]{0,15})$/.exec(id);
  if (!match) throw new GeneralReportError("invalid_report_id", 400);
  if (!env?.ROOM_REALTIME) {
    throw new GeneralReportError("room_filter_not_available", 503);
  }
  // Mandatory durable audit before any privileged DO evidence is returned.
  await db.commit(null, [db.writeCreate(
    "admin_audit_logs/report_evidence_open_" + crypto.randomUUID(), {
      action: "openSensitiveReportEvidence",
      actorUid: actor.uid, reportId: id,
      sourceCollection: "room_content_filter_flags",
      createdAt: new Date(),
    },
  )]);
  const coordinator = env.ROOM_REALTIME.get(
    env.ROOM_REALTIME.idFromName(CONTENT_FILTER_COORDINATOR_ID),
  );
  const response = await coordinator.fetch(
    "https://internal/filter/flag/evidence", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ sequence: Number(match[1]) }),
    });
  if (!response.ok) throw new GeneralReportError("report_not_found", 404);
  const payload = await response.json();
  return { ok: true, reportId: id,
    evidence: payload?.evidence && typeof payload.evidence === "object"
      ? { text: String(payload.evidence.text || "").slice(0, 2000) } : {},
  };
}

// A case ID is provided by an inbox item, never by arbitrary profile search.
async function getSystemFlagGroup(db, body) {
  const alert = clean(body.groupAlertId);
  const match = /^([A-Za-z0-9_-]{1,180})_([0-9]{13})_(normal|high|urgent)$/.exec(alert);
  if (!match) throw new GeneralReportError("invalid_report_id", 400);
  const groupId = match[1] + "_" + match[2];
  const snapshot = await db.get("moderation_flag_group_cases/" + groupId);
  const data = snapshot.data || {};
  if (!snapshot.exists || clean(data.groupId) !== groupId ||
      clean(data.actorUid) !== match[1] ||
      !Array.isArray(data.recentReferences)) {
    throw new GeneralReportError("report_not_found", 404);
  }
  return {
    ok: true,
    group: {
      groupId, actorUid: match[1],
      count: Math.max(0, Number(data.count || 0)),
      highestPriority: clean(data.highestPriority) || "normal",
      windowStartMs: Number(data.windowStartMs || 0),
      // References only, never the original text in this response.
      recentReferences: data.recentReferences.slice(-12).map(item => ({
        surface: clean(item?.surface).slice(0,32),
        referenceId: clean(item?.referenceId).slice(0,180),
        createdAtMs: Number(item?.createdAtMs || 0),
      })).filter(item => item.referenceId),
    },
  };
}

async function holdGeneralEvidence(db, actor, body) {
  const id = safeId(body.reportId);
  const snap = await db.get("reports/" + id);
  if (!snap.exists || !generalReportType(snap.data || {})) {
    throw new GeneralReportError("report_not_found", 404);
  }
  return setReportEvidenceHold(db, {
    collection: "reports", reportId: id, actorUid: actor.uid,
    hold: body.hold, reason: body.reason,
    operationKey: body.idempotencyKey,
  });
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
      action === "reviewReport" || action === "applyAccountAction" ||
      action === "setReportPriority" || action === "reviewSystemFlag" ||
      action === "setEvidenceHold");
    if (action === "openSensitiveEvidence" ||
        action === "openSystemFlagEvidence" ||
        action === "openReportScreenshot") {
      if (!actor.canViewSensitiveEvidence) {
        throw new GeneralReportError("forbidden_evidence", 403);
      }
      const authAge = Math.floor(Date.now() / 1000) -
        Number(decoded.auth_time || 0);
      if (!Number.isFinite(authAge) || authAge < 0 || authAge > 1800) {
        throw new GeneralReportError("recent_auth_required", 401);
      }
    }
    if (action === "setEvidenceHold" && !actor.canHoldEvidence) {
      throw new GeneralReportError("forbidden", 403);
    }
    const result = action === "getSystemFlagGroup"
      ? await getSystemFlagGroup(db, body)
      : action === "openReportScreenshot"
      ? await openReportScreenshot(db, env, actor.uid, safeId(body.reportId))
      : action === "openSystemFlagEvidence"
      ? await openSystemFlagEvidence(db, env, actor, body)
      : action === "setEvidenceHold"
      ? await holdGeneralEvidence(db, actor, body)
      : action === "listSystemFlags"
      ? await contentFilterControlInternals.listFlags(db, env)
      : action === "reviewSystemFlag"
        ? await reviewSystemFlag(db, env, actor, body)
        : action === "openSensitiveEvidence"
      ? await openGeneralSensitiveEvidence(db, actor, body)
      : action === "listReports"
      ? await listGeneralReports(db, body)
      : action === "listHistory"
        ? await listReportHistory(db, body)
        : action === "getReporterContext"
          ? await getReporterContext(db, body)
        : action === "getAccountActionHistory"
          ? await getAccountActionHistory(db, body)
        : action === "getReport"
        ? await getGeneralReport(db, body)
        : action === "reviewReport"
          ? await reviewGeneralReport(db, actor.uid, body)
          : action === "applyAccountAction"
            ? await resolveWithAccountAction(db, env, decoded, actor.uid, body)
            : action === "setReportPriority"
              ? await setReportPriority(db, actor.uid, body)
              : null;
    if (!result) throw new GeneralReportError("unsupported_action", 400);
    return json(request, env, {
      ...result, canReview: actor.canReview,
      canHoldEvidence: actor.canHoldEvidence,
      canViewSensitiveEvidence: actor.canViewSensitiveEvidence,
      canWarn: actor.canWarn,
      canSuspend: actor.canSuspend, canBan: actor.canBan,
      canRestrictPrivateMessages: actor.canRestrictPrivateMessages,
      canRestrictRoomChat: actor.canRestrictRoomChat,
      canRestrictRoomEntry: actor.canRestrictRoomEntry,
      canRestrictRoomMic: actor.canRestrictRoomMic,
    });
  } catch (error) {
    const quota = firestoreQuotaResponse(request, env, error);
    if (quota) return quota;
    if (clean(error?.code) === "evidence_retention_expired") {
      return json(request, env, { ok: false, code: error.code }, 410);
    }
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
  openGeneralSensitiveEvidence,
  reviewSystemFlag,
  openSystemFlagEvidence,
  getReporterContext,
  getAccountActionHistory,
  requireAdmin,
  reviewGeneralReport,
  setReportPriority,
  resolveWithAccountAction,
});
