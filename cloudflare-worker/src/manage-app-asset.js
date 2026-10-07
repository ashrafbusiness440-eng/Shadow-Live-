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
const ALLOWED_DIRS = Object.freeze([
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

function safeDirectory(value) {
  const directory = normalizeDirectory(value);
  if (!directory || directory.startsWith("/") || directory.includes("//")) {
    return false;
  }
  const segments = directory.split("/");
  if (
    segments.some(
      (segment) =>
        !segment ||
        segment === "." ||
        segment === ".." ||
        !/^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/.test(segment),
    )
  ) {
    return false;
  }
  return ALLOWED_DIRS.some(
    (root) => directory === root || directory.startsWith(`${root}/`),
  );
}

function validFileName(name) {
  const value = clean(name);
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$/.test(value)) return false;
  const ext = value.includes(".") ? value.split(".").pop().toLowerCase() : "";
  return ALLOWED_EXTS.has(ext);
}

function validKey(key) {
  return /^[a-z0-9][A-Za-z0-9._-]{2,119}$/.test(clean(key));
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

function assetStudioEffectiveType(asset, source = asset) {
  const assetKey = clean(asset?.assetKey).toLowerCase();
  const fullPath = clean(source?.fullPath || asset?.fullPath).toLowerCase();
  const fileName = clean(source?.fileName || asset?.fileName).toLowerCase();
  if (
    assetKey.endsWith(".profileframe") ||
    fileName.includes("_profile_frame.") ||
    fullPath.includes("_profile_frame.")
  ) {
    return "frame";
  }
  return clean(source?.assetType || asset?.assetType);
}

function assetMatchesListFilters(asset, {
  query = "",
  status = "all",
  type = "all",
  channel = "all",
  family = "",
  level = "",
  updatedAfter = "",
  updatedBefore = "",
} = {}) {
  const draft = asset?.draft && typeof asset.draft === "object"
    ? asset.draft
    : {};
  const hasDraft = asset?.hasDraft === true && Object.keys(draft).length > 0;
  const source = hasDraft ? draft : asset;
  const published = asset?.published === true;
  const normalizedStatus = clean(asset?.status).toLowerCase();
  const assetType = assetStudioEffectiveType(asset, source);
  const channels = Array.isArray(source?.channels || asset?.channels)
    ? (source?.channels || asset?.channels).map((item) => clean(item))
    : [];
  const assetKey = clean(asset?.assetKey);
  const fullPath = clean(source?.fullPath || asset?.fullPath);
  const fileName = clean(source?.fileName || asset?.fileName);
  const templateId = clean(source?.templateId || asset?.templateId);

  const statusOk = status === "published"
    ? published
    : status === "draft"
      ? hasDraft
      : status === "review"
        ? normalizedStatus.includes("review") ||
          normalizedStatus.includes("pending")
        : true;
  if (!statusOk) return false;
  if (type !== "all" && assetType !== type) return false;
  if (channel !== "all" && !channels.includes(channel)) return false;

  const familyNeedle = clean(family).toLowerCase();
  if (familyNeedle) {
    const familyHaystack = `${assetKey} ${fullPath} ${templateId}`.toLowerCase();
    if (!familyHaystack.includes(familyNeedle)) return false;
  }

  const levelNeedle = clean(level).toLowerCase();
  if (levelNeedle) {
    const levelHaystack = `${assetKey} ${fullPath} ${fileName}`.toLowerCase();
    if (!levelHaystack.includes(levelNeedle)) return false;
  }

  const updatedAt = new Date(asset?.updatedAt || 0);
  if (clean(updatedAfter)) {
    const after = new Date(updatedAfter);
    if (!Number.isNaN(after.getTime()) &&
        (Number.isNaN(updatedAt.getTime()) || updatedAt < after)) {
      return false;
    }
  }
  if (clean(updatedBefore)) {
    const before = new Date(updatedBefore);
    if (!Number.isNaN(before.getTime()) &&
        (Number.isNaN(updatedAt.getTime()) || updatedAt > before)) {
      return false;
    }
  }

  const q = clean(query).toLowerCase();
  if (!q) return true;
  const haystack = [
    assetKey,
    fullPath,
    fileName,
    assetType,
    templateId,
    ...channels,
  ].join(" ").toLowerCase();
  return haystack.includes(q);
}

function registryCursor(updatedAt, id) {
  const timestamp = clean(updatedAt);
  const date = timestamp ? new Date(timestamp) : null;
  if (!date || Number.isNaN(date.getTime()) || !clean(id)) return [];
  return [
    date,
    { referencePath: `app_asset_registry/${clean(id)}` },
  ];
}

async function listAssets(
  db,
  {
    limit = 100,
    cursorUpdatedAt = "",
    cursorId = "",
    query = "",
    status = "all",
    type = "all",
    channel = "all",
    family = "",
    level = "",
    updatedAfter = "",
    updatedBefore = "",
  } = {},
) {
  const boundedLimit = Math.max(12, Math.min(100, Number(limit || 60)));
  const filters = {
    query: clean(query),
    status: clean(status) || "all",
    type: clean(type) || "all",
    channel: clean(channel) || "all",
    family: clean(family),
    level: clean(level),
    updatedAfter: clean(updatedAfter),
    updatedBefore: clean(updatedBefore),
  };
  const hasFilters = Boolean(
    filters.query ||
    filters.family ||
    filters.level ||
    filters.updatedAfter ||
    filters.updatedBefore ||
    filters.status !== "all" ||
    filters.type !== "all" ||
    filters.channel !== "all"
  );

  // Search/filter must cover the registry, not only the first ordered page.
  // Keep it bounded so Asset Studio never performs an unbounded collection scan.
  if (hasFilters) {
    const scanCap = 500;
    const docs = await db.list("app_asset_registry", scanCap);
    const normalized = docs.map((doc) => ({
      assetKey: doc.id,
      ...(doc.data || {}),
      updatedAt: doc.data?.updatedAt || doc.updateTime || null,
    }));

    normalized.sort((left, right) => {
      const leftTime = new Date(left.updatedAt || 0).getTime();
      const rightTime = new Date(right.updatedAt || 0).getTime();
      const safeLeft = Number.isNaN(leftTime) ? 0 : leftTime;
      const safeRight = Number.isNaN(rightTime) ? 0 : rightTime;
      if (safeLeft !== safeRight) return safeRight - safeLeft;
      return clean(right.assetKey).localeCompare(clean(left.assetKey));
    });

    const matches = normalized.filter((asset) =>
      assetMatchesListFilters(asset, filters)
    );

    return {
      assets: matches.slice(0, boundedLimit),
      nextCursor: null,
      scannedCount: docs.length,
      filtered: true,
      scanLimitReached:
        docs.length >= scanCap && matches.length < boundedLimit,
    };
  }

  const startAfter = registryCursor(cursorUpdatedAt, cursorId);
  const docs = await db.runQuery("app_asset_registry", {
    orderBy: [
      { field: "updatedAt", direction: "desc" },
      { field: "__name__", direction: "desc" },
    ],
    limit: boundedLimit,
    startAfter,
  });

  const assets = docs.map((doc) => ({
    assetKey: doc.id,
    ...(doc.data || {}),
    updatedAt: doc.data?.updatedAt || null,
  }));
  const last = docs.length ? docs[docs.length - 1] : null;
  const nextCursor = docs.length === boundedLimit && last
    ? {
        updatedAt: last.data?.updatedAt || null,
        id: last.id,
      }
    : null;

  return {
    assets,
    nextCursor,
    scannedCount: docs.length,
    filtered: false,
    scanLimitReached: false,
  };
}

function assetRepoConfig(env) {
  return {
    branch: clean(env.GITHUB_ASSET_BRANCH) || DEFAULT_BRANCH,
    repo: clean(env.GITHUB_ASSET_REPO) || `${OWNER}/${REPO}`,
  };
}

async function assetVersionHistory(env, db, assetKey, asset, limit = 8) {
  const fullPath = clean(asset?.fullPath);
  const { branch, repo } = assetRepoConfig(env);
  let commits = [];

  if (fullPath) {
    const url =
      `https://api.github.com/repos/${repo}/commits?` +
      `path=${encodeURIComponent(fullPath)}&sha=${encodeURIComponent(branch)}&per_page=${Math.max(2, Math.min(12, Number(limit || 8)))}`;
    const response = await github(env, url);
    commits = Array.isArray(response.body)
      ? response.body.map((item) => ({
          sha: clean(item?.sha),
          message: clean(item?.commit?.message),
          date: clean(item?.commit?.committer?.date || item?.commit?.author?.date),
          author: clean(item?.commit?.author?.name || item?.author?.login),
          htmlUrl: clean(item?.html_url),
        })).filter((item) => item.sha)
      : [];
  }

  const audits = await db.runQuery("admin_audit_logs", {
    filters: [{ field: "targetId", op: "==", value: assetKey }],
    limit: 20,
  });
  const audit = audits
    .map((doc) => ({ id: doc.id, ...(doc.data || {}) }))
    .filter((item) => clean(item.targetType) === "app_asset")
    .sort((a, b) =>
      clean(b.createdAt).localeCompare(clean(a.createdAt))
    )
    .slice(0, 12)
    .map((item) => ({
      id: item.id,
      action: clean(item.action),
      actorUid: clean(item.actorUid),
      reason: clean(item.reason),
      createdAt: item.createdAt || null,
      before: item.before || null,
      after: item.after || null,
    }));

  return { commits, audit };
}

function parentDirectory(path) {
  const value = normalizeDirectory(path);
  const slash = value.lastIndexOf("/");
  return slash > 0 ? value.slice(0, slash) : "";
}

function decodeGithubTextContent(body) {
  const encoded = clean(body?.content).replace(/\s+/g, "");
  if (!encoded) return "";
  const bytes = decodeBase64(encoded);
  return new TextDecoder().decode(bytes);
}

async function assetBatchManifest(env, db, assetKey, asset) {
  const fullPath = clean(asset?.fullPath);
  let directory = clean(asset?.directory);
  if (!directory && fullPath.includes("/")) {
    directory = fullPath.slice(0, fullPath.lastIndexOf("/"));
  }
  if (!directory) {
    return {
      sourcePath: null,
      batch: null,
      metric: null,
      tier: null,
      assets: [],
    };
  }

  const { branch, repo } = assetRepoConfig(env);
  const directories = [];
  let cursor = directory;
  for (let i = 0; i < 4 && cursor; i++) {
    if (!directories.includes(cursor)) directories.push(cursor);
    if (cursor === "assets/images" || cursor === "assets") break;
    cursor = parentDirectory(cursor);
  }

  for (const dir of directories) {
    const listing = await github(
      env,
      `https://api.github.com/repos/${repo}/contents/${encodePath(dir)}?ref=${encodeURIComponent(branch)}`,
    );
    const entries = Array.isArray(listing.body) ? listing.body : [];
    const candidates = entries.filter((item) => {
      const name = clean(item?.name).toUpperCase();
      return item?.type === "file" && name.endsWith("PUBLISHED.JSON");
    });

    for (const candidate of candidates.slice(0, 6)) {
      const file = await github(
        env,
        `https://api.github.com/repos/${repo}/contents/${encodePath(clean(candidate.path))}?ref=${encodeURIComponent(branch)}`,
      );
      let parsed = null;
      try {
        parsed = JSON.parse(decodeGithubTextContent(file.body));
      } catch {
        parsed = null;
      }
      const declared = Array.isArray(parsed?.assets) ? parsed.assets : [];
      if (!declared.some((item) => clean(item?.assetKey) === assetKey)) {
        continue;
      }

      const limited = declared.slice(0, 40);
      const templateMap = new Map(
        publicAssetStudioTemplates().map((template) => [
          clean(template?.id),
          template,
        ]),
      );
      const metadata = await Promise.all(
        limited.map(async (item) => {
          const key = clean(item?.assetKey);
          if (!validKey(key)) return null;
          const current = await db.get(`app_asset_registry/${key}`);
          const data = current.data || {};
          const templateId = clean(data.templateId);
          const template = templateMap.get(templateId) || null;
          return {
            assetKey: key,
            fullPath: clean(item?.fullPath || data.fullPath),
            width: Number(item?.width || data?.templateSpecs?.width || 0) || null,
            height: Number(item?.height || data?.templateSpecs?.height || 0) || null,
            contentSha: clean(item?.contentSha || data.contentSha) || null,
            published: current.exists && data.published === true,
            hasDraft: current.exists && data.hasDraft === true,
            status: clean(data.status) || (current.exists ? "registered" : "missing"),
            assetType: clean(data.assetType),
            templateId,
            templateLabel: clean(template?.labelAr),
            templatePrompt: clean(template?.prompt),
            channels: Array.isArray(data.channels) ? data.channels : [],
            mode: data.mode === "bundled" ? "bundled" : "remote",
            fileName: clean(data.fileName) ||
              clean(item?.fullPath).split("/").pop() ||
              "",
            directory: clean(data.directory) ||
              parentDirectory(clean(item?.fullPath)),
          };
        }),
      );

      return {
        sourcePath: clean(candidate.path),
        batch: clean(parsed?.batch) || null,
        metric: clean(parsed?.metric) || null,
        tier: clean(parsed?.tier) || null,
        publishedAt: parsed?.publishedAt || null,
        assets: metadata.filter(Boolean),
      };
    }
  }

  return {
    sourcePath: null,
    batch: null,
    metric: null,
    tier: null,
    assets: [{
      assetKey,
      fullPath,
      width: Number(asset?.templateSpecs?.width || 0) || null,
      height: Number(asset?.templateSpecs?.height || 0) || null,
      contentSha: clean(asset?.contentSha) || null,
      published: asset?.published === true,
      hasDraft: asset?.hasDraft === true,
      status: clean(asset?.status) || "registered",
      assetType: clean(asset?.assetType),
      templateId: clean(asset?.templateId),
      channels: Array.isArray(asset?.channels) ? asset.channels : [],
      mode: asset?.mode === "bundled" ? "bundled" : "remote",
      fileName: clean(asset?.fileName),
      directory,
    }],
  };
}

async function assetHealthCheck(env, db, assetKey, asset) {
  const { branch, repo } = assetRepoConfig(env);
  const fullPath = clean(asset?.fullPath);
  const directory = clean(asset?.directory) ||
    (fullPath.includes("/") ? fullPath.slice(0, fullPath.lastIndexOf("/")) : "");
  const usage = await assetUsageMap(env, assetKey, asset);

  let fileExists = false;
  if (fullPath) {
    const file = await github(
      env,
      `https://api.github.com/repos/${repo}/contents/${encodePath(fullPath)}?ref=${encodeURIComponent(branch)}`,
    );
    fileExists = file.status !== 404;
  }

  let directoryFiles = [];
  if (directory) {
    const listing = await github(
      env,
      `https://api.github.com/repos/${repo}/contents/${encodePath(directory)}?ref=${encodeURIComponent(branch)}`,
    );
    directoryFiles = Array.isArray(listing.body)
      ? listing.body
          .filter((item) => item?.type === "file")
          .map((item) => clean(item?.path))
          .filter(Boolean)
          .slice(0, 60)
      : [];
  }

  const sameDirectory = directory
    ? await db.runQuery("app_asset_registry", {
        filters: [{ field: "directory", op: "==", value: directory }],
        limit: 80,
      })
    : [];
  const registeredPaths = new Set(
    sameDirectory
      .map((doc) => clean(doc.data?.fullPath))
      .filter(Boolean),
  );
  const filesWithoutRegistry = directoryFiles
    .filter((path) => {
      const name = path.split("/").pop()?.toUpperCase() || "";
      if (name.endsWith("PUBLISHED.JSON")) return false;
      return !registeredPaths.has(path);
    })
    .slice(0, 20);

  const samePath = fullPath
    ? await db.runQuery("app_asset_registry", {
        filters: [{ field: "fullPath", op: "==", value: fullPath }],
        limit: 12,
      })
    : [];
  const duplicatePathKeys = samePath
    .map((doc) => doc.id)
    .filter((id) => id && id !== assetKey)
    .slice(0, 10);

  const templateId = clean(asset?.templateId);
  const sameTemplate = templateId
    ? await db.runQuery("app_asset_registry", {
        filters: [{ field: "templateId", op: "==", value: templateId }],
        limit: 24,
      })
    : [];
  const channels = Array.isArray(asset?.channels)
    ? asset.channels.map((item) => clean(item)).sort()
    : [];
  const duplicateFunctionKeys = sameTemplate
    .filter((doc) => doc.id !== assetKey)
    .filter((doc) => {
      const other = Array.isArray(doc.data?.channels)
        ? doc.data.channels.map((item) => clean(item)).sort()
        : [];
      return JSON.stringify(other) === JSON.stringify(channels);
    })
    .map((doc) => doc.id)
    .slice(0, 10);

  return {
    assetKey,
    fileExists,
    unusedDirectly: Number(usage.totalReferences || 0) === 0,
    directUsageCount: Number(usage.totalReferences || 0),
    filesWithoutRegistry,
    duplicatePathKeys,
    duplicateFunctionKeys,
    directoryFileScanTruncated: directoryFiles.length >= 60,
  };
}

async function assetUsageMap(env, assetKey, asset) {
  const { repo } = assetRepoConfig(env);
  const query = encodeURIComponent(`"${assetKey}" repo:${repo}`);
  const response = await github(
    env,
    `https://api.github.com/search/code?q=${query}&per_page=20`,
  );
  const items = Array.isArray(response.body?.items)
    ? response.body.items
        .map((item) => ({
          path: clean(item?.path),
          htmlUrl: clean(item?.html_url),
          repository: clean(item?.repository?.full_name),
        }))
        .filter((item) => item.path)
    : [];
  return {
    assetKey,
    assetType: clean(asset?.assetType),
    channels: Array.isArray(asset?.channels) ? asset.channels : [],
    references: items,
    truncated: Number(response.body?.total_count || 0) > items.length,
    totalReferences: Number(response.body?.total_count || 0),
  };
}

async function rollbackPreviousAssetVersion({
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
  if (data.published !== true || !clean(data.fullPath)) {
    throw new ApiError("asset_not_published", 409);
  }

  const { branch, repo } = assetRepoConfig(env);
  const fullPath = clean(data.fullPath);
  const commitsResponse = await github(
    env,
    `https://api.github.com/repos/${repo}/commits?path=${encodeURIComponent(fullPath)}&sha=${encodeURIComponent(branch)}&per_page=12`,
  );
  const commits = Array.isArray(commitsResponse.body)
    ? commitsResponse.body
    : [];
  if (commits.length < 2) throw new ApiError("asset_history_not_found", 404);

  const currentCommitSha = clean(data.commitSha);
  let currentIndex = currentCommitSha
    ? commits.findIndex((item) => clean(item?.sha) === currentCommitSha)
    : 0;
  if (currentIndex < 0) currentIndex = 0;
  const previous = commits[currentIndex + 1];
  const previousSha = clean(previous?.sha);
  if (!previousSha) throw new ApiError("asset_history_not_found", 404);

  const contentsUrl =
    `https://api.github.com/repos/${repo}/contents/${encodePath(fullPath)}`;
  const previousFile = await github(
    env,
    `${contentsUrl}?ref=${encodeURIComponent(previousSha)}`,
  );
  const encoded = clean(previousFile.body?.content).replace(/\s+/g, "");
  if (!encoded) throw new ApiError("asset_history_content_missing", 409);
  const bytes = decodeBase64(encoded);
  if (!bytes.length || bytes.length > MAX_BYTES) {
    throw new ApiError("asset_history_content_invalid", 409);
  }

  const restored = await writeFinalAssetToGithub(env, {
    assetKey,
    directory: clean(data.directory),
    fileName: clean(data.fileName),
    bytes,
    reason: `Rollback: ${reason}`,
  });

  const now = new Date();
  const patch = {
    contentSha: restored.contentSha,
    commitSha: restored.commitSha || null,
    rawUrl: restored.rawUrl,
    byteSize: bytes.length,
    replaced: true,
    published: true,
    status: "published",
    hasDraft: false,
    draft: null,
    publishedBy: decoded.sub,
    publishedAt: now,
    updatedBy: decoded.sub,
    updatedAt: now,
  };
  const result = {
    assetKey,
    fullPath,
    contentSha: restored.contentSha,
    commitSha: restored.commitSha,
    rawUrl: restored.rawUrl,
    rolledBackFrom: currentCommitSha || null,
    restoredFrom: previousSha,
    published: true,
    status: "published",
  };
  const auditId = crypto.randomUUID().replace(/-/g, "");

  await db.commit(null, [
    db.writeUpdate(registryPath, patch, Object.keys(patch)),
    db.writeCreate(`admin_audit_logs/${auditId}`, {
      actorUid: decoded.sub,
      action: "rollbackAppAsset",
      targetType: "app_asset",
      targetId: assetKey,
      reason,
      before: {
        contentSha: data.contentSha || null,
        commitSha: currentCommitSha || null,
        fullPath,
      },
      after: {
        contentSha: restored.contentSha,
        commitSha: restored.commitSha || null,
        restoredFrom: previousSha,
        fullPath,
      },
      operationId: idempotencyKey,
      createdAt: now,
    }),
    db.writeCreate(operationPath, {
      action: "rollbackAppAsset",
      actorUid: decoded.sub,
      targetId: assetKey,
      status: "completed",
      result,
      createdAt: now,
    }),
  ]);

  invalidateAssetCaches(assetKey);
  return result;
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
  { assetKey, directory, fileName, bytes, reason = "" },
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
      message: `Asset ${replaced ? "replace" : "add"}: ${assetKey} (${fullPath})` +
        (clean(reason) ? ` — ${clean(reason).slice(0, 120)}` : ""),
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
    reason,
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
      const url = new URL(request.url);
      const detailKey = clean(url.searchParams.get("assetKey"));
      const include = clean(url.searchParams.get("include"));

      if (detailKey) {
        if (!validKey(detailKey)) throw new ApiError("invalid_request", 400);
        const current = await db.get(`app_asset_registry/${detailKey}`);
        if (!current.exists) throw new ApiError("asset_not_found", 404);
        const asset = { assetKey: detailKey, ...(current.data || {}) };

        if (include === "history") {
          phase = "history";
          return json(request, env, {
            ok: true,
            asset,
            history: await assetVersionHistory(env, db, detailKey, asset),
          });
        }
        if (include === "usage") {
          phase = "usage";
          return json(request, env, {
            ok: true,
            asset,
            usage: await assetUsageMap(env, detailKey, asset),
          });
        }
        if (include === "health") {
          phase = "health";
          return json(request, env, {
            ok: true,
            asset,
            health: await assetHealthCheck(env, db, detailKey, asset),
          });
        }
        if (include === "manifest") {
          phase = "manifest";
          return json(request, env, {
            ok: true,
            asset,
            manifest: await assetBatchManifest(
              env,
              db,
              detailKey,
              asset,
            ),
          });
        }
        return json(request, env, { ok: true, asset });
      }

      phase = "list";
      const page = await listAssets(db, {
        limit: Number(url.searchParams.get("limit") || 60),
        cursorUpdatedAt: clean(url.searchParams.get("cursorUpdatedAt")),
        cursorId: clean(url.searchParams.get("cursorId")),
        query: clean(url.searchParams.get("q")),
        status: clean(url.searchParams.get("status")) || "all",
        type: clean(url.searchParams.get("type")) || "all",
        channel: clean(url.searchParams.get("channel")) || "all",
        family: clean(url.searchParams.get("family")),
        level: clean(url.searchParams.get("level")),
        updatedAfter: clean(url.searchParams.get("updatedAfter")),
        updatedBefore: clean(url.searchParams.get("updatedBefore")),
      });
      return json(request, env, {
        ok: true,
        studioVersion: ASSET_STUDIO_VERSION,
        channels: [...ASSET_STUDIO_CHANNELS],
        templates: publicAssetStudioTemplates(),
        assets: page.assets,
        nextCursor: page.nextCursor,
        scannedCount: page.scannedCount,
        filtered: page.filtered,
        scanLimitReached: page.scanLimitReached,
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

    if (action === "rollback_previous") {
      phase = "rollback";
      const result = await rollbackPreviousAssetVersion({
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
      !safeDirectory(directory) ||
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
      assetKey,
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
      reason,
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
