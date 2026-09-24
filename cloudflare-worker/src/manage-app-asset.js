import { createHash } from "node:crypto";
import { json, readJson } from "./http.js";
import { verifyFirebaseIdToken } from "./firebase-auth.js";
import { firestoreClient } from "./firestore.js";

const OWNER = "ashrafbusiness440-eng";
const REPO = "Shadow-Live-";
const DEFAULT_BRANCH = "main";
const MAX_BYTES = 2500000;
const ALLOWED_DIRS = new Set([
  "assets/images","assets/images/avatars","assets/images/coins","assets/images/badges","assets/images/vip",
  "assets/images/levels","assets/images/roles","assets/images/frames","assets/images/gifts","assets/images/rooms",
  "assets/images/backgrounds","assets/images/banners","assets/images/games",
  "assets/images/games/greedy_cat","assets/images/games/witch","assets/images/games/slot",
  "assets/images/store","assets/images/misc",
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
  const decoded = await verifyFirebaseIdToken(request, env);
  const authAge = Math.floor(Date.now() / 1000) - Number(decoded.auth_time || 0);
  if (!Number.isFinite(authAge) || authAge > 1800) {
    throw new ApiError("recent_auth_required", 401);
  }

  const db = firestoreClient(env);
  const user = await db.get(`users/${decoded.sub}`);
  const actor = user.data || {};
  if (!user.exists || actor.role !== "owner" || actor.adminEnabled !== true) {
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
      return json(request, env, { ok: true, assets: await listAssets(db) });
    }

    const body = await readJson(request);
    const assetKey = clean(body.assetKey);
    const directory = normalizeDirectory(body.directory);
    const fileName = clean(body.fileName);
    const mimeType = clean(body.mimeType);
    const mode = body.mode === "bundled" ? "bundled" : "remote";
    const reason = clean(body.reason);
    const idempotencyKey = clean(body.idempotencyKey);

    if (
      !validKey(assetKey) ||
      !ALLOWED_DIRS.has(directory) ||
      !validFileName(fileName) ||
      !mimeType.startsWith("image/") ||
      reason.length < 3 ||
      reason.length > 180 ||
      !/^[A-Za-z0-9_-]{12,180}$/.test(idempotencyKey)
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

    phase = "idempotency";
    const operationPath = `control_operations/${idempotencyKey}`;
    const operation = await db.get(operationPath);
    if (operation.exists) {
      return json(request, env, {
        ok: true,
        code: "duplicate",
        ...(operation.data?.result || {}),
      });
    }

    const fullPath = `${directory}/${fileName}`;
    const branch = clean(env.GITHUB_ASSET_BRANCH) || DEFAULT_BRANCH;
    const repo = clean(env.GITHUB_ASSET_REPO) || `${OWNER}/${REPO}`;
    const contentsUrl =
      `https://api.github.com/repos/${repo}/contents/${encodePath(fullPath)}`;

    phase = "github_lookup";
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
      phase = "github_write";
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

    const cacheUrl = downloadUrl
      ? `${downloadUrl}${downloadUrl.includes("?") ? "&" : "?"}v=${contentSha}`
      : null;

    phase = "registry";
    const registryPath = `app_asset_registry/${assetKey}`;
    const previous = await db.get(registryPath);
    const before = previous.exists
      ? {
          fullPath: previous.data?.fullPath || null,
          contentSha: previous.data?.contentSha || null,
          mode: previous.data?.mode || null,
        }
      : null;

    const now = new Date();
    const registryData = {
      assetKey,
      directory,
      fileName,
      fullPath,
      mimeType,
      mode,
      byteSize: bytes.length,
      contentSha,
      commitSha: commitSha || null,
      rawUrl: cacheUrl,
      published: true,
      replaced,
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
      replaced,
      contentSha,
      commitSha,
      rawUrl: cacheUrl,
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
        action: "upsertAppAsset",
        targetType: "app_asset",
        targetId: assetKey,
        reason,
        before,
        after: {
          fullPath,
          contentSha,
          mode,
          byteSize: bytes.length,
          replaced,
        },
        operationId: idempotencyKey,
        createdAt: now,
      }),
      db.writeCreate(operationPath, {
        action: "upsertAppAsset",
        actorUid: decoded.sub,
        targetId: assetKey,
        status: "completed",
        result,
        createdAt: now,
      }),
    ]);

    return json(request, env, { ok: true, code: "ok", ...result });
  } catch (error) {
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
