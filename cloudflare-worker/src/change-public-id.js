import { json, readJson } from "./http.js";
import { verifyFirebaseIdToken } from "./firebase-auth.js";
import { firestoreClient } from "./firestore.js";

class ApiError extends Error {
  constructor(code, status = 400) { super(code); this.code = code; this.status = status; }
}
const clean = (v) => String(v ?? "").trim();
const randomId = (prefix) => `${prefix}_${crypto.randomUUID().replace(/-/g, "")}`;

function normalizeId(value) {
  let text = clean(value);
  const arabic = "٠١٢٣٤٥٦٧٨٩";
  const persian = "۰۱۲۳۴۵۶۷۸۹";
  for (let i = 0; i < 10; i++) {
    text = text.split(arabic[i]).join(String(i)).split(persian[i]).join(String(i));
  }
  return text;
}

function normalizeSearchText(value) {
  let text = String(value ?? "").toLowerCase();
  const arabic = "٠١٢٣٤٥٦٧٨٩";
  const persian = "۰۱۲۳۴۵۶۷۸۹";
  for (let i = 0; i < 10; i++) {
    text = text.split(arabic[i]).join(String(i)).split(persian[i]).join(String(i));
  }
  return text
    .replace(/[\u064B-\u065F\u0670\u06D6-\u06ED]/g, "")
    .replace(/ـ/g, "")
    .replace(/[أإآٱ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/\s+/g, " ")
    .trim();
}

function buildSearchTokens(values, maxSubstringLength = 8, maxTokens = 512) {
  const tokens = new Set();
  const add = (token) => { if (token && tokens.size < maxTokens) tokens.add(token); };
  for (const value of values) {
    if (tokens.size >= maxTokens) break;
    const normalized = normalizeSearchText(value);
    if (!normalized) continue;
    add(normalized);
    const chars = Array.from(normalized);
    for (let end = 1; end <= chars.length && tokens.size < maxTokens; end++) {
      add(chars.slice(0, end).join(""));
    }
    for (const word of normalized.split(" ")) {
      const w = Array.from(word);
      for (let end = 1; end <= w.length && tokens.size < maxTokens; end++) {
        add(w.slice(0, end).join(""));
      }
      if (tokens.size >= maxTokens) break;
    }
    for (let start = 0; start < chars.length && tokens.size < maxTokens; start++) {
      const maxEnd = Math.min(chars.length, start + maxSubstringLength);
      for (let end = start + 1; end <= maxEnd && tokens.size < maxTokens; end++) {
        add(chars.slice(start, end).join("").trim());
      }
    }
  }
  return [...tokens];
}

async function execute(db, actorUid, body) {
  const currentId = normalizeId(body.currentId);
  const newId = normalizeId(body.newId);
  const reason = clean(body.reason);
  const key = clean(body.idempotencyKey);

  for (let attempt = 0; attempt < 3; attempt++) {
    const transaction = await db.beginTransaction();
    try {
      const [actorSnap, opSnap, oldSnap, newSnap, roomCollision] = await Promise.all([
        db.get(`users/${actorUid}`, transaction),
        db.get(`control_operations/${key}`, transaction),
        db.get(`public_ids/${currentId}`, transaction),
        db.get(`public_ids/${newId}`, transaction),
        db.get(`room_ids/${newId}`, transaction),
      ]);

      const actor = actorSnap.data || {};
      const capabilities = Array.isArray(actor.capabilities) ? actor.capabilities : [];
      const canManageIds =
        actorSnap.exists &&
        actor.adminEnabled === true &&
        (actor.role === "owner" || capabilities.includes("manageIds"));

      if (!canManageIds) {
        await db.rollback(transaction);
        throw new ApiError("forbidden", 403);
      }

      if (opSnap.exists) {
        await db.rollback(transaction);
        return { ok: true, code: "duplicate", operationId: key, ...(opSnap.data?.result || {}) };
      }
      if (!oldSnap.exists) {
        await db.rollback(transaction);
        throw new ApiError("not_found", 404);
      }

      const targetUid = clean(oldSnap.data?.uid);
      if (!targetUid) {
        await db.rollback(transaction);
        throw new ApiError("old_id_retired", 409);
      }
      if (newSnap.exists || roomCollision.exists) {
        await db.rollback(transaction);
        throw new ApiError("id_taken", 409);
      }

      const [userSnap, publicSnap] = await Promise.all([
        db.get(`users/${targetUid}`, transaction),
        db.get(`public_profiles/${targetUid}`, transaction),
      ]);
      if (!userSnap.exists) {
        await db.rollback(transaction);
        throw new ApiError("not_found", 404);
      }

      const user = userSnap.data || {};
      if (user.role === "owner" && actor.role !== "owner") {
        await db.rollback(transaction);
        throw new ApiError("owner_protected", 409);
      }
      if (clean(user.publicId) !== currentId) {
        await db.rollback(transaction);
        throw new ApiError("old_id_not_current", 409);
      }

      const profile = publicSnap.data || {};
      const displayName = profile.displayName ?? user.displayName ?? user.name ?? "";
      const username = profile.username ?? user.username ?? "";
      const searchTokens = buildSearchTokens([displayName, username, newId]);
      const history = Array.isArray(user.publicIdHistory)
        ? [...new Set([...user.publicIdHistory.map(String), currentId])]
        : [currentId];
      const createdAt = new Date();
      const resultData = { targetUid, before: currentId, after: newId };

      await db.commit(transaction, [
        db.writeUpdate(`users/${targetUid}`, {
          publicId: newId,
          publicIdHistory: history,
          publicIdUpdatedAt: createdAt,
          publicIdUpdatedBy: actorUid,
          updatedAt: createdAt,
        }, ["publicId", "publicIdHistory", "publicIdUpdatedAt", "publicIdUpdatedBy", "updatedAt"]),
        db.writeUpdate(`public_profiles/${targetUid}`, {
          publicId: newId,
          searchTokens,
          updatedAt: createdAt,
        }, ["publicId", "searchTokens", "updatedAt"]),
        db.writeCreate(`public_ids/${newId}`, {
          uid: targetUid,
          createdAt,
          source: "adminOverride",
          createdBy: actorUid,
        }),
        db.writeUpdate(`public_ids/${currentId}`, {
          reserved: true,
          retiredFromUid: targetUid,
          retiredAt: createdAt,
          retiredBy: actorUid,
          currentPublicId: newId,
        }, ["reserved", "retiredFromUid", "retiredAt", "retiredBy", "currentPublicId"]),
        db.writeCreate(`admin_audit_logs/${randomId("admin")}`, {
          actorUid,
          action: "changePublicId",
          targetType: "user",
          targetId: targetUid,
          targetUid,
          reason,
          before: { publicId: currentId },
          after: { publicId: newId },
          operationId: key,
          createdAt,
        }),
        db.writeCreate(`control_operations/${key}`, {
          action: "changePublicId",
          actorUid,
          targetId: targetUid,
          status: "completed",
          result: resultData,
          createdAt,
        }),
      ]);

      return { ok: true, code: "ok", operationId: key, ...resultData };
    } catch (error) {
      await db.rollback(transaction);
      if (error instanceof ApiError) throw error;
      if ((error?.message === "ABORTED" || error?.status === 409) && attempt < 2) continue;
      throw error;
    }
  }
  throw new ApiError("transaction_failed", 500);
}

export async function changePublicId(request, env) {
  if (request.method !== "POST") {
    return json(request, env, { ok: false, code: "method_not_allowed" }, 405);
  }

  try {
    const decoded = await verifyFirebaseIdToken(request, env);
    const authAge = Math.floor(Date.now() / 1000) - Number(decoded.auth_time || 0);
    if (!Number.isFinite(authAge) || authAge > 1800) {
      throw new ApiError("recent_auth_required", 401);
    }

    const body = await readJson(request);
    const currentId = normalizeId(body.currentId);
    const newId = normalizeId(body.newId);
    const reason = clean(body.reason);
    const key = clean(body.idempotencyKey);

    if (
      !/^\d{3,12}$/.test(currentId) ||
      !/^\d{3,12}$/.test(newId) ||
      currentId === newId ||
      reason.length < 3 ||
      reason.length > 160 ||
      !/^[A-Za-z0-9_-]{12,160}$/.test(key)
    ) {
      throw new ApiError("invalid_request", 400);
    }

    const result = await execute(firestoreClient(env), decoded.sub, body);
    return json(request, env, result, 200);
  } catch (error) {
    if (error instanceof ApiError) return json(request, env, { ok: false, code: error.code }, error.status);
    const raw = clean(error?.message);
    if (raw === "unauthorized") return json(request, env, { ok: false, code: "unauthorized" }, 401);
    if (raw === "server_not_configured" || raw === "invalid_service_account_json") {
      return json(request, env, { ok: false, code: raw }, 503);
    }
    return json(request, env, { ok: false, code: "server_transaction_failed" }, 500);
  }
}
