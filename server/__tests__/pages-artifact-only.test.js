import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";

test("production Pages uses exact verified artifact, not a redundant git force-push", () => {
  const workflow = readFileSync(
    new URL("../../.github/workflows/deploy-shadow-control-pages.yml", import.meta.url),
    "utf8",
  );
  assert.match(workflow, /group: shadow-live-pages-production/);
  assert.match(workflow, /cancel-in-progress: true/);
  assert.match(workflow, /actions\/upload-pages-artifact@v4/);
  assert.match(workflow, /actions\/deploy-pages@v4/);
  assert.match(workflow, /ref: \$\{\{ github\.sha \}\}/);
  assert.doesNotMatch(workflow, /git push\s+--force/);
  assert.doesNotMatch(workflow, /git remote add origin/);
});
