import { activeEffectiveVipLevelFromUser } from "./vip-runtime.js";
import {
  firestoreQuotaResponse,
  json,
  readJson,
} from "./http.js";
import { verifyFirebaseIdToken } from "./firebase-auth.js";
import { firestoreClient } from "./firestore.js";
import { publicMediaUrl } from "./public-media.js";
import {
  R2_BUCKET_NAME,
  R2_PRESIGN_TTL_SECONDS,
  presignR2Get,
  presignR2Put,
} from "./r2-presign.js";

const MAX_PROFILE_BYTES = 2 * 1024 * 1024;
const MAX_COVER_BYTES = 3 * 1024 * 1024;
const MAX_CHAT_BYTES = 3 * 1024 * 1024;
const MAX_DIARY_BYTES = 3 * 1024 * 1024;
const RATE_WINDOW_MS = 60_000;
const UPLOAD_TICKET_TTL_MS = R2_PRESIGN_TTL_SECONDS * 1000;
export const REPLACEMENT_DELETE_DELAY_MS = 24 * 60 * 60 * 1000;
export const DIARY_ORPHAN_DELETE_DELAY_MS = 24 * 60 * 60 * 1000;
export const STORAGE_DELETE_BATCH_LIMIT = 25;
const REPLACEABLE_SCOPES = new Set([
  "profile_image",
  "profile_avatar_animation",
  "profile_cover",
  "room_cover",
  "agency_logo",
  "agency_background",
  "agency_room_image",
]);

export const STORAGE_SCOPE_CONFIG = Object.freeze({
  profile_image: Object.freeze({ maxBytes: MAX_PROFILE_BYTES }),
  profile_avatar_animation: Object.freeze({ maxBytes: MAX_PROFILE_BYTES }),
  profile_cover: Object.freeze({ maxBytes: MAX_COVER_BYTES }),
  room_cover: Object.freeze({ maxBytes: MAX_COVER_BYTES }),
  agency_logo: Object.freeze({ maxBytes: MAX_PROFILE_BYTES }),
  agency_background: Object.freeze({ maxBytes: MAX_COVER_BYTES }),
  agency_room_image: Object.freeze({ maxBytes: MAX_COVER_BYTES }),
  chat_image: Object.freeze({ maxBytes: MAX_CHAT_BYTES }),
  diary_image: Object.freeze({ maxBytes: MAX_DIARY_BYTES }),
});

