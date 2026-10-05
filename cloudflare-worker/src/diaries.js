import { json, readJson, firestoreQuotaResponse } from "./http.js";
import { verifyFirebaseIdToken } from "./firebase-auth.js";
import { firestoreClient } from "./firestore.js";
import { annotatePressureRequest } from "./pressure-telemetry.js";

const clean = (value) => String(value ?? "").trim();
const MAX_TEXT_LENGTH = 500;
const MAX_IMAGES = 2;
const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 30;
const URL_PATTERN = /(?:https?:\/\/|www\.|\b[a-z0-9-]+\.(?:com|net|org|io|co|me|app|dev|gg|tv|ae|sa|sy)(?:\/|\b))/i;
const OPERATION_KEY_PATTERN = /^[A-Za-z0-9_-]{12,220}$/;
const OBJECT_ID_PATTERN = /^[a-f0-9]{32}$/;

class DiaryApiError extends Error {
  constructor(code, status = 400) {
    super(code);
    this.code = code;
    this.status = status;
  }
}

function randomId(prefix) {
  return `${prefix}_${crypto.randomUUID().replace(/-/g, "")}`;
}

function assertSafeId(value, code = "invalid_id") {
  const id = clean(value);
  if (!id || id.length > 220 || id.includes("/") || id.includes("\\")) {
    throw new DiaryApiError(code, 400);
  }
  return id;
}

function assertOperationKey(value) {
  const key = clean(value);
  if (!OPERATION_KEY_PATTERN.test(key)) {
    throw new DiaryApiError("invalid_idempotency_key", 400);
  }
  return key;
}

export function diaryText(value) {
  const text = clean(value);
  if (text.length > MAX_TEXT_LENGTH) {
    throw new DiaryApiError("diary_text_too_long", 400);
  }
  if (text && URL_PATTERN.test(text)) {
    throw new DiaryApiError("external_links_not_allowed", 400);
  }
  return text;
}

export function diaryImageIds(value) {
  if (value == null) return [];
  if (!Array.isArray(value) || value.length > MAX_IMAGES) {
    throw new DiaryApiError("invalid_diary_images", 400);
  }
  const ids = value.map((item) => clean(item).toLowerCase());
  if (ids.some((id) => !OBJECT_ID_PATTERN.test(id))) {
    throw new DiaryApiError("invalid_diary_image", 400);
  }
  if (new Set(ids).size !== ids.length) {
    throw new DiaryApiError("duplicate_diary_image", 400);
  }
  return ids;
}

function assertNotEmpty(text, imageObjectIds) {
  if (!text && imageObjectIds.length === 0) {
    throw new DiaryApiError("empty_diary", 400);
  }
}

function createSignature(text, imageObjectIds, commentsEnabled) {
  return JSON.stringify({
    text,
    imageObjectIds,
    commentsEnabled: commentsEnabled === true,
  });
}

function pageLimit(value) {
  const raw = Number(value || DEFAULT_PAGE_SIZE);
  if (!Number.isFinite(raw)) return DEFAULT_PAGE_SIZE;
  return Math.max(1, Math.min(MAX_PAGE_SIZE, Math.trunc(raw)));
}

function cursorMs(value) {
  if (value == null || value === "") return null;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new DiaryApiError("invalid_cursor", 400);
  }
  return parsed;
}

function publicAuthorSnapshot(user = {}, uid = "") {
  return {
    ownerUid: uid,
    ownerName: clean(user.displayName || user.name || "مستخدم Shadow Live").slice(0, 80),
    ownerPublicId: clean(user.publicId).slice(0, 16),
    ownerProfileImageUrl: clean(user.profileImageUrl).slice(0, 1000),
    ownerProfileAvatarAsset: clean(user.profileAvatarAsset).slice(0, 500),
  };
}

function publicImageSnapshot(objectId, object = {}) {
  return {
    objectId,
    publicUrl: clean(object.publicUrl).slice(0, 1500),
    mimeType: clean(object.mimeType).slice(0, 80),
    sizeBytes: Math.max(0, Number(object.sizeBytes || 0)),
  };
}

