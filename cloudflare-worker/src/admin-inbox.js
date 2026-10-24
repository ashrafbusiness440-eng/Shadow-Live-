import { json, readJson, firestoreQuotaResponse } from "./http.js";
import {
  assertUserDocumentSessionState,
  verifyFirebaseIdToken,
} from "./firebase-auth.js";
import { firestoreClient } from "./firestore.js";
import {
  inspectAccountDeletionForOwner,
  setAccountDeletionReviewHold,
  AccountDeletionReviewControlError,
} from "./account-deletion-review-control.js";
import { inspectAccountErasureInventory } from "./account-deletion-erasure-inventory.js";
import { generalReportType } from "./general-reports.js";
import { loadPublicProfilePresentations } from "./public-profile-presentation.js";
import {
  recoverLongDiaryAlertsPage,
  longDiaryAlertRecoveryStatus,
} from "./admin-inbox-recovery.js";
import {
  ADMIN_INBOX_INDEX_COLLECTION,
  ADMIN_INBOX_INDEX_LIMIT,
  adminInboxUpsertWrite,
  adminInboxIndexId,
  normalizeAdminInboxIndexRow,
} from "./admin-inbox-index.js";

const clean = (value) => String(value ?? "").trim();
const MAX_SOURCE_ITEMS = 12;
const MAX_VISIBLE_ITEMS = 40;
const MAX_READ_RECEIPTS = 1000;

class AdminInboxError extends Error {
  constructor(code, status = 400) {
    super(code);
    this.code = code;
    this.status = status;
  }
}