const MIME_TO_EXT = Object.freeze({
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
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

export function diaryOrphanDeleteAt(nowMs = Date.now()) {
  return new Date(Number(nowMs) + DIARY_ORPHAN_DELETE_DELAY_MS);
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
  if (!/^(jpg|png|webp|gif)$/.test(safeExt)) {
    throw new StorageApiError("invalid_file_type", 400);
  }

  switch (clean(scope)) {
    case "profile_image":
      return `users/${safeUid}/profile/${safeObject}.${safeExt}`;
    case "profile_avatar_animation":
      return `users/${safeUid}/profile-animation/${safeObject}.${safeExt}`;
    case "profile_cover":
      return `users/${safeUid}/covers/${safeObject}.${safeExt}`;
    case "diary_image":
      return `users/${safeUid}/diaries/${safeObject}.${safeExt}`;
    case "room_cover":
      return `rooms/${safeTarget}/covers/${safeObject}.${safeExt}`;
    case "agency_logo":
      return `agencies/${safeTarget}/logo/${safeObject}.${safeExt}`;
    case "agency_background":
      return `agencies/${safeTarget}/background/${safeObject}.${safeExt}`;
    case "agency_room_image":
      return `agencies/${safeTarget}/room-image/${safeObject}.${safeExt}`;
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
  if (extension === "gif" && normalizedScope !== "profile_avatar_animation") {
    throw new StorageApiError("gif_profile_only", 400);
  }
  if (normalizedScope === "profile_avatar_animation" && extension !== "gif") {
    throw new StorageApiError("animated_avatar_gif_required", 400);
  }

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

async function authorizeRoomCoverManagement(db, uid, targetId) {
  const [room, actor] = await Promise.all([
    db.get(`rooms/${targetId}`),
    db.get(`users/${uid}`),
  ]);
  if (!room.exists) throw new StorageApiError("room_not_found", 404);

  const ownerUid = clean(room.data?.ownerUid || room.data?.ownerId);
  const hostUid = clean(room.data?.hostUid || room.data?.hostId);
  const actorRole = clean(actor.data?.role);
  const actorEnabled = actor.data?.adminEnabled === true;
  const actorCapabilities = Array.isArray(actor.data?.capabilities)
    ? actor.data.capabilities.map(clean)
    : [];
  const globalManageRooms =
    actorRole === "owner" ||
    (
      actorEnabled &&
      (
        actorCapabilities.includes("manageRooms") ||
        actorCapabilities.includes("manage_rooms")
      )
    );

  if (uid !== ownerUid && uid !== hostUid && !globalManageRooms) {
    throw new StorageApiError("forbidden", 403);
  }
  return { targetId, room: room.data || {} };
}

export async function authorizeAgencyLogoManagement(
  db,
  uid,
  targetId,
  transaction = null,
) {
  const agency = await db.get(`agencies/${targetId}`, transaction);
  if (!agency.exists) throw new StorageApiError("agency_not_found", 404);
  if (clean(agency.data?.ownerUid) !== uid) {
    throw new StorageApiError("agency_owner_required", 403);
  }
  if (clean(agency.data?.status) === "closed") {
    throw new StorageApiError("agency_closed", 409);
  }
  return { targetId, agency: agency.data || {} };
}

async function authorizeVipAnimatedProfileImage(db, uid, nowMs = Date.now()) {
  const user = await db.get(`users/${uid}`);
  if (!user.exists) throw new StorageApiError("user_not_found", 404);
  if (activeEffectiveVipLevelFromUser(user.data || {}, nowMs) < 4) {
    throw new StorageApiError("vip4_required_for_animated_avatar", 403);
  }
  return true;
}

async function authorizeUpload(db, uid, scope, rawTargetId) {
  if (
    scope === "profile_image" ||
    scope === "profile_avatar_animation" ||
    scope === "profile_cover" ||
    scope === "diary_image"
  ) {
    return { targetId: uid };
  }

  const targetId = clean(rawTargetId);
  if (!targetId || targetId.includes("/")) {
    throw new StorageApiError("invalid_target", 400);
  }

  if (scope === "room_cover") {
    await authorizeRoomCoverManagement(db, uid, targetId);
    return { targetId };
  }

  if (scope === "agency_logo" ||
    scope === "agency_background" ||
    scope === "agency_room_image") {
    await authorizeAgencyLogoManagement(db, uid, targetId);
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

    const [forward, reverse, outgoingBlock, incomingBlock] =
      await Promise.all([
        db.get(`follows/${uid}__${otherUid}`),
        db.get(`follows/${otherUid}__${uid}`),
        db.get(`user_blocks/${uid}/items/${otherUid}`),
        db.get(`user_blocks/${otherUid}/items/${uid}`),
      ]);
    if (outgoingBlock.exists || incomingBlock.exists) {
      throw new StorageApiError("blocked", 403);
    }
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
    scope === "profile_avatar_animation" ||
    scope === "profile_cover" ||
    scope === "diary_image" ||
    scope === "room_cover" ||
    scope === "agency_logo" ||
    scope === "agency_background" ||
    scope === "agency_room_image"
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

async function authorizeDelete(db, uid, metadata) {
  if (clean(metadata.scope) === "room_cover") {
    await authorizeRoomCoverManagement(db, uid, clean(metadata.targetId));
    return true;
  }
  if (
    clean(metadata.scope) === "agency_logo" ||
    clean(metadata.scope) === "agency_background" ||
    clean(metadata.scope) === "agency_room_image"
  ) {
    await authorizeAgencyLogoManagement(db, uid, clean(metadata.targetId));
    return true;
  }
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
  if (scope === "profile_avatar_animation") {
    await authorizeVipAnimatedProfileImage(auth.db, auth.uid);
  }

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
      await authorizeDelete(auth.db, auth.uid, previous);
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
  if (
    clean(ticket.scope) === "profile_avatar_animation" &&
    clean(ticket.mimeType).toLowerCase() === "image/gif"
  ) {
    await authorizeVipAnimatedProfileImage(auth.db, auth.uid);
  }
  if (clean(ticket.scope) === "room_cover") {
    await authorizeRoomCoverManagement(
      auth.db,
      auth.uid,
      clean(ticket.targetId),
    );
  }
  if (
    clean(ticket.scope) === "agency_logo" ||
    clean(ticket.scope) === "agency_background" ||
    clean(ticket.scope) === "agency_room_image"
  ) {
    await authorizeAgencyLogoManagement(
      auth.db,
      auth.uid,
      clean(ticket.targetId),
    );
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
    let agencyAuthorization = null;
    if (
      clean(ticket.scope) === "agency_logo" ||
      clean(ticket.scope) === "agency_background" ||
      clean(ticket.scope) === "agency_room_image"
    ) {
      agencyAuthorization = await authorizeAgencyLogoManagement(
        auth.db,
        auth.uid,
        clean(ticket.targetId),
        transaction,
      );
    }
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
        (
          ![
            "room_cover",
            "agency_logo",
            "agency_background",
            "agency_room_image",
          ].includes(clean(ticket.scope)) &&
          clean(snap.data?.ownerUid) !== auth.uid
        ) ||
        clean(snap.data?.scope) !== clean(ticket.scope) ||
        clean(snap.data?.targetId) !== clean(ticket.targetId)
      ) {
        await auth.db.rollback(transaction);
        throw new StorageApiError("replace_conflict", 409);
      }
      previous = { objectId: replaceObjectId, ...snap.data };
    }
  }

  let linkedAgencyRoom = null;
  let linkedAgencyRoomId = "";
  if (clean(ticket.scope) === "agency_room_image" && transaction) {
    const agency = await authorizeAgencyLogoManagement(
      auth.db,
      auth.uid,
      clean(ticket.targetId),
      transaction,
    );
    linkedAgencyRoomId = clean(agency.agency?.roomId);
    if (
      linkedAgencyRoomId &&
      /^[A-Za-z0-9_-]{3,180}$/.test(linkedAgencyRoomId)
    ) {
      linkedAgencyRoom = await auth.db.get(
        `rooms/${linkedAgencyRoomId}`,
        transaction,
      );
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

  const stablePublicUrl = publicMediaUrl(request, {
    scope: metadata.scope,
    targetId: metadata.targetId,
    objectId,
    extension: storageExtensionForMime(metadata.mimeType),
  });
  if (stablePublicUrl) metadata.publicUrl = stablePublicUrl;

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
  let diaryOrphanDeleteAtValue = null;
  if (metadata.scope === "diary_image") {
    if (!stablePublicUrl) {
      if (transaction) await auth.db.rollback(transaction);
      throw new StorageApiError("public_media_url_missing", 500);
    }
    diaryOrphanDeleteAtValue = diaryOrphanDeleteAt(now.getTime());
    writes.push(
      auth.db.writeCreate(`storage_delete_queue/${objectId}`, {
        objectId,
        storageKey: metadata.storageKey,
        ownerUid: auth.uid,
        scope: metadata.scope,
        targetId: metadata.targetId,
        sizeBytes: metadata.sizeBytes,
        deleteAfter: diaryOrphanDeleteAtValue,
        reason: "diary_orphan_timeout",
        createdAt: now,
      }),
    );
  }
  if (metadata.scope === "profile_avatar_animation") {
    if (!stablePublicUrl) {
      if (transaction) await auth.db.rollback(transaction);
      throw new StorageApiError("public_media_url_missing", 500);
    }
    const publicProfile = await auth.db.get(
      `public_profiles/${auth.uid}`,
      transaction,
    );
    writes.push(
      auth.db.writeUpdate(
        `users/${auth.uid}`,
        {
          profileAvatarAnimationUrl: stablePublicUrl,
          profileAvatarAnimationObjectId: objectId,
          updatedAt: now,
        },
        [
          "profileAvatarAnimationUrl",
          "profileAvatarAnimationObjectId",
          "updatedAt",
        ],
      ),
    );
    if (publicProfile.exists) {
      writes.push(
        auth.db.writeUpdate(
          `public_profiles/${auth.uid}`,
          {
            profileAvatarAnimationUrl: stablePublicUrl,
            profileAvatarAnimationObjectId: objectId,
            updatedAt: now,
          },
          [
            "profileAvatarAnimationUrl",
            "profileAvatarAnimationObjectId",
            "updatedAt",
          ],
        ),
      );
    }
  }

  if (metadata.scope === "agency_logo") {
    if (!stablePublicUrl) {
      if (transaction) await auth.db.rollback(transaction);
      throw new StorageApiError("public_media_url_missing", 500);
    }
    writes.push(
      auth.db.writeUpdate(
        `agencies/${metadata.targetId}`,
        {
          logoUrl: stablePublicUrl,
          logoObjectId: objectId,
          updatedAt: now,
        },
        ["logoUrl", "logoObjectId", "updatedAt"],
      ),
      auth.db.writeCreate(
        `admin_audit_logs/agency_logo_${metadata.targetId}_${objectId}`,
        {
          actorUid: auth.uid,
          action: previous ? "replaceAgencyLogo" : "uploadAgencyLogo",
          targetType: "agency",
          targetId: metadata.targetId,
          objectId,
          replacedObjectId: previous?.objectId || null,
          createdAt: now,
        },
      ),
    );
  }
  if (metadata.scope === "agency_background") {
    if (!stablePublicUrl) {
      if (transaction) await auth.db.rollback(transaction);
      throw new StorageApiError("public_media_url_missing", 500);
    }
    writes.push(
      auth.db.writeUpdate(
        `agencies/${metadata.targetId}`,
        {
          backgroundUrl: stablePublicUrl,
          backgroundObjectId: objectId,
          coverUrl: stablePublicUrl,
          updatedAt: now,
        },
        [
          "backgroundUrl",
          "backgroundObjectId",
          "coverUrl",
          "updatedAt",
        ],
      ),
      auth.db.writeCreate(
        `admin_audit_logs/agency_background_${metadata.targetId}_${objectId}`,
        {
          actorUid: auth.uid,
          action: previous
            ? "replaceAgencyBackground"
            : "uploadAgencyBackground",
          targetType: "agency",
          targetId: metadata.targetId,
          objectId,
          replacedObjectId: previous?.objectId || null,
          createdAt: now,
        },
      ),
    );
  }

  if (metadata.scope === "agency_room_image") {
    if (!stablePublicUrl) {
      if (transaction) await auth.db.rollback(transaction);
      throw new StorageApiError("public_media_url_missing", 500);
    }

    writes.push(
      auth.db.writeUpdate(
        `agencies/${metadata.targetId}`,
        {
          roomImageUrl: stablePublicUrl,
          roomImageObjectId: objectId,
          updatedAt: now,
        },
        ["roomImageUrl", "roomImageObjectId", "updatedAt"],
      ),
      auth.db.writeCreate(
        `admin_audit_logs/agency_room_image_${metadata.targetId}_${objectId}`,
        {
          actorUid: auth.uid,
          action: previous
            ? "replaceAgencyRoomImage"
            : "uploadAgencyRoomImage",
          targetType: "agency_room",
          targetId: metadata.targetId,
          roomId: linkedAgencyRoomId || null,
          objectId,
          replacedObjectId: previous?.objectId || null,
          createdAt: now,
        },
      ),
    );

    if (
      linkedAgencyRoom?.exists &&
      clean(linkedAgencyRoom.data?.agencyId) === metadata.targetId
    ) {
      writes.push(
        auth.db.writeUpdate(
          `rooms/${linkedAgencyRoomId}`,
          {
            agencyRoomImageUrl: stablePublicUrl,
            agencyRoomImageObjectId: objectId,
            updatedAt: now,
          },
          [
            "agencyRoomImageUrl",
            "agencyRoomImageObjectId",
            "updatedAt",
          ],
        ),
      );
    }
  }

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
    orphanDeleteAtMs: diaryOrphanDeleteAtValue?.getTime() || null,
    publicUrl: stablePublicUrl,
  });
}

export async function storageQueueObjectStillReferenced(
  db,
  queueItem,
  objectId,
) {
  const scope = clean(queueItem?.scope);
  if (scope === "diary_image") {
    const link = await db.get(`diary_image_links/${clean(objectId)}`);
    return link.exists && clean(link.data?.state) === "linked";
  }

  const targetId = clean(queueItem?.targetId);
  if (!targetId) return false;

  let documentPath = "";
  let field = "";
  switch (scope) {
    case "profile_image":
      documentPath = `users/${targetId}`;
      field = "profileImageObjectId";
      break;
    case "profile_avatar_animation":
      documentPath = `users/${targetId}`;
      field = "profileAvatarAnimationObjectId";
      break;
    case "profile_cover":
      documentPath = `users/${targetId}`;
      field = "coverImageObjectId";
      break;
    case "room_cover":
      documentPath = `rooms/${targetId}`;
      field = "coverImageObjectId";
      break;
    case "agency_logo":
      documentPath = `agencies/${targetId}`;
      field = "logoObjectId";
      break;
    case "agency_background":
      documentPath = `agencies/${targetId}`;
      field = "backgroundObjectId";
      break;
    case "agency_room_image":
      documentPath = `agencies/${targetId}`;
      field = "roomImageObjectId";
      break;
    default:
      return false;
  }

  const snapshot = await db.get(documentPath);
  if (!snapshot.exists) return false;
  return clean(snapshot.data?.[field]) === clean(objectId);
}

async function transferSharedRoomCoverOnAccountDeletion({
  db,
  deletedUid,
  item,
  objectId,
  nowMs,
}) {
  if (clean(item?.data?.scope) !== "room_cover") return "";

  const targetId = clean(item?.data?.targetId);
  if (!targetId) return "";

  const room = await db.get(`rooms/${targetId}`);
  if (
    !room.exists ||
    clean(room.data?.coverImageObjectId) !== objectId
  ) {
    return "";
  }

  const isOfficialRoom =
    room.data?.systemOwned === true ||
    room.data?.officialRoom === true;
  const directOwnerUid = clean(
    room.data?.ownerUid ||
    room.data?.ownerId,
  );
  const roomOwnerUid =
    directOwnerUid && directOwnerUid !== deletedUid
      ? directOwnerUid
      : isOfficialRoom
        ? `room:${targetId}`
        : "";
  if (!roomOwnerUid) return "";

  const now = new Date(nowMs);
  const writes = [
    db.writeUpdate(
      `storage_objects/${objectId}`,
      { ownerUid: roomOwnerUid, updatedAt: now },
      ["ownerUid", "updatedAt"],
    ),
    db.writeCreate(`storage_audit_logs/${auditId()}`, {
      actorUid: "system",
      subjectUid: deletedUid,
      action: "transferDeletedAccountRoomCoverOwnership",
      objectId,
      scope: "room_cover",
      targetId,
      transferredToUid: roomOwnerUid,
      reason: "shared_room_cover_still_active",
      createdAt: now,
    }),
  ];

  const pointerPath = storageActivePointerPath("room_cover", targetId);
  const pointer = await db.get(pointerPath);
  if (
    pointer.exists &&
    clean(pointer.data?.objectId) === objectId
  ) {
    writes.push(
      db.writeUpdate(
        pointerPath,
        { ownerUid: roomOwnerUid, updatedAt: now },
        ["ownerUid", "updatedAt"],
      ),
    );
  }

  await db.commit(null, writes);
  return roomOwnerUid;
}

async function transferAgencyAssetOnAccountDeletion({
  db,
  deletedUid,
  item,
  objectId,
  nowMs,
}) {
  const scope = clean(item?.data?.scope);
  if (
    !["agency_logo", "agency_background", "agency_room_image"].includes(scope)
  ) {
    return "";
  }

  const targetId = clean(item?.data?.targetId);
  if (!targetId) return "";

  const agency = await db.get(`agencies/${targetId}`);
  const activeField =
    scope === "agency_logo"
      ? "logoObjectId"
      : scope === "agency_background"
        ? "backgroundObjectId"
        : "roomImageObjectId";
  if (
    !agency.exists ||
    clean(agency.data?.[activeField]) !== objectId
  ) {
    return "";
  }

  const syntheticOwner = `agency:${targetId}`;
  const now = new Date(nowMs);
  const writes = [
    db.writeUpdate(
      `storage_objects/${objectId}`,
      { ownerUid: syntheticOwner, updatedAt: now },
      ["ownerUid", "updatedAt"],
    ),
    db.writeCreate(`storage_audit_logs/${auditId()}`, {
      actorUid: "system",
      subjectUid: deletedUid,
      action:
        scope === "agency_logo"
          ? "transferDeletedAccountAgencyLogoOwnership"
          : scope === "agency_background"
            ? "transferDeletedAccountAgencyBackgroundOwnership"
            : "transferDeletedAccountAgencyRoomImageOwnership",
      objectId,
      scope,
      targetId,
      transferredToUid: syntheticOwner,
      reason:
        scope === "agency_logo"
          ? "agency_logo_still_active"
          : scope === "agency_background"
            ? "agency_background_still_active"
            : "agency_room_image_still_active",
      createdAt: now,
    }),
  ];

  const pointerPath = storageActivePointerPath(scope, targetId);
  const pointer = await db.get(pointerPath);
  if (
    pointer.exists &&
    clean(pointer.data?.objectId) === objectId
  ) {
    writes.push(
      db.writeUpdate(
        pointerPath,
        { ownerUid: syntheticOwner, updatedAt: now },
        ["ownerUid", "updatedAt"],
      ),
    );
  }

  await db.commit(null, writes);
  return syntheticOwner;
}

async function accountDeletionReferenceWrites({
  db,
  ownerUid,
  item,
  objectId,
}) {
  const scope = clean(item?.data?.scope);
  const targetId = clean(item?.data?.targetId);
  const writes = [];

  if (
    scope === "profile_image" ||
    scope === "profile_avatar_animation" ||
    scope === "profile_cover"
  ) {
    const userId = targetId || ownerUid;
    const [user, publicProfile] = await Promise.all([
      db.get(`users/${userId}`),
      db.get(`public_profiles/${userId}`),
    ]);

    if (scope === "profile_avatar_animation") {
      if (
        user.exists &&
        clean(user.data?.profileAvatarAnimationObjectId) === objectId
      ) {
        writes.push(
          db.writeUpdate(
            `users/${userId}`,
            {
              profileAvatarAnimationUrl: "",
              profileAvatarAnimationObjectId: "",
            },
            [
              "profileAvatarAnimationUrl",
              "profileAvatarAnimationObjectId",
            ],
          ),
        );
      }
      if (
        publicProfile.exists &&
        clean(publicProfile.data?.profileAvatarAnimationObjectId) === objectId
      ) {
        writes.push(
          db.writeUpdate(
            `public_profiles/${userId}`,
            {
              profileAvatarAnimationUrl: "",
              profileAvatarAnimationObjectId: "",
            },
            [
              "profileAvatarAnimationUrl",
              "profileAvatarAnimationObjectId",
            ],
          ),
        );
      }
    } else if (scope === "profile_image") {
      if (
        user.exists &&
        clean(user.data?.profileImageObjectId) === objectId
      ) {
        writes.push(
          db.writeUpdate(
            `users/${userId}`,
            {
              profileImageUrl: "",
              profileImageObjectId: "",
              photoUrl: "",
              avatarUrl: "",
            },
            [
              "profileImageUrl",
              "profileImageObjectId",
              "photoUrl",
              "avatarUrl",
            ],
          ),
        );
      }
      if (
        publicProfile.exists &&
        clean(publicProfile.data?.profileImageObjectId) === objectId
      ) {
        writes.push(
          db.writeUpdate(
            `public_profiles/${userId}`,
            {
              profileImageUrl: "",
              profileImageObjectId: "",
            },
            ["profileImageUrl", "profileImageObjectId"],
          ),
        );
      }
    } else {
      if (
        user.exists &&
        clean(user.data?.coverImageObjectId) === objectId
      ) {
        writes.push(
          db.writeUpdate(
            `users/${userId}`,
            { coverImageUrl: "", coverImageObjectId: "" },
            ["coverImageUrl", "coverImageObjectId"],
          ),
        );
      }
      if (
        publicProfile.exists &&
        clean(publicProfile.data?.coverImageObjectId) === objectId
      ) {
        writes.push(
          db.writeUpdate(
            `public_profiles/${userId}`,
            { coverImageUrl: "", coverImageObjectId: "" },
            ["coverImageUrl", "coverImageObjectId"],
          ),
        );
      }
    }
  }

  if (scope === "room_cover" && targetId) {
    const room = await db.get(`rooms/${targetId}`);
    if (
      room.exists &&
      clean(room.data?.coverImageObjectId) === objectId
    ) {
      writes.push(
        db.writeUpdate(
          `rooms/${targetId}`,
          { coverImageUrl: "", coverImageObjectId: "" },
          ["coverImageUrl", "coverImageObjectId"],
        ),
      );
    }
  }

  return writes;
}

async function deleteAccountOwnedStorageObject({
  db,
  bucket,
  ownerUid,
  item,
  nowMs,
}) {
  const objectId = clean(item?.data?.objectId || item?.id);
  const storageKey = clean(item?.data?.storageKey);
  if (!objectId || !storageKey) {
    throw new Error("invalid_account_cleanup_object");
  }

  const transferredToUid = await transferSharedRoomCoverOnAccountDeletion({
    db,
    deletedUid: ownerUid,
    item,
    objectId,
    nowMs,
  });
  if (transferredToUid) {
    return { objectId, deleted: false, transferredToUid };
  }

  const agencyTransferredToUid = await transferAgencyAssetOnAccountDeletion({
    db,
    deletedUid: ownerUid,
    item,
    objectId,
    nowMs,
  });
  if (agencyTransferredToUid) {
    return {
      objectId,
      deleted: false,
      transferredToUid: agencyTransferredToUid,
    };
  }

  const referenceWrites = await accountDeletionReferenceWrites({
    db,
    ownerUid,
    item,
    objectId,
  });

  await bucket.delete(storageKey);

  const writes = [
    ...referenceWrites,
    db.writeDelete(`storage_objects/${objectId}`),
    db.writeDelete(`storage_delete_queue/${objectId}`),
    db.writeCreate(`storage_audit_logs/${auditId()}`, {
      actorUid: "system",
      subjectUid: ownerUid,
      action: "cleanupDeletedAccountStorageObject",
      objectId,
      scope: clean(item?.data?.scope),
      targetId: clean(item?.data?.targetId),
      sizeBytes: Number(item?.data?.sizeBytes || 0),
      reason: "account_deleted",
      createdAt: new Date(nowMs),
    }),
  ];

  if (isReplaceableStorageScope(item?.data?.scope)) {
    const pointerPath = storageActivePointerPath(
      item.data.scope,
      item.data.targetId,
    );
    const pointer = await db.get(pointerPath);
    if (
      pointer.exists &&
      clean(pointer.data?.objectId) === objectId
    ) {
      writes.push(db.writeDelete(pointerPath));
    }
  }

  await db.commit(null, writes);
  return { objectId, deleted: true, transferredToUid: "" };
}

export async function runDeletedAccountStorageCleanup(
  db,
  bucket,
  {
    nowMs = Date.now(),
    limit = STORAGE_DELETE_BATCH_LIMIT,
  } = {},
) {
  const budget = Math.max(
    0,
    Math.min(STORAGE_DELETE_BATCH_LIMIT, Number(limit || 0)),
  );
  if (budget <= 0) {
    return { jobsChecked: 0, checked: 0, deleted: 0, failed: 0 };
  }

  const jobs = await db.runQuery("storage_account_cleanup_jobs", {
    orderBy: [{ field: "createdAt", direction: "asc" }],
    limit: 1,
  });
  if (!jobs.length) {
    return { jobsChecked: 0, checked: 0, deleted: 0, failed: 0 };
  }

  const job = jobs[0];
  const ownerUid = clean(job.data?.ownerUid);
  if (!ownerUid) {
    await db.commit(null, [
      db.writeDelete(`storage_account_cleanup_jobs/${job.id}`),
    ]);
    return { jobsChecked: 1, checked: 0, deleted: 0, failed: 1 };
  }

  const objects = await db.runQuery("storage_objects", {
    filters: [{ field: "ownerUid", op: "==", value: ownerUid }],
    limit: budget,
  });

  let deleted = 0;
  let transferred = 0;
  let failed = 0;
  for (const item of objects) {
    try {
      const cleanup = await deleteAccountOwnedStorageObject({
        db,
        bucket,
        ownerUid,
        item,
        nowMs,
      });
      if (cleanup.deleted) deleted += 1;
      if (cleanup.transferredToUid) transferred += 1;
    } catch (error) {
      failed += 1;
      console.error(
        "R2 deleted-account cleanup failed",
        JSON.stringify({
          ownerUid,
          objectId: clean(item?.data?.objectId || item?.id),
          code: clean(error?.code || error?.message || "cleanup_failed").slice(0, 120),
        }),
      );
    }
  }

  if (objects.length < budget && failed === 0) {
    await db.commit(null, [
      db.writeDelete(`storage_account_cleanup_jobs/${job.id}`),
      db.writeCreate(`storage_audit_logs/${auditId()}`, {
        actorUid: "system",
        subjectUid: ownerUid,
        action: "completeDeletedAccountStorageCleanup",
        reason: clean(job.data?.reason || "account_deleted"),
        createdAt: new Date(nowMs),
      }),
    ]);
  }

  return {
    jobsChecked: 1,
    checked: objects.length,
    deleted,
    transferred,
    failed,
  };
}

export async function cleanupQueuedStorageObject(
  db,
  bucket,
  item,
  nowMs = Date.now(),
) {
  const objectId = clean(item?.data?.objectId || item?.id);
  const storageKey = clean(item?.data?.storageKey);
  if (!objectId || !storageKey) {
    throw new StorageApiError("invalid_storage_delete_queue_item", 500);
  }

  const stillReferenced = await storageQueueObjectStillReferenced(
    db,
    item.data,
    objectId,
  );
  if (stillReferenced) {
    const nextDeleteAt = replacementDeleteAt(nowMs);
    await db.commit(null, [
      db.writeUpdate(
        `storage_delete_queue/${item.id}`,
        {
          deleteAfter: nextDeleteAt,
          lastDeferredAt: new Date(nowMs),
          deferReason: "still_referenced",
        },
        ["deleteAfter", "lastDeferredAt", "deferReason"],
      ),
    ]);
    return { status: "deferred", objectId, nextDeleteAt };
  }

  await bucket.delete(storageKey);
  const now = new Date(nowMs);
  const scope = clean(item.data?.scope);
  const cleanupWrites = [
    db.writeDelete(`storage_objects/${objectId}`),
    db.writeDelete(`storage_delete_queue/${item.id}`),
    db.writeCreate(`storage_audit_logs/${auditId()}`, {
      actorUid: "system",
      action: scope === "diary_image"
        ? "cleanupDiaryImage"
        : "cleanupReplacedStorageObject",
      objectId,
      scope,
      targetId: clean(item.data?.targetId),
      sizeBytes: Number(item.data?.sizeBytes || 0),
      reason: clean(item.data?.reason || "replaced"),
      createdAt: now,
    }),
  ];
  if (scope === "diary_image") {
    cleanupWrites.push(
      db.writeDelete(`diary_image_links/${objectId}`),
    );
  }
  await db.commit(null, cleanupWrites);
  return { status: "deleted", objectId };
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
  const maxBatch = Math.max(
    1,
    Math.min(
      STORAGE_DELETE_BATCH_LIMIT,
      Number(limit || STORAGE_DELETE_BATCH_LIMIT),
    ),
  );
  let remainingBudget = maxBatch;

  const accountCleanup = await runDeletedAccountStorageCleanup(
    db,
    bucket,
    { nowMs, limit: remainingBudget },
  );
  remainingBudget = Math.max(0, remainingBudget - accountCleanup.checked);

  const due = remainingBudget > 0
    ? await db.runQuery("storage_delete_queue", {
        filters: [
          { field: "deleteAfter", op: "<=", value: new Date(nowMs) },
        ],
        orderBy: [{ field: "deleteAfter", direction: "asc" }],
        limit: remainingBudget,
      })
    : [];

  let deleted = 0;
  let failed = 0;
  let deferred = 0;
  for (const item of due) {
    try {
      const result = await cleanupQueuedStorageObject(
        db,
        bucket,
        item,
        nowMs,
      );
      if (result.status === "deferred") deferred += 1;
      if (result.status === "deleted") deleted += 1;
    } catch (error) {
      failed += 1;
      console.error(
        "R2 delayed storage cleanup failed",
        JSON.stringify({
          objectId: clean(item?.data?.objectId || item?.id),
          code: clean(error?.code || error?.message || "cleanup_failed").slice(0, 120),
        }),
      );
    }
  }
  remainingBudget = Math.max(0, remainingBudget - due.length);
  const expiredTickets = remainingBudget > 0
    ? await db.runQuery("storage_upload_tickets", {
        filters: [
          { field: "expiresAt", op: "<=", value: new Date(nowMs) },
        ],
        orderBy: [{ field: "expiresAt", direction: "asc" }],
        limit: remainingBudget,
      })
    : [];

  let expiredTicketsCleaned = 0;
  let expiredTicketFailures = 0;
  for (const ticket of expiredTickets) {
    const objectId = clean(ticket.data?.objectId || ticket.id);
    const storageKey = clean(ticket.data?.storageKey);
    if (!objectId || !storageKey) {
      expiredTicketFailures += 1;
      continue;
    }

    try {
      await bucket.delete(storageKey);
      await db.commit(null, [
        db.writeDelete(`storage_upload_tickets/${ticket.id}`),
        db.writeCreate(`storage_audit_logs/${auditId()}`, {
          actorUid: "system",
          action: "cleanupExpiredStorageUpload",
          objectId,
          scope: clean(ticket.data?.scope),
          targetId: clean(ticket.data?.targetId),
          sizeBytes: Number(ticket.data?.expectedSizeBytes || 0),
          reason: "upload_ticket_expired",
          createdAt: new Date(),
        }),
      ]);
      expiredTicketsCleaned += 1;
    } catch (error) {
      expiredTicketFailures += 1;
      console.error(
        "R2 expired upload cleanup failed",
        JSON.stringify({
          objectId,
          code: clean(error?.code || error?.message || "cleanup_failed").slice(0, 120),
        }),
      );
    }
  }

  return {
    checked:
      accountCleanup.checked +
      due.length +
      expiredTickets.length,
    accountCleanupJobsChecked: accountCleanup.jobsChecked,
    accountCleanupChecked: accountCleanup.checked,
    accountCleanupDeleted: accountCleanup.deleted,
    accountCleanupTransferred: accountCleanup.transferred,
    accountCleanupFailed: accountCleanup.failed,
    replacementChecked: due.length,
    replacementDeleted: deleted,
    replacementDeferred: deferred,
    replacementFailed: failed,
    expiredTicketsChecked: expiredTickets.length,
    expiredTicketsCleaned,
    expiredTicketFailures,
    deleted:
      accountCleanup.deleted +
      deleted +
      expiredTicketsCleaned,
    failed:
      accountCleanup.failed +
      failed +
      expiredTicketFailures,
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
  await authorizeDelete(auth.db, auth.uid, metadata);

  const now = new Date();
  const writes = [];
  if (clean(metadata.scope) === "profile_avatar_animation") {
    const [user, publicProfile] = await Promise.all([
      auth.db.get(`users/${auth.uid}`),
      auth.db.get(`public_profiles/${auth.uid}`),
    ]);
    if (
      user.exists &&
      clean(user.data?.profileAvatarAnimationObjectId) === metadata.objectId
    ) {
      writes.push(
        auth.db.writeUpdate(
          `users/${auth.uid}`,
          {
            profileAvatarAnimationUrl: "",
            profileAvatarAnimationObjectId: "",
            updatedAt: now,
          },
          [
            "profileAvatarAnimationUrl",
            "profileAvatarAnimationObjectId",
            "updatedAt",
          ],
        ),
      );
    }
    if (
      publicProfile.exists &&
      clean(publicProfile.data?.profileAvatarAnimationObjectId) ===
        metadata.objectId
    ) {
      writes.push(
        auth.db.writeUpdate(
          `public_profiles/${auth.uid}`,
          {
            profileAvatarAnimationUrl: "",
            profileAvatarAnimationObjectId: "",
            updatedAt: now,
          },
          [
            "profileAvatarAnimationUrl",
            "profileAvatarAnimationObjectId",
            "updatedAt",
          ],
        ),
      );
    }
  }
  writes.push(
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
  );

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
