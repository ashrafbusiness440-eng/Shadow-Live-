export const CONFIG_CACHE_TTL_MS = 60_000;
export const CONFIG_CACHE_STALE_MS = 5 * 60_000;

const entries = new Map();
const inflight = new Map();
const generations = new Map();

function generationFor(key) {
  return Number(generations.get(key) || 0);
}

function positiveMs(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : fallback;
}

export function isTransientConfigReadError(error) {
  const status = Number(error?.status || 0);
  const code = [
    error?.code,
    error?.message,
    error?.details?.error?.status,
    error?.details?.error?.message,
  ]
    .filter((value) => value !== undefined && value !== null)
    .map((value) => String(value))
    .join(" ")
    .toUpperCase()
    .replaceAll("-", "_");

  return status === 408 ||
    status === 409 ||
    status === 429 ||
    status >= 500 ||
    [
      "RESOURCE_EXHAUSTED",
      "UNAVAILABLE",
      "DEADLINE_EXCEEDED",
      "ABORTED",
      "FIRESTORE_NETWORK_ERROR",
      "FIRESTORE_REQUEST_FAILED",
    ].some((token) => code.includes(token));
}

export async function readThroughConfigCache(
  key,
  loader,
  {
    ttlMs = CONFIG_CACHE_TTL_MS,
    staleMs = CONFIG_CACHE_STALE_MS,
    allowStaleOnError = true,
    now = Date.now,
  } = {},
) {
  const cacheKey = String(key || "").trim();
  if (!cacheKey) throw new Error("cache_key_required");
  if (typeof loader !== "function") throw new Error("cache_loader_required");

  const currentTime = Number(now());
  const cached = entries.get(cacheKey);
  if (cached && cached.expiresAtMs > currentTime) {
    return cached.value;
  }

  const running = inflight.get(cacheKey);
  if (running) return running;

  const generation = generationFor(cacheKey);
  const freshTtlMs = positiveMs(ttlMs, CONFIG_CACHE_TTL_MS);
  const staleWindowMs = Math.max(
    freshTtlMs,
    positiveMs(staleMs, CONFIG_CACHE_STALE_MS),
  );

  const request = (async () => {
    try {
      const value = await loader();
      const loadedAtMs = Number(now());
      if (generationFor(cacheKey) === generation) {
        entries.set(cacheKey, {
          value,
          expiresAtMs: loadedAtMs + freshTtlMs,
          staleUntilMs: loadedAtMs + staleWindowMs,
        });
      }
      return value;
    } catch (error) {
      const stale = entries.get(cacheKey);
      if (
        allowStaleOnError &&
        stale &&
        stale.staleUntilMs > Number(now()) &&
        isTransientConfigReadError(error)
      ) {
        return stale.value;
      }
      throw error;
    } finally {
      if (inflight.get(cacheKey) === request) {
        inflight.delete(cacheKey);
      }
    }
  })();

  inflight.set(cacheKey, request);
  return request;
}

export function primeConfigCache(
  key,
  value,
  {
    ttlMs = CONFIG_CACHE_TTL_MS,
    staleMs = CONFIG_CACHE_STALE_MS,
    now = Date.now,
  } = {},
) {
  const cacheKey = String(key || "").trim();
  if (!cacheKey) throw new Error("cache_key_required");

  const freshTtlMs = positiveMs(ttlMs, CONFIG_CACHE_TTL_MS);
  const staleWindowMs = Math.max(
    freshTtlMs,
    positiveMs(staleMs, CONFIG_CACHE_STALE_MS),
  );
  const loadedAtMs = Number(now());

  generations.set(cacheKey, generationFor(cacheKey) + 1);
  entries.set(cacheKey, {
    value,
    expiresAtMs: loadedAtMs + freshTtlMs,
    staleUntilMs: loadedAtMs + staleWindowMs,
  });
  inflight.delete(cacheKey);
  return value;
}

export function invalidateConfigCache(key) {
  const cacheKey = String(key || "").trim();
  if (!cacheKey) return;
  generations.set(cacheKey, generationFor(cacheKey) + 1);
  entries.delete(cacheKey);
  inflight.delete(cacheKey);
}

export function resetConfigCacheForTests() {
  entries.clear();
  inflight.clear();
  generations.clear();
}
