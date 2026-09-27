import {
  firestoreQuotaResponse,
  json,
  readJson,
} from "./http.js";
import { verifyFirebaseIdToken } from "./firebase-auth.js";
import { firestoreClient } from "./firestore.js";
import {
  R2_BUCKET_NAME,
  R2_PRESIGN_TTL_SECONDS,
  presignR2Get,
  presignR2Put,
} from "./r2-presign.js";

const MAX_PROFILE_BYTES = 2 * 1024 * 1024;
const MAX_COVER_BYTES = 4 * 1024 * 1024;
const MAX_CHAT_BYTES = 8 * 1024 * 1024;
const RATE_WINDOW_MS = 60_000;
const UPLOAD_TICKET_TTL_MS = R2_PRESIGN_TTL_SECONDS * 1000;
export const REPLACEMENT_DELETE_DELAY_MS = 24 * 60 * 60 * 1000;
export const STORAGE_DELETE_BATCH_LIMIT = 25;
const REPLACEABLE_SCOPES = new Set([
  "profile_image",
  "profile_cover",
  "room_cover",
]);

export const STORAGE_SCOPE_CONFIG = Object.freeze({
  profile_image: Object.freeze({ maxBytes: MAX_PROFILE_BYTES }),
  profile_cover: Object.freeze({ maxBytes: MAX_COVER_BYTES }),
  room_cover: Object.freeze({ maxBytes: MAX_COVER_BYTES }),
  chat_image: Object.freeze({ maxBytes: MAX_CHAT_BYTES }),
});

const MIME_TO_EXT = Object.freeze({
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
});

const rateState = new Map();

class StorageApiError extends Error {
  constructor(code, status = 400) {
    super(code);
    this.code = code;
    this.status = status;
  }
}

const clean = (value) => String(value ?? "").trim();

function encodedSegment(value) {
  const text = clean(value);
  if (!text || text.length > 220 || text.includes("/")) {
    throw new StorageApiError("invalid_target", 400);
  }
  return encodeURIComponent(text);
}

export function storageExtensionForMime(mimeType) {
  return MIME_TO_EXT[clean(mimeType).toLowerCase()] || "";
}

export function storageMaxBytes(scope) {
  return Number(STORAGE_SCOPE_CONFIG[clean(scope)]?.maxBytes || 0);
}

export function isReplaceableStorageScope(scope) {
  return REPLACEABLE_SCOPES.has(clean(scope));
}

export function replacementDeleteAt(nowMs = Date.now()) {
  return new Date(Number(nowMs) + REPLACEMENT_DELETE_DELAY_MS);
}

export function storageActivePointerId(scope, targetId) {
  const normalizedScope = clean(scope);
  if (!isReplaceableStorageScope(normalizedScope)) {
    throw new StorageApiError("active_pointer_not_supported", 400);
  }
  return `${normalizedScope}__${encodedSegment(targetId)}`;
}

function storageActivePointerPath(scope, targetId) {
  return `storage_active_objects/${storageActivePointerId(scope, targetId)}`;
}

export function buildStorageObjectKey({
  scope,
  uid,
  targetId,
  objectId,
  extension,
}) {
  const safeUid = encodedSegment(uid);
  const safeTarget = encodedSegment(targetId);
  const safeObject = encodedSegment(objectId);
  const safeExt = clean(extension).toLowerCase();
  if (!/^(jpg|png|webp)$/.test(safeExt)) {
    throw new StorageApiError("invalid_file_type", 400);
  }

  switch (clean(scope)) {
    case "profile_image":
      return `users/${safeUid}/profile/${safeObject}.${safeExt}`;
    case "profile_cover":
      return `users/${safeUid}/covers/${safeObject}.${safeExt}`;
    case "room_cover":
      return `rooms/${safeTarget}/covers/${safeObject}.${safeExt}`;
    case "chat_image":
      return `chat/${safeTarget}/${safeUid}/${safeObject}.${safeExt}`;
    default:
      throw new StorageApiError("invalid_scope", 400);
  }
}

