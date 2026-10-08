import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile } from "node:fs/promises";

test("rocket explosion preserves mysterious visual metadata for trigger and top3", async () => {
  const rocket = await readFile(
    new URL("../../cloudflare-worker/src/room-rocket.js", import.meta.url),
    "utf8",
  );
  const feed = await readFile(
    new URL("../../cloudflare-worker/src/room-rocket-feed.js", import.meta.url),
    "utf8",
  );

  assert.equal(rocket.includes("triggerMysteriousMode"), true);
  assert.equal(rocket.includes("triggerMysteriousId"), true);
  assert.equal(rocket.includes("mysteriousMode: sender.mysteriousMode === true"), true);
  assert.equal(feed.includes("mysteriousMode: item?.mysteriousMode === true"), true);
  assert.equal(feed.includes("triggerMysteriousMode: raw.triggerMysteriousMode === true"), true);
});

test("rocket contributor uid remains internal for reward eligibility", async () => {
  const rocket = await readFile(
    new URL("../../cloudflare-worker/src/room-rocket.js", import.meta.url),
    "utf8",
  );
  assert.equal(rocket.includes("contributorIds: ranked.map((item) => item.uid)"), true);
  assert.equal(rocket.includes("top3: ranked.slice(0, 3)"), true);
});
