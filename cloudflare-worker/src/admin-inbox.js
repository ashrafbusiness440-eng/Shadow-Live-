import { json, readJson, firestoreQuotaResponse } from "./http.js";
import {
  assertUserDocumentSessionState,
  verifyFirebaseIdToken,
} from "./firebase-auth.js";
import { firestoreClient } from "./firestore.js";
import {
  ADMIN_INBOX_INDEX_COLLECTION,
  ADMIN_INBOX_INDEX_LIMIT,
  adminInboxUpsertWrite,
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
  return clean(value).replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 180);
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
    case "agency_application":
      return canReviewAgencyApplications(actor);
    case "agency_identity_change":
      return canManageAgencies(actor);
    case "agency_ownership_transfer":
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

async function loadIndexedItems(db, actor) {
  const rows = await db.list(
    ADMIN_INBOX_INDEX_COLLECTION,
    ADMIN_INBOX_INDEX_LIMIT,
  );
  const metaPresent = rows.some((row) => row.id === "__meta");
  const indexed = rows
    .filter((row) => row.id !== "__meta")
    .map(normalizeAdminInboxIndexRow)
    .filter((item) => item.key && item.targetId && itemAllowedForActor(actor, item))
    .sort((a, b) => {
      const byTime = b.createdAtMs - a.createdAtMs;
      return byTime !== 0 ? byTime : b.key.localeCompare(a.key);
    })
    .slice(0, MAX_VISIBLE_ITEMS);

  if (metaPresent) return indexed;

  // Safe first-run fallback: build the index from the legacy sources once.
  const legacy = await loadItems(db, actor);
  const writes = legacy.map((item) =>
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
  writes.push(
    db.writeUpdate(
      `${ADMIN_INBOX_INDEX_COLLECTION}/__meta`,
      {
        schemaVersion: 1,
        ready: true,
        backfilledAt: new Date(),
      },
      ["schemaVersion", "ready", "backfilledAt"],
    ),
  );
  await db.commit(null, writes).catch(() => {});
  return legacy;
}

async function listInbox(db, actor) {
  const [items, readState] = await Promise.all([
    loadIndexedItems(db, actor),
    loadReadState(db, actor.uid),
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
    items: visible,
    unreadCount,
    capped: visible.length >= MAX_VISIBLE_ITEMS,
    limit: MAX_VISIBLE_ITEMS,
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
  loadReadKeys,
  loadReadState,
  loadIndexedItems,
  listInbox,
});