export function validateStoragePayload({
  scope,
  mimeType,
  byteLength,
}) {
  const normalizedScope = clean(scope);
  const config = STORAGE_SCOPE_CONFIG[normalizedScope];
  if (!config) throw new StorageApiError("invalid_scope", 400);

  const extension = storageExtensionForMime(mimeType);
  if (!extension) throw new StorageApiError("invalid_file_type", 400);

  const size = Number(byteLength || 0);
  if (!Number.isSafeInteger(size) || size <= 0 || size > config.maxBytes) {
    throw new StorageApiError("invalid_file_size", 400);
  }

  return {
    scope: normalizedScope,
    mimeType: clean(mimeType).toLowerCase(),
    extension,
    maxBytes: config.maxBytes,
  };
}

function bucketFromEnv(env) {
  const bucket = env?.USER_STORAGE;
  if (
    !bucket ||
    typeof bucket.head !== "function" ||
    typeof bucket.delete !== "function"
  ) {
    throw new StorageApiError("r2_not_configured", 503);
  }
  return bucket;
}

function rateLimitForAction(action) {
  switch (action) {
    case "prepareUpload":
      return 8;
    case "confirmUpload":
      return 12;
    case "prepareRead":
      return 180;
    case "delete":
      return 20;
    default:
      return 30;
  }
}

export function consumeStorageRateLimit(
  uid,
  action,
  nowMs = Date.now(),
) {
  const key = `${clean(uid)}:${clean(action)}`;
  const limit = rateLimitForAction(action);
  const existing = rateState.get(key);
  const current =
    existing && Number(existing.resetAtMs || 0) > nowMs
      ? existing
      : { count: 0, resetAtMs: nowMs + RATE_WINDOW_MS };

  if (current.count >= limit) {
    return {
      ok: false,
      retryAfterSeconds: Math.max(
        1,
        Math.ceil((current.resetAtMs - nowMs) / 1000),
      ),
    };
  }

  current.count += 1;
  rateState.set(key, current);

  if (rateState.size > 5_000) {
    for (const [entryKey, value] of rateState.entries()) {
      if (Number(value?.resetAtMs || 0) <= nowMs) rateState.delete(entryKey);
    }
  }
  return { ok: true, retryAfterSeconds: 0 };
}

async function authContext(request, env) {
  const decoded = await verifyFirebaseIdToken(request, env);
  const uid = clean(decoded.sub);
  if (!uid) throw new StorageApiError("unauthorized", 401);
  return { uid, decoded, db: firestoreClient(env) };
}

async function authorizeUpload(db, uid, scope, rawTargetId) {
  if (scope === "profile_image" || scope === "profile_cover") {
    return { targetId: uid };
  }

  const targetId = clean(rawTargetId);
  if (!targetId || targetId.includes("/")) {
    throw new StorageApiError("invalid_target", 400);
  }

  if (scope === "room_cover") {
    const room = await db.get(`rooms/${targetId}`);
    if (!room.exists) throw new StorageApiError("room_not_found", 404);
    const ownerUid = clean(room.data?.ownerUid || room.data?.hostId);
    const hostId = clean(room.data?.hostId);
    if (uid !== ownerUid && uid !== hostId) {
      throw new StorageApiError("forbidden", 403);
    }
    return { targetId };
  }

  if (scope === "chat_image") {
    const conversation = await db.get(`conversations/${targetId}`);
    if (!conversation.exists) {
      throw new StorageApiError("invalid_conversation", 404);
    }
    const participants = Array.isArray(conversation.data?.participants)
      ? conversation.data.participants.map(clean).filter(Boolean)
      : [];
    if (!participants.includes(uid) || participants.length !== 2) {
      throw new StorageApiError("forbidden", 403);
    }
    const otherUid = participants.find((value) => value !== uid) || "";
    if (!otherUid) throw new StorageApiError("invalid_conversation", 400);

    const [forward, reverse] = await Promise.all([
      db.get(`follows/${uid}__${otherUid}`),
      db.get(`follows/${otherUid}__${uid}`),
    ]);
    if (!forward.exists || !reverse.exists) {
      throw new StorageApiError("follow_required", 403);
    }
    return { targetId, otherUid };
  }

  throw new StorageApiError("invalid_scope", 400);
}

