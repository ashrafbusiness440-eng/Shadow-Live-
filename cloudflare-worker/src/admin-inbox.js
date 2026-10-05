import { json, readJson, firestoreQuotaResponse } from "./http.js";
import {
  assertUserDocumentSessionState,
  verifyFirebaseIdToken,
} from "./firebase-auth.js";
import { firestoreClient } from "./firestore.js";

const clean = (value) => String(value ?? "").trim();
const MAX_SOURCE_ITEMS = 12;
const MAX_VISIBLE_ITEMS = 40;

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
  return clean(value).replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 180);
}

function readPath(uid, key) {
  return `admin_notification_reads/${safeKey(uid)}__${safeKey(key)}`;
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
        status: clean(data.status),
      },
    });
  }).filter((item) => item.targetId);
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
      meta: { status: clean(data.status) },
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

async function listInbox(db, actor) {
  const items = await loadItems(db, actor);
  const reads = await Promise.all(items.map((item) => db.get(readPath(actor.uid, item.key))));
  let unreadCount = 0;
  const visible = items.map((item, index) => {
    const read = reads[index]?.exists === true;
    if (!read) unreadCount += 1;
    return { ...item, read };
  });
  return {
    ok: true,
    items: visible,
    unreadCount,
    capped: visible.length >= MAX_VISIBLE_ITEMS,
    limit: MAX_VISIBLE_ITEMS,
  };
}

async function markRead(db, actor, body) {
  const key = safeKey(body.key);
  if (!key) throw new AdminInboxError("invalid_notification_key", 400);
  const path = readPath(actor.uid, key);
  const existing = await db.get(path);
  if (existing.exists) {
    return { ok: true, code: "already_read", key };
  }
  await db.commit(null, [
    db.writeCreate(path, {
      userId: actor.uid,
      key,
      readAt: new Date(),
    }),
  ]);
  return { ok: true, code: "ok", key };
}

async function markVisibleRead(db, actor) {
  const items = await loadItems(db, actor);
  const paths = items.map((item) => readPath(actor.uid, item.key));
  const existing = await Promise.all(paths.map((path) => db.get(path)));
  const now = new Date();
  const writes = paths.flatMap((path, index) =>
    existing[index]?.exists
      ? []
      : [
          db.writeCreate(path, {
            userId: actor.uid,
            key: items[index].key,
            readAt: now,
          }),
        ],
  );
  if (writes.length) await db.commit(null, writes);
  return { ok: true, code: "ok", marked: writes.length };
}

export async function adminInbox(request, env) {
  if (request.method !== "POST") {
    return json(request, env, { ok: false, code: "method_not_allowed" }, 405);
  }
  try {
    const decoded = await verifyFirebaseIdToken(request, env, { checkUserState: false });
    const db = firestoreClient(env);
    const actor = await loadActor(db, decoded);
    const body = await readJson(request);
    const action = clean(body.action || "list");

    if (action === "list") {
      return json(request, env, await listInbox(db, actor));
    }
    if (action === "markRead") {
      return json(request, env, await markRead(db, actor, body));
    }
    if (action === "markVisibleRead") {
      return json(request, env, await markVisibleRead(db, actor));
    }
    throw new AdminInboxError("unsupported_action", 400);
  } catch (error) {
    const quota = firestoreQuotaResponse(request, env, error);
    if (quota) return quota;
    if (error instanceof AdminInboxError) {
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
  listInbox,
});
