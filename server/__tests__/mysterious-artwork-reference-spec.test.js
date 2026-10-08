import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile } from "node:fs/promises";

test("mysterious artwork prompts preserve approved reference separation", async () => {
  const source = await readFile(
    new URL("../../cloudflare-worker/src/asset-studio-templates.js", import.meta.url),
    "utf8",
  );
  assert.equal(source.includes("anonymous hooded figure"), true);
  assert.equal(source.includes("tall premium gold banner/shield"), true);
  assert.equal(source.includes("intentionally distinct from the purple hooded avatar"), true);
  assert.equal(source.includes("Do not bake any digits"), true);
  assert.equal(source.includes("sound remains ZEGO logic"), true);
});
