import { json } from "./http.js";
import { googleAccessToken, parseServiceAccount } from "./google-auth.js";

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
    const { projectId } = parseServiceAccount(env.FIREBASE_SERVICE_ACCOUNT);
    const expected = [
      `${projectId}.firebasestorage.app`,
      `${projectId}.appspot.com`,
    ];
    const results = [];

    for (const name of expected) {
      try {
        const response = await fetch(
          `https://storage.googleapis.com/storage/v1/b/${encodeURIComponent(name)}`,
          { headers: { Authorization: `Bearer ${token}` } },
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

    let discoveredBuckets = [];
    try {
      const listUrl = new URL("https://storage.googleapis.com/storage/v1/b");
      listUrl.searchParams.set("project", projectId);
      listUrl.searchParams.set("maxResults", "100");
      const response = await fetch(listUrl.toString(), {
        headers: { Authorization: `Bearer ${token}` },
      });
      const body = await response.json().catch(() => ({}));
      if (response.ok) {
        discoveredBuckets = (body.items || [])
          .map((item) => String(item?.name || "").trim())
          .filter(Boolean);
      }
    } catch (_) {}

    const expectedActive = results.find((item) => item.exists === true)?.name || null;
    const discoveredActive =
      discoveredBuckets.find((name) => expected.includes(name)) ||
      discoveredBuckets.find((name) => name.includes(projectId)) ||
      (discoveredBuckets.length === 1 ? discoveredBuckets[0] : null);
    const active = expectedActive || discoveredActive || null;

    return json(
      request,
      env,
      {
        ok: Boolean(active),
        service: "shadow-storage-health",
        activeBucket: active,
        candidates: results,
        discoveredBuckets,
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
