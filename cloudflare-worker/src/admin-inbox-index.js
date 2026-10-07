const clean = (value) => String(value ?? "").trim();

export const ADMIN_INBOX_INDEX_COLLECTION = "admin_inbox_items";
export const ADMIN_INBOX_INDEX_LIMIT = 200;

export function adminInboxIndexId(typeInput, targetIdInput) {
  const type = clean(typeInput).replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 80);
  const targetId = clean(targetIdInput).replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 160);
  return type && targetId ? `${type}__${targetId}` : "";
}

export function adminInboxIndexPath(type, targetId) {
  const id = adminInboxIndexId(type, targetId);
  if (!id) throw new Error("invalid_admin_inbox_index_id");
  return `${ADMIN_INBOX_INDEX_COLLECTION}/${id}`;
}

export function adminInboxUpsertWrite(db, {
  type,
  title,
  body = "",
  targetId,
  route,
  createdAt = new Date(),
  priority = "normal",
  meta = {},
}) {
  const key = `${clean(type)}_${clean(targetId)}`;
  const path = adminInboxIndexPath(type, targetId);
  const createdAtMs = createdAt instanceof Date
    ? createdAt.getTime()
    : (Date.parse(String(createdAt || "")) || 0);
  const fields = {
    key,
    type: clean(type),
    title: clean(title),
    body: clean(body),
    targetId: clean(targetId),
    route: clean(route),
    createdAt,
    createdAtMs,
    priority: clean(priority) || "normal",
    meta: meta && typeof meta === "object" ? meta : {},
    updatedAt: new Date(),
  };
  return db.writeUpdate(path, fields, Object.keys(fields));
}

export function adminInboxDeleteWrite(db, type, targetId) {
  return db.writeDelete(adminInboxIndexPath(type, targetId));
}

export function normalizeAdminInboxIndexRow(row) {
  const data = row?.data || {};
  return {
    key: clean(data.key),
    type: clean(data.type),
    title: clean(data.title),
    body: clean(data.body),
    targetId: clean(data.targetId),
    route: clean(data.route),
    createdAt: data.createdAt || null,
    createdAtMs: Math.max(0, Number(data.createdAtMs || 0)),
    priority: clean(data.priority) || "normal",
    meta: data.meta && typeof data.meta === "object" ? data.meta : {},
  };
}
