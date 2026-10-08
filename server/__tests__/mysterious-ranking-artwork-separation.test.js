import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile } from "node:fs/promises";

test("mysterious artwork does not duplicate existing ranking UI", async () => {
  const template = await readFile(
    new URL("../../cloudflare-worker/src/asset-studio-templates.js", import.meta.url),
    "utf8",
  );
  const spec = await readFile(
    new URL("../../docs/mysterious-person-artwork-spec.md", import.meta.url),
    "utf8",
  );
  assert.equal(template.includes("Ranking/Top3 cards must continue using the existing ranking UI"), true);
  assert.equal(spec.includes("gold banner/shield belongs to the existing ranking UI"), true);
  assert.equal(spec.includes("room_presence_skin = subtle horizontal skin"), true);
});
