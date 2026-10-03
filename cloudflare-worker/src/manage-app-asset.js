import { firestoreQuotaResponse, json, readJson } from "./http.js";
import {
  assertUserDocumentSessionState,
  verifyFirebaseIdToken,
} from "./firebase-auth.js";
import { firestoreClient } from "./firestore.js";
import { invalidateConfigCache } from "./config-cache.js";
import {
  ASSET_STUDIO_CHANNELS,
  ASSET_STUDIO_VERSION,
  publicAssetStudioTemplates,
  validateAssetStudioMetadata,
} from "./asset-studio-templates.js";

const OWNER = "ashrafbusiness440-eng";
const REPO = "Shadow-Live-";
const DEFAULT_BRANCH = "main";
const MAX_BYTES = 2500000;
const ALLOWED_DIRS = new Set([
  "assets/images","assets/images/avatars","assets/images/coins","assets/images/badges","assets/images/vip",
  "assets/images/levels","assets/images/roles","assets/images/frames","assets/images/gifts","assets/images/rooms",
  "assets/images/backgrounds","assets/images/banners","assets/images/games",
  "assets/images/games/greedy_cat","assets/images/games/witch","assets/images/games/slot",
  "assets/images/store","assets/images/misc","assets/images/chat_bubbles","assets/images/entrances",
  "assets/images/audio_waves","assets/images/name_effects","assets/images/mic_effects","assets/images/stickers",
  "assets/images/cards","assets/images/events","assets/images/agencies","assets/images/system",
]);
const ALLOWED_EXTS = new Set(["png","jpg","jpeg","webp","gif"]);

const clean = (value) => String(value ?? "").trim();

class ApiError extends Error {
  constructor(code, status = 400) {
    super(code);
    this.code = code;
    this.status = status;
  }
}

function normalizeDirectory(value) {
  let text = clean(value).replace(/\\/g, "/");
  while (text.endsWith("/")) text = text.slice(0, -1);
  return text;
}

function validFileName(name) {
  const value = clean(name);
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$/.test(value)) return false;
  const ext = value.includes(".") ? value.split(".").pop().toLowerCase() : "";
  return ALLOWED_EXTS.has(ext);
}

function validKey(key) {
  return /^[a-z0-9][a-z0-9._-]{2,119}$/.test(clean(key));
}

function validOperationKey(key) {
  return /^[A-Za-z0-9_-]{12,180}$/.test(clean(key));
}

function validReason(reason) {
  const length = clean(reason).length;
  return length >= 3 && length <= 180;
}

function decodeBase64(input) {
  try {
    const binary = atob(input);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
  } catch {
    throw new ApiError("invalid_request", 400);
  }
}

function encodeBase64(bytes) {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

function encodePath(path) {
  return path.split("/").map(encodeURIComponent).join("/");
}

async function github(env, url, options = {}) {
  const token = clean(env.GITHUB_ASSET_TOKEN);
  if (!token) throw new ApiError("github_not_configured", 503);

  const headers = new Headers(options.headers || {});
  headers.set("accept", "application/vnd.github+json");
  headers.set("authorization", `Bearer ${token}`);
  headers.set("x-github-api-version", "2022-11-28");
  headers.set("user-agent", "Shadow-Live-Cloudflare-Asset-Manager");

  const response = await fetch(url, { ...options, headers });
  if (response.status === 404) return { status: 404, body: null };

  const text = await response.text();
  let body = {};
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    body = { message: text };
  }

  if (!response.ok) {
    const error = new ApiError(`github_${response.status}`, 502);
    error.githubStatus = response.status;
    throw error;
  }
  return { status: response.status, body };
}

async function verifyOwner(request, env) {
  const decoded = await verifyFirebaseIdToken(request, env, {
    checkUserState: false,
  });
  const authAge = Math.floor(Date.now() / 1000) - Number(decoded.auth_time || 0);
  if (!Number.isFinite(authAge) || authAge > 1800) {
    throw new ApiError("recent_auth_required", 401);
  }

  const db = firestoreClient(env);
  const user = await db.get(`users/${decoded.sub}`);
  const actor = user.data || {};
  if (!user.exists) throw new ApiError("forbidden", 403);
  assertUserDocumentSessionState(decoded, actor);
  if (actor.role !== "owner" || actor.adminEnabled !== true) {
    throw new ApiError("forbidden", 403);
  }
  return { decoded, db };
}

