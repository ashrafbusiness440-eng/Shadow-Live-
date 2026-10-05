import { json, readJson, firestoreQuotaResponse } from "./http.js";
import { verifyFirebaseIdToken } from "./firebase-auth.js";
import { firestoreClient } from "./firestore.js";
import { annotatePressureRequest } from "./pressure-telemetry.js";

const clean = (value) => String(value ?? "").trim();
const MAX_TEXT_LENGTH = 500;
const MAX_COMMENT_LENGTH = 200;
const MAX_IMAGES = 2;
const MAX_MENTIONS = 8;
const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 30;
const VIEW_DEDUPE_WINDOW_MS = 24 * 60 * 60 * 1000;
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

function pathSafe(value) {
  const bytes = new TextEncoder().encode(clean(value));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function diaryLikePath(diaryId, uid) {
  return `diary_likes/${diaryId}__${pathSafe(uid)}`;
}

function diaryViewKeyPath(diaryId, uid) {
  return `diary_view_keys/${diaryId}__${pathSafe(uid)}`;
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

export function diaryCommentText(value) {
  const text = clean(value);
  if (!text) throw new DiaryApiError("empty_comment", 400);
  if (text.length > MAX_COMMENT_LENGTH) {
    throw new DiaryApiError("comment_text_too_long", 400);
  }
  if (URL_PATTERN.test(text)) {
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

function parseCursor(value) {
  const raw = clean(value);
  if (!raw) return null;
  const separator = raw.indexOf("|");
  if (separator <= 0 || separator >= raw.length - 1) {
    throw new DiaryApiError("invalid_cursor", 400);
  }
  const createdAtMs = Number(raw.slice(0, separator));
  const diaryId = raw.slice(separator + 1);
  if (!Number.isSafeInteger(createdAtMs) || createdAtMs <= 0) {
    throw new DiaryApiError("invalid_cursor", 400);
  }
  assertSafeId(diaryId, "invalid_cursor");
  return { createdAtMs, diaryId };
}

function makeCursor(row) {
  const createdAtMs = Number(row?.data?.createdAtMs || 0);
  const diaryId = clean(row?.id);
  if (!Number.isSafeInteger(createdAtMs) || createdAtMs <= 0 || !diaryId) {
    return null;
  }
  return `${createdAtMs}|${diaryId}`;
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

function normalizeSearchText(value) {
  let text = String(value ?? "").toLowerCase();
  const arabic = "٠١٢٣٤٥٦٧٨٩";
  const persian = "۰۱۲۳۴۵۶۷۸۹";
  for (let i = 0; i < 10; i += 1) {
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

function mentionPublicIds(text) {
  const ids = [];
  const seen = new Set();
  const source = clean(text);
  for (const match of source.matchAll(/@([0-9]{3,12})/g)) {
    const publicId = clean(match[1]);
    if (!publicId || seen.has(publicId)) continue;
    seen.add(publicId);
    ids.push(publicId);
    if (ids.length >= MAX_MENTIONS) break;
  }
  return ids;
}

async function resolveMentionTargets(db, text, transaction = null) {
  const publicIds = mentionPublicIds(text);
  if (publicIds.length === 0) return [];
  const idSnaps = await Promise.all(
    publicIds.map((publicId) => db.get(`public_ids/${publicId}`, transaction)),
  );
  const targets = [];
  const seenUids = new Set();
  for (let index = 0; index < publicIds.length; index += 1) {
    const uid = clean(idSnaps[index]?.data?.uid);
    if (!uid || seenUids.has(uid)) continue;
    seenUids.add(uid);
    targets.push({ uid, publicId: publicIds[index] });
  }
  return targets;
}

function diaryNotificationPath(kind, diaryId, recipientUid, suffix = "") {
  const safeDiary = clean(diaryId).replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 120);
  const safeRecipient = pathSafe(recipientUid).slice(0, 48);
  const safeSuffix = clean(suffix).replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 80);
  return `notifications/${kind}_${safeDiary}_${safeRecipient}${safeSuffix ? "_" + safeSuffix : ""}`;
}

function diarySocialNotification({
  type,
  recipientUid,
  diaryId,
  commentId = null,
  actorUid,
  actorName,
  actorPublicId,
  title,
  body,
  aggregateCount = null,
  now,
}) {
  return {
    userId: recipientUid,
    type,
    category: "social",
    title,
    body,
    read: false,
    diaryId,
    commentId,
    actorUid,
    actorName,
    actorPublicId,
    ...(aggregateCount == null ? {} : { aggregateCount }),
    createdAt: now,
    updatedAt: now,
  };
}

async function searchMentions(db, uid, body) {
  const raw = clean(body.query);
  const query = normalizeSearchText(raw);
  if (!query || query.length > 40) return { ok: true, items: [] };

  const results = new Map();
  const addProfile = (profileUid, data = {}) => {
    const targetUid = clean(profileUid);
    if (!targetUid || targetUid === uid || results.has(targetUid)) return;
    const publicId = clean(data.publicId);
    if (!publicId) return;
    results.set(targetUid, {
      uid: targetUid,
      displayName: clean(data.displayName || data.name || "مستخدم Shadow Live").slice(0, 80),
      publicId: publicId.slice(0, 16),
      profileImageUrl: clean(data.profileImageUrl).slice(0, 1000),
      profileAvatarAsset: clean(data.profileAvatarAsset).slice(0, 500),
    });
  };

  if (/^[0-9]{3,12}$/.test(query)) {
    const exactId = await db.get(`public_ids/${query}`);
    const exactUid = clean(exactId.data?.uid);
    if (exactId.exists && exactUid && exactUid !== uid) {
      const profile = await db.get(`public_profiles/${exactUid}`);
      if (profile.exists) addProfile(exactUid, profile.data || {});
    }
  }

  if (results.size < MAX_MENTIONS) {
    const rows = await db.runQuery("public_profiles", {
      filters: [{ field: "searchTokens", op: "array-contains", value: query }],
      limit: MAX_MENTIONS + 1,
    });
    for (const row of rows) {
      addProfile(row.id, row.data || {});
      if (results.size >= MAX_MENTIONS) break;
    }
  }

  return { ok: true, items: [...results.values()].slice(0, MAX_MENTIONS) };
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
    const mentionTargets = await resolveMentionTargets(db, text, transaction);
    const mentionedUids = mentionTargets
      .map((target) => target.uid)
      .filter((targetUid) => targetUid !== uid);
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
      mentionedUids,
      createdAt: now,
      createdAtMs: nowMs,
    };
    const result = { diaryId, createdAtMs: nowMs };

    const writes = [
      db.writeCreate(`diaries/${diaryId}`, diary),
      db.writeCreate(`users/${uid}/diaries/${diaryId}`, diary),
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
    for (const target of mentionTargets) {
      if (target.uid === uid) continue;
      writes.push(
        db.writeCreate(
          diaryNotificationPath("diary_mention", diaryId, target.uid),
          diarySocialNotification({
            type: "diary_mention",
            recipientUid: target.uid,
            diaryId,
            actorUid: uid,
            actorName: author.ownerName,
            actorPublicId: author.ownerPublicId,
            title: "تمت الإشارة إليك في يومية",
            body: `${author.ownerName || "مستخدم Shadow Live"} أشار إليك في يومية.`,
            now,
          }),
        ),
      );
    }
    for (const image of images) {
      writes.push(
        db.writeCreate(`diary_image_links/${image.objectId}`, {
          objectId: image.objectId,
          diaryId,
          ownerUid: uid,
          state: "linked",
          createdAt: now,
        }),
        db.writeDelete(`storage_delete_queue/${image.objectId}`),
        db.writeUpdate(
          `storage_objects/${image.objectId}`,
          {
            state: "active",
            linkedDiaryId: diaryId,
            linkedAt: now,
            updatedAt: now,
          },
          ["state", "linkedDiaryId", "linkedAt", "updatedAt"],
        ),
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
    const images = Array.isArray(diary.data?.images)
      ? diary.data.images.slice(0, MAX_IMAGES)
      : [];
    const objectIds = images
      .map((image) => clean(image?.objectId))
      .filter((objectId) => OBJECT_ID_PATTERN.test(objectId));
    const objectSnaps = await Promise.all(
      objectIds.map((objectId) =>
        db.get(`storage_objects/${objectId}`, transaction)
      ),
    );
    const writes = [
      db.writeDelete(`diaries/${diaryId}`),
      db.writeDelete(`users/${uid}/diaries/${diaryId}`),
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
    let queuedImages = 0;
    for (let index = 0; index < objectIds.length; index += 1) {
      const objectId = objectIds[index];
      const object = objectSnaps[index];
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

      if (
        !object?.exists ||
        clean(object.data?.scope) !== "diary_image" ||
        clean(object.data?.ownerUid) !== uid
      ) {
        continue;
      }

      writes.push(
        db.writeUpdate(
          `storage_objects/${objectId}`,
          {
            state: "pending_delete",
            pendingDeleteAt: now,
            updatedAt: now,
          },
          ["state", "pendingDeleteAt", "updatedAt"],
        ),
        db.writeCreate(`storage_delete_queue/${objectId}`, {
          objectId,
          storageKey: clean(object.data?.storageKey),
          ownerUid: uid,
          scope: "diary_image",
          targetId: clean(object.data?.targetId || uid),
          sizeBytes: Number(object.data?.sizeBytes || 0),
          deleteAfter: now,
          reason: "diary_deleted",
          createdAt: now,
        }),
      );
      queuedImages += 1;
    }
    await db.commit(transaction, writes);
    return { ok: true, diaryId, queuedImages };
  });
}

async function toggleLike(db, uid, body) {
  const diaryId = assertSafeId(body.diaryId, "invalid_diary_id");
  const operationKey = assertOperationKey(body.idempotencyKey);

  return runTransaction(db, async (transaction) => {
    const operationPath = `diary_operations/${operationKey}`;
    const likePath = diaryLikePath(diaryId, uid);
    const [operation, diary, like] = await Promise.all([
      db.get(operationPath, transaction),
      db.get(`diaries/${diaryId}`, transaction),
      db.get(likePath, transaction),
    ]);

    if (operation.exists) {
      if (
        clean(operation.data?.action) !== "toggleLike" ||
        clean(operation.data?.actorUid) !== uid ||
        clean(operation.data?.diaryId) !== diaryId
      ) {
        throw new DiaryApiError("idempotency_conflict", 409);
      }
      await db.rollback(transaction);
      return { ok: true, code: "duplicate", ...(operation.data?.result || {}) };
    }

    if (!diary.exists) throw new DiaryApiError("diary_not_found", 404);
    const ownerUid = clean(diary.data?.ownerUid);
    if (!ownerUid) throw new DiaryApiError("invalid_diary_owner", 409);

    const liked = !like.exists;
    const currentCount = Math.max(0, Number(diary.data?.likeCount || 0));
    const likeCount = liked
      ? currentCount + 1
      : Math.max(0, currentCount - 1);
    const now = new Date();
    const result = { diaryId, liked, likeCount };

    const writes = [
      liked
        ? db.writeCreate(likePath, {
            diaryId,
            userUid: uid,
            createdAt: now,
          })
        : db.writeDelete(likePath),
      db.writeUpdate(
        `diaries/${diaryId}`,
        { likeCount },
        ["likeCount"],
      ),
      db.writeUpdate(
        `users/${ownerUid}/diaries/${diaryId}`,
        { likeCount },
        ["likeCount"],
      ),
      db.writeCreate(operationPath, {
        action: "toggleLike",
        actorUid: uid,
        diaryId,
        status: "completed",
        result,
        createdAt: now,
      }),
    ];

    if (liked && ownerUid !== uid) {
      const notificationPath = diaryNotificationPath("diary_like", diaryId, ownerUid);
      const [actor, existingNotification] = await Promise.all([
        db.get(`users/${uid}`, transaction),
        db.get(notificationPath, transaction),
      ]);
      const actorSnapshot = publicAuthorSnapshot(actor.data || {}, uid);
      const notificationData = diarySocialNotification({
        type: "diary_like_aggregate",
        recipientUid: ownerUid,
        diaryId,
        actorUid: uid,
        actorName: actorSnapshot.ownerName,
        actorPublicId: actorSnapshot.ownerPublicId,
        title: "إعجابات جديدة على يوميتك",
        body: likeCount > 1
          ? `${actorSnapshot.ownerName || "مستخدم Shadow Live"} وآخرون أعجبوا بيوميتك.`
          : `${actorSnapshot.ownerName || "مستخدم Shadow Live"} أعجب بيوميتك.`,
        aggregateCount: likeCount,
        now,
      });
      const notificationUpdate = { ...notificationData };
      delete notificationUpdate.createdAt;
      writes.push(
        existingNotification.exists
          ? db.writeUpdate(
              notificationPath,
              notificationUpdate,
              [
                "type",
                "category",
                "title",
                "body",
                "read",
                "diaryId",
                "actorUid",
                "actorName",
                "actorPublicId",
                "aggregateCount",
                "updatedAt",
              ],
            )
          : db.writeCreate(notificationPath, notificationData),
      );
    }

    await db.commit(transaction, writes);
    return { ok: true, ...result };
  });
}

function normalizeComment(id, data = {}) {
  return {
    commentId: id,
    diaryId: clean(data.diaryId),
    authorUid: clean(data.authorUid),
    authorName: clean(data.authorName),
    authorPublicId: clean(data.authorPublicId),
    authorProfileImageUrl: clean(data.authorProfileImageUrl),
    authorProfileAvatarAsset: clean(data.authorProfileAvatarAsset),
    text: clean(data.text),
    createdAt: data.createdAt || null,
    createdAtMs: Math.max(0, Number(data.createdAtMs || 0)),
  };
}

async function createComment(db, uid, body) {
  const diaryId = assertSafeId(body.diaryId, "invalid_diary_id");
  const text = diaryCommentText(body.text);
  const operationKey = assertOperationKey(body.idempotencyKey);

  return runTransaction(db, async (transaction) => {
    const operationPath = `diary_operations/${operationKey}`;
    const [operation, diary, user] = await Promise.all([
      db.get(operationPath, transaction),
      db.get(`diaries/${diaryId}`, transaction),
      db.get(`users/${uid}`, transaction),
    ]);

    if (operation.exists) {
      if (
        clean(operation.data?.action) !== "createComment" ||
        clean(operation.data?.actorUid) !== uid ||
        clean(operation.data?.diaryId) !== diaryId ||
        clean(operation.data?.text) !== text
      ) {
        throw new DiaryApiError("idempotency_conflict", 409);
      }
      await db.rollback(transaction);
      return { ok: true, code: "duplicate", ...(operation.data?.result || {}) };
    }

    if (!diary.exists) throw new DiaryApiError("diary_not_found", 404);
    if (diary.data?.commentsEnabled === false) {
      throw new DiaryApiError("comments_disabled", 409);
    }
    if (!user.exists) throw new DiaryApiError("user_not_found", 404);

    const ownerUid = clean(diary.data?.ownerUid);
    if (!ownerUid) throw new DiaryApiError("invalid_diary_owner", 409);

    const commentId = randomId("diarycomment");
    const now = new Date();
    const nowMs = Date.now();
    const author = publicAuthorSnapshot(user.data || {}, uid);
    const mentionTargets = await resolveMentionTargets(db, text, transaction);
    const mentionedUids = mentionTargets
      .map((target) => target.uid)
      .filter((targetUid) => targetUid !== uid);
    const comment = {
      commentId,
      diaryId,
      authorUid: uid,
      authorName: author.ownerName,
      authorPublicId: author.ownerPublicId,
      authorProfileImageUrl: author.ownerProfileImageUrl,
      authorProfileAvatarAsset: author.ownerProfileAvatarAsset,
      text,
      mentionedUids,
      createdAt: now,
      createdAtMs: nowMs,
    };
    const currentCount = Math.max(0, Number(diary.data?.commentCount || 0));
    const commentCount = currentCount + 1;
    const result = {
      diaryId,
      commentId,
      commentCount,
      comment: normalizeComment(commentId, comment),
    };

    const writes = [
      db.writeCreate(`diaries/${diaryId}/comments/${commentId}`, comment),
      db.writeUpdate(
        `diaries/${diaryId}`,
        { commentCount },
        ["commentCount"],
      ),
      db.writeUpdate(
        `users/${ownerUid}/diaries/${diaryId}`,
        { commentCount },
        ["commentCount"],
      ),
      db.writeCreate(operationPath, {
        action: "createComment",
        actorUid: uid,
        diaryId,
        text,
        status: "completed",
        result,
        createdAt: now,
      }),
    ];

    if (ownerUid !== uid) {
      writes.push(
        db.writeCreate(
          diaryNotificationPath("diary_comment", diaryId, ownerUid, commentId),
          diarySocialNotification({
            type: "diary_comment",
            recipientUid: ownerUid,
            diaryId,
            commentId,
            actorUid: uid,
            actorName: author.ownerName,
            actorPublicId: author.ownerPublicId,
            title: "تعليق جديد على يوميتك",
            body: `${author.ownerName || "مستخدم Shadow Live"} علّق على يوميتك.`,
            now,
          }),
        ),
      );
    }

    for (const target of mentionTargets) {
      if (target.uid === uid || target.uid === ownerUid) continue;
      writes.push(
        db.writeCreate(
          diaryNotificationPath("diary_mention", diaryId, target.uid, commentId),
          diarySocialNotification({
            type: "diary_mention",
            recipientUid: target.uid,
            diaryId,
            commentId,
            actorUid: uid,
            actorName: author.ownerName,
            actorPublicId: author.ownerPublicId,
            title: "تمت الإشارة إليك في تعليق",
            body: `${author.ownerName || "مستخدم Shadow Live"} أشار إليك في تعليق.`,
            now,
          }),
        ),
      );
    }

    await db.commit(transaction, writes);
    return { ok: true, ...result };
  });
}

async function listComments(db, body) {
  const diaryId = assertSafeId(body.diaryId, "invalid_diary_id");
  const limit = pageLimit(body.limit);
  const cursor = parseCursor(body.cursor);
  const diary = await db.get(`diaries/${diaryId}`);
  if (!diary.exists) throw new DiaryApiError("diary_not_found", 404);

  const collectionPath = `diaries/${diaryId}/comments`;
  const rows = await db.runQuery(collectionPath, {
    orderBy: [
      { field: "createdAtMs", direction: "desc" },
      { field: "__name__", direction: "desc" },
    ],
    limit: limit + 1,
    startAfter: cursor
      ? [
          { value: cursor.createdAtMs },
          { referencePath: `${collectionPath}/${cursor.diaryId}` },
        ]
      : [],
  });
  const hasMore = rows.length > limit;
  const visible = rows.slice(0, limit);
  return {
    ok: true,
    items: visible.map((row) => normalizeComment(row.id, row.data)),
    nextCursor:
      hasMore && visible.length
        ? makeCursor(visible[visible.length - 1])
        : null,
    hasMore,
  };
}

async function deleteComment(db, uid, body) {
  const diaryId = assertSafeId(body.diaryId, "invalid_diary_id");
  const commentId = assertSafeId(body.commentId, "invalid_comment_id");
  const operationKey = assertOperationKey(body.idempotencyKey);

  return runTransaction(db, async (transaction) => {
    const operationPath = `diary_operations/${operationKey}`;
    const commentPath = `diaries/${diaryId}/comments/${commentId}`;
    const [operation, diary, comment] = await Promise.all([
      db.get(operationPath, transaction),
      db.get(`diaries/${diaryId}`, transaction),
      db.get(commentPath, transaction),
    ]);

    if (operation.exists) {
      if (
        clean(operation.data?.action) !== "deleteComment" ||
        clean(operation.data?.actorUid) !== uid ||
        clean(operation.data?.diaryId) !== diaryId ||
        clean(operation.data?.commentId) !== commentId
      ) {
        throw new DiaryApiError("idempotency_conflict", 409);
      }
      await db.rollback(transaction);
      return { ok: true, code: "duplicate", ...(operation.data?.result || {}) };
    }

    if (!diary.exists) throw new DiaryApiError("diary_not_found", 404);
    if (!comment.exists) throw new DiaryApiError("comment_not_found", 404);

    const ownerUid = clean(diary.data?.ownerUid);
    const authorUid = clean(comment.data?.authorUid);
    if (uid !== ownerUid && uid !== authorUid) {
      throw new DiaryApiError("forbidden", 403);
    }

    const currentCount = Math.max(0, Number(diary.data?.commentCount || 0));
    const commentCount = Math.max(0, currentCount - 1);
    const now = new Date();
    const result = { diaryId, commentId, commentCount };

    await db.commit(transaction, [
      db.writeDelete(commentPath),
      db.writeUpdate(
        `diaries/${diaryId}`,
        { commentCount },
        ["commentCount"],
      ),
      db.writeUpdate(
        `users/${ownerUid}/diaries/${diaryId}`,
        { commentCount },
        ["commentCount"],
      ),
      db.writeCreate(operationPath, {
        action: "deleteComment",
        actorUid: uid,
        diaryId,
        commentId,
        status: "completed",
        result,
        createdAt: now,
      }),
    ]);

    return { ok: true, ...result };
  });
}

async function recordView(db, uid, body) {
  const diaryId = assertSafeId(body.diaryId, "invalid_diary_id");

  return runTransaction(db, async (transaction) => {
    const viewPath = diaryViewKeyPath(diaryId, uid);
    const [diary, viewKey] = await Promise.all([
      db.get(`diaries/${diaryId}`, transaction),
      db.get(viewPath, transaction),
    ]);
    if (!diary.exists) throw new DiaryApiError("diary_not_found", 404);

    const ownerUid = clean(diary.data?.ownerUid);
    if (!ownerUid) throw new DiaryApiError("invalid_diary_owner", 409);

    const nowMs = Date.now();
    const nextEligibleAtMs = Math.max(
      0,
      Number(viewKey.data?.nextEligibleAtMs || 0),
    );
    const currentCount = Math.max(0, Number(diary.data?.viewCount || 0));

    if (viewKey.exists && nextEligibleAtMs > nowMs) {
      await db.rollback(transaction);
      return {
        ok: true,
        diaryId,
        counted: false,
        viewCount: currentCount,
        nextEligibleAtMs,
      };
    }

    const viewCount = currentCount + 1;
    const nextAt = nowMs + VIEW_DEDUPE_WINDOW_MS;
    const now = new Date();
    const viewData = {
      diaryId,
      userUid: uid,
      lastCountedAt: now,
      lastCountedAtMs: nowMs,
      nextEligibleAtMs: nextAt,
    };

    await db.commit(transaction, [
      viewKey.exists
        ? db.writeUpdate(
            viewPath,
            viewData,
            [
              "diaryId",
              "userUid",
              "lastCountedAt",
              "lastCountedAtMs",
              "nextEligibleAtMs",
            ],
          )
        : db.writeCreate(viewPath, viewData),
      db.writeUpdate(
        `diaries/${diaryId}`,
        { viewCount },
        ["viewCount"],
      ),
      db.writeUpdate(
        `users/${ownerUid}/diaries/${diaryId}`,
        { viewCount },
        ["viewCount"],
      ),
    ]);

    return {
      ok: true,
      diaryId,
      counted: true,
      viewCount,
      nextEligibleAtMs: nextAt,
    };
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
      db.writeUpdate(
        `users/${uid}/diaries/${diaryId}`,
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

async function getDiary(db, body) {
  const diaryId = assertSafeId(body.diaryId, "invalid_diary_id");
  const diary = await db.get(`diaries/${diaryId}`);
  if (!diary.exists) throw new DiaryApiError("diary_not_found", 404);
  return { ok: true, diary: normalizeDiary(diaryId, diary.data || {}) };
}

async function listLatest(db, body) {
  const limit = pageLimit(body.limit);
  const cursor = parseCursor(body.cursor);
  const rows = await db.runQuery("diaries", {
    orderBy: [
      { field: "createdAtMs", direction: "desc" },
      { field: "__name__", direction: "desc" },
    ],
    limit: limit + 1,
    startAfter: cursor
      ? [
          { value: cursor.createdAtMs },
          { referencePath: `diaries/${cursor.diaryId}` },
        ]
      : [],
  });
  const hasMore = rows.length > limit;
  const visible = rows.slice(0, limit);
  return {
    ok: true,
    items: visible.map((row) => normalizeDiary(row.id, row.data)),
    nextCursor:
      hasMore && visible.length
        ? makeCursor(visible[visible.length - 1])
        : null,
    hasMore,
  };
}

async function listUser(db, body) {
  const userId = assertSafeId(body.userId, "invalid_user");
  const limit = pageLimit(body.limit);
  const cursor = parseCursor(body.cursor);
  const collectionPath = `users/${userId}/diaries`;
  const rows = await db.runQuery(collectionPath, {
    orderBy: [
      { field: "createdAtMs", direction: "desc" },
      { field: "__name__", direction: "desc" },
    ],
    limit: limit + 1,
    startAfter: cursor
      ? [
          { value: cursor.createdAtMs },
          { referencePath: `${collectionPath}/${cursor.diaryId}` },
        ]
      : [],
  });
  const hasMore = rows.length > limit;
  const visible = rows.slice(0, limit);
  return {
    ok: true,
    items: visible.map((row) => normalizeDiary(row.id, row.data)),
    nextCursor:
      hasMore && visible.length
        ? makeCursor(visible[visible.length - 1])
        : null,
    hasMore,
  };
}

async function listFollowing(db, uid, body) {
  const limit = pageLimit(body.limit);
  const cursor = parseCursor(body.cursor);
  const rows = await db.runQuery("diaries", {
    orderBy: [
      { field: "createdAtMs", direction: "desc" },
      { field: "__name__", direction: "desc" },
    ],
    limit: limit + 1,
    startAfter: cursor
      ? [
          { value: cursor.createdAtMs },
          { referencePath: `diaries/${cursor.diaryId}` },
        ]
      : [],
  });

  const hasMore = rows.length > limit;
  const scanned = rows.slice(0, limit);
  const ownerIds = [...new Set(
    scanned
      .map((row) => clean(row?.data?.ownerUid))
      .filter((ownerUid) => ownerUid && ownerUid !== uid),
  )];

  let followedOwnerIds = new Set();
  if (ownerIds.length) {
    const follows = await db.runQuery("follows", {
      filters: [
        { field: "followerUid", op: "==", value: uid },
        { field: "followingUid", op: "in", value: ownerIds },
      ],
      limit: ownerIds.length,
    });
    followedOwnerIds = new Set(
      follows
        .map((row) => clean(row?.data?.followingUid))
        .filter(Boolean),
    );
  }

  const visible = scanned.filter((row) =>
    followedOwnerIds.has(clean(row?.data?.ownerUid))
  );

  return {
    ok: true,
    items: visible.map((row) => normalizeDiary(row.id, row.data)),
    nextCursor:
      hasMore && scanned.length
        ? makeCursor(scanned[scanned.length - 1])
        : null,
    hasMore,
  };
}

function normalizeGiftEvent(id, data = {}) {
  return {
    giftEventId: id,
    giftOperationId: clean(data.giftOperationId || id),
    diaryId: clean(data.diaryId),
    senderId: clean(data.senderId),
    senderName: clean(data.senderName),
    senderPublicId: clean(data.senderPublicId),
    senderProfileImageUrl: clean(data.senderProfileImageUrl),
    receiverId: clean(data.receiverId),
    giftId: clean(data.giftId),
    giftName: clean(data.giftName),
    quantity: Math.max(1, Number(data.quantity || 1)),
    unitCoins: Math.max(0, Number(data.unitCoins || 0)),
    totalCost: Math.max(0, Number(data.totalCost || 0)),
    imageUrl: clean(data.imageUrl),
    assetKey: clean(data.assetKey),
    createdAt: data.createdAt || null,
    createdAtMs: Math.max(0, Number(data.createdAtMs || 0)),
  };
}

async function listGiftEvents(db, body) {
  const diaryId = assertSafeId(body.diaryId, "invalid_diary_id");
  const limit = pageLimit(body.limit);
  const cursor = parseCursor(body.cursor);
  const diary = await db.get(`diaries/${diaryId}`);
  if (!diary.exists) throw new DiaryApiError("diary_not_found", 404);

  const collectionPath = `diaries/${diaryId}/gifts`;
  const rows = await db.runQuery(collectionPath, {
    orderBy: [
      { field: "createdAtMs", direction: "desc" },
      { field: "__name__", direction: "desc" },
    ],
    limit: limit + 1,
    startAfter: cursor
      ? [
          { value: cursor.createdAtMs },
          { referencePath: `${collectionPath}/${cursor.diaryId}` },
        ]
      : [],
  });
  const hasMore = rows.length > limit;
  const visible = rows.slice(0, limit);
  return {
    ok: true,
    items: visible.map((row) => normalizeGiftEvent(row.id, row.data)),
    nextCursor:
      hasMore && visible.length
        ? makeCursor(visible[visible.length - 1])
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

    if (action === "getDiary") {
      return json(request, env, await getDiary(auth.db, body));
    }
    if (action === "listLatest") {
      return json(request, env, await listLatest(auth.db, body));
    }
    if (action === "listUser") {
      return json(request, env, await listUser(auth.db, body));
    }
    if (action === "listComments") {
      return json(request, env, await listComments(auth.db, body));
    }
    if (action === "recordView") {
      return json(request, env, await recordView(auth.db, auth.uid, body));
    }
    if (action === "listGiftEvents") {
      return json(request, env, await listGiftEvents(auth.db, body));
    }

    if (action === "listFollowing") {
      if (auth.guest) throw new DiaryApiError("guest_restricted", 403);
      return json(request, env, await listFollowing(auth.db, auth.uid, body));
    }

    if (auth.guest) {
      throw new DiaryApiError("guest_restricted", 403);
    }

    if (action === "searchMentions") {
      return json(request, env, await searchMentions(auth.db, auth.uid, body));
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
    if (action === "toggleLike") {
      return json(request, env, await toggleLike(auth.db, auth.uid, body));
    }
    if (action === "createComment") {
      return json(request, env, await createComment(auth.db, auth.uid, body));
    }
    if (action === "deleteComment") {
      return json(request, env, await deleteComment(auth.db, auth.uid, body));
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
  diaryCommentText,
  diaryImageIds,
  createDiary,
  deleteDiary,
  setCommentsEnabled,
  toggleLike,
  createComment,
  listComments,
  deleteComment,
  recordView,
  listGiftEvents,
  getDiary,
  listLatest,
  listUser,
  listFollowing,
  normalizeDiary,
  normalizeComment,
  normalizeGiftEvent,
  searchMentions,
  mentionPublicIds,
  resolveMentionTargets,
  parseCursor,
  makeCursor,
});
