import { firestoreQuotaResponse, json } from "./http.js";
import { firestoreClient } from "./firestore.js";
import { readThroughConfigCache } from "./config-cache.js";

const clean = (value) => String(value ?? "").trim();

export async function appAssets(request, env) {
  if (request.method !== "GET") {
    return json(request, env, { ok: false, code: "method_not_allowed" }, 405);
  }

  try {
    const db = firestoreClient(env);
    const url = new URL(request.url);
    const key = clean(url.searchParams.get("key"));
    const cacheHeaders = { "Cache-Control": "public, max-age=60, s-maxage=300" };

    if (key) {
      if (!/^[a-z0-9][a-z0-9._-]{2,119}$/.test(key)) {
        return json(request, env, { ok: false, code: "invalid_key" }, 400);
      }
      const asset = await readThroughConfigCache(
        `registry:app_assets:key:${key}`,
        async () => {
          const doc = await db.get(`app_asset_registry/${key}`);
          if (!doc.exists || doc.data?.published !== true) return null;
          const data = doc.data || {};
          return {
            assetKey: key,
            rawUrl: data.rawUrl || null,
            mode: data.mode || "remote",
            contentSha: data.contentSha || null,
          };
        },
        { ttlMs: 60_000, staleMs: 5 * 60_000 },
      );
      if (!asset) {
        return json(request, env, { ok: false, code: "not_found" }, 404);
      }
      return json(request, env, { ok: true, asset }, 200, cacheHeaders);
    }

    const assets = await readThroughConfigCache(
      "registry:app_assets:list",
      async () => {
        const docs = await db.list("app_asset_registry", 200);
        return docs
          .filter((doc) => doc.data?.published === true)
          .map((doc) => ({
            assetKey: doc.id,
            rawUrl: doc.data?.rawUrl || null,
            mode: doc.data?.mode || "remote",
            contentSha: doc.data?.contentSha || null,
          }));
      },
      { ttlMs: 60_000, staleMs: 5 * 60_000 },
    );

    return json(request, env, { ok: true, assets }, 200, cacheHeaders);
  } catch (error) {
    const quotaResponse = firestoreQuotaResponse(request, env, error);
    if (quotaResponse) return quotaResponse;
    const raw = clean(error?.message);
    if (raw === "server_not_configured" || raw === "invalid_service_account_json") {
      return json(request, env, { ok: false, code: raw }, 503);
    }
    return json(request, env, { ok: false, code: "server_failed" }, 500);
  }
}
