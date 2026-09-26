import assert from "node:assert/strict";
import test from "node:test";

import {
  createAsyncLimiter,
  createAsyncTtlCache,
} from "../../cloudflare-worker/src/room-realtime-pressure.js";

test("realtime ticket limiter bounds concurrent Firestore work", async () => {
  const limiter = createAsyncLimiter(3);
  let active = 0;
  let peak = 0;

  await Promise.all(Array.from({ length: 12 }, (_, index) =>
    limiter.run(async () => {
      active += 1;
      peak = Math.max(peak, active);
      await new Promise((resolve) => setTimeout(resolve, 5));
      active -= 1;
      return index;
    }),
  ));

  assert.equal(peak, 3);
  assert.deepEqual(limiter.snapshot(), { active: 0, queued: 0, limit: 3 });
});

test("realtime room cache single-flights concurrent misses", async () => {
  let nowMs = 1000;
  let loads = 0;
  const cache = createAsyncTtlCache({
    ttlMs: 5000,
    now: () => nowMs,
  });

  const values = await Promise.all(Array.from({ length: 20 }, () =>
    cache.get("room-a", async () => {
      loads += 1;
      await new Promise((resolve) => setTimeout(resolve, 5));
      return { exists: true, data: { isActive: true } };
    }),
  ));

  assert.equal(loads, 1);
  assert.ok(values.every((value) => value.data.isActive === true));

  await cache.get("room-a", async () => {
    loads += 1;
    return { exists: false, data: null };
  });
  assert.equal(loads, 1);

  nowMs += 6000;
  const refreshed = await cache.get("room-a", async () => {
    loads += 1;
    return { exists: true, data: { isActive: false } };
  });

  assert.equal(loads, 2);
  assert.equal(refreshed.data.isActive, false);
});
