export function createAsyncLimiter(maxConcurrent = 32) {
  const limit = Math.max(1, Math.floor(Number(maxConcurrent) || 1));
  let active = 0;
  const queue = [];

  const release = () => {
    active = Math.max(0, active - 1);
    const next = queue.shift();
    if (next) next();
  };

  async function run(task) {
    if (active >= limit) {
      await new Promise((resolve) => queue.push(resolve));
    }
    active += 1;
    try {
      return await task();
    } finally {
      release();
    }
  }

  return {
    run,
    snapshot() {
      return { active, queued: queue.length, limit };
    },
  };
}

export function createAsyncTtlCache({
  ttlMs = 30000,
  maxEntries = 2048,
  now = () => Date.now(),
} = {}) {
  const ttl = Math.max(1000, Number(ttlMs) || 30000);
  const cap = Math.max(16, Math.floor(Number(maxEntries) || 2048));
  const values = new Map();
  const inflight = new Map();

  function prune() {
    const current = now();
    for (const [key, entry] of values) {
      if (Number(entry.expiresAtMs || 0) <= current) values.delete(key);
    }
    while (values.size > cap) {
      const oldest = values.keys().next().value;
      if (oldest === undefined) break;
      values.delete(oldest);
    }
  }

  async function get(key, loader) {
    const cacheKey = String(key || "");
    const current = now();
    const cached = values.get(cacheKey);
    if (cached && cached.expiresAtMs > current) {
      values.delete(cacheKey);
      values.set(cacheKey, cached);
      return cached.value;
    }
    values.delete(cacheKey);

    const pending = inflight.get(cacheKey);
    if (pending) return pending;

    const promise = Promise.resolve()
      .then(loader)
      .then((value) => {
        values.set(cacheKey, {
          value,
          expiresAtMs: now() + ttl,
        });
        prune();
        return value;
      })
      .finally(() => {
        inflight.delete(cacheKey);
      });

    inflight.set(cacheKey, promise);
    return promise;
  }

  return {
    get,
    clear(key = null) {
      if (key === null) values.clear();
      else values.delete(String(key || ""));
    },
    snapshot() {
      prune();
      return { size: values.size, inflight: inflight.size, ttlMs: ttl, maxEntries: cap };
    },
  };
}