async function metadataForObject(db, objectId) {
  const id = clean(objectId);
  if (!/^[a-f0-9]{32}$/.test(id)) {
    throw new StorageApiError("invalid_object_id", 400);
  }
  const metadata = await db.get(`storage_objects/${id}`);
  if (!metadata.exists) throw new StorageApiError("storage_object_not_found", 404);
  return { objectId: id, ...metadata.data };
}

async function ticketForObject(db, objectId) {
  const id = clean(objectId);
  if (!/^[a-f0-9]{32}$/.test(id)) {
    throw new StorageApiError("invalid_object_id", 400);
  }
  const ticket = await db.get(`storage_upload_tickets/${id}`);
  if (!ticket.exists) return null;
  return { objectId: id, ...ticket.data };
}

async function authorizeRead(db, uid, metadata) {
  const scope = clean(metadata.scope);
  if (
    scope === "profile_image" ||
    scope === "profile_cover" ||
    scope === "room_cover"
  ) {
    return true;
  }

  if (scope === "chat_image") {
    const conversationId = clean(metadata.targetId);
    const conversation = await db.get(`conversations/${conversationId}`);
    const participants = Array.isArray(conversation.data?.participants)
      ? conversation.data.participants.map(clean)
      : [];
    if (!conversation.exists || !participants.includes(uid)) {
      throw new StorageApiError("forbidden", 403);
    }
    return true;
  }

  throw new StorageApiError("forbidden", 403);
}

function authorizeDelete(uid, metadata) {
  if (clean(metadata.ownerUid) !== uid) {
    throw new StorageApiError("forbidden", 403);
  }
  return true;
}

function auditId() {
  return crypto.randomUUID().replaceAll("-", "");
}

function timestampMs(value) {
  if (value instanceof Date) return value.getTime();
  const ms = Date.parse(clean(value));
  return Number.isFinite(ms) ? ms : 0;
}

async function prepareUpload(request, env, auth, body) {
  const scope = clean(body.scope);
  const mimeType = clean(body.mimeType).toLowerCase();
  const byteLength = Number(body.byteLength || 0);
  const rawTargetId = clean(body.targetId);
  const replaceObjectId = clean(body.replaceObjectId);

  const validated = validateStoragePayload({
    scope,
    mimeType,
    byteLength,
  });
  const authorization = await authorizeUpload(
    auth.db,
    auth.uid,
    scope,
    rawTargetId,
  );

  let previous = null;
  let effectiveReplaceObjectId = "";
  if (isReplaceableStorageScope(scope)) {
    const pointer = await auth.db.get(
      storageActivePointerPath(scope, authorization.targetId),
    );
    const activeObjectId = pointer.exists
      ? clean(pointer.data?.objectId)
      : "";

    if (
      replaceObjectId &&
      activeObjectId &&
      replaceObjectId !== activeObjectId
    ) {
      throw new StorageApiError("replace_conflict", 409);
    }

    effectiveReplaceObjectId = activeObjectId || replaceObjectId;
    if (effectiveReplaceObjectId) {
      previous = await metadataForObject(auth.db, effectiveReplaceObjectId);
      authorizeDelete(auth.uid, previous);
      if (
        clean(previous.scope) !== scope ||
        clean(previous.targetId) !== clean(authorization.targetId)
      ) {
        throw new StorageApiError("replace_scope_mismatch", 409);
      }
    }
  } else if (replaceObjectId) {
    throw new StorageApiError("replace_not_supported", 409);
  }

  const objectId = crypto.randomUUID().replaceAll("-", "");
  const storageKey = buildStorageObjectKey({
    scope,
    uid: auth.uid,
    targetId: authorization.targetId,
    objectId,
    extension: validated.extension,
  });
  const expiresAtMs = Date.now() + UPLOAD_TICKET_TTL_MS;

  const uploadUrl = await presignR2Put(env, {
    key: storageKey,
    mimeType: validated.mimeType,
    expiresSeconds: R2_PRESIGN_TTL_SECONDS,
  });

  await auth.db.commit(null, [
    auth.db.writeCreate(`storage_upload_tickets/${objectId}`, {
      objectId,
      storageKey,
      bucket: R2_BUCKET_NAME,
      scope,
      ownerUid: auth.uid,
      targetId: authorization.targetId,
      mimeType: validated.mimeType,
      expectedSizeBytes: byteLength,
      replaceObjectId: previous?.objectId || null,
      expiresAt: new Date(expiresAtMs),
      createdAt: new Date(),
    }),
  ]);

  return json(request, env, {
    ok: true,
    action: "prepareUpload",
    objectId,
    uploadUrl,
    expiresAtMs,
    requiredHeaders: {
      "content-type": validated.mimeType,
    },
    confirmAction: "confirmUpload",
  });
}

