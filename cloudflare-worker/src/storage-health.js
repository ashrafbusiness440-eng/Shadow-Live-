import { json } from "./http.js";

const BUCKET_NAME = "shadow-live-storage";
const HEALTH_KEY = "__shadow_live_r2_healthcheck__";

export async function storageHealth(request, env) {
  if (request.method !== "GET") {
    return json(request, env, { ok: false, code: "method_not_allowed" }, 405);
  }

  const bucket = env.USER_STORAGE;
  if (!bucket || typeof bucket.head !== "function") {
    return json(
      request,
      env,
      {
        ok: false,
        service: "shadow-storage-health",
        provider: "cloudflare-r2",
        bucket: BUCKET_NAME,
        code: "r2_not_configured",
      },
      503,
    );
  }

  try {
    // A HEAD against a reserved key verifies that the R2 binding is usable
    // without creating a health-check object or exposing the private bucket.
    await bucket.head(HEALTH_KEY);
    return json(request, env, {
      ok: true,
      service: "shadow-storage-health",
      provider: "cloudflare-r2",
      bucket: BUCKET_NAME,
      binding: "USER_STORAGE",
      privateBucket: true,
    });
  } catch (error) {
    return json(
      request,
      env,
      {
        ok: false,
        service: "shadow-storage-health",
        provider: "cloudflare-r2",
        bucket: BUCKET_NAME,
        code: "r2_health_failed",
        errorCode: String(error?.message || error || "unknown").slice(0, 120),
      },
      503,
    );
  }
}
