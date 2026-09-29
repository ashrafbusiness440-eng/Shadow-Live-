import assert from "node:assert/strict";
import fs from "node:fs";
import { test } from "node:test";

const script = fs.readFileSync(
  ".github/scripts/ensure-firestore-indexes.mjs",
  "utf8",
);

test("Firestore index deploy lists indexes without unsupported pageSize", () => {
  assert.equal(script.includes("?pageSize="), false);
  assert.ok(script.includes('const listed = await jsonFetch(base, { headers });'));
});

test("Firestore index deploy remains fail-closed until READY", () => {
  assert.ok(script.includes('current.state === "READY"'));
  assert.ok(script.includes('current.state === "NEEDS_REPAIR"'));
  assert.ok(script.includes('current.state === "ERROR"'));
  assert.ok(script.includes("firestore index readiness timeout"));
});