async function confirmUpload(request, env, auth, body) {
  const objectId = clean(body.objectId);
  let ticket = await ticketForObject(auth.db, objectId);

  if (!ticket) {
    const existing = await auth.db.get(`storage_objects/${objectId}`);
    if (
      existing.exists &&
      clean(existing.data?.ownerUid) === auth.uid
    ) {
      return json(request, env, {
        ok: true,
        action: "confirmUpload",
        objectId,
        code: "already_confirmed",
      });
    }
    throw new StorageApiError("upload_ticket_not_found", 404);
  }

  if (clean(ticket.ownerUid) !== auth.uid) {
    throw new StorageApiError("forbidden", 403);
  }

  const bucket = bucketFromEnv(env);
  if (timestampMs(ticket.expiresAt) < Date.now()) {
    await bucket.delete(clean(ticket.storageKey)).catch(() => {});
    await auth.db.commit(null, [
      auth.db.writeDelete(`storage_upload_tickets/${objectId}`),
    ]).catch(() => {});
    throw new StorageApiError("upload_ticket_expired", 410);
  }

  const object = await bucket.head(clean(ticket.storageKey));
  if (!object) {
    throw new StorageApiError("uploaded_object_not_found", 409);
  }

  const actualSize = Number(object.size || 0);
  const expectedSize = Number(ticket.expectedSizeBytes || 0);
  const actualMime = clean(object.httpMetadata?.contentType).toLowerCase();
  const expectedMime = clean(ticket.mimeType).toLowerCase();

  if (
    actualSize !== expectedSize ||
    (actualMime && actualMime !== expectedMime)
  ) {
    await bucket.delete(clean(ticket.storageKey)).catch(() => {});
    await auth.db.commit(null, [
      auth.db.writeDelete(`storage_upload_tickets/${objectId}`),
    ]).catch(() => {});
    throw new StorageApiError("uploaded_object_mismatch", 409);
  }

  let previous = null;
  const replaceObjectId = clean(ticket.replaceObjectId);
  const replaceable = isReplaceableStorageScope(ticket.scope);
  let transaction = null;
  let pointerPath = "";
  if (replaceable) {
    pointerPath = storageActivePointerPath(ticket.scope, ticket.targetId);
    transaction = await auth.db.beginTransaction();
    const pointer = await auth.db.get(pointerPath, transaction);
    const currentActiveObjectId = pointer.exists
      ? clean(pointer.data?.objectId)
      : "";

    if (currentActiveObjectId !== replaceObjectId) {
      await auth.db.rollback(transaction);
      await bucket.delete(clean(ticket.storageKey)).catch(() => {});
      await auth.db.commit(null, [
        auth.db.writeDelete(`storage_upload_tickets/${objectId}`),
      ]).catch(() => {});
      throw new StorageApiError("replace_conflict", 409);
    }

    if (replaceObjectId) {
      const snap = await auth.db.get(
        `storage_objects/${replaceObjectId}`,
        transaction,
      );
      if (
        !snap.exists ||
        clean(snap.data?.ownerUid) !== auth.uid ||
        clean(snap.data?.scope) !== clean(ticket.scope) ||
        clean(snap.data?.targetId) !== clean(ticket.targetId)
      ) {
        await auth.db.rollback(transaction);
        throw new StorageApiError("replace_conflict", 409);
      }
      previous = { objectId: replaceObjectId, ...snap.data };
    }
  }

  const now = new Date();
  const metadata = {
    objectId,
    storageKey: clean(ticket.storageKey),
    bucket: R2_BUCKET_NAME,
    scope: clean(ticket.scope),
    ownerUid: auth.uid,
    targetId: clean(ticket.targetId),
    mimeType: expectedMime,
    sizeBytes: actualSize,
    etag: clean(object.etag),
    state: "active",
    createdAt: now,
    updatedAt: now,
  };

  const writes = [
    auth.db.writeCreate(`storage_objects/${objectId}`, metadata),
    auth.db.writeDelete(`storage_upload_tickets/${objectId}`),
    auth.db.writeCreate(`storage_audit_logs/${auditId()}`, {
      actorUid: auth.uid,
      action: previous ? "replaceStorageObject" : "uploadStorageObject",
      objectId,
      scope: metadata.scope,
      targetId: metadata.targetId,
      sizeBytes: actualSize,
      replacedObjectId: previous?.objectId || null,
      createdAt: now,
    }),
  ];
  let previousDeleteAt = null;
  if (previous) {
    previousDeleteAt = replacementDeleteAt(now.getTime());
    writes.push(
      auth.db.writeUpdate(
        `storage_objects/${previous.objectId}`,
        {
          state: "pending_delete",
          pendingDeleteAt: previousDeleteAt,
          replacedByObjectId: objectId,
          updatedAt: now,
        },
        ["state", "pendingDeleteAt", "replacedByObjectId", "updatedAt"],
      ),
    );
    writes.push(
      auth.db.writeCreate(`storage_delete_queue/${previous.objectId}`, {
        objectId: previous.objectId,
        storageKey: clean(previous.storageKey),
        ownerUid: clean(previous.ownerUid),
        scope: clean(previous.scope),
        targetId: clean(previous.targetId),
        sizeBytes: Number(previous.sizeBytes || 0),
        deleteAfter: previousDeleteAt,
        reason: "replaced",
        createdAt: now,
      }),
    );
  }

  if (replaceable) {
    writes.push(
      auth.db.writeUpdate(pointerPath, {
        objectId,
        ownerUid: auth.uid,
        scope: metadata.scope,
        targetId: metadata.targetId,
        updatedAt: now,
      }),
    );
  }

  await auth.db.commit(transaction, writes);

  return json(request, env, {
    ok: true,
    action: "confirmUpload",
    objectId,
    scope: metadata.scope,
    targetId: metadata.targetId,
    mimeType: metadata.mimeType,
    sizeBytes: metadata.sizeBytes,
    replacedObjectId: previous?.objectId || null,
    previousDeleteAtMs: previousDeleteAt?.getTime() || null,
  });
}