async function listAssets(db) {
  const docs = await db.runQuery("app_asset_registry", {
    orderBy: [{ field: "updatedAt", direction: "desc" }],
    limit: 100,
  });
  return docs.map((doc) => ({
    assetKey: doc.id,
    ...(doc.data || {}),
    updatedAt: doc.data?.updatedAt || null,
  }));
}

async function sha1Blob(bytes) {
  const header = new TextEncoder().encode(`blob ${bytes.length}\0`);
  const merged = new Uint8Array(header.length + bytes.length);
  merged.set(header, 0);
  merged.set(bytes, header.length);
  const digest = await crypto.subtle.digest("SHA-1", merged);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function invalidateAssetCaches(assetKey) {
  invalidateConfigCache("registry:app_assets:list");
  invalidateConfigCache(`registry:app_assets:key:${assetKey}`);
}

async function duplicateOperation(db, operationPath) {
  const operation = await db.get(operationPath);
  return operation.exists ? operation.data?.result || {} : null;
}

function assetDraftBucket(env) {
  const bucket = env?.USER_STORAGE;
  if (
    !bucket ||
    typeof bucket.put !== "function" ||
    typeof bucket.get !== "function" ||
    typeof bucket.delete !== "function"
  ) {
    throw new ApiError("r2_not_configured", 503);
  }
  return bucket;
}

function assetDraftKey(assetKey, contentSha, fileName) {
  const extension = clean(fileName).toLowerCase().split(".").pop() || "bin";
  return `asset-studio/drafts/${assetKey}/${contentSha}.${extension}`;
}

function templateSpecs(template) {
  return {
    width: template.width,
    height: template.height,
    dimensionsStatus: template.dimensionsStatus,
    transparency: template.transparency,
    motion: template.motion,
    maxBytes: template.maxBytes,
    extensions: [...template.extensions],
  };
}

async function writeFinalAssetToGithub(
  env,
  { assetKey, directory, fileName, bytes },
) {
  const fullPath = `${directory}/${fileName}`;
  const branch = clean(env.GITHUB_ASSET_BRANCH) || DEFAULT_BRANCH;
  const repo = clean(env.GITHUB_ASSET_REPO) || `${OWNER}/${REPO}`;
  const contentsUrl =
    `https://api.github.com/repos/${repo}/contents/${encodePath(fullPath)}`;

  const existing = await github(
    env,
    `${contentsUrl}?ref=${encodeURIComponent(branch)}`,
  );
  const existingSha = existing.status === 404
    ? null
    : clean(existing.body?.sha);
  const nextBlobSha = await sha1Blob(bytes);
  const replaced = Boolean(existingSha);

  let commitSha = null;
  let contentSha = nextBlobSha;
  let downloadUrl = null;

  if (existingSha === nextBlobSha) {
    downloadUrl = existing.body?.download_url || null;
  } else {
    const payload = {
      message: `Asset ${replaced ? "replace" : "add"}: ${assetKey} (${fullPath})`,
      content: encodeBase64(bytes),
      branch,
      ...(existingSha ? { sha: existingSha } : {}),
    };
    const write = await github(env, contentsUrl, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    commitSha = clean(write.body?.commit?.sha) || null;
    contentSha = clean(write.body?.content?.sha) || nextBlobSha;
    downloadUrl = write.body?.content?.download_url || null;
  }

  const rawUrl = downloadUrl
    ? `${downloadUrl}${downloadUrl.includes("?") ? "&" : "?"}v=${contentSha}`
    : null;

  return {
    fullPath,
    replaced,
    contentSha,
    commitSha,
    rawUrl,
  };
}

async function publishAsset({
  env,
  db,
  decoded,
  assetKey,
  reason,
  idempotencyKey,
  operationPath,
}) {
  const registryPath = `app_asset_registry/${assetKey}`;
  const current = await db.get(registryPath);
  if (!current.exists) throw new ApiError("asset_not_found", 404);

  const data = current.data || {};
  const draft =
    data.draft && typeof data.draft === "object"
      ? data.draft
      : null;
  const storageKey = clean(draft?.storageKey);
  if (!draft || !storageKey || data.hasDraft !== true) {
    throw new ApiError("asset_draft_not_found", 404);
  }

  const bucket = assetDraftBucket(env);
  const object = await bucket.get(storageKey);
  if (!object) throw new ApiError("asset_draft_missing", 409);

  const bytes = new Uint8Array(await object.arrayBuffer());
  if (!bytes.length || bytes.length > MAX_BYTES) {
    throw new ApiError("asset_draft_invalid", 409);
  }
  const expectedSha = clean(draft.contentSha);
  const actualSha = await sha1Blob(bytes);
  if (expectedSha && expectedSha !== actualSha) {
    throw new ApiError("asset_draft_mismatch", 409);
  }

  const finalAsset = await writeFinalAssetToGithub(env, {
    assetKey,
    directory: clean(draft.directory),
    fileName: clean(draft.fileName),
    bytes,
  });

  const now = new Date();
  const patch = {
    assetKey,
    directory: clean(draft.directory),
    fileName: clean(draft.fileName),
    fullPath: finalAsset.fullPath,
    mimeType: clean(draft.mimeType),
    mode: draft.mode === "bundled" ? "bundled" : "remote",
    byteSize: bytes.length,
    contentSha: finalAsset.contentSha,
    commitSha: finalAsset.commitSha || null,
    rawUrl: finalAsset.rawUrl,
    published: true,
    status: "published",
    replaced: finalAsset.replaced,
    studioVersion: Number(draft.studioVersion || ASSET_STUDIO_VERSION),
    assetType: clean(draft.assetType),
    templateId: clean(draft.templateId),
    templateVersion: Number(draft.templateVersion || 1),
    channels: Array.isArray(draft.channels) ? draft.channels : [],
    templateSpecs: draft.templateSpecs || {},
    prompt: clean(draft.prompt),
    hasDraft: false,
    draft: null,
    publishedBy: decoded.sub,
    publishedAt: now,
    updatedBy: decoded.sub,
    updatedAt: now,
  };
  const result = {
    assetKey,
    fullPath: finalAsset.fullPath,
    mode: patch.mode,
    byteSize: bytes.length,
    replaced: finalAsset.replaced,
    contentSha: finalAsset.contentSha,
    commitSha: finalAsset.commitSha,
    rawUrl: finalAsset.rawUrl,
    published: true,
    hasDraft: false,
    status: "published",
    studioVersion: patch.studioVersion,
    assetType: patch.assetType,
    templateId: patch.templateId,
    channels: patch.channels,
  };
  const auditId = crypto.randomUUID().replace(/-/g, "");

  await db.commit(null, [
    db.writeUpdate(registryPath, patch, Object.keys(patch)),
    db.writeCreate(`admin_audit_logs/${auditId}`, {
      actorUid: decoded.sub,
      action: "publishAppAssetDraft",
      targetType: "app_asset",
      targetId: assetKey,
      reason,
      before: {
        published: data.published === true,
        status: data.status || null,
        liveContentSha: data.contentSha || null,
        draftContentSha: expectedSha || null,
      },
      after: {
        published: true,
        status: "published",
        contentSha: finalAsset.contentSha,
        fullPath: finalAsset.fullPath,
      },
      operationId: idempotencyKey,
      createdAt: now,
    }),
    db.writeCreate(operationPath, {
      action: "publishAppAssetDraft",
      actorUid: decoded.sub,
      targetId: assetKey,
      status: "completed",
      result,
      createdAt: now,
    }),
  ]);

  try {
    await bucket.delete(storageKey);
  } catch (error) {
    console.warn("Asset Studio draft cleanup failed", clean(error?.message));
  }

  invalidateAssetCaches(assetKey);
  return result;
}

export async function manageAppAsset(request, env) {
  if (!["GET", "POST"].includes(request.method)) {
    return json(request, env, { ok: false, code: "method_not_allowed" }, 405);
  }

  let phase = "init";
  try {
    phase = "auth";
    const { decoded, db } = await verifyOwner(request, env);

    if (request.method === "GET") {
      phase = "list";
      return json(request, env, {
        ok: true,
        studioVersion: ASSET_STUDIO_VERSION,
        channels: [...ASSET_STUDIO_CHANNELS],
        templates: publicAssetStudioTemplates(),
        assets: await listAssets(db),
      });
    }

    const body = await readJson(request);
    const action = clean(body.action) || "upload";
    const assetKey = clean(body.assetKey);
    const reason = clean(body.reason);
    const idempotencyKey = clean(body.idempotencyKey);

    if (
      !validKey(assetKey) ||
      !validReason(reason) ||
      !validOperationKey(idempotencyKey)
    ) {
      throw new ApiError("invalid_request", 400);
    }

    phase = "idempotency";
    const operationPath = `control_operations/${idempotencyKey}`;
    const duplicate = await duplicateOperation(db, operationPath);
    if (duplicate) {
      return json(request, env, { ok: true, code: "duplicate", ...duplicate });
    }

    if (action === "publish") {
      phase = "publish";
      const result = await publishAsset({
        env,
        db,
        decoded,
        assetKey,
        reason,
        idempotencyKey,
        operationPath,
      });
      return json(request, env, { ok: true, code: "ok", ...result });
    }

    if (action !== "upload") {
      throw new ApiError("invalid_action", 400);
    }

    const directory = normalizeDirectory(body.directory);
    const fileName = clean(body.fileName);
    const mimeType = clean(body.mimeType);
    const mode = body.mode === "bundled" ? "bundled" : "remote";

    if (
      !ALLOWED_DIRS.has(directory) ||
      !validFileName(fileName) ||
      !mimeType.startsWith("image/")
    ) {
      throw new ApiError("invalid_request", 400);
    }

    let base64 = clean(body.contentBase64);
    const comma = base64.indexOf(",");
    if (base64.startsWith("data:") && comma >= 0) base64 = base64.slice(comma + 1);
    const bytes = decodeBase64(base64);
    if (!bytes.length || bytes.length > MAX_BYTES) {
      throw new ApiError("invalid_request", 400);
    }

    const studio = validateAssetStudioMetadata({
      studioVersion: body.studioVersion,
      assetType: body.assetType,
      templateId: body.templateId,
      channels: body.channels,
      directory,
      fileName,
      byteSize: bytes.length,
    });
    if (!studio.ok) throw new ApiError(studio.code || "invalid_studio_asset", 400);

    const publishNow = studio.legacy ? true : body.publish === true;
    const fullPath = `${directory}/${fileName}`;

    phase = "registry_lookup";
    const registryPath = `app_asset_registry/${assetKey}`;
    const previous = await db.get(registryPath);
    const previousData = previous.data || {};
    const oldDraftKey = clean(previousData?.draft?.storageKey);
    const now = new Date();
    const before = previous.exists
      ? {
          fullPath: previousData.fullPath || null,
          contentSha: previousData.contentSha || null,
          mode: previousData.mode || null,
          published: previousData.published === true,
          status: previousData.status || null,
          hasDraft: previousData.hasDraft === true,
          draftContentSha: previousData?.draft?.contentSha || null,
        }
      : null;

    if (!publishNow) {
      phase = "draft_storage";
      const bucket = assetDraftBucket(env);
      const contentSha = await sha1Blob(bytes);
      const storageKey = assetDraftKey(assetKey, contentSha, fileName);
      await bucket.put(storageKey, bytes, {
        httpMetadata: { contentType: mimeType },
        customMetadata: {
          assetKey,
          templateId: studio.template.id,
          contentSha,
        },
      });

      const draft = {
        storageKey,
        directory,
        fileName,
        fullPath,
        mimeType,
        mode,
        byteSize: bytes.length,
        contentSha,
        studioVersion: studio.studioVersion,
        assetType: studio.template.type,
        templateId: studio.template.id,
        templateVersion: studio.template.version,
        channels: studio.channels,
        templateSpecs: templateSpecs(studio.template),
        prompt: studio.template.prompt,
        updatedBy: decoded.sub,
        updatedAt: now,
      };
      const keepLive = previous.exists && previousData.published === true;
      const registryData = keepLive
        ? {
            hasDraft: true,
            draft,
            status: "published_with_draft",
            updatedBy: decoded.sub,
            updatedAt: now,
          }
        : {
            assetKey,
            published: false,
            status: "draft",
            hasDraft: true,
            draft,
            updatedBy: decoded.sub,
            updatedAt: now,
            ...(previous.exists
              ? {}
              : { createdBy: decoded.sub, createdAt: now }),
          };
      const result = {
        assetKey,
        fullPath,
        mode,
        byteSize: bytes.length,
        contentSha,
        published: keepLive,
        hasDraft: true,
        status: keepLive ? "published_with_draft" : "draft",
        studioVersion: studio.studioVersion,
        assetType: studio.template.type,
        templateId: studio.template.id,
        channels: studio.channels,
      };
      const auditId = crypto.randomUUID().replace(/-/g, "");

      try {
        await db.commit(null, [
          db.writeUpdate(
            registryPath,
            registryData,
            previous.exists ? Object.keys(registryData) : null,
          ),
          db.writeCreate(`admin_audit_logs/${auditId}`, {
            actorUid: decoded.sub,
            action: "saveAppAssetDraft",
            targetType: "app_asset",
            targetId: assetKey,
            reason,
            before,
            after: {
              fullPath,
              contentSha,
              mode,
              byteSize: bytes.length,
              published: keepLive,
              status: result.status,
              assetType: studio.template.type,
              templateId: studio.template.id,
              channels: studio.channels,
            },
            operationId: idempotencyKey,
            createdAt: now,
          }),
          db.writeCreate(operationPath, {
            action: "saveAppAssetDraft",
            actorUid: decoded.sub,
            targetId: assetKey,
            status: "completed",
            result,
            createdAt: now,
          }),
        ]);
      } catch (error) {
        await bucket.delete(storageKey).catch(() => {});
        throw error;
      }

      if (oldDraftKey && oldDraftKey !== storageKey) {
        await bucket.delete(oldDraftKey).catch(() => {});
      }

      return json(request, env, { ok: true, code: "ok", ...result });
    }

    phase = "github_write";
    const finalAsset = await writeFinalAssetToGithub(env, {
      assetKey,
      directory,
      fileName,
      bytes,
    });

    phase = "registry";
    const studioFields = !studio.legacy
      ? {
          studioVersion: studio.studioVersion,
          assetType: studio.template.type,
          templateId: studio.template.id,
          templateVersion: studio.template.version,
          channels: studio.channels,
          templateSpecs: templateSpecs(studio.template),
          prompt: studio.template.prompt,
        }
      : {};
    const registryData = {
      assetKey,
      directory,
      fileName,
      fullPath: finalAsset.fullPath,
      mimeType,
      mode,
      byteSize: bytes.length,
      contentSha: finalAsset.contentSha,
      commitSha: finalAsset.commitSha || null,
      rawUrl: finalAsset.rawUrl,
      published: true,
      status: "published",
      replaced: finalAsset.replaced,
      hasDraft: false,
      draft: null,
      updatedBy: decoded.sub,
      updatedAt: now,
      publishedBy: decoded.sub,
      publishedAt: now,
      ...studioFields,
      ...(previous.exists
        ? {}
        : { createdBy: decoded.sub, createdAt: now }),
    };

    const result = {
      assetKey,
      fullPath: finalAsset.fullPath,
      mode,
      byteSize: bytes.length,
      replaced: finalAsset.replaced,
      contentSha: finalAsset.contentSha,
      commitSha: finalAsset.commitSha,
      rawUrl: finalAsset.rawUrl,
      published: true,
      hasDraft: false,
      status: "published",
      ...(!studio.legacy
        ? {
            studioVersion: studio.studioVersion,
            assetType: studio.template.type,
            templateId: studio.template.id,
            channels: studio.channels,
          }
        : {}),
    };

    const auditId = crypto.randomUUID().replace(/-/g, "");
    await db.commit(null, [
      db.writeUpdate(
        registryPath,
        registryData,
        previous.exists ? Object.keys(registryData) : null,
      ),
      db.writeCreate(`admin_audit_logs/${auditId}`, {
        actorUid: decoded.sub,
        action: "publishAppAssetUpload",
        targetType: "app_asset",
        targetId: assetKey,
        reason,
        before,
        after: {
          fullPath: finalAsset.fullPath,
          contentSha: finalAsset.contentSha,
          mode,
          byteSize: bytes.length,
          replaced: finalAsset.replaced,
          published: true,
          status: "published",
          ...(!studio.legacy
            ? {
                assetType: studio.template.type,
                templateId: studio.template.id,
                channels: studio.channels,
              }
            : {}),
        },
        operationId: idempotencyKey,
        createdAt: now,
      }),
      db.writeCreate(operationPath, {
        action: "publishAppAssetUpload",
        actorUid: decoded.sub,
        targetId: assetKey,
        status: "completed",
        result,
        createdAt: now,
      }),
    ]);

    if (oldDraftKey) {
      assetDraftBucket(env).delete(oldDraftKey).catch(() => {});
    }
    invalidateAssetCaches(assetKey);
    return json(request, env, { ok: true, code: "ok", ...result });
  } catch (error) {
    const quotaResponse = firestoreQuotaResponse(request, env, error);
    if (quotaResponse) return quotaResponse;
    if (error instanceof ApiError) {
      return json(request, env, { ok: false, code: error.code }, error.status);
    }
    const raw = clean(error?.message);
    if (raw === "unauthorized") {
      return json(request, env, { ok: false, code: "unauthorized" }, 401);
    }
    if (raw === "server_not_configured" || raw === "invalid_service_account_json") {
      return json(request, env, { ok: false, code: raw }, 503);
    }
    return json(request, env, { ok: false, code: `server_${phase}_failed` }, 500);
  }
}
