import test from "node:test";
import assert from "node:assert/strict";

import {
  invalidateConfigCache,
  isTransientConfigReadError,
  primeConfigCache,
  readThroughConfigCache,
  resetConfigCacheForTests,
} from "../../cloudflare-worker/src/config-cache.js";

test("config cache reuses fresh values and coalesces concurrent loads", async () => {
  resetConfigCacheForTests();
  let nowMs = 1_000;
  let loads = 0;
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const loader = async () => {
    loads += 1;
    await gate;
    return { revision: loads };
  };

  const first = readThroughConfigCache("gift_catalog", loader, {
    ttlMs: 1_000,
    staleMs: 5_000,
    now: () => nowMs,
  });
  const second = readThroughConfigCache("gift_catalog", loader, {
    ttlMs: 1_000,
    staleMs: 5_000,
    now: () => nowMs,
  });

  assert.equal(loads, 1);
  release();
  assert.deepEqual(await first, { revision: 1 });
  assert.deepEqual(await second, { revision: 1 });

  nowMs += 500;
  assert.deepEqual(
    await readThroughConfigCache("gift_catalog", loader, {
      ttlMs: 1_000,
      staleMs: 5_000,
      now: () => nowMs,
    }),
    { revision: 1 },
  );
  assert.equal(loads, 1);
});

test("config cache uses bounded stale data only for transient failures", async () => {
  resetConfigCacheForTests();
  let nowMs = 10_000;
  primeConfigCache("economy", { enabled: true }, {
    ttlMs: 100,
    staleMs: 1_000,
    now: () => nowMs,
  });

  nowMs += 200;
  const transient = new Error("RESOURCE_EXHAUSTED");
  transient.status = 429;
  const stale = await readThroughConfigCache(
    "economy",
    async () => { throw transient; },
    {
      ttlMs: 100,
      staleMs: 1_000,
      now: () => nowMs,
    },
  );
  assert.deepEqual(stale, { enabled: true });

  await assert.rejects(
    () => readThroughConfigCache(
      "economy",
      async () => { throw new Error("permission_denied"); },
      {
        ttlMs: 100,
        staleMs: 1_000,
        now: () => nowMs,
      },
    ),
    /permission_denied/,
  );

  nowMs += 1_000;
  await assert.rejects(
    () => readThroughConfigCache(
      "economy",
      async () => { throw transient; },
      {
        ttlMs: 100,
        staleMs: 1_000,
        now: () => nowMs,
      },
    ),
    /RESOURCE_EXHAUSTED/,
  );
});

test("prime and invalidate update the visible cached value", async () => {
  resetConfigCacheForTests();
  let loads = 0;
  const loader = async () => ({ revision: ++loads });

  primeConfigCache("recharge", { revision: 7 });
  assert.deepEqual(
    await readThroughConfigCache("recharge", loader),
    { revision: 7 },
  );
  assert.equal(loads, 0);

  invalidateConfigCache("recharge");
  assert.deepEqual(
    await readThroughConfigCache("recharge", loader),
    { revision: 1 },
  );
  assert.equal(loads, 1);
});

test("invalidating during an in-flight load prevents stale cache refill", async () => {
  resetConfigCacheForTests();
  let release;
  const gate = new Promise((resolve) => { release = resolve; });

  const oldLoad = readThroughConfigCache(
    "gift_catalog",
    async () => {
      await gate;
      return { revision: 1 };
    },
  );

  invalidateConfigCache("gift_catalog");
  release();
  assert.deepEqual(await oldLoad, { revision: 1 });

  let loads = 0;
  const fresh = await readThroughConfigCache(
    "gift_catalog",
    async () => ({ revision: ++loads + 1 }),
  );
  assert.deepEqual(fresh, { revision: 2 });
  assert.equal(loads, 1);
});

test("older invalidated load cannot clear a newer in-flight request", async () => {
  resetConfigCacheForTests();

  let releaseOld;
  let releaseNew;
  const oldGate = new Promise((resolve) => { releaseOld = resolve; });
  const newGate = new Promise((resolve) => { releaseNew = resolve; });
  let oldLoads = 0;
  let newLoads = 0;

  const oldRequest = readThroughConfigCache(
    "game_runtime",
    async () => {
      oldLoads += 1;
      await oldGate;
      return { revision: 1 };
    },
  );

  invalidateConfigCache("game_runtime");

  const newLoader = async () => {
    newLoads += 1;
    await newGate;
    return { revision: 2 };
  };
  const newRequest = readThroughConfigCache("game_runtime", newLoader);

  releaseOld();
  assert.deepEqual(await oldRequest, { revision: 1 });

  const joinedRequest = readThroughConfigCache("game_runtime", newLoader);
  assert.equal(newLoads, 1);

  releaseNew();
  assert.deepEqual(await newRequest, { revision: 2 });
  assert.deepEqual(await joinedRequest, { revision: 2 });
  assert.equal(oldLoads, 1);
  assert.equal(newLoads, 1);
});

test("transient classifier covers Firestore quota and availability errors", () => {
  assert.equal(isTransientConfigReadError({ status: 429 }), true);
  assert.equal(isTransientConfigReadError(new Error("RESOURCE_EXHAUSTED")), true);
  assert.equal(isTransientConfigReadError(new Error("UNAVAILABLE")), true);
  assert.equal(isTransientConfigReadError(new Error("permission_denied")), false);
});