export async function runDueStorageCleanup(
  env,
  {
    nowMs = Date.now(),
    limit = STORAGE_DELETE_BATCH_LIMIT,
  } = {},
) {
  const bucket = bucketFromEnv(env);
  const db = firestoreClient(env);
  const due = await db.runQuery("storage_delete_queue", {
    filters: [
      { field: "deleteAfter", op: "<=", value: new Date(nowMs) },
    ],
    orderBy: [{ field: "deleteAfter", direction: "asc" }],
    limit: Math.max(1, Math.min(STORAGE_DELETE_BATCH_LIMIT, Number(limit || STORAGE_DELETE_BATCH_LIMIT))),
  });

  let deleted = 0;
  let failed = 0;
  for (const item of due) {
    const objectId = clean(item.data?.objectId || item.id);
    const storageKey = clean(item.data?.storageKey);
    if (!objectId || !storageKey) {
      failed += 1;
      continue;
    }

    try {
      await bucket.delete(storageKey);
      const now = new Date();
      await db.commit(null, [
        db.writeDelete(`storage_objects/${objectId}`),
        db.writeDelete(`storage_delete_queue/${item.id}`),
        db.writeCreate(`storage_audit_logs/${auditId()}`, {
          actorUid: "system",
          action: "cleanupReplacedStorageObject",
          objectId,
          scope: clean(item.data?.scope),
          targetId: clean(item.data?.targetId),
          sizeBytes: Number(item.data?.sizeBytes || 0),
          reason: clean(item.data?.reason || "replaced"),
          createdAt: now,
        }),
      ]);
      deleted += 1;
    } catch (error) {
      failed += 1;
      console.error(
        "R2 delayed storage cleanup failed",
        JSON.stringify({
          objectId,
          code: clean(error?.code || error?.message || "cleanup_failed").slice(0, 120),
        }),
      );
    }
  }

  return {
    checked: due.length,
    deleted,
    failed,
  };
}