function normalizeDiary(id, data = {}) {
  return {
    diaryId: id,
    ownerUid: clean(data.ownerUid),
    ownerName: clean(data.ownerName),
    ownerPublicId: clean(data.ownerPublicId),
    ownerProfileImageUrl: clean(data.ownerProfileImageUrl),
    ownerProfileAvatarAsset: clean(data.ownerProfileAvatarAsset),
    text: clean(data.text),
    images: Array.isArray(data.images) ? data.images : [],
    commentsEnabled: data.commentsEnabled !== false,
    likeCount: Math.max(0, Number(data.likeCount || 0)),
    commentCount: Math.max(0, Number(data.commentCount || 0)),
    giftCount: Math.max(0, Number(data.giftCount || 0)),
    giftCoins: Math.max(0, Number(data.giftCoins || 0)),
    viewCount: Math.max(0, Number(data.viewCount || 0)),
    createdAt: data.createdAt || null,
    createdAtMs: Math.max(0, Number(data.createdAtMs || 0)),
  };
}

async function runTransaction(db, body) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const transaction = await db.beginTransaction();
    try {
      return await body(transaction);
    } catch (error) {
      await db.rollback(transaction);
      if (error instanceof DiaryApiError) throw error;
      if ((error?.message === "ABORTED" || error?.status === 409) && attempt < 2) {
        continue;
      }
      throw error;
    }
  }
  throw new DiaryApiError("transaction_failed", 500);
}

async function requireRegisteredUser(db, uid, transaction = null) {
  const user = await db.get(`users/${uid}`, transaction);
  if (!user.exists) throw new DiaryApiError("user_not_found", 404);
  return user.data || {};
}

function isAnonymousToken(decoded) {
  return clean(decoded?.firebase?.sign_in_provider) === "anonymous";
}

async function createDiary(db, uid, body) {
  const text = diaryText(body.text);
  const imageObjectIds = diaryImageIds(body.imageObjectIds);
  const commentsEnabled = body.commentsEnabled !== false;
  const operationKey = assertOperationKey(body.idempotencyKey);
  const signature = createSignature(text, imageObjectIds, commentsEnabled);
  assertNotEmpty(text, imageObjectIds);

  return runTransaction(db, async (transaction) => {
    const operationPath = `diary_operations/${operationKey}`;
    const operation = await db.get(operationPath, transaction);
    if (operation.exists) {
      if (
        clean(operation.data?.action) !== "createDiary" ||
        clean(operation.data?.actorUid) !== uid ||
        clean(operation.data?.requestSignature) !== signature
      ) {
        throw new DiaryApiError("idempotency_conflict", 409);
      }
      await db.rollback(transaction);
      return { ok: true, code: "duplicate", ...(operation.data?.result || {}) };
    }

    const user = await requireRegisteredUser(db, uid, transaction);
    const objectSnaps = await Promise.all(
      imageObjectIds.map((objectId) => db.get(`storage_objects/${objectId}`, transaction)),
    );
    const linkSnaps = await Promise.all(
      imageObjectIds.map((objectId) => db.get(`diary_image_links/${objectId}`, transaction)),
    );

    const images = [];
    for (let index = 0; index < imageObjectIds.length; index += 1) {
      const objectId = imageObjectIds[index];
      const object = objectSnaps[index];
      const link = linkSnaps[index];
      if (!object.exists) throw new DiaryApiError("diary_image_not_found", 409);
      if (
        clean(object.data?.scope) !== "diary_image" ||
        clean(object.data?.ownerUid) !== uid ||
        clean(object.data?.targetId) !== uid ||
        clean(object.data?.state) !== "active" ||
        !clean(object.data?.publicUrl)
      ) {
        throw new DiaryApiError("invalid_diary_image", 409);
      }
      if (link.exists) throw new DiaryApiError("diary_image_already_linked", 409);
      images.push(publicImageSnapshot(objectId, object.data));
    }

    const diaryId = randomId("diary");
    const now = new Date();
    const nowMs = Date.now();
    const author = publicAuthorSnapshot(user, uid);
    const diary = {
      diaryId,
      ...author,
      text,
      images,
      commentsEnabled,
      likeCount: 0,
      commentCount: 0,
      giftCount: 0,
      giftCoins: 0,
      viewCount: 0,
      createdAt: now,
      createdAtMs: nowMs,
    };
    const result = { diaryId, createdAtMs: nowMs };

    const writes = [
      db.writeCreate(`diaries/${diaryId}`, diary),
      db.writeCreate(operationPath, {
        action: "createDiary",
        actorUid: uid,
        requestSignature: signature,
        diaryId,
        status: "completed",
        result,
        createdAt: now,
      }),
      db.writeCreate(`diary_audit_logs/${randomId("diaryaudit")}`, {
        action: "createDiary",
        actorUid: uid,
        diaryId,
        createdAt: now,
      }),
    ];
    for (const image of images) {
      writes.push(
        db.writeCreate(`diary_image_links/${image.objectId}`, {
          objectId: image.objectId,
          diaryId,
          ownerUid: uid,
          state: "linked",
          createdAt: now,
        }),
      );
    }

    await db.commit(transaction, writes);
    return { ok: true, ...result };
  });
}

