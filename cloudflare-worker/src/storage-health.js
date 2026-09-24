import { json } from "./http.js";
import { googleAccessToken } from "./google-auth.js";

function codeOf(error) {
  const raw = String(error?.code || error?.message || "unknown");
  return raw.slice(0, 120);
}

export async function storageHealth(request, env) {
  if (request.method !== "GET") {
    return json(request, env, { ok: false, code: "method_not_allowed" }, 405);
  }

  try {
    const token = await googleAccessToken(
      env,
      "https://www.googleapis.com/auth/devstorage.read_only",
    );
    const candidates = [
      "shadow-live.firebasestorage.app",
      "shadow-live.appspot.com",
    ];
    const results = [];

    for (const name of candidates) {
      try {
        const response = await fetch(
          `https://storage.googleapis.com/storage/v1/b/${encodeURIComponent(name)}`,
          {
            headers: { Authorization: `Bearer ${token}` },
          },
        );

        if (response.ok) {
          results.push({ name, exists: true });
          continue;
        }
        if (response.status === 404) {
          results.push({ name, exists: false });
          continue;
        }

        const body = await response.json().catch(() => ({}));
        results.push({
          name,
          exists: null,
          errorCode: String(
            body?.error?.errors?.[0]?.reason ||
            body?.error?.code ||
            response.status,
          ).slice(0, 120),
        });
      } catch (error) {
        results.push({ name, exists: null, errorCode: codeOf(error) });
      }
    }

    const active = results.find((item) => item.exists === true)?.name || null;
    return json(
      request,
      env,
      {
        ok: Boolean(active),
        service: "shadow-storage-health",
        activeBucket: active,
        candidates: results,
      },
      active ? 200 : 503,
    );
  } catch (error) {
    return json(
      request,
      env,
      {
        ok: false,
        service: "shadow-storage-health",
        code: "storage_health_failed",
        errorCode: codeOf(error),
      },
      500,
    );
  }
}
