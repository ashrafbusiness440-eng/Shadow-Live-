const DEFAULT_ALLOWED_ORIGINS = new Set([
  "https://ashrafbusiness440-eng.github.io",
]);

export function corsHeaders(request, env) {
  const origin = request.headers.get("Origin") || "";
  const configured = String(env?.CONTROL_ALLOWED_ORIGINS || "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  const allowed = new Set([...DEFAULT_ALLOWED_ORIGINS, ...configured]);

  const headers = {
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Authorization, Content-Type",
    "Access-Control-Max-Age": "86400",
    "Cache-Control": "no-store",
    "Content-Type": "application/json; charset=utf-8",
  };
  if (origin && allowed.has(origin)) {
    headers["Access-Control-Allow-Origin"] = origin;
    headers["Vary"] = "Origin";
  }
  return headers;
}

export function json(request, env, body, status = 200, extraHeaders = {}) {
  const headers = new Headers(corsHeaders(request, env));
  for (const [key, value] of Object.entries(extraHeaders)) {
    headers.set(key, value);
  }
  return new Response(JSON.stringify(body), { status, headers });
}

export function firestoreQuotaResponse(request, env, error) {
  const code = String(error?.code || error?.message || "").trim();
  if (code !== "firestore_quota_exhausted") return null;
  const retryAfterSeconds = Math.max(
    1,
    Math.min(60, Number(error?.retryAfterSeconds || 10)),
  );
  return json(
    request,
    env,
    {
      ok: false,
      code: "firestore_quota_exhausted",
      retryAfterSeconds,
    },
    503,
    { "Retry-After": String(retryAfterSeconds) },
  );
}

export async function readJson(request) {
  try {
    const body = await request.json();
    return body && typeof body === "object" ? body : {};
  } catch {
    return {};
  }
}
