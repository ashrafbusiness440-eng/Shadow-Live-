import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

test("production R2 smoke uses atomic Firestore image message + preview", () => {
  const src = readFileSync(".github/workflows/deploy-cloudflare-worker.yml", "utf8");
  const stageStart = src.indexOf('chatMessageId = "r2_" + stamp;');
  const stageEnd = src.indexOf('const peerRead = await storageCall(', stageStart);
  assert.ok(stageStart > 0 && stageEnd > stageStart);
  const stage = src.slice(stageStart, stageEnd);
  assert.match(stage, /documents:commit/);
  assert.match(stage, /method: "POST"/);
  assert.match(stage, /writes: \[/);
  assert.match(stage, /lastMessageId: \{ stringValue: chatMessageId \}/);
  assert.match(stage, /fieldPath: "updatedAt"/);
  assert.match(stage, /fieldPath: "createdAt"/);
  assert.equal((stage.match(/setToServerValue: "REQUEST_TIME"/g)||[]).length, 2);
  assert.match(stage, /currentDocument: \{ exists: false \}/);
  assert.doesNotMatch(stage, /method: "PATCH"/);
});
