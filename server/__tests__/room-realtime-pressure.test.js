import assert from "node:assert/strict";
import test from "node:test";

import {
  createAsyncLimiter,
  createAsyncTtlCache,
} from "../../cloudflare-worker/src/room-realtime-pressure.js";
import { roomDepartureCandidatesFromSnapshot } from "../../cloudflare-worker/src/room-realtime-persistence.js";

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


test("abandoned seat reconciliation ignores listeners and caps candidates to one page", () => {
  const pending = ["listener-1", "speaker-1", "speaker-2", "music-1"];
  const result = roomDepartureCandidatesFromSnapshot({
    seats: [
      { uid: "speaker-1", muted: false },
      { uid: "speaker-2", muted: true },
      { uid: "other-speaker", muted: false },
    ],
    musicState: { status: "playing", sourceOwnerUid: "music-1" },
  }, pending);
  assert.deepEqual(Array.from(result).sort(), ["music-1", "speaker-1", "speaker-2"]);
  assert.deepEqual(Array.from(roomDepartureCandidatesFromSnapshot({
    seats: [{ uid: "speaker-1" }],
    musicState: { status: "stopped", sourceOwnerUid: "music-1" },
  }, ["listener-1", "music-1"])), []);

  const over = Array.from({ length: 30 }, (_, i) => "u" + i);
  const capped = roomDepartureCandidatesFromSnapshot({
    seats: [{ uid: "u24" }, { uid: "u23" }, { uid: "u2" }],
  }, over);
  assert.deepEqual(Array.from(capped).sort(), ["u2", "u23"]);
});