async function deleteDiary(db, uid, body) {
  const diaryId = assertSafeId(body.diaryId, "invalid_diary_id");
  const operationKey = assertOperationKey(body.idempotencyKey);

  return runTransaction(db, async (transaction) => {
    const operationPath = `diary_operations/${operationKey}`;
    const [operation, diary] = await Promise.all([
      db.get(operationPath, transaction),
      db.get(`diaries/${diaryId}`, transaction),
    ]);
    if (operation.exists) {
      if (
        clean(operation.data?.action) !== "deleteDiary" ||
        clean(operation.data?.actorUid) !== uid ||
        clean(operation.data?.diaryId) !== diaryId
      ) {
        throw new DiaryApiError("idempotency_conflict", 409);
      }
      await db.rollback(transaction);
      return { ok: true, code: "duplicate", diaryId };
    }
    if (!diary.exists) throw new DiaryApiError("diary_not_found", 404);
    if (clean(diary.data?.ownerUid) !== uid) {
      throw new DiaryApiError("forbidden", 403);
    }

    const now = new Date();
    const images = Array.isArray(diary.data?.images) ? diary.data.images : [];
    const writes = [
      db.writeDelete(`diaries/${diaryId}`),
      db.writeCreate(operationPath, {
        action: "deleteDiary",
        actorUid: uid,
        diaryId,
        status: "completed",
        createdAt: now,
      }),
      db.writeCreate(`diary_audit_logs/${randomId("diaryaudit")}`, {
        action: "deleteDiary",
        actorUid: uid,
        diaryId,
        createdAt: now,
      }),
    ];
    for (const image of images.slice(0, MAX_IMAGES)) {
      const objectId = clean(image?.objectId);
      if (!OBJECT_ID_PATTERN.test(objectId)) continue;
      writes.push(
        db.writeUpdate(
          `diary_image_links/${objectId}`,
          {
            state: "pending_cleanup",
            deletedAt: now,
          },
          ["state", "deletedAt"],
        ),
      );
    }
    await db.commit(transaction, writes);
    return { ok: true, diaryId };
  });
}

async function setCommentsEnabled(db, uid, body) {
  const diaryId = assertSafeId(body.diaryId, "invalid_diary_id");
  const enabled = body.enabled === true;
  const operationKey = assertOperationKey(body.idempotencyKey);

  return runTransaction(db, async (transaction) => {
    const operationPath = `diary_operations/${operationKey}`;
    const [operation, diary] = await Promise.all([
      db.get(operationPath, transaction),
      db.get(`diaries/${diaryId}`, transaction),
    ]);
    if (operation.exists) {
      if (
        clean(operation.data?.action) !== "setCommentsEnabled" ||
        clean(operation.data?.actorUid) !== uid ||
        clean(operation.data?.diaryId) !== diaryId ||
        operation.data?.enabled !== enabled
      ) {
        throw new DiaryApiError("idempotency_conflict", 409);
      }
      await db.rollback(transaction);
      return { ok: true, code: "duplicate", diaryId, commentsEnabled: enabled };
    }
    if (!diary.exists) throw new DiaryApiError("diary_not_found", 404);
    if (clean(diary.data?.ownerUid) !== uid) {
      throw new DiaryApiError("forbidden", 403);
    }
    const now = new Date();
    await db.commit(transaction, [
      db.writeUpdate(
        `diaries/${diaryId}`,
        { commentsEnabled: enabled },
        ["commentsEnabled"],
      ),
      db.writeCreate(operationPath, {
        action: "setCommentsEnabled",
        actorUid: uid,
        diaryId,
        enabled,
        status: "completed",
        createdAt: now,
      }),
    ]);
    return { ok: true, diaryId, commentsEnabled: enabled };
  });
}

