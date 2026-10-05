import { corsHeaders } from "./http.js";

const PUBLIC_MEDIA_CACHE_SECONDS = 300;

const PUBLIC_SCOPES = new Set([
  "profile_image",
  "profile_cover",
  "diary_image",
  "room_cover",
  "agency_logo",
  "agency_background",
  "agency_room_image",
]);

const FILE_PATTERN = /^([a-f0-9]{32})\.(jpg|png|webp)$/;
const MIME_BY_EXT = Object.freeze({
  jpg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
});

const clean = (value) => String(value ?? "").trim();

function publicMediaCache() {
  try {
    return typeof caches !== "undefined" ? caches.default : null;
  } catch (_) {
    return null;
  }
}

function mediaHeaders(request, env, object, extension) {
  const headers = new Headers(corsHeaders(request, env));
  headers.set(
    "Content-Type",
    clean(object?.httpMetadata?.contentType) ||
      MIME_BY_EXT[clean(extension).toLowerCase()] ||
      "application/octet-stream",
  );
  headers.set(
    "Cache-Control",
    `public, max-age=${PUBLIC_MEDIA_CACHE_SECONDS}, stale-while-revalidate=60`,
  );
  headers.set("Cross-Origin-Resource-Policy", "cross-origin");
  const etag = clean(object?.httpEtag || object?.etag);
  if (etag) headers.set("ETag", etag);
  const size = Number(object?.size || 0);
  if (Number.isFinite(size) && size > 0) {
    headers.set("Content-Length", String(size));
  }
  return headers;
}

function publicMediaBucket(env) {
  const bucket = env?.USER_STORAGE;
  if (!bucket || typeof bucket.get !== "function") {
    throw new Error("r2_not_configured");
  }
  return bucket;
}

export function isPublicMediaScope(scope) {
  return PUBLIC_SCOPES.has(clean(scope));
}

export function publicMediaStorageKey({ scope, targetId, filename }) {
  const normalizedScope = clean(scope);
  if (!isPublicMediaScope(normalizedScope)) {
    throw new Error("invalid_public_media_scope");
  }

  const target = clean(targetId);
  if (
    !target ||
    target.length > 220 ||
    target.includes("/") ||
    target.includes("\\")
  ) {
    throw new Error("invalid_public_media_target");
  }

  const match = FILE_PATTERN.exec(clean(filename).toLowerCase());
  if (!match) throw new Error("invalid_public_media_file");
  const canonicalFile = `${match[1]}.${match[2]}`;
  const encodedTarget = encodeURIComponent(target);

  switch (normalizedScope) {
    case "profile_image":
      return `users/${encodedTarget}/profile/${canonicalFile}`;
    case "profile_cover":
      return `users/${encodedTarget}/covers/${canonicalFile}`;
    case "diary_image":
      return `users/${encodedTarget}/diaries/${canonicalFile}`;
    case "room_cover":
      return `rooms/${encodedTarget}/covers/${canonicalFile}`;
    case "agency_logo":
      return `agencies/${encodedTarget}/logo/${canonicalFile}`;
    case "agency_background":
      return `agencies/${encodedTarget}/background/${canonicalFile}`;
    case "agency_room_image":
      return `agencies/${encodedTarget}/room-image/${canonicalFile}`;
    default:
      throw new Error("invalid_public_media_scope");
  }
}

export function publicMediaUrl(
  request,
  {
    scope,
    targetId,
    objectId,
    extension,
  },
) {
  const normalizedScope = clean(scope);
  if (!isPublicMediaScope(normalizedScope)) return null;

  const id = clean(objectId).toLowerCase();
  const ext = clean(extension).toLowerCase();
  if (!/^[a-f0-9]{32}$/.test(id) || !/^(jpg|png|webp)$/.test(ext)) {
    return null;
  }

  const origin = new URL(request.url).origin;
  return (
    origin +
    "/api/public-media/" +
    encodeURIComponent(normalizedScope) +
    "/" +
    encodeURIComponent(clean(targetId)) +
    "/" +
    encodeURIComponent(`${id}.${ext}`)
  );
}

export async function publicMediaRedirect(request, env) {
  if (request.method !== "GET") {
    const headers = new Headers(corsHeaders(request, env));
    headers.set("Content-Type", "application/json; charset=utf-8");
    return new Response(
      JSON.stringify({ ok: false, code: "method_not_allowed" }),
      { status: 405, headers },
    );
  }

  try {
    const url = new URL(request.url);
    const prefix = "/api/public-media/";
    const relative = url.pathname.startsWith(prefix)
      ? url.pathname.slice(prefix.length)
      : "";
    const parts = relative
      .split("/")
      .filter(Boolean)
      .map((value) => decodeURIComponent(value));

    if (parts.length !== 3) {
      throw new Error("invalid_public_media_path");
    }

    const [scope, targetId, filename] = parts;
    const match = FILE_PATTERN.exec(clean(filename).toLowerCase());
    if (!match) throw new Error("invalid_public_media_file");
    const extension = match[2];
    const storageKey = publicMediaStorageKey({
      scope,
      targetId,
      filename,
    });

    const requestOrigin = request.headers.get("Origin") || "";
    const cacheUrl = new URL(url.toString());
    if (requestOrigin) {
      cacheUrl.searchParams.set("__shadow_origin", requestOrigin);
    }
    const cache = publicMediaCache();
    const cacheKey = new Request(cacheUrl.toString(), { method: "GET" });
    if (cache) {
      try {
        const cached = await cache.match(cacheKey);
        if (cached) return cached;
      } catch (_) {}
    }

    const object = await publicMediaBucket(env).get(storageKey);
    if (!object) {
      const headers = new Headers(corsHeaders(request, env));
      headers.set("Content-Type", "application/json; charset=utf-8");
      return new Response(
        JSON.stringify({ ok: false, code: "public_media_not_found" }),
        { status: 404, headers },
      );
    }

    const response = new Response(object.body, {
      status: 200,
      headers: mediaHeaders(request, env, object, extension),
    });

    if (cache) {
      try {
        await cache.put(cacheKey, response.clone());
      } catch (_) {}
    }

    return response;
  } catch (error) {
    const code = clean(error?.message || "public_media_failed").slice(0, 120);
    const status = code === "r2_not_configured" ? 503 : 400;
    const headers = new Headers(corsHeaders(request, env));
    headers.set("Content-Type", "application/json; charset=utf-8");
    return new Response(
      JSON.stringify({ ok: false, code }),
      { status, headers },
    );
  }
}
