import { corsHeaders } from "./http.js";
import { presignR2Get, R2_PRESIGN_TTL_SECONDS } from "./r2-presign.js";

const PUBLIC_SCOPES = new Set([
  "profile_image",
  "profile_cover",
  "room_cover",
]);

const FILE_PATTERN = /^([a-f0-9]{32})\.(jpg|png|webp)$/;

const clean = (value) => String(value ?? "").trim();

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
    case "room_cover":
      return `rooms/${encodedTarget}/covers/${canonicalFile}`;
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
    const storageKey = publicMediaStorageKey({
      scope,
      targetId,
      filename,
    });
    const readUrl = await presignR2Get(env, {
      key: storageKey,
      expiresSeconds: R2_PRESIGN_TTL_SECONDS,
    });

    const headers = new Headers(corsHeaders(request, env));
    headers.delete("Content-Type");
    headers.set("Location", readUrl);
    headers.set("Cache-Control", "public, max-age=300, stale-while-revalidate=60");
    headers.set("Cross-Origin-Resource-Policy", "cross-origin");

    return new Response(null, { status: 302, headers });
  } catch (error) {
    const headers = new Headers(corsHeaders(request, env));
    headers.set("Content-Type", "application/json; charset=utf-8");
    return new Response(
      JSON.stringify({
        ok: false,
        code: clean(error?.message || "public_media_failed").slice(0, 120),
      }),
      { status: 400, headers },
    );
  }
}