async function prepareRead(request, env, auth, body) {
  const metadata = await metadataForObject(auth.db, body.objectId);
  await authorizeRead(auth.db, auth.uid, metadata);
  const readUrl = await presignR2Get(env, {
    key: clean(metadata.storageKey),
    expiresSeconds: R2_PRESIGN_TTL_SECONDS,
  });
  return json(request, env, {
    ok: true,
    action: "prepareRead",
    objectId: metadata.objectId,
    readUrl,
    expiresAtMs: Date.now() + UPLOAD_TICKET_TTL_MS,
    mimeType: clean(metadata.mimeType),
    sizeBytes: Number(metadata.sizeBytes || 0),
  });
}

async function deleteObject(request, env, auth) {
  const url = new URL(request.url);
  const metadata = await metadataForObject(
    auth.db,
    url.searchParams.get("objectId"),
  );
  authorizeDelete(auth.uid, metadata);

  const now = new Date();
  const writes = [
    auth.db.writeDelete(`storage_objects/${metadata.objectId}`),
    auth.db.writeDelete(`storage_delete_queue/${metadata.objectId}`),
    auth.db.writeCreate(`storage_audit_logs/${auditId()}`, {
      actorUid: auth.uid,
      action: "deleteStorageObject",
      objectId: metadata.objectId,
      scope: clean(metadata.scope),
      targetId: clean(metadata.targetId),
      sizeBytes: Number(metadata.sizeBytes || 0),
      createdAt: now,
    }),
  ];

  if (isReplaceableStorageScope(metadata.scope)) {
    const pointerPath = storageActivePointerPath(
      metadata.scope,
      metadata.targetId,
    );
    const pointer = await auth.db.get(pointerPath);
    if (
      pointer.exists &&
      clean(pointer.data?.objectId) === metadata.objectId
    ) {
      writes.push(auth.db.writeDelete(pointerPath));
    }
  }

  await auth.db.commit(null, writes);

  const bucket = bucketFromEnv(env);
  await bucket.delete(clean(metadata.storageKey));

  return json(request, env, {
    ok: true,
    objectId: metadata.objectId,
    deleted: true,
  });
}

export async function userStorage(request, env) {
  if (!["POST", "DELETE"].includes(request.method)) {
    return json(
      request,
      env,
      {
        ok: false,
        code: request.method === "PUT"
          ? "direct_upload_required"
          : "method_not_allowed",
      },
      request.method === "PUT" ? 409 : 405,
    );
  }

  try {
    const auth = await authContext(request, env);

    if (request.method === "DELETE") {
      const rate = consumeStorageRateLimit(auth.uid, "delete");
      if (!rate.ok) {
        return json(
          request,
          env,
          { ok: false, code: "rate_limited" },
          429,
          { "Retry-After": String(rate.retryAfterSeconds) },
        );
      }
      return await deleteObject(request, env, auth);
    }

    const body = await readJson(request);
    const action = clean(body.action);
    if (!["prepareUpload", "confirmUpload", "prepareRead"].includes(action)) {
      throw new StorageApiError("invalid_action", 400);
    }

    const rate = consumeStorageRateLimit(auth.uid, action);
    if (!rate.ok) {
      return json(
        request,
        env,
        { ok: false, code: "rate_limited" },
        429,
        { "Retry-After": String(rate.retryAfterSeconds) },
      );
    }

    if (action === "prepareUpload") {
      return await prepareUpload(request, env, auth, body);
    }
    if (action === "confirmUpload") {
      return await confirmUpload(request, env, auth, body);
    }
    return await prepareRead(request, env, auth, body);
  } catch (error) {
    const quotaResponse = firestoreQuotaResponse(request, env, error);
    if (quotaResponse) return quotaResponse;

    if (error instanceof StorageApiError) {
      return json(request, env, { ok: false, code: error.code }, error.status);
    }

    const code = clean(error?.code || error?.message);
    if (code === "unauthorized") {
      return json(request, env, { ok: false, code: "unauthorized" }, 401);
    }
    if (code === "auth_state_lookup_failed") {
      return json(request, env, { ok: false, code }, 503);
    }
    if (code === "r2_presign_not_configured") {
      return json(request, env, { ok: false, code }, 503);
    }
    return json(request, env, { ok: false, code: "storage_server_failed" }, 500);
  }
}