function timestampMs(value) {
  if (value instanceof Date) return value.getTime();
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  if (value && typeof value === "object") {
    if (typeof value.toDate === "function") {
      const date = value.toDate();
      return date instanceof Date ? date.getTime() : 0;
    }
    const seconds = Number(value.seconds ?? value._seconds ?? 0);
    const nanos = Number(value.nanoseconds ?? value._nanoseconds ?? 0);
    if (Number.isFinite(seconds) && seconds > 0) {
      return Math.trunc(seconds * 1000 + nanos / 1_000_000);
    }
  }
  const parsed = Date.parse(String(value ?? ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

function safeKey(value) {
  // Preserve full server-generated keys for existing 300+ char diary reports.
  // Older 180-char truncation prevented these alerts from staying marked read.
  return clean(value).replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 768);
}

function readPath(uid, key) {
  return `admin_notification_reads/${safeKey(uid)}__${safeKey(key)}`;
}

function readStatePath(uid) {
  return `admin_notification_read_state/${safeKey(uid)}`;
}

function itemAllowedForActor(actor, item) {
  switch (clean(item?.type)) {
    case "diary_report":
      return canSeeDiary(actor);
    case "user_report":
    case "account_report":
    case "account_action_appeal":
    case "room_message_report":
    case "room_report":
    case "system_repeat_flag":
      return canSeeGeneralReports(actor);
    case "agency_application":
      return canReviewAgencyApplications(actor);
    case "agency_identity_change":
      return canManageAgencies(actor);
    case "agency_ownership_transfer":
    case "account_deletion_review":
      return actor.owner;
    case "agency_cooldown_exception":
      return canManageMemberships(actor);
    default:
      return false;
  }
}

async function loadActor(db, decoded) {
  const uid = clean(decoded?.sub);
  if (!uid) throw new AdminInboxError("unauthorized", 401);
  const actor = await db.get(`users/${uid}`);
  if (!actor.exists) throw new AdminInboxError("forbidden", 403);
  assertUserDocumentSessionState(decoded, actor.data || {});
  const data = actor.data || {};
  const role = clean(data.role);
  const owner = role === "owner";
  const adminEnabled = data.adminEnabled === true;
  if (!owner && !adminEnabled) throw new AdminInboxError("forbidden", 403);
  const capabilities = new Set(
    Array.isArray(data.capabilities) ? data.capabilities.map(clean).filter(Boolean) : [],
  );
  return { uid, owner, role, adminEnabled, capabilities };
}

function canSeeGeneralReports(actor) {
  return actor.owner ||
    actor.capabilities.has("viewReports") ||
    actor.capabilities.has("reviewReports");
}

function canSeeDiary(actor) {
  if (actor.owner) return true;
  return [
    "viewReports",
    "reviewReports",
    "manageDiaries",
    "deleteDiaryComment",
  ].some((capability) => actor.capabilities.has(capability));
}

function canReviewAgencyApplications(actor) {
  return actor.owner ||
    actor.capabilities.has("manageAgencies") ||
    actor.capabilities.has("reviewAgencyApplications");
}

function canManageAgencies(actor) {
  return actor.owner || actor.capabilities.has("manageAgencies");
}

function canManageMemberships(actor) {
  return actor.owner ||
    actor.capabilities.has("manageAgencies") ||
    actor.capabilities.has("manageAgencyMemberships");
}

function inboxItem({
  key,
  type,
  title,
  body,
  targetId,
  route,
  createdAt,
  priority = "normal",
  meta = {},
}) {
  return {
    key,
    type,
    title,
    body,
    targetId,
    route,
    createdAt: createdAt || null,
    createdAtMs: timestampMs(createdAt),
    priority,
    meta,
  };
}

async function queryStatus(db, collection, status) {
  return db.runQuery(collection, {
    filters: [{ field: "status", op: "==", value: status }],
    limit: MAX_SOURCE_ITEMS,
  });
}

async function loadDiaryItems(db) {
  const [fresh, review] = await Promise.all([
    queryStatus(db, "diary_reports", "new"),
    queryStatus(db, "diary_reports", "under_review"),
  ]);
  return [...fresh, ...review].map((row) => {
    const data = row?.data || {};
    const reportId = clean(data.reportId || row?.id);
    const targetType = clean(data.targetType);
    const label = clean(data.reasonLabel || data.reason) || "بلاغ محتوى";
    return inboxItem({
      key: `diary_report_${reportId}`,
      type: "diary_report",
      title: targetType === "diary_comment" ? "بلاغ على تعليق يومية" : "بلاغ على يومية",
      body: label,
      targetId: reportId,
      route: "diary_reports",
      createdAt: data.createdAt,
      priority: "high",
      meta: {
        diaryId: clean(data.diaryId) || null,
        commentId: clean(data.commentId) || null,
        reporterUid: clean(data.reporterUid) || null,
        targetUid: clean(data.targetAuthorUid) || null,
        ownerUid: clean(data.targetOwnerUid) || null,
        status: clean(data.status),
      },
    });
  }).filter((item) => item.targetId);
}

// One-time, bounded migration for already-saved room and private-chat reports.
// New reports are indexed atomically at creation; no recurring source scans.
async function loadGeneralReportItems(db) {
  const sources = [
    [{ field: "type", op: "==", value: "user" }],
    [{ field: "targetType", op: "==", value: "user" }],
    [{ field: "targetType", op: "==", value: "room_message" }],
    [{ field: "targetType", op: "==", value: "room" }],
  ];
  const groups = await Promise.all(sources.map((filters) =>
    db.runQuery("reports", { filters, limit: 20 })
  ));
  return groups.flat().map((row) => {
    const data = row?.data || {};
    const reportId = clean(data.reportId || row.id);
    const type = generalReportType(data);
    const status = clean(data.status);
    if (!reportId || !type ||
        !["open", "new", "under_review"].includes(status)) return null;
    return inboxItem({
      key: type + "_" + reportId,
      type,
      title: type === "user_report"
        ? "بلاغ عن مستخدم في محادثة خاصة"
        : type === "account_report" ? "بلاغ مباشر عن حساب"
        : type === "room_report" ? "بلاغ عن غرفة"
          : "بلاغ عن رسالة داخل غرفة",
      body: "بلاغ يحتاج مراجعة",
      targetId: reportId,
      route: "general_reports",
      createdAt: data.createdAt,
      priority: "high",
      meta: {
        reporterUid: clean(data.reporterUid || data.reporterId) || null,
        targetUid: clean(data.targetUid || data.targetUserId) || null,
        roomId: clean(data.roomId) || null,
        conversationId: clean(data.conversationId) || null,
        status,
      },
    });
  }).filter(Boolean);
}

async function loadAgencyApplicationItems(db) {
  const [pending, review] = await Promise.all([
    queryStatus(db, "agency_applications", "pending"),
    queryStatus(db, "agency_applications", "under_review"),
  ]);
  return [...pending, ...review].map((row) => {
    const data = row?.data || {};
    const id = clean(data.applicationId || row?.id);
    const name = clean(data.name) || "وكالة جديدة";
    const applicant = clean(data.applicantPublicId || data.applicantUid);
    return inboxItem({
      key: `agency_application_${id}`,
      type: "agency_application",
      title: "طلب إنشاء وكالة",
      body: applicant ? `${name} • المقدم: ${applicant}` : name,
      targetId: id,
      route: "agency_control",
      createdAt: data.createdAt,
      priority: "high",
      meta: {
        applicantUid: clean(data.applicantUid) || null,
        status: clean(data.status),
      },
    });
  }).filter((item) => item.targetId);
}

async function loadSimpleAgencyRequests(db, collection, type, title, bodyBuilder) {
  const rows = await queryStatus(db, collection, "pending");
  return rows.map((row) => {
    const data = row?.data || {};
    const requestId = clean(data.requestId || row?.id);
    return inboxItem({
      key: `${type}_${requestId}`,
      type,
      title,
      body: bodyBuilder(data),
      targetId: requestId,
      route: "agency_control",
      createdAt: data.createdAt,
      meta: {
        agencyId: clean(data.agencyId) || null,
        requesterUid: clean(data.requesterUid || data.userUid || data.uid) || null,
        targetUid: clean(data.newOwnerUid) || null,
        status: clean(data.status),
      },
    });
  }).filter((item) => item.targetId);
}

async function loadItems(db, actor) {
  const tasks = [];
  if (canSeeDiary(actor)) tasks.push(loadDiaryItems(db));
  if (canReviewAgencyApplications(actor)) tasks.push(loadAgencyApplicationItems(db));
  if (canManageAgencies(actor)) {
    tasks.push(
      loadSimpleAgencyRequests(
        db,
        "agency_identity_change_requests",
        "agency_identity_change",
        "طلب تغيير بيانات وكالة",
        (data) => {
          const agencyId = clean(data.agencyId);
          const requestedName = clean(data.requestedName);
          return [agencyId, requestedName].filter(Boolean).join(" • ");
        },
      ),
    );
  }
  if (actor.owner) {
    tasks.push(
      loadSimpleAgencyRequests(
        db,
        "agency_ownership_transfer_requests",
        "agency_ownership_transfer",
        "طلب نقل ملكية وكالة",
        (data) => {
          const agencyId = clean(data.agencyId);
          const newOwner = clean(data.newOwnerPublicId || data.newOwnerUid);
          return [agencyId, newOwner ? `المالك الجديد: ${newOwner}` : ""]
            .filter(Boolean)
            .join(" • ");
        },
      ),
    );
  }
  if (canManageMemberships(actor)) {
    tasks.push(
      loadSimpleAgencyRequests(
        db,
        "agency_cooldown_exception_requests",
        "agency_cooldown_exception",
        "طلب استثناء انتظار وكالة",
        (data) => {
          const uid = clean(data.userPublicId || data.uid);
          const agencyId = clean(data.agencyId);
          return [uid, agencyId].filter(Boolean).join(" • ");
        },
      ),
    );
  }

  const groups = await Promise.all(tasks);
  const deduped = new Map();
  for (const item of groups.flat()) {
    if (!item?.key) continue;
    const previous = deduped.get(item.key);
    if (!previous || item.createdAtMs > previous.createdAtMs) {
      deduped.set(item.key, item);
    }
  }
  return [...deduped.values()]
    .sort((a, b) => {
      const byTime = b.createdAtMs - a.createdAtMs;
      return byTime !== 0 ? byTime : b.key.localeCompare(a.key);
    })
    .slice(0, MAX_VISIBLE_ITEMS);
}

async function loadReadKeys(db, uid) {
  const rows = await db.runQuery("admin_notification_reads", {
    filters: [{ field: "userId", op: "==", value: uid }],
    limit: MAX_READ_RECEIPTS,
  });
  return new Set(
    rows
      .map((row) => clean(row?.data?.key))
      .filter(Boolean),
  );
}

async function loadReadState(db, uid) {
  const path = readStatePath(uid);
  const snapshot = await db.get(path);
  if (snapshot.exists) {
    const data = snapshot.data || {};
    return {
      readThroughMs: Math.max(0, Number(data.readThroughMs || 0)),
      keys: new Set(
        Array.isArray(data.keys) ? data.keys.map(clean).filter(Boolean) : [],
      ),
    };
  }

  // One-time compatibility migration for admins who already have legacy
  // per-notification receipts. After this, normal loads use one direct read.
  const legacyKeys = await loadReadKeys(db, uid);
  const keys = [...legacyKeys].slice(-250);
  const now = new Date();
  await db.commit(null, [
    db.writeCreate(path, {
      userId: uid,
      readThroughMs: 0,
      keys,
      migratedFromLegacy: true,
      createdAt: now,
      updatedAt: now,
    }),
  ]).catch(() => {});
  return { readThroughMs: 0, keys: new Set(keys) };
}

async function loadIndexedItems(db, actor, prefetchedRows = null) {
  const rows = Array.isArray(prefetchedRows)
    ? prefetchedRows
    : await db.list(ADMIN_INBOX_INDEX_COLLECTION, ADMIN_INBOX_INDEX_LIMIT);
  const meta = rows.find((row) => row.id === "__meta");
  // During legacy restoration, a prefix-keyed row and a full-keyed row can
  // briefly coexist. Render each real report once, preferring the full key.
  const indexedMap = new Map();
  for (const row of rows) {
    if (row.id === "__meta") continue;
    const item = normalizeAdminInboxIndexRow(row);
    if (!item.key || !item.targetId || !itemAllowedForActor(actor, item)) continue;
    const existing = indexedMap.get(item.key);
    if (!existing || row.id === adminInboxIndexId(item.type, item.targetId)) {
      indexedMap.set(item.key, item);
    }
  }
  const indexed = [...indexedMap.values()];

  if (meta && Number(meta.data?.schemaVersion || 0) >= 2) {
    return indexed.sort((a, b) =>
      b.createdAtMs - a.createdAtMs || b.key.localeCompare(a.key)
    ).slice(0, MAX_VISIBLE_ITEMS);
  }

  // Existing deployments have index schema v1, which omitted every report
  // in reports/*. Upgrade a single time and retain the old visible items.
  const [reports, legacy] = await Promise.all([
    loadGeneralReportItems(db),
    meta ? Promise.resolve([]) : loadItems(db, actor),
  ]);
  const migration = new Map();
  for (const item of [...indexed, ...legacy, ...reports]) {
    if (item?.key) migration.set(item.key, item);
  }
  const writes = [...legacy, ...reports].map((item) =>
    adminInboxUpsertWrite(db, {
      type: item.type,
      title: item.title,
      body: item.body,
      targetId: item.targetId,
      route: item.route,
      createdAt: item.createdAt,
      priority: item.priority,
      meta: item.meta,
    })
  );
  const now = new Date();
  writes.push(db.writeUpdate(
    ADMIN_INBOX_INDEX_COLLECTION + "/__meta",
    {
      schemaVersion: 2,
      ready: true,
      migratedGeneralReportsAt: now,
      ...(meta ? {} : { backfilledAt: now }),
    },
    meta
      ? ["schemaVersion", "ready", "migratedGeneralReportsAt"]
      : ["schemaVersion", "ready", "migratedGeneralReportsAt", "backfilledAt"],
  ));
  // Do not acknowledge migration as done after a failed write: a later
  // authorized visit can retry without silently losing old reports.
  await db.commit(null, writes);
  return [...migration.values()]
    .filter((item) => itemAllowedForActor(actor, item))
    .sort((a, b) =>
      b.createdAtMs - a.createdAtMs || b.key.localeCompare(a.key)
    ).slice(0, MAX_VISIBLE_ITEMS);
}


// Only identities already attached to authorized inbox items are shown here.
// Do not fetch users/*, infer a user from a public ID, or reveal hidden status.
function inboxActorRoles(item) {
  const meta = item.meta && typeof item.meta === "object" ? item.meta : {};
  const candidates = [];
  switch (clean(item.type)) {
    case "diary_report":
      candidates.push(["مقدّم البلاغ", meta.reporterUid]);
      candidates.push(["الحساب المبلّغ عليه", meta.targetUid]);
      if (clean(meta.ownerUid) && clean(meta.ownerUid) !== clean(meta.targetUid)) {
        candidates.push(["صاحب اليومية", meta.ownerUid]);
      }
      break;
    case "user_report":
    case "account_report":
    case "room_message_report":
    case "room_report":
      candidates.push(["مقدّم البلاغ", meta.reporterUid]);
      candidates.push(["الحساب المبلّغ عليه", meta.targetUid]);
      break;
    case "account_action_appeal":
      candidates.push(["صاحب الاعتراض", meta.userUid]);
      break;
    case "account_deletion_review":
      candidates.push(["صاحب طلب الحذف", meta.userUid]);
      break;
    case "system_repeat_flag":
      candidates.push(["الحساب المرتبط بالتنبيهات", meta.actorUid]);
      break;
    case "agency_application":
      candidates.push(["مقدّم الطلب", meta.applicantUid]);
      break;
    case "agency_identity_change":
    case "agency_cooldown_exception":
      candidates.push(["مقدّم الطلب", meta.requesterUid]);
      break;
    case "agency_ownership_transfer":
      candidates.push(["مقدّم الطلب", meta.requesterUid]);
      candidates.push(["المالك الجديد", meta.targetUid]);
      break;
    default:
      break;
  }
  const used = new Set();
  return candidates.map(([role, value]) => ({ role, uid: clean(value) }))
    .filter(({ uid }) => {
      if (!uid || uid.includes("/") || uid.includes("\\") || used.has(uid)) return false;
      used.add(uid);
      return true;
    });
}

async function withInboxActorProfiles(db, items) {
  const roles = items.map(inboxActorRoles);
  const uids = roles.flat().map((actor) => actor.uid);
  if (uids.length === 0) return items.map((item) => ({ ...item, actors: [] }));
  // One bounded public presentation batch, shared across the visible 40 items.
  const profiles = await loadPublicProfilePresentations(db, uids, {
    limit: 80,
    concurrency: 8,
  }).catch(() => new Map());
  return items.map((item, index) => ({
    ...item,
    actors: roles[index].map((actor) => ({
      role: actor.role,
      uid: actor.uid,
      profile: profiles.get(actor.uid) || null,
    })),
  }));
}

async function listInbox(
  db,
  actor,
  { prefetchedRows = null, prefetchedReadState = null } = {},
) {
  const [items, readState] = await Promise.all([
    loadIndexedItems(db, actor, prefetchedRows),
    prefetchedReadState
      ? Promise.resolve(prefetchedReadState)
      : loadReadState(db, actor.uid),
  ]);
  let unreadCount = 0;
  const visible = items.map((item) => {
    const read =
      item.createdAtMs <= readState.readThroughMs ||
      readState.keys.has(item.key);
    if (!read) unreadCount += 1;
    return { ...item, read };
  });
  return {
    ok: true,
    items: await withInboxActorProfiles(db, visible),
    unreadCount,
    capped: visible.length >= MAX_VISIBLE_ITEMS,
    limit: MAX_VISIBLE_ITEMS,
    diaryLongRepair: longDiaryAlertRecoveryStatus(
      Array.isArray(prefetchedRows)
        ? (prefetchedRows.find((row) => row.id === "__meta")?.data || {})
        : {},
      actor.owner,
    ),
  };
}

async function markRead(db, actor, body) {
  const key = safeKey(body.key);
  if (!key) throw new AdminInboxError("invalid_notification_key", 400);
  const path = readStatePath(actor.uid);
  const current = await db.get(path);
  const data = current.exists ? current.data || {} : {};
  const keys = Array.isArray(data.keys)
    ? data.keys.map(clean).filter(Boolean)
    : [];
  const nextKeys = [...new Set([...keys, key])].slice(-250);
  const fields = {
    userId: actor.uid,
    readThroughMs: Math.max(0, Number(data.readThroughMs || 0)),
    keys: nextKeys,
    updatedAt: new Date(),
  };
  await db.commit(null, [
    current.exists
      ? db.writeUpdate(path, fields, Object.keys(fields))
      : db.writeCreate(path, { ...fields, createdAt: new Date() }),
  ]);
  return { ok: true, code: keys.includes(key) ? "already_read" : "ok", key };
}

async function markVisibleRead(db, actor) {
  const path = readStatePath(actor.uid);
  const current = await db.get(path);
  const now = new Date();
  const fields = {
    userId: actor.uid,
    readThroughMs: now.getTime(),
    keys: [],
    updatedAt: now,
  };
  await db.commit(null, [
    current.exists
      ? db.writeUpdate(path, fields, Object.keys(fields))
      : db.writeCreate(path, { ...fields, createdAt: now }),
  ]);
  return { ok: true, code: "ok" };
}

export async function adminInbox(request, env) {
  if (request.method !== "POST") {
    return json(request, env, { ok: false, code: "method_not_allowed" }, 405);
  }
  try {
    const decoded = await verifyFirebaseIdToken(request, env, { checkUserState: false });
    const db = firestoreClient(env);
    const body = await readJson(request);
    const action = clean(body.action || "list");

    if (action === "list") {
      const uid = clean(decoded?.sub);
      if (!uid) throw new AdminInboxError("unauthorized", 401);
      const [actor, prefetchedReadState, prefetchedRows] = await Promise.all([
        loadActor(db, decoded),
        loadReadState(db, uid),
        db.list(ADMIN_INBOX_INDEX_COLLECTION, ADMIN_INBOX_INDEX_LIMIT),
      ]);
      return json(
        request,
        env,
        await listInbox(db, actor, { prefetchedRows, prefetchedReadState }),
      );
    }

    const actor = await loadActor(db, decoded);
    if (action === "repairDiaryReportInbox") {
      if (!actor.owner) throw new AdminInboxError("forbidden", 403);
      return json(request, env, await recoverLongDiaryAlertsPage(db));
    }
    if (action === "markRead") {
      return json(request, env, await markRead(db, actor, body));
    }
    if (action === "markVisibleRead") {
      return json(request, env, await markVisibleRead(db, actor));
    }
    // Reuse the existing admin inbox route; never expose account erasure
    // controls or retention notes to ordinary moderators.
    if (["accountDeletionDetails", "accountDeletionInventory",
         "accountDeletionHold", "accountDeletionReleaseHold"].includes(action)) {
      if (!actor.owner) throw new AdminInboxError("forbidden", 403);
      const targetUid = clean(body.targetUid);
      if (action === "accountDeletionDetails") {
        return json(request, env,
          await inspectAccountDeletionForOwner(db, targetUid));
      }
      if (action === "accountDeletionInventory") {
        const details = await inspectAccountDeletionForOwner(db, targetUid);
        // Never inspect data on behalf of a stale, cancelled, substituted,
        // processing or already completed request.
        if (clean(body.requestId) !== details.requestId) {
          throw new AdminInboxError("review_no_longer_available", 409);
        }
        const inventory = await inspectAccountErasureInventory(db, targetUid);
        return json(request, env, {
          ...inventory, targetUid, requestId: details.requestId,
          reviewHold: details.reviewHold,
        });
      }
      const age = Math.floor(Date.now() / 1000) -
        Number(decoded?.auth_time);
      if (!Number.isFinite(age) || age < -60 || age > 600) {
        throw new AdminInboxError("recent_auth_required", 401);
      }
      return json(request, env,
        await setAccountDeletionReviewHold(db, {
          actorUid: actor.uid,
          targetUid,
          requestId: body.requestId,
          action,
          reason: body.reason,
        }));
    }
    throw new AdminInboxError("unsupported_action", 400);
  } catch (error) {
    const quota = firestoreQuotaResponse(request, env, error);
    if (quota) return quota;
    if (error instanceof AdminInboxError ||
        error instanceof AccountDeletionReviewControlError) {
      return json(request, env, { ok: false, code: error.code }, error.status);
    }
    const code = clean(error?.code || error?.message || "admin_inbox_failed");
    const status = code === "unauthorized" ? 401 : 500;
    return json(request, env, { ok: false, code }, status);
  }
}

export const adminInboxTestHooks = Object.freeze({
  timestampMs,
  safeKey,
  loadItems,
  loadReadKeys,
  loadReadState,
  loadIndexedItems,
  listInbox,
  loadGeneralReportItems,
  inboxActorRoles,
  withInboxActorProfiles,
  markRead,
});
