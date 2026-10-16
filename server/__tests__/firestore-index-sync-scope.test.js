import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

test("Firestore index sync restricts matches to exact collection group", () => {
  const workflow = readFileSync(".github/workflows/deploy-firestore-rules.yml", "utf8");
  assert.ok(workflow.includes("const existing = (await listIndexes(parentUrl))"));
  assert.ok(workflow.includes("String(index?.name || '').startsWith(parent + '/indexes/')"));
  assert.ok(workflow.includes("const existingSignatures = new Set(existing.map(indexSignature))"));
});
test("index deployment workflow changes force an idempotent sync", () => {
  const workflow = readFileSync(".github/workflows/deploy-firestore-rules.yml", "utf8");
  assert.ok(workflow.includes("grep -Fxq '.github/workflows/deploy-firestore-rules.yml'"));
  assert.ok(workflow.includes('echo "run_index_sync=true"'));
});