async function listLatest(db, body) {
  const limit = pageLimit(body.limit);
  const cursor = cursorMs(body.cursor);
  const rows = await db.runQuery("diaries", {
    orderBy: [{ field: "createdAtMs", direction: "desc" }],
    limit: limit + 1,
    startAfter: cursor ? [{ value: cursor }] : [],
  });
  const hasMore = rows.length > limit;
  const visible = rows.slice(0, limit);
  return {
    ok: true,
    items: visible.map((row) => normalizeDiary(row.id, row.data)),
    nextCursor:
      hasMore && visible.length
        ? String(visible[visible.length - 1].data?.createdAtMs || "")
        : null,
    hasMore,
  };
}

async function listUser(db, body) {
  const userId = assertSafeId(body.userId, "invalid_user");
  const limit = pageLimit(body.limit);
  const cursor = cursorMs(body.cursor);
  const rows = await db.runQuery("diaries", {
    filters: [{ field: "ownerUid", op: "==", value: userId }],
    orderBy: [{ field: "createdAtMs", direction: "desc" }],
    limit: limit + 1,
    startAfter: cursor ? [{ value: cursor }] : [],
  });
  const hasMore = rows.length > limit;
  const visible = rows.slice(0, limit);
  return {
    ok: true,
    items: visible.map((row) => normalizeDiary(row.id, row.data)),
    nextCursor:
      hasMore && visible.length
        ? String(visible[visible.length - 1].data?.createdAtMs || "")
        : null,
    hasMore,
  };
}

async function authContext(request, env) {
  const decoded = await verifyFirebaseIdToken(request, env);
  const uid = clean(decoded?.sub);
  if (!uid) throw new DiaryApiError("unauthorized", 401);
  return {
    decoded,
    uid,
    guest: isAnonymousToken(decoded),
    db: firestoreClient(env),
  };
}

export async function diaries(request, env) {
  if (request.method !== "POST") {
    return json(request, env, { ok: false, code: "method_not_allowed" }, 405);
  }

  try {
    const auth = await authContext(request, env);
    const body = await readJson(request);
    const action = clean(body.action);
    annotatePressureRequest(request, { action: `diaries_${action || "unknown"}` });

    if (action === "listLatest") {
      return json(request, env, await listLatest(auth.db, body));
    }
    if (action === "listUser") {
      return json(request, env, await listUser(auth.db, body));
    }

    if (auth.guest) {
      throw new DiaryApiError("guest_restricted", 403);
    }

    if (action === "createDiary") {
      return json(request, env, await createDiary(auth.db, auth.uid, body));
    }
    if (action === "deleteDiary") {
      return json(request, env, await deleteDiary(auth.db, auth.uid, body));
    }
    if (action === "setCommentsEnabled") {
      return json(request, env, await setCommentsEnabled(auth.db, auth.uid, body));
    }
    throw new DiaryApiError("unsupported_action", 400);
  } catch (error) {
    const quota = firestoreQuotaResponse(request, env, error);
    if (quota) return quota;
    const code = clean(error?.code || error?.message || "diaries_failed").slice(0, 120);
    const status = Number(error?.status || 0) || (code === "unauthorized" ? 401 : 500);
    return json(request, env, { ok: false, code }, status);
  }
}

export const diaryCoreTestHooks = Object.freeze({
  diaryText,
  diaryImageIds,
  createDiary,
  deleteDiary,
  setCommentsEnabled,
  listLatest,
  listUser,
  normalizeDiary,
});
